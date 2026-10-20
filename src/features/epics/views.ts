import { itemKey } from '../../core/inventory'
import { heldFrom, heldOf, type CountFrom } from '../../core/itemTally'
import { EPIC_CLASSES, everyStep, stepName, tickKey, type EpicClass, type EpicState, type EpicStep } from './core'

// What Goals › Epics draws from a character's state (core.ts): each class's steps with what is held of
// each, which are done and why (in hand, ticked off, or covered by the reward above them or the
// finished epic), how much of each item the classes shown still want between them, and the other
// tabs' lists: where to hunt for what is missing (Targets) and every item (Items).

export type { CountFrom }

/** How many of an item a character holds, counted from where the player chose. */
export function held(s: Pick<EpicState, 'logged' | 'adjust' | 'exported'>, name: string, from: CountFrom): number {
  return heldFrom(heldOf(s, name), s.exported ? (s.exported.counts[itemKey(name)] ?? 0) : null, from)
}

/** A step as the page shows it. */
export interface StepView {
  step: EpicStep
  cls: string
  name: string
  depth: number
  /** Held of its item; 0 for a quest with no reward named. */
  have: number
  /** What the classes shown still want of its item between them, this step's share in: 0 once nothing does. */
  need: number
  /** More than this step takes is wanted: another step, or another class, takes it too. */
  shared: boolean
  ticked: boolean
  /** Enough is held for every step that wants it. */
  enough: boolean
  /** Why it is done by something above it: "Darkforge Breastplate in hand", "Innoruuk's Curse in hand". Null when nothing above covers it. */
  covered: string | null
  /** Ticked, enough held, or covered. */
  done: boolean
  parts: StepView[]
}

/** A class as the page shows it. */
export interface ClassView {
  cls: string
  epic: string[]
  /** The finished epic in hand, by name; null when not (or none is known). */
  finished: string | null
  steps: StepView[]
  /** The pieces to gather (the steps with nothing under them), and how many are done. */
  pieces: number
  done: number
  /** The share done, 0 to 1. */
  near: number
}

type Counts = Pick<EpicState, 'logged' | 'adjust' | 'exported' | 'ticks'>

/**
 * The classes given, each step with what is held and what the classes still want. A step is its own
 * once ticked or its item held as many as it takes; a step under one that is covers nothing more,
 * nor does any step of a class whose finished epic is in hand. What is wanted of an item is every
 * step not covered or ticked, across the classes given, so one Shining Metallic Robes is half of what
 * an Enchanter and a Rogue want.
 */
export function classViews(classes: readonly EpicClass[], s: Counts, from: CountFrom): ClassView[] {
  const have = (name: string) => held(s, name, from)
  // What every class wants of each item, by item key: the steps that nothing covers.
  const wanted = new Map<string, number>()
  const wanting = new Map<string, number>()
  const first = classes.map((c) => {
    const finished = c.epic.find((e) => have(e) > 0) ?? null
    const view = (step: EpicStep, depth: number, covered: string | null): StepView => {
      const ticked = s.ticks.includes(tickKey(c.cls, step))
      const h = step.item ? have(step.item) : 0
      const own = ticked || (!!step.item && h >= step.qty)
      if (step.item && !ticked && !covered) {
        const k = itemKey(step.item)
        wanted.set(k, (wanted.get(k) ?? 0) + step.qty)
        wanting.set(k, (wanting.get(k) ?? 0) + 1)
      }
      const below = covered ?? (own ? `${stepName(step)} ${ticked ? 'ticked off' : 'in hand'}` : null)
      return {
        step,
        cls: c.cls,
        name: stepName(step),
        depth,
        have: h,
        need: 0,
        shared: false,
        ticked,
        enough: own && !ticked,
        covered,
        done: own || !!covered,
        parts: step.parts.map((p) => view(p, depth + 1, below))
      }
    }
    const steps = c.steps.map((st) => view(st, 0, finished ? `${finished} in hand` : null))
    return { cls: c.cls, epic: c.epic, finished, steps }
  })
  // Then each step against what everything wants of its item.
  return first.map((c) => {
    const settle = (v: StepView): StepView => {
      const k = v.step.item ? itemKey(v.step.item) : ''
      const need = v.step.item && !v.ticked && !v.covered ? (wanted.get(k) ?? 0) : 0
      const enough = need > 0 ? v.have >= need : v.enough
      const done = v.ticked || !!v.covered || enough
      const shared = need > v.step.qty && (wanting.get(k) ?? 0) > 1
      const parts = v.parts.map((p) => settle(done && !p.covered ? { ...p, covered: p.covered ?? `${v.name} in hand` } : p))
      return { ...v, need, shared, enough, done, parts }
    }
    const steps = c.steps.map(settle)
    const leaves = (vs: StepView[]): StepView[] => vs.flatMap((v) => (v.parts.length ? leaves(v.parts) : [v]))
    const pieces = leaves(steps)
    const done = pieces.filter((p) => p.done).length
    return { ...c, steps, pieces: pieces.length, done, near: pieces.length ? done / pieces.length : 1 }
  })
}

