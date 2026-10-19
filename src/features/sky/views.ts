import { itemKey } from '../../core/inventory'
import { firstIsland, heldOf, questNeeds, SKY_QUESTS, wishLeft, type SkyItem, type SkyQuest, type SkyState } from './core'

// What Plan › Plane of Sky draws from a character's state (core.ts): each Test as a row (what it takes,
// held of needed, whether and how it was handed in), the filters and orders over them, and the other
// tabs' lists: where to hunt for what is missing (Targets), what could go (Cleanup) and each class's
// Tests (Classes).

/** Where the counts come from: the log, the inventory export, or the higher of the two for each item. */
export type CountFrom = 'both' | 'log' | 'export'

type Counts = Pick<SkyState, 'logged' | 'adjust' | 'exported'>

/** How many of an item are held, counted from where the player chose. The export lists no currency tab or Dragon Hoard (Wind Runes): the higher of the two keeps the log's for those. */
export function held(s: Counts, name: string, from: CountFrom): number {
  const log = heldOf(s, name)
  const exp = s.exported?.counts[itemKey(name)] ?? 0
  return from === 'log' || !s.exported ? log : from === 'export' ? exp : Math.max(log, exp)
}

/** How a Test is known to have been handed in, and how often. */
export interface TurnIn {
  /** Hand-ins the log saw. */
  log: number
  /** Added (or taken away) by the player. */
  hand: number
  /** The two together, never under none. */
  count: number
  /** The achievements export says its reward was obtained. */
  achievement: boolean
  /** Its reward is in the inventory export: it was done at least once. */
  reward: boolean
  /** Any of these. */
  any: boolean
}

export function turnInOf(q: SkyQuest, s: Pick<SkyState, 'runs' | 'turnIns' | 'achieved' | 'exported'>): TurnIn {
  const log = s.runs[q.name]?.length ?? 0
  const hand = s.turnIns[q.name] ?? 0
  const count = Math.max(0, log + hand)
  const achievement = !!s.achieved?.obtained.includes(q.name)
  const reward = q.rewards.some((r) => (s.exported?.counts[itemKey(r)] ?? 0) > 0)
  return { log, hand, count, achievement, reward, any: count > 0 || achievement || reward }
}

/** One thing a Test takes, with what is held of it. */
export interface NeedView {
  item: SkyItem
  have: number
  need: number
  /** The log's count (with the player's correction) and the export's, for the details. */
  log: number
  exported: number | null
}

/** A Test as the page shows it. */
export interface QuestView {
  quest: SkyQuest
  /** Times it is wanted still (the wish list); 1 when it is not, or no more. */
  times: number
  /** Times the wish list wants it in all; 0 when it is not on it. */
  want: number
  needs: NeedView[]
  /** Every need met once: it can be handed in now. */
  ready: boolean
  /** Things it takes that are not held (as many as it needs). */
  missing: number
  /** The share of what it takes that is held, 0 to 1. */
  near: number
  turnIn: TurnIn
  favorite: boolean
  ignored: boolean
  /** When the log last saw one of its items come in; 0 when never. */
  last: number
  /** The items it shares with other Tests, and those Tests. */
  shared: { item: string; tests: string[] }[]
}

/** The Tests that take each item, by item key. */
const TAKEN_BY: ReadonlyMap<string, readonly SkyQuest[]> = (() => {
  const m = new Map<string, SkyQuest[]>()
  for (const q of SKY_QUESTS) for (const i of questNeeds(q)) m.set(itemKey(i.name), [...(m.get(itemKey(i.name)) ?? []), q])
  return m
})()

const isRune = (i: SkyItem) => /^Wind Rune /.test(i.name)

export function questView(q: SkyQuest, s: SkyState, from: CountFrom): QuestView {
  const w = s.wishes.find((x) => x.quest === q.name)
  const left = w ? wishLeft(w, s.runs) : 1
  const times = Math.max(1, left)
  const needs = questNeeds(q).map((item) => ({
    item,
    have: held(s, item.name, from),
    need: times,
    log: heldOf(s, item.name),
    exported: s.exported ? (s.exported.counts[itemKey(item.name)] ?? 0) : null
  }))
  const total = needs.reduce((n, x) => n + x.need, 0)
  const got = needs.reduce((n, x) => n + Math.min(x.have, x.need), 0)
  return {
    quest: q,
    times,
    want: w?.want ?? 0,
    needs,
    ready: needs.every((x) => x.have >= 1),
    missing: needs.filter((x) => x.have < 1).length,
    near: total ? got / total : 1,
    turnIn: turnInOf(q, s),
    favorite: s.favorites.includes(q.name),
    ignored: s.ignored.includes(q.name),
    last: Math.max(0, ...needs.map((x) => s.last[itemKey(x.item.name)] ?? 0)),
    shared: q.items.flatMap((i) => {
      const tests = (TAKEN_BY.get(itemKey(i.name)) ?? []).filter((x) => x !== q).map((x) => x.name)
      return tests.length ? [{ item: i.name, tests }] : []
    })
  }
}

