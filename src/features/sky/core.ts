import SKY from '../../shared/game/skyQuests.json'
import { itemKey } from '../../core/inventory'
import { parseLootLine } from '../../core/loot'
import { SELF } from '../../core/combatLines'
import type { LogLine } from '../../core/logLine'

// Plan › Plane of Sky (an optional module): every class's Test quests as the eqlwiki lists them
// (scripts/sky-quests.mjs), what the player's log says they hold of each thing a quest takes, and the
// wish list: the rewards they want, and how many of each.
//
// What is held comes from the log alone, as a LogHistory consumer counts it:
//   --You have looted a Nebulous Sapphire from Sister of the Spire's corpse.--          +1
//   You looted a Wind Rune Neza from a blade storm's corpse and stored it in your currency   +1 (and the depot, the Dragon Hoard)
//   You looted a Nebulous Sapphire from Sister of the Spire's corpse and sold it for free.  never held
//   You offered 1 Nebulous Sapphire to Holwin.   then   You complete the trade with Holwin.  −1
//   You have cancelled the trade.                                                       what was offered comes back
//   You have successfully merged two items together to create a new item: Wu's Fist of Mastery +7    −1 (two become one)
// Copies held before the log began are not in it: the player puts the count right by hand, and that
// correction is kept as a difference, so the log goes on counting from it.
//
// A Test is done when a trade with its class's giver completes with its items in it. Which Test: the
// one of that giver's whose items the trade held most of. The player's hand-ins of 2026-08-10 read so:
//   You offered 1 Cracked Leather Eyepatch +1 to Holwin.
//   You offered 1 Wind Rune Geza to Holwin.
//   You complete the trade with Holwin.                                                 Monk Test of Sight

export interface SkyItem {
  name: string
  /** The island it drops on; absent for what is not from the Plane of Sky (Brass Knuckles). */
  island?: number
  /** The mob it drops from, or "any mob on the island". */
  from?: string
  /** No Drop: whoever does the quest loots it. */
  noDrop?: true
}

export interface SkyQuest {
  cls: string
  giver: string
  /** "Monk Test of Fists". */
  name: string
  /** What to say to the giver to hear it: "fists". */
  say: string
  /** What it gives; one Test (Beastlord Test of Claw) gives two. */
  rewards: string[]
  /** The Wind Runes it takes: every Plane of Sky mob can drop them. */
  runes: string[]
  items: SkyItem[]
}

export const SKY_SOURCE: string = SKY.source
export const SKY_QUESTS: readonly SkyQuest[] = SKY.quests as SkyQuest[]

/** Everything one Test takes, the runes first, once each. */
export const questNeeds = (q: SkyQuest): SkyItem[] => [...q.runes.map((name): SkyItem => ({ name })), ...q.items]

/** The keys of every item a Test takes or gives: the only ones the log is counted for. */
const SKY_KEYS: ReadonlySet<string> = new Set(SKY_QUESTS.flatMap((q) => [...questNeeds(q).map((i) => itemKey(i.name)), ...q.rewards.map(itemKey)]))
const GIVERS: ReadonlySet<string> = new Set(SKY_QUESTS.map((q) => q.giver))

// ---- The log ----

/** One stretch of log's count of the Sky's items, and the Tests it saw handed in. */
export interface SkyTally {
  /** By item key: copies that came in, and copies that went (handed over, merged away). */
  items: Record<string, { got: number; gave: number }>
  /** By Test name: when each hand-in was. */
  runs: Record<string, number[]>
  /** The trade open at the end of what was read: its NPC and what was offered, by item as printed. */
  trade?: { npc: string; items: Record<string, number> }
}

export const emptySkyTally = (): SkyTally => ({ items: {}, runs: {} })

const OFFERED = /^You offered (\d+) (.+) to (.+)\.$/
const TRADED = /^You complete the trade with (.+)\.$/
const CANCELLED = 'You have cancelled the trade.'
const MERGED = /^You have successfully merged two items together to create a new item: (.+)$/

function count(into: SkyTally, item: string, got: number, gave: number): void {
  const k = itemKey(item)
  if (!SKY_KEYS.has(k)) return
  const c = (into.items[k] ??= { got: 0, gave: 0 })
  c.got += got
  c.gave += gave
}

/** The Test a completed trade with one of the Sky's givers was: the giver's with most of its items in it. */
export function questOfTrade(npc: string, offered: readonly string[]): SkyQuest | null {
  const keys = new Set(offered.map(itemKey))
  let best: SkyQuest | null = null
  let most = 0
  for (const q of SKY_QUESTS) {
    if (q.giver !== npc) continue
    const n = questNeeds(q).filter((i) => keys.has(itemKey(i.name))).length
    if (n > most) [best, most] = [q, n]
  }
  return best
}

