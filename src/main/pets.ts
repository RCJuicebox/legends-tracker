import { app } from 'electron'
import { writeFileAtomic } from './storeCore'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseLogLine } from '../core/logLine'
import { readBackward, identityOf } from './sources/logHistory'
import { sameFile } from '../core/fileIdentity'
import { CAST_BY_YOU } from '../core/phrases'
import { PET_GEAR_HEAD, PetGearReader, parsePetGuide, parseSummonPage, type PetGearReading, type PetMelee, type PetProfile } from '../core/pets'
import { log } from './log'
import { wiki } from './sources/wiki'
import type { PetState } from '../shared/ipc'
import { cacheDir } from './paths'
import { sources } from './sources/registry'
import { expired, WIKI_FRESH_MS } from './sources/freshness'

// The pet: what it wears (the log's `/pet inventory check` lists) and which pet it is (the last
// summoning spell cast), both kept per character so an archived log loses neither; and the pet's
// classes, level, stats and base melee from its eqlwiki pages, cached a week.

export type { PetState }

/**
 * The last gear list and the last summoning cast in a log, read from its end backwards. Stops at the
 * start, after `maxBytes`, or at `stopAt`: where the last scan of this file ended, since the live log
 * has been followed from there.
 */
export async function scanPetLog(logPath: string, isSummon: (name: string) => string | null, opts: { maxBytes?: number; stopAt?: number } = {}): Promise<PetState> {
  const out: PetState = { gear: null, summon: null }
  // Lines after the one being looked at, nearest first: a gear list is found at its heading, after its items.
  let after: string[] = []
  try {
    await readBackward(
      logPath,
      (raw) => {
        if (!out.gear && raw.endsWith(PET_GEAR_HEAD)) {
          const head = parseLogLine(raw)
          if (head) {
            let reading: PetGearReading | null = null
            const reader = new PetGearReader((r) => (reading = r))
            reader.handle(head.text, head.time)
            for (const next of after) {
              const l = parseLogLine(next)
              if (!l) break
              reader.handle(l.text, l.time)
              if (reading) break
            }
            reader.flush()
            out.gear = reading
          }
        }
        if (!out.summon && raw.includes('] You begin casting ')) {
          const l = parseLogLine(raw)
          const name = l && CAST_BY_YOU.exec(l.text)?.[1]
          const spell = name ? isSummon(name) : null
          if (spell && l) out.summon = { spell, at: l.time }
        }
        if (out.gear && out.summon) return true
        after = [raw, ...after.slice(0, 24)]
      },
      { maxBytes: opts.maxBytes ?? PET_SCAN_MAX, stopAt: opts.stopAt }
    )
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read ${logPath} for the pet:`, e)
  }
  return out
}

/** How far back a log is read for the pet: far enough for a session or two, not a whole year of log. */
const PET_SCAN_MAX = 32 << 20

/** A character's pet, and how far their log has been read back for it. */
type PetRecord = PetState & { scanned?: { path: string; id: string; size: number } }

/** pets.json: the newest gear list and summoning cast seen, per character. */
export class PetStore {
  private data: Record<string, PetRecord> | null = null

  private get path(): string {
    return join(app.getPath('userData'), 'pets.json')
  }

  private async load(): Promise<Record<string, PetRecord>> {
    if (this.data) return this.data
    try {
      const v = JSON.parse(await fs.readFile(this.path, 'utf8')) as unknown
      this.data = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, PetRecord>) : {}
    } catch {
      this.data = {}
    }
    return this.data
  }

  async get(character: string): Promise<PetState> {
    const d = await this.load()
    const p = d[character]
    return p ? { gear: p.gear, summon: p.summon } : { gear: null, summon: null }
  }

  /**
   * Reads a character's log back for the pet, from the end to where the last scan of the same file
   * stopped (the live log was followed from there), and keeps what it finds.
   */
  async scan(character: string, logPath: string, isSummon: (name: string) => string | null): Promise<void> {
    const d = await this.load()
    let st
    try {
      st = await fs.stat(logPath, { bigint: true })
    } catch {
      return
    }
    const now = { id: identityOf(st), size: Number(st.size) }
    const was = d[character]?.scanned
    const stopAt = was && was.path.toLowerCase() === logPath.toLowerCase() && sameFile(was, now) ? was.size : 0
    const found = await scanPetLog(logPath, isSummon, { stopAt })
    d[character] = { ...(d[character] ?? { gear: null, summon: null }), scanned: { path: logPath, ...now } }
    await this.merge(character, found, true)
  }

  /** Keeps whichever of each is newer. Returns true when anything changed. */
  async merge(character: string, next: Partial<PetState>, save = false): Promise<boolean> {
    const d = await this.load()
    const cur = d[character] ?? { gear: null, summon: null }
    const gear = next.gear && (!cur.gear || next.gear.at >= cur.gear.at) ? next.gear : cur.gear
    const summon = next.summon && (!cur.summon || next.summon.at >= cur.summon.at) ? next.summon : cur.summon
    if (gear === cur.gear && summon === cur.summon && !save) return false
    d[character] = { ...cur, gear, summon }
    try {
      await writeFileAtomic(this.path, JSON.stringify(d, null, 2))
    } catch (e) {
      log.warn('Could not save pets.json:', e)
    }
    return gear !== cur.gear || summon !== cur.summon
  }
}

interface WikiCache {
  guide?: { fetchedAt: number; melee: Record<string, PetMelee & { unsure: boolean }> }
  pages: Record<string, { fetchedAt: number; profile: ReturnType<typeof parseSummonPage> | null }>
}

/** Pet pages from eqlwiki: "<spell> Summon" for the pet, and the Pet Guide for its base melee. */
export class PetWiki {
  private cache: WikiCache | null = null

  private get path(): string {
    return join(cacheDir(), 'pet-wiki.json')
  }

  private async load(): Promise<WikiCache> {
    if (this.cache) return this.cache
    try {
      this.cache = JSON.parse(await fs.readFile(this.path, 'utf8')) as WikiCache
      if (!this.cache.pages) this.cache.pages = {}
    } catch {
      this.cache = { pages: {} }
    }
    return this.cache
  }

  private async save(): Promise<void> {
    try {
      await writeFileAtomic(this.path, JSON.stringify(this.cache))
    } catch (e) {
      log.warn('Could not save pet-wiki.json:', e)
    }
  }

  private wikitext(title: string): Promise<string | null> {
    return wiki.wikitext(title)
  }

  /** The pet a spell summons; null when the wiki has no page for it. Stale pages are fetched again, and kept if the wiki is down. */
  async profile(spell: string, force = false): Promise<PetProfile | null> {
    const c = await this.load()
    const now = Date.now()
    const key = spell.toLowerCase()
    let changed = false
    try {
      if (force || expired(c.guide?.fetchedAt, WIKI_FRESH_MS, now)) {
        const text = await this.wikitext('Pet Guide')
        if (text) c.guide = { fetchedAt: now, melee: Object.fromEntries(parsePetGuide(text)) }
        changed = true
      }
      const page = c.pages[key]
      if (force || expired(page?.fetchedAt, WIKI_FRESH_MS, now)) {
        const text = await this.wikitext(`${spell} Summon`)
        c.pages[key] = { fetchedAt: now, profile: text ? parseSummonPage(spell, text) : null }
        changed = true
      }
      sources.ok('petWiki', `${Object.keys(c.pages).length} pet page${Object.keys(c.pages).length === 1 ? '' : 's'} kept`)
    } catch (e) {
      sources.fail('petWiki', e, `Could not fetch the pages for ${spell}`)
      if (!c.pages[key]) throw e
    } finally {
      if (changed) await this.save()
    }
    const p = c.pages[key]?.profile
    if (!p) return null
    const g = c.guide?.melee[key]
    const { dualWield, ...rest } = p
    const melee: PetMelee | null = g ? { damage: g.damage, delay: g.delay, bonus: g.bonus, dualWield: dualWield ?? g.dualWield } : null
    return { ...rest, melee, unsure: [...rest.unsure, ...(g?.unsure ? ['base melee'] : [])] }
  }
}
