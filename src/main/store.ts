import { app } from 'electron'
import type { MoteState } from '../core/motes'
import type { RespawnRecords } from '../core/respawns'
import type { BuffsFile } from '../core/buffs'
import { join } from 'node:path'
import { DEFAULT_CHARACTER, type AppSettings, type CharacterSettings, type FocusSource, type MoteStock, type SpellRule, type Trigger } from '../shared/types'
import { sanitizeBuffs, sanitizeCasts, sanitizeMoteStock, sanitizeMotes, sanitizeRespawns, sanitizeSettings } from '../core/validate'
import { SCHEMAS, upgrade } from './schema'
import { DEFAULT_OVERLAYS, JsonFile, characterKey, defaultSettings, mergeDefaults, readJsonFile, type ReadResult } from './storeCore'

export { DEFAULT_OVERLAYS, characterKey, characterName, defaultSettings } from './storeCore'

export interface KnownCast {
  rankedName: string
  lastCast: number
  count: number
}

export class Store {
  readonly dir = app.getPath('userData')
  readonly settings: JsonFile<AppSettings>
  readonly triggers: JsonFile<Trigger[]>
  readonly rules: JsonFile<Record<string, SpellRule>>
  readonly casts: JsonFile<Record<string, KnownCast>>
  readonly motes: JsonFile<MoteState>
  readonly stock: JsonFile<MoteStock>
  readonly respawns: JsonFile<RespawnRecords>
  readonly buffs: JsonFile<BuffsFile>
  /** True until mote history has been built from the logs once (or after its file was unreadable). */
  readonly motesFresh: boolean
  /** True on a first run, before any settings were saved. An unreadable settings file is not a first run. */
  readonly settingsFresh: boolean
  /** Files that would not parse and were moved aside this start, by the name they were moved to. */
  readonly recovered: string[] = []
  /** Files a newer build wrote: read, but not written this run. */
  readonly newer: string[] = []
  /** Files that were there but could not be opened (held by another program): defaults in use, not written this run. */
  readonly unreadable: string[] = []
  /** Each file's schema, as schema.json records it (see schema.ts). */
  private readonly schema: JsonFile<Record<string, number>>