/** Reads one line into a stretch's tally (the LogHistory consumer's reader). */
export function readSkyLine(line: LogLine, into: SkyTally): void {
  const text = line.text
  if (text.startsWith('You offered ')) {
    const m = OFFERED.exec(text)
    if (!m) return
    // Another NPC: the trade before is over, whatever became of it.
    if (into.trade?.npc !== m[3]) into.trade = { npc: m[3], items: {} }
    into.trade.items[m[2]] = (into.trade.items[m[2]] ?? 0) + Number(m[1])
  } else if (text.startsWith('You complete the trade with ')) {
    const m = TRADED.exec(text)
    const t = into.trade
    if (!m || !t || t.npc !== m[1]) return
    delete into.trade
    for (const [item, n] of Object.entries(t.items)) count(into, item, 0, n)
    const q = GIVERS.has(t.npc) ? questOfTrade(t.npc, Object.keys(t.items)) : null
    if (q) (into.runs[q.name] ??= []).push(line.time)
  } else if (text === CANCELLED) {
    delete into.trade
  } else if (text.startsWith('You have successfully merged ')) {
    const m = MERGED.exec(text)
    if (m) count(into, m[1], 0, 1)
  } else {
    const e = parseLootLine(text)
    // Kept, or put in the depot, the currency tab or the Dragon Hoard: held. Sold as it dropped: never
    // held. Looted into a merge: one in, one out.
    if (e?.kind === 'loot' && e.looter === SELF && e.outcome !== 'sold' && e.outcome !== 'merged') count(into, e.item, e.count, 0)
  }
}

/** The stretches of a character's history, oldest first, as one tally (the open trade is the last one's). */
export function joinSkyTallies(stretches: readonly SkyTally[]): SkyTally {
  const out = emptySkyTally()
  for (const s of stretches) {
    for (const [k, c] of Object.entries(s.items)) {
      const o = (out.items[k] ??= { got: 0, gave: 0 })
      o.got += c.got
      o.gave += c.gave
    }
    for (const [q, ts] of Object.entries(s.runs)) (out.runs[q] ??= []).push(...ts)
  }
  return out
}

/** What the log says is held, by item key: what came in less what went, never under none. */
export function loggedCounts(t: SkyTally): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, c] of Object.entries(t.items)) out[k] = Math.max(0, c.got - c.gave)
  return out
}

// ---- What the player keeps ----

/** A reward wanted, and how many times. */
export interface SkyWish {
  /** The Test that gives it. */
  quest: string
  /** How many times it is wanted done. */
  want: number
  /** When it was wished for: the hand-ins the log sees from then count toward it. */
  since: number
  /** Hand-ins the player says they made that the log did not see (another PC, a log turned off). */
  extra?: number
}

/** One character's part of sky.json. */
export interface SkyCharacter {
  wishes: SkyWish[]
  /** By item key: what the player said they hold less what the log counted then. */
  adjust: Record<string, number>
}

/** What the page shows for a character: the log's counts and hand-ins, and what the player keeps. */
export interface SkyState extends SkyCharacter {
  character: string
  /** By item key. */
  logged: Record<string, number>
  /** By Test name: when the log saw each hand-in. */
  runs: Record<string, number[]>
  /** The character's classes, from its record, its main one first: the page opens on them. */
  classes: string[]
}

/** Held, by item key: the log's count with the player's correction, never under none. */
export function heldOf(s: Pick<SkyState, 'logged' | 'adjust'>, name: string): number {
  const k = itemKey(name)
  return Math.max(0, (s.logged[k] ?? 0) + (s.adjust[k] ?? 0))
}

/** The hand-ins that count toward a wish: those the log saw since it was made, and those the player added. */
export function wishDone(w: SkyWish, runs: Readonly<Record<string, readonly number[]>>): number {
  return (runs[w.quest] ?? []).filter((t) => t >= w.since).length + (w.extra ?? 0)
}

/** How many more times a wish wants its Test done. */
export const wishLeft = (w: SkyWish, runs: Readonly<Record<string, readonly number[]>>): number => Math.max(0, w.want - wishDone(w, runs))

/** A Test as the page shows it: each thing it takes with how many are held and needed, and how near it is. */
export interface QuestView {
  quest: SkyQuest
  /** Times it is wanted still (the wish list); 1 when it is not, or no more. */
  times: number
  /** Times the wish list wants it in all; 0 when it is not on it. */
  want: number
  needs: { item: SkyItem; have: number; need: number }[]
  /** Every need met: it can be handed in now. */
  ready: boolean
  /** The share of what it takes that is held, 0 to 1. */
  near: number
  /** Hand-ins the log saw. */
  done: number
}

