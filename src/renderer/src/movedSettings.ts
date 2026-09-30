import type { AppSettings, PlanChoices, PlanSettings } from '../../shared/types'

// The faction plan's assumptions and each character's locks, rule-outs and paces, and the Live page's
// checklist, were kept in this window's local storage (remember.ts): lost with it, and left out of a
// copied settings folder. They are kept in settings.json now; what the storage still holds moves there
// once, when the app next starts.

const PREFIX = 'lt:'
const PLAN = 'factions.plan.'

/** The part of local storage read here. */
export type KeptStorage = Pick<Storage, 'length' | 'key' | 'getItem'>

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/**
 * The settings with what local storage still holds added, and the storage keys it came from: none when
 * there was nothing to move. What settings.json has already wins; a value that cannot be read is dropped,
 * its key still listed so it goes too. settings:save checks the rest.
 */
export function moveRemembered(settings: AppSettings, storage: KeptStorage): { settings: AppSettings; keys: string[] } {
  const names: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k?.startsWith(PREFIX + PLAN) || k?.startsWith(PREFIX + 'setup.')) names.push(k.slice(PREFIX.length))
  }
  const keys: string[] = []
  const read = (name: string): unknown => {
    keys.push(PREFIX + name)
    try {
      return JSON.parse(storage.getItem(PREFIX + name) ?? 'null') as unknown
    } catch {
      return null
    }
  }
  let { assumptions, choices } = settings.factionPlan
  let setup = settings.setup
  for (const name of names) {
    if (name === PLAN + 'settings') {
      const v = read(name)
      if (isObj(v) && !Object.keys(assumptions).length) assumptions = v as Partial<PlanSettings>
    } else if (name.startsWith(PLAN)) {
      const character = name.slice(PLAN.length)
      const v = read(name)
      if (!isObj(v) || Object.hasOwn(choices, character)) continue
      const c: PlanChoices = {
        locks: isObj(v.locks) ? (Object.fromEntries(Object.entries(v.locks).filter(([, id]) => typeof id === 'string')) as Record<string, string>) : {},
        excluded: strings(v.excluded),
        perHour: isObj(v.perHour) ? (Object.fromEntries(Object.entries(v.perHour).filter(([, n]) => typeof n === 'number')) as Record<string, number>) : {}
      }
      if (Object.keys(c.locks).length || c.excluded.length || Object.keys(c.perHour).length) choices = { ...choices, [character]: c }
    } else if (name === 'setup.hidden' || name === 'setup.arranged') {
      if (read(name) === true) setup = { ...setup, [name === 'setup.hidden' ? 'hidden' : 'arranged']: true }
    } else if (name === 'setup.accepted') {
      setup = { ...setup, accepted: [...new Set([...setup.accepted, ...strings(read(name))])] }
    }
  }
  return { settings: keys.length ? { ...settings, factionPlan: { assumptions, choices }, setup } : settings, keys }
}
