import { app } from 'electron'
import type { MoteState } from '../core/motes'
import type { RespawnRecords } from '../core/respawns'
import type { BuffsFile } from '../core/buffs'
import { join } from 'node:path'
import {
  DEFAULT_CHARACTER,
  type AppSettings,
  type CharacterSettings,
  type FocusSource,
  type MoteStock,
  type SpellRule,
  type Trigger
} from '../shared/types'
import { sanitizeBuffs, sanitizeRespawns, sanitizeSettings } from './validate'
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

  constructor(defaultTriggersPath: string) {
    const p = (f: string) => join(this.dir, f)
    const read = (f: string): unknown => {
      const r: ReadResult = readJsonFile(p(f))
      if (r.state === 'corrupt') this.recovered.push(r.movedTo)
      return r.state === 'ok' ? r.value : undefined
    }

    const settingsRead = readJsonFile(p('settings.json'))
    if (settingsRead.state === 'corrupt') this.recovered.push(settingsRead.movedTo)
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

    const triggersRead = readJsonFile(p('triggers.json'))
    if (triggersRead.state === 'corrupt') this.recovered.push(triggersRead.movedTo)
    const firstRun = triggersRead.state === 'missing'
    const triggers = firstRun ? readJsonFile(defaultTriggersPath, { setAside: false }) : triggersRead
    const list = triggers.state === 'ok' && Array.isArray(triggers.value) ? (triggers.value as Trigger[]) : []
    this.triggers = new JsonFile(p('triggers.json'), list)
    if (firstRun) this.triggers.markDirty()

    this.rules = new JsonFile(p('spell-rules.json'), (read('spell-rules.json') as Record<string, SpellRule>) ?? {})
    this.casts = new JsonFile(p('casts.json'), (read('casts.json') as Record<string, KnownCast>) ?? {})
    // Mote history is rebuilt from the logs when its file is missing or unreadable.
    const motes = read('motes.json') as MoteState | undefined
    this.motesFresh = !motes
    this.motes = new JsonFile(p('motes.json'), motes ?? { active: null, sessions: [], daily: {} })
    this.stock = new JsonFile(
      p('mote-stock.json'),
      mergeDefaults<MoteStock>({ counts: {}, item: { name: '', lvl: 0, xp: 0, to: 1 }, autoAdd: true }, read('mote-stock.json'))
    )
    this.respawns = new JsonFile(p('respawns.json'), sanitizeRespawns(read('respawns.json')))
    this.buffs = new JsonFile(p('buffs.json'), sanitizeBuffs(read('buffs.json')))
  }

  characterOf(logFile: string): CharacterSettings {
    const s = this.settings.get()
    const c = mergeDefaults(DEFAULT_CHARACTER, s.characters[characterKey(logFile)])
    // A character saved with one flat focus figure keeps it, as a single source, until it is replaced.
    if (!c.focusSources.length && (c.beneficialFocusPct || c.detrimentalFocusPct)) {
      const legacy = (pct: number, appliesTo: FocusSource['appliesTo']): FocusSource => ({
        id: `legacy-${appliesTo}`, name: `${appliesTo === 'beneficial' ? 'Beneficial' : 'Detrimental'} duration focus`, kind: 'aa', from: 'earlier setting',
        pct, appliesTo, maxLevel: 0, decayPct: 0, minTicks: 0, requireSpas: [], excludeSpas: [], enabled: true
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
    const files = [this.settings, this.triggers, this.rules, this.casts, this.motes, this.stock, this.respawns, this.buffs]
    await Promise.allSettled(files.map((f) => f.flush()))
  }
}
