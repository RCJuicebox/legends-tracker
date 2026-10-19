import type { AppSettings, SpellRule, Trigger } from '../shared/types'
import { sanitizeSettings, sanitizeSpellRule, sanitizeTriggers } from './validate'

// "Share my setup" (FEAT-028): the parts of a setup a player hands a friend or takes to another PC, in
// one file. Each section carries the schema its store file is at, and comes back through the same
// sanitisers a page's save does; a section written by a newer build than this one is not taken.

export const SETUP_APP = 'legends-tracker-setup'

export type SetupSectionId = 'triggers' | 'spellRules' | 'overlays' | 'audio' | 'tracking'

/** Each section, the store file whose schema it carries, and how it is named on the card. */
export const SETUP_SECTIONS: readonly { id: SetupSectionId; file: string; label: string }[] = [
  { id: 'triggers', file: 'triggers.json', label: 'Triggers' },
  { id: 'spellRules', file: 'spell-rules.json', label: 'Spell rules' },
  { id: 'overlays', file: 'settings.json', label: 'Overlays: places, sizes, text' },
  { id: 'audio', file: 'settings.json', label: 'Voice and volumes' },
  { id: 'tracking', file: 'settings.json', label: 'Spell Timers defaults' }
]

interface Section<T> {
  schema: number
  value: T
}

export interface SetupFile {
  app: typeof SETUP_APP
  /** The version that wrote it, for a person reading the file. */
  version: string
  written: string
  sections: {
    triggers?: Section<Trigger[]>
    spellRules?: Section<Record<string, SpellRule>>
    overlays?: Section<Pick<AppSettings, 'overlays' | 'overlaysOnlyWithGame' | 'uiScale'>>
    audio?: Section<Omit<AppSettings['audio'], 'deviceId' | 'muted'>>
    tracking?: Section<AppSettings['tracking']>
  }
}

/** The setup as one file. The audio device and mute stay behind: they belong to the PC, not the player. */
export function buildSetup(
  s: AppSettings,
  triggers: Trigger[],
  rules: Record<string, SpellRule>,
  schemas: Readonly<Record<string, number>>,
  version: string,
  now: Date
): SetupFile {
  const schema = (id: SetupSectionId) => schemas[SETUP_SECTIONS.find((x) => x.id === id)!.file] ?? 1
  const { deviceId: _d, muted: _m, ...audio } = s.audio
  return {
    app: SETUP_APP,
    version,
    written: now.toISOString(),
    sections: {
      triggers: { schema: schema('triggers'), value: triggers },
      spellRules: { schema: schema('spellRules'), value: rules },
      overlays: { schema: schema('overlays'), value: { overlays: s.overlays, overlaysOnlyWithGame: s.overlaysOnlyWithGame, uiScale: s.uiScale } },
      audio: { schema: schema('audio'), value: audio },
      tracking: { schema: schema('tracking'), value: s.tracking }
    }
  }
}