/** The orders the Tests can be listed in. */
export type SkySort = 'near' | 'recent' | 'class' | 'island'

/** The furthest island a Test needs to reach, each item got where it first drops: where it is finished. */
const lastIsland = (v: QuestView) => Math.max(0, ...v.quest.items.map(firstIsland))

const wikiOrder = (a: QuestView, b: QuestView) => SKY_QUESTS.indexOf(a.quest) - SKY_QUESTS.indexOf(b.quest)

/** Ready first, then nearest to done; most recently looted for; by class; by the island it is finished on. */
export function sortViews(sort: SkySort): (a: QuestView, b: QuestView) => number {
  if (sort === 'recent') return (a, b) => b.last - a.last || wikiOrder(a, b)
  if (sort === 'class') return wikiOrder
  if (sort === 'island') return (a, b) => lastIsland(a) - lastIsland(b) || wikiOrder(a, b)
  return (a, b) => Number(b.ready) - Number(a.ready) || b.near - a.near || wikiOrder(a, b)
}

/** What narrows the Tests tab. Each box is its own question, and ticked boxes all apply. */
export interface SkyFilter {
  /** 'all', 'mine' (the character's classes) or a class. */
  cls: string
  /** 0 for every island. */
  island: number
  /** '' for every mob. */
  mob: string
  text: string
  /** Hide the Tests every item is held for. */
  hideReady: boolean
  /** Hide the Tests handed in at least once. */
  hideTurnedIn: boolean
  /** Only the Tests handed in at least once. */
  onlyTurnedIn: boolean
  favoritesOnly: boolean
}

export const NO_FILTER: SkyFilter = { cls: 'all', island: 0, mob: '', text: '', hideReady: false, hideTurnedIn: false, onlyTurnedIn: false, favoritesOnly: false }

