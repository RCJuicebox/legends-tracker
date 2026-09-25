import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseLogLine } from '../core/logLine'
import { PET_GEAR_HEAD, PetGearReader, parsePetGuide, parseSummonPage, type PetGearReading, type PetMelee, type PetProfile } from '../core/pets'
import { log } from './log'

// The pet: what it wears (the log's `/pet inventory check` lists) and which pet it is (the last
// summoning spell cast), both kept per character so an archived log loses neither; and the pet's
// classes, level, stats and base melee from its eqlwiki pages, cached a week.

const API = 'https://eqlwiki.com/api.php'
const AGENT = 'LegendsTracker (https://github.com/RCJuicebox/legends-tracker)'
const FRESH_MS = 7 * 24 * 3600_000
const TIMEOUT_MS = 15_000

export interface PetSummon {
  /** Unranked: "Frenzied Spirit". */
  spell: string
  at: number
}

export interface PetState {
  gear: PetGearReading | null
  summon: PetSummon | null
}


/**
 * The last gear list and the last summoning cast in a log, read from its end backwards. Stops at the
 * start or after `maxBytes`.
 */
export async function scanPetLog(logPath: string, isSummon: (name: string) => string | null, maxBytes = 256 << 20): Promise<PetState> {
  const out: PetState = { gear: null, summon: null }
  let handle
  try {
    handle = await fs.open(logPath, 'r')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not open ${logPath} for the pet:`, e)
    return out
  }
  const step = 1 << 20
  try {
    const size = (await handle.stat()).size
    let carry = ''
    // Lines after the one being looked at, nearest first: a gear list is found at its heading, after its items.
    let after: string[] = []
    for (let end = size; end > 0 && size - end < maxBytes && !(out.gear && out.summon); end -= step) {
      const start = Math.max(0, end - step)
      const buf = Buffer.alloc(end - start)
      await handle.read(buf, 0, buf.length, start)
      const lines = (buf.toString('latin1') + carry).split('\n')
      carry = start > 0 ? (lines.shift() ?? '') : ''
      for (let i = lines.length - 1; i >= 0; i--) {
        const raw = lines[i].replace(/\r$/, '')
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
          const name = l && /^You begin casting (.+)\.$/.exec(l.text)?.[1]
          const spell = name ? isSummon(name) : null
          if (spell && l) out.summon = { spell, at: l.time }
        }
        if (out.gear && out.summon) break
        after = [raw, ...after.slice(0, 24)]
      }
    }
  } catch (e) {
    log.warn(`Could not read ${logPath} for the pet:`, e)
  } finally {
    await handle.close()
  }
  return out
}

/** pets.json: the newest gear list and summoning cast seen, per character. */
export class PetStore {
  private data: Record<string, PetState> | null = null

  private get path(): string {
    return join(app.getPath('userData'), 'pets.json')
  }

  private async load(): Promise<Record<string, PetState>> {
    if (this.data) return this.data
    try {
      const v = JSON.parse(await fs.readFile(this.path, 'utf8')) as unknown
      this.data = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, PetState>) : {}
    } catch {
      this.data = {}
    }
    return this.data
  }

  async get(character: string): Promise<PetState> {
    const d = await this.load()
    return d[character] ?? { gear: null, summon: null }
  }

  /** Keeps whichever of each is newer. Returns true when anything changed. */
  async merge(character: string, next: Partial<PetState>): Promise<boolean> {
    const d = await this.load()
    const cur = d[character] ?? { gear: null, summon: null }
    const gear = next.gear && (!cur.gear || next.gear.at >= cur.gear.at) ? next.gear : cur.gear
    const summon = next.summon && (!cur.summon || next.summon.at >= cur.summon.at) ? next.summon : cur.summon
    if (gear === cur.gear && summon === cur.summon) return false
    d[character] = { gear, summon }
    const tmp = this.path + '.tmp'
    try {
      await fs.writeFile(tmp, JSON.stringify(d, null, 2))
      await fs.rename(tmp, this.path)
    } catch (e) {
      log.warn('Could not save pets.json:', e)
    }
    return true
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
    return join(app.getPath('userData'), 'pet-wiki.json')
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
    const tmp = this.path + '.tmp'
    try {
      await fs.writeFile(tmp, JSON.stringify(this.cache))
      await fs.rename(tmp, this.path)
    } catch (e) {
      log.warn('Could not save pet-wiki.json:', e)
    }
  }

  private async wikitext(title: string): Promise<string | null> {
    const url = `${API}?action=parse&format=json&formatversion=2&redirects=1&prop=wikitext&page=${encodeURIComponent(title.replace(/ /g, '_'))}`
    const res = await fetch(url, { headers: { 'User-Agent': AGENT, 'Api-User-Agent': AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`eqlwiki answered ${res.status}`)
    const body = (await res.json()) as { parse?: { wikitext?: string }; error?: { code: string } }
    if (body.error?.code === 'missingtitle') return null
    return body.parse?.wikitext ?? null
  }

  /** The pet a spell summons; null when the wiki has no page for it. Stale pages are fetched again, and kept if the wiki is down. */
  async profile(spell: string, force = false): Promise<PetProfile | null> {
    const c = await this.load()
    const now = Date.now()
    const key = spell.toLowerCase()
    let changed = false
    try {
      if (force || !c.guide || now - c.guide.fetchedAt > FRESH_MS) {
        const text = await this.wikitext('Pet Guide')
        if (text) c.guide = { fetchedAt: now, melee: Object.fromEntries(parsePetGuide(text)) }
        changed = true
      }
      const page = c.pages[key]
      if (force || !page || now - page.fetchedAt > FRESH_MS) {
        const text = await this.wikitext(`${spell} Summon`)
        c.pages[key] = { fetchedAt: now, profile: text ? parseSummonPage(spell, text) : null }
        changed = true
      }
    } catch (e) {
      log.warn(`Could not fetch the wiki pages for ${spell}:`, e)
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