  constructor(defaultTriggersPath: string) {
    const p = (f: string) => join(this.dir, f)
    // Files from before schema.json existed are at schema 1.
    const schemaRead = readJsonFile(p('schema.json'))
    const recorded = schemaRead.state === 'ok' && schemaRead.value && typeof schemaRead.value === 'object' ? (schemaRead.value as Record<string, number>) : {}
    const versions: Record<string, number> = { ...SCHEMAS }
    const migrated: string[] = []
    /** A file as read and brought up to this build's schema; undefined when missing or unreadable. */
    const readResult = (f: string): ReadResult => {
      const r = readJsonFile(p(f))
      if (r.state === 'corrupt') this.recovered.push(r.movedTo)
      if (r.state === 'unreadable') this.unreadable.push(f)
      if (r.state !== 'ok') return r
      const up = upgrade(p(f), r.value, typeof recorded[f] === 'number' ? recorded[f] : 1)
      if (up.state.state === 'newer') {
        this.newer.push(f)
        versions[f] = up.state.version
      } else if (up.state.state === 'migrated') migrated.push(f)
      return { state: 'ok', value: up.value }
    }
    const read = (f: string): unknown => {
      const r = readResult(f)
      return r.state === 'ok' ? r.value : undefined
    }

    const settingsRead = readResult('settings.json')
    this.settingsFresh = settingsRead.state === 'missing'
    const savedSettings = settingsRead.state === 'ok' ? settingsRead.value : undefined
    // Every default overlay is built in and cannot be removed, so one missing from the saved list (an
    // older build let the meter and respawn overlays be removed) comes back. The result is checked the
    // way a save from a page is, so a hand-edited or half-migrated value cannot break the start.
    const merged = mergeDefaults(defaultSettings(), savedSettings, () => true)
    this.settings = new JsonFile(p('settings.json'), sanitizeSettings(merged, defaultSettings()) ?? defaultSettings())
    if (savedSettings) {
      const saved = (savedSettings as { overlays?: unknown }).overlays
      const have = new Set(Array.isArray(saved) ? saved.map((o) => (o as { id?: unknown })?.id) : [])
      // Written at the next save or at quit, not on a timer: a second copy of the app, started by
      // mistake and quitting at once, must not write anything.
      if (DEFAULT_OVERLAYS.some((o) => !have.has(o.id))) this.settings.markDirty()
    }

    const triggersRead = readResult('triggers.json')
    const firstRun = triggersRead.state === 'missing'
    const triggers = firstRun ? readJsonFile(defaultTriggersPath, { setAside: false }) : triggersRead
    const list = triggers.state === 'ok' && Array.isArray(triggers.value) ? (triggers.value as Trigger[]) : []
    this.triggers = new JsonFile(p('triggers.json'), list)
    if (firstRun) this.triggers.markDirty()

    this.rules = new JsonFile(p('spell-rules.json'), (read('spell-rules.json') as Record<string, SpellRule>) ?? {})
    // Files the log changes every few seconds wait a while and go compact: a crash loses at most that
    // long, and mote catch-up reads it back from the log anyway.
    const often = { delayMs: 15_000, pretty: false }
    // Each file the log keeps changing is checked on the way in, like the settings: a hand edit or a
    // half-written file must not throw in the engine's tick on every start.
    this.casts = new JsonFile<Record<string, KnownCast>>(p('casts.json'), sanitizeCasts(read('casts.json')), often)
    // Mote history is rebuilt from the logs when its file is missing, unreadable or the wrong shape.
    const motes = sanitizeMotes(read('motes.json'))
    this.motesFresh = !motes
    this.motes = new JsonFile<MoteState>(p('motes.json'), motes ?? { active: null, sessions: [], daily: {} }, often)
    this.stock = new JsonFile<MoteStock>(p('mote-stock.json'), sanitizeMoteStock(read('mote-stock.json')), { delayMs: 3000 })
    this.respawns = new JsonFile(p('respawns.json'), sanitizeRespawns(read('respawns.json')), often)
    this.buffs = new JsonFile(p('buffs.json'), sanitizeBuffs(read('buffs.json')), often)

    const byName: Record<string, JsonFile<unknown>> = {
      'settings.json': this.settings,
      'triggers.json': this.triggers,
      'spell-rules.json': this.rules,
      'casts.json': this.casts,
      'motes.json': this.motes,
      'mote-stock.json': this.stock,
      'respawns.json': this.respawns,
      'buffs.json': this.buffs
    }
    for (const f of this.newer) byName[f]?.freeze('written by a newer version')
    // Its contents are unknown, not bad: writing defaults over it would lose them.
    for (const f of this.unreadable) byName[f]?.freeze('could not be read at start')
    // Brought forward: written in the new shape at the next save or at quit.
    for (const f of migrated) byName[f]?.markDirty()
    this.schema = new JsonFile(p('schema.json'), versions)
    if (Object.keys(versions).some((f) => recorded[f] !== versions[f])) this.schema.markDirty()
  }

  characterOf(logFile: string): CharacterSettings {
    return this.characterByKey(characterKey(logFile))
  }

  characterByKey(key: string): CharacterSettings {
    const s = this.settings.get()
    const c = mergeDefaults(DEFAULT_CHARACTER, s.characters[key])
    // A character saved with one flat focus figure keeps it, as a single source, until it is replaced.
    if (!c.focusSources.length && (c.beneficialFocusPct || c.detrimentalFocusPct)) {
      const legacy = (pct: number, appliesTo: FocusSource['appliesTo']): FocusSource => ({
        id: `legacy-${appliesTo}`,
        name: `${appliesTo === 'beneficial' ? 'Beneficial' : 'Detrimental'} duration focus`,
        kind: 'aa',
        from: 'earlier setting',
        pct,
        appliesTo,
        maxLevel: 0,
        decayPct: 0,
        minTicks: 0,
        requireSpas: [],
        excludeSpas: [],
        enabled: true
      })
      c.focusSources = [
        ...(c.beneficialFocusPct ? [legacy(c.beneficialFocusPct, 'beneficial')] : []),
        ...(c.detrimentalFocusPct ? [legacy(c.detrimentalFocusPct, 'detrimental')] : [])
      ]
    }
    delete c.beneficialFocusPct
    delete c.detrimentalFocusPct
    return c
  }

  /** Writes whatever changed. Never rejects: a file that cannot be written is logged. */
  async flushAll(): Promise<void> {
    const files = [this.settings, this.triggers, this.rules, this.casts, this.motes, this.stock, this.respawns, this.buffs, this.schema]
    await Promise.allSettled(files.map((f) => f.flush()))
  }
}