/** What a setup file holds, cleaned: what the card lists, and what applying it writes. */
export interface SetupRead {
  version: string
  triggers?: Trigger[]
  spellRules?: Record<string, SpellRule>
  /** The settings with each settings section of the file put in, apart. */
  overlays?: Pick<AppSettings, 'overlays' | 'overlaysOnlyWithGame' | 'uiScale'>
  audio?: AppSettings['audio']
  tracking?: AppSettings['tracking']
  /** Sections a newer build wrote, left out. */
  newer: string[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Reads a setup file against the settings now (`prev`); null when it is not one. */
export function readSetup(v: unknown, prev: AppSettings, schemas: Readonly<Record<string, number>>): SetupRead | null {
  if (!isObj(v) || v.app !== SETUP_APP || !isObj(v.sections)) return null
  const sections = v.sections
  const out: SetupRead = { version: typeof v.version === 'string' ? v.version.slice(0, 40) : '', newer: [] }
  const take = (id: SetupSectionId): unknown => {
    const sec = sections[id]
    if (!isObj(sec)) return undefined
    const def = SETUP_SECTIONS.find((x) => x.id === id)!
    if (typeof sec.schema === 'number' && sec.schema > (schemas[def.file] ?? 1)) {
      out.newer.push(def.label)
      return undefined
    }
    return sec.value
  }
  const triggers = sanitizeTriggers(take('triggers'))
  if (triggers?.length) out.triggers = triggers
  const rules = take('spellRules')
  if (isObj(rules)) {
    const clean: Record<string, SpellRule> = {}
    for (const [name, r] of Object.entries(rules)) {
      const rule = name.length <= 100 ? sanitizeSpellRule(r) : null
      if (rule) clean[name] = rule
    }
    if (Object.keys(clean).length) out.spellRules = clean
  }
  // Each settings section through the settings' own sanitiser, over the settings now.
  const overlays = take('overlays')
  if (isObj(overlays)) {
    const s = sanitizeSettings({ ...prev, ...overlays }, prev)
    if (s) out.overlays = { overlays: s.overlays, overlaysOnlyWithGame: s.overlaysOnlyWithGame, uiScale: s.uiScale }
  }
  const audio = take('audio')
  if (isObj(audio)) {
    const s = sanitizeSettings({ ...prev, audio: { ...prev.audio, ...audio, deviceId: prev.audio.deviceId, muted: prev.audio.muted } }, prev)
    if (s) out.audio = s.audio
  }
  const tracking = take('tracking')
  if (isObj(tracking)) {
    const s = sanitizeSettings({ ...prev, tracking }, prev)
    if (s) out.tracking = s.tracking
  }
  return out
}

/** The card's lines: each section in the file, with how much of it there is. */
export function setupSummary(r: SetupRead): { id: SetupSectionId; label: string; detail: string }[] {
  const out: { id: SetupSectionId; label: string; detail: string }[] = []
  const label = (id: SetupSectionId) => SETUP_SECTIONS.find((x) => x.id === id)!.label
  if (r.triggers) out.push({ id: 'triggers', label: label('triggers'), detail: `${r.triggers.length}: added to yours, a trigger of the same id replaced` })
  if (r.spellRules) out.push({ id: 'spellRules', label: label('spellRules'), detail: `${Object.keys(r.spellRules).length}: added to yours, a spell's rule replaced` })
  if (r.overlays) out.push({ id: 'overlays', label: label('overlays'), detail: `${r.overlays.overlays.length} overlays: replace yours` })
  if (r.audio) out.push({ id: 'audio', label: label('audio'), detail: 'replace yours (your device stays)' })
  if (r.tracking) out.push({ id: 'tracking', label: label('tracking'), detail: 'replace yours' })
  return out
}

/** What applying the picked sections makes of the setup now: new triggers, rules and settings. */
export function applySetup(
  r: SetupRead,
  picked: readonly SetupSectionId[],
  now: { settings: AppSettings; triggers: Trigger[]; rules: Record<string, SpellRule> }
): { settings: AppSettings; triggers: Trigger[]; rules: Record<string, SpellRule> } {
  const on = (id: SetupSectionId) => picked.includes(id)
  let triggers = now.triggers
  if (on('triggers') && r.triggers) {
    const incoming = new Map(r.triggers.map((t) => [t.id, t]))
    triggers = [...now.triggers.map((t) => incoming.get(t.id) ?? t), ...r.triggers.filter((t) => !now.triggers.some((x) => x.id === t.id))]
  }
  const rules = on('spellRules') && r.spellRules ? { ...now.rules, ...r.spellRules } : now.rules
  let settings = now.settings
  if (on('overlays') && r.overlays) settings = { ...settings, ...r.overlays }
  if (on('audio') && r.audio) settings = { ...settings, audio: { ...r.audio, deviceId: settings.audio.deviceId, muted: settings.audio.muted } }
  if (on('tracking') && r.tracking) settings = { ...settings, tracking: r.tracking }
  return { settings, triggers, rules }
}