export function questView(q: SkyQuest, s: Pick<SkyState, 'logged' | 'adjust' | 'runs' | 'wishes'>): QuestView {
  const w = s.wishes.find((x) => x.quest === q.name)
  const left = w ? wishLeft(w, s.runs) : 1
  const times = Math.max(1, left)
  const needs = questNeeds(q).map((item) => ({ item, have: heldOf(s, item.name), need: times }))
  const total = needs.reduce((n, x) => n + x.need, 0)
  const got = needs.reduce((n, x) => n + Math.min(x.have, x.need), 0)
  return {
    quest: q,
    times,
    want: w?.want ?? 0,
    needs,
    ready: needs.every((x) => x.have >= 1),
    near: total ? got / total : 1,
    done: s.runs[q.name]?.length ?? 0
  }
}

/** Ready first, then nearest to done, then as the wiki lists them. */
export function byNearest(a: QuestView, b: QuestView): number {
  return Number(b.ready) - Number(a.ready) || b.near - a.near || SKY_QUESTS.indexOf(a.quest) - SKY_QUESTS.indexOf(b.quest)
}

/** One line of the wish list's shopping list: an item, what the wishes still take of it, and what is held. */
export interface ShoppingRow {
  item: SkyItem
  need: number
  have: number
  /** The Tests on the wish list that take it. */
  for: string[]
}

/** What every wish still takes, item by item, by island (the runes first, then what is from elsewhere last). */
export function shoppingList(s: Pick<SkyState, 'logged' | 'adjust' | 'runs' | 'wishes'>): ShoppingRow[] {
  const rows = new Map<string, ShoppingRow>()
  for (const w of s.wishes) {
    const q = SKY_QUESTS.find((x) => x.name === w.quest)
    const left = q ? wishLeft(w, s.runs) : 0
    if (!q || !left) continue
    for (const item of questNeeds(q)) {
      const k = itemKey(item.name)
      const r = rows.get(k) ?? { item, need: 0, have: heldOf(s, item.name), for: [] }
      r.need += left
      if (!r.for.includes(q.name)) r.for.push(q.name)
      rows.set(k, r)
    }
  }
  const rank = (i: SkyItem) => i.island ?? (/^Wind Rune /.test(i.name) ? 0 : 99)
  return [...rows.values()].sort((a, b) => rank(a.item) - rank(b.item) || a.item.name.localeCompare(b.item.name))
}

/** A Test whose name, class, giver, reward or items hold every word typed. */
export function questMatch(q: SkyQuest, filter: string): boolean {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [q.name, q.cls, q.giver, ...q.rewards, ...questNeeds(q).flatMap((i) => [i.name, i.from ?? ''])].join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/**
 * The Test that gives a reward, by the reward’s name (a merged one’s +N is ignored).
 * @public
 */
export const questOfReward = (reward: string): SkyQuest | undefined => SKY_QUESTS.find((q) => q.rewards.some((r) => itemKey(r) === itemKey(reward)))

/** sky.json's character part as read back: wishes for Tests there are, and whole-number corrections. */
export function sanitizeSkyCharacter(v: unknown): SkyCharacter {
  const o = v && typeof v === 'object' ? (v as Partial<Record<keyof SkyCharacter, unknown>>) : {}
  const names = new Set(SKY_QUESTS.map((q) => q.name))
  const wishes = (Array.isArray(o.wishes) ? o.wishes : []).flatMap((x): SkyWish[] => {
    const w = x as Partial<SkyWish> | null
    if (!w || typeof w.quest !== 'string' || !names.has(w.quest) || !Number.isInteger(w.want) || typeof w.since !== 'number') return []
    const want = Math.min(99, Math.max(1, w.want as number))
    const extra = Number.isInteger(w.extra) && (w.extra as number) > 0 ? Math.min(99, w.extra as number) : 0
    return [{ quest: w.quest, want, since: w.since, ...(extra ? { extra } : {}) }]
  })
  const adjust: Record<string, number> = {}
  if (o.adjust && typeof o.adjust === 'object')
    for (const [k, n] of Object.entries(o.adjust)) if (SKY_KEYS.has(k) && Number.isInteger(n) && n !== 0 && Math.abs(n as number) < 10_000) adjust[k] = n as number
  return { wishes: wishes.filter((w, i) => wishes.findIndex((x) => x.quest === w.quest) === i), adjust }
}

/** Whether an item is one a Test takes or gives: the only ones a correction is kept for. */
export const isSkyItem = (name: string): boolean => SKY_KEYS.has(itemKey(name))