/** A Test whose name, class, giver, reward or items hold every word typed. */
export function questMatch(q: SkyQuest, filter: string): boolean {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [q.name, q.cls, q.giver, ...q.rewards, ...questNeeds(q).flatMap((i) => [i.name, ...i.drops.flatMap((d) => [d.mob ?? '', `island ${d.island}`])])]
    .join(' ')
    .toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** Whether a Test passes the filter; the ignored never do. */
export function passes(v: QuestView, f: SkyFilter, mine: readonly string[]): boolean {
  const q = v.quest
  if (v.ignored) return false
  if (f.cls === 'mine' ? mine.length > 0 && !mine.includes(q.cls) : f.cls !== 'all' && q.cls !== f.cls) return false
  if (f.island && !q.items.some((i) => i.drops.some((d) => d.island === f.island))) return false
  if (f.mob && !q.items.some((i) => i.drops.some((d) => d.mob === f.mob))) return false
  if (f.hideReady && v.ready) return false
  if (f.hideTurnedIn && v.turnIn.any) return false
  if (f.onlyTurnedIn && !v.turnIn.any) return false
  if (f.favoritesOnly && !v.favorite) return false
  return questMatch(q, f.text)
}

/** The islands and the mobs the Tests' items drop on and from, for the filter's lists: by island, then name. */
export function skyFacets(): { islands: number[]; mobs: { mob: string; island: number }[] } {
  const islands = new Set<number>()
  const mobs = new Map<string, number>()
  for (const q of SKY_QUESTS)
    for (const d of q.items.flatMap((i) => i.drops)) {
      islands.add(d.island)
      if (d.mob && !/^any mob/i.test(d.mob)) mobs.set(d.mob, d.island)
    }
  return {
    islands: [...islands].sort((a, b) => a - b),
    mobs: [...mobs].map(([mob, island]) => ({ mob, island })).sort((a, b) => a.island - b.island || a.mob.localeCompare(b.mob))
  }
}

// ---- Targets ----

/** A mob to hunt, and what it drops that the Tests shown still need. */
export interface Target {
  /** The mob; "Any Plane of Sky mob" for the runes, "Not from the Plane of Sky" for what has no place. */
  mob: string
  island?: number
  /** Each item, with the other mobs that drop it too. */
  items: { item: SkyItem; have: number; need: number; tests: string[]; also: string[] }[]
}

export const ANY_MOB = 'Any Plane of Sky mob'
export const ELSEWHERE = 'Not from the Plane of Sky'

/** Where to hunt for what the given Tests are missing: each item under every mob that drops it, needed by every Test that wants it. Runes first, then by island, then what has no place. */
export function targets(views: readonly QuestView[]): Target[] {
  const items = new Map<string, { item: SkyItem; have: number; need: number; tests: string[] }>()
  for (const v of views)
    for (const n of v.needs) {
      const k = itemKey(n.item.name)
      const r = items.get(k) ?? { item: n.item, have: n.have, need: 0, tests: [] }
      r.need += n.need
      r.tests.push(v.quest.name)
      items.set(k, r)
    }
  const by = new Map<string, Target>()
  const put = (mob: string, island: number | undefined, row: Target['items'][number]) => {
    const key = `${mob}|${island ?? ''}`
    const t = by.get(key) ?? { mob, ...(island ? { island } : {}), items: [] }
    t.items.push(row)
    by.set(key, t)
  }
  for (const r of items.values()) {
    if (r.have >= r.need) continue
    if (isRune(r.item) || !r.item.drops.length) {
      put(isRune(r.item) ? ANY_MOB : ELSEWHERE, undefined, { ...r, also: [] })
      continue
    }
    const named = r.item.drops.map((d) => d.mob ?? 'Any mob on the island')
    r.item.drops.forEach((d, i) => put(named[i], d.island, { ...r, also: named.filter((_, j) => j !== i) }))
  }
  const rank = (t: Target) => (t.mob === ANY_MOB ? 0 : t.mob === ELSEWHERE ? 99 : (t.island ?? 98))
  for (const t of by.values()) t.items.sort((a, b) => a.item.name.localeCompare(b.item.name))
  return [...by.values()].sort((a, b) => rank(a) - rank(b) || b.items.length - a.items.length || a.mob.localeCompare(b.mob))
}

// ---- Cleanup ----

/** An item held that no Test still wants: every Test that takes it is handed in, and no wish wants more. */
export interface CleanupRow {
  item: SkyItem
  have: number
  /** The Tests that take it: how often each was handed in, and how many more times what is held would do it. */
  tests: { name: string; rewards: string[]; done: number; sets: number }[]
  /** Enough is held to hand one of them in again: another reward, and two merge into a +1. */
  keep: boolean
}

/**
 * What could go. A Sky Test can be done again, and a second reward merges with the first into a +1, so
 * nothing here says "destroy": each row says what it feeds and whether a whole set for another hand-in
 * is held. Rewards are never listed; nor is anything a Test not yet handed in, or a wish, still takes.
 */
export function cleanupRows(s: SkyState, from: CountFrom): CleanupRow[] {
  const wished = new Set(s.wishes.filter((w) => wishLeft(w, s.runs) > 0).map((w) => w.quest))
  const rows: CleanupRow[] = []
  for (const [k, qs] of TAKEN_BY) {
    const item = questNeeds(qs[0]).find((i) => itemKey(i.name) === k)!
    const have = held(s, item.name, from)
    if (!have || qs.some((q) => wished.has(q.name) || !turnInOf(q, s).any)) continue
    const tests = qs.map((q) => ({
      name: q.name,
      rewards: q.rewards,
      done: turnInOf(q, s).count,
      sets: Math.min(...questNeeds(q).map((i) => held(s, i.name, from)))
    }))
    rows.push({ item, have, tests, keep: tests.some((t) => t.sets > 0) })
  }
  return rows.sort((a, b) => Number(a.keep) - Number(b.keep) || a.item.name.localeCompare(b.item.name))
}

// ---- Classes ----

/** A class: its Tests handed in, and whether it is unlocked as a Primary Class. */
export interface ClassRow {
  cls: string
  tests: number
  turnedIn: number
  /** Null when nothing says. */
  unlocked: boolean | null
  /** What says so: the achievements export, or every Test handed in. */
  from: 'export' | 'tests' | null
  granted: boolean
}

/** Every class, in the wiki's order. A class the export cannot speak for reads unlocked once every Test is handed in. */
export function classRows(s: SkyState): ClassRow[] {
  const classes = [...new Set(SKY_QUESTS.map((q) => q.cls))]
  return classes.map((cls) => {
    const qs = SKY_QUESTS.filter((q) => q.cls === cls)
    const turnedIn = qs.filter((q) => turnInOf(q, s).any).length
    const said = s.achieved?.unlocked[cls]
    const unlocked = said ?? (turnedIn === qs.length ? true : null)
    return {
      cls,
      tests: qs.length,
      turnedIn,
      unlocked,
      from: said !== undefined ? 'export' : unlocked ? 'tests' : null,
      granted: !!s.achieved?.granted.includes(cls)
    }
  })
}

// ---- The wish list ----

/** One line of the wish list's shopping list: an item, what the wishes still take of it, and what is held. */
export interface ShoppingRow {
  item: SkyItem
  need: number
  have: number
  /** The Tests on the wish list that take it. */
  for: string[]
}

/** What every wish still takes, item by item: the runes first, then by island, then what is from elsewhere. */
export function shoppingList(s: SkyState, from: CountFrom): ShoppingRow[] {
  const rows = new Map<string, ShoppingRow>()
  for (const w of s.wishes) {
    const q = SKY_QUESTS.find((x) => x.name === w.quest)
    const left = q ? wishLeft(w, s.runs) : 0
    if (!q || !left) continue
    for (const item of questNeeds(q)) {
      const k = itemKey(item.name)
      const r = rows.get(k) ?? { item, need: 0, have: held(s, item.name, from), for: [] }
      r.need += left
      if (!r.for.includes(q.name)) r.for.push(q.name)
      rows.set(k, r)
    }
  }
  const rank = (i: SkyItem) => (isRune(i) ? 0 : firstIsland(i) || 99)
  return [...rows.values()].sort((a, b) => rank(a.item) - rank(b.item) || a.item.name.localeCompare(b.item.name))
}