/** Every step of a class view, depth first. */
export const everyView = (views: readonly StepView[]): StepView[] => views.flatMap((v) => [v, ...everyView(v.parts)])

// ---- The filter ----

/** What narrows the Checklist. */
export interface EpicFilter {
  /** 'all', 'mine' (the character's classes) or a class. */
  cls: string
  text: string
  /** Hide the steps that are done. */
  hideDone: boolean
}

export const NO_FILTER: EpicFilter = { cls: 'mine', text: '', hideDone: false }

/** The classes the filter picks; the character's, or every class when it has none. */
export function pickClasses(f: Pick<EpicFilter, 'cls'>, mine: readonly string[]): EpicClass[] {
  if (f.cls === 'all' || (f.cls === 'mine' && !mine.length)) return [...EPIC_CLASSES]
  if (f.cls === 'mine') return EPIC_CLASSES.filter((c) => mine.includes(c.cls))
  return EPIC_CLASSES.filter((c) => c.cls === f.cls)
}

/** Whether a step's name, how, zone or note holds every word typed. */
export function stepMatch(step: EpicStep, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [stepName(step), step.how, step.zone ?? '', step.note ?? ''].join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** The steps that pass the filter, each with the parts of its that do; a step passes when it or one under it matches the words. */
export function filterViews(views: readonly StepView[], f: EpicFilter): StepView[] {
  return views.flatMap((v) => {
    const parts = filterViews(v.parts, f)
    const self = stepMatch(v.step, f.text) && !(f.hideDone && v.done)
    if (!self && !parts.length) return []
    return [{ ...v, parts: self && !f.text ? v.parts.filter((p) => !(f.hideDone && p.done) || filterViews([p], f).length) : parts }]
  })
}

// ---- Targets ----

/** A zone to hunt in, and what it gives that is still wanted. */
export interface Target {
  /** The zone, or "Anywhere" for what the page gives no zone. */
  zone: string
  rows: { name: string; how: string; have: number; need: number; classes: string[]; unverified: boolean; note?: string }[]
}

export const ANYWHERE = 'Anywhere'

/** Where to hunt for what the classes shown are missing: each piece not done, under its zone, with every class that wants it. Zones with most to do first. */
export function targets(views: readonly ClassView[]): Target[] {
  const rows = new Map<string, Target['rows'][number] & { zone: string }>()
  for (const c of views)
    for (const v of everyView(c.steps)) {
      if (v.done || !v.step.item || v.parts.length) continue
      const key = `${v.step.zone ?? ''}|${itemKey(v.step.item)}`
      const r = rows.get(key) ?? {
        zone: v.step.zone ?? ANYWHERE,
        name: v.name,
        how: v.step.how,
        have: v.have,
        need: v.need,
        classes: [],
        unverified: !!v.step.unverified,
        ...(v.step.note ? { note: v.step.note } : {})
      }
      if (!r.classes.includes(c.cls)) r.classes.push(c.cls)
      rows.set(key, r)
    }
  const by = new Map<string, Target>()
  for (const { zone, ...r } of rows.values()) {
    const t = by.get(zone) ?? { zone, rows: [] }
    t.rows.push(r)
    by.set(zone, t)
  }
  for (const t of by.values()) t.rows.sort((a, b) => a.name.localeCompare(b.name))
  return [...by.values()].sort((a, b) => Number(a.zone === ANYWHERE) - Number(b.zone === ANYWHERE) || b.rows.length - a.rows.length || a.zone.localeCompare(b.zone))
}

// ---- Items ----

/** An item any class's steps take, where it comes from and who takes it. */
export interface ItemRow {
  name: string
  /** Where it comes from, as the first step that takes it says. */
  how: string
  zone?: string
  classes: string[]
  /** The finished epic of a class, not a piece. */
  epic: boolean
}

/** Every item the steps take, and every finished epic, each once, by name. */
export function itemRows(): ItemRow[] {
  const by = new Map<string, ItemRow>()
  for (const c of EPIC_CLASSES) {
    for (const s of everyStep(c.steps)) {
      if (!s.item) continue
      const r = by.get(itemKey(s.item)) ?? { name: s.item, how: s.how, ...(s.zone ? { zone: s.zone } : {}), classes: [], epic: false }
      if (!r.classes.includes(c.cls)) r.classes.push(c.cls)
      by.set(itemKey(s.item), r)
    }
    for (const e of c.epic) {
      const r = by.get(itemKey(e)) ?? { name: e, how: 'The finished epic', classes: [], epic: true }
      if (!r.classes.includes(c.cls)) r.classes.push(c.cls)
      by.set(itemKey(e), r)
    }
  }
  return [...by.values()].sort((a, b) => Number(a.epic) - Number(b.epic) || a.name.localeCompare(b.name))
}
