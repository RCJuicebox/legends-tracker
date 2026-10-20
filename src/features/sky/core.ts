import SKY from '../../shared/game/skyQuests.json'
import { itemKey } from '../../core/inventory'
import { addItemTally, heldOf as heldOfCounts, readItemLine, type ItemTally } from '../../core/itemTally'
import type { LogLine } from '../../core/logLine'
import { leftOutIsDone, type AchSection } from '../../core/achievements'
import type { Inventory } from '../../shared/character'

// Plan › Plane of Sky (an optional module): every class's Test quests as the eqlwiki lists them
// (scripts/sky-quests.mjs), what the player's log says they hold of each thing a quest takes, and what
// the player keeps (the wish list, favourites, Tests ignored, corrections). What the page draws from
// them (each Test's view, the targets, the cleanup, the classes) is views.ts.
//
// What is held comes from the log alone, as a LogHistory consumer counts it (src/core/itemTally.ts:
// looted in, handed over or merged away out, with the player's correction for what the log never saw).
//
// A Test is done when a trade with its class's giver completes with its items in it. Which Test: the
// one of that giver's whose items the trade held most of. The player's hand-ins of 2026-08-10 read so:
//   You offered 1 Cracked Leather Eyepatch +1 to Holwin.
//   You offered 1 Wind Rune Geza to Holwin.
//   You complete the trade with Holwin.                                                 Monk Test of Sight

/** Where an item drops: an island (1.5 is Noble Island), and the mob when one is named. */
export interface SkyDrop {
  island: number
  /** The mob, or "any mob on the island"; absent where the wiki names none. */
  mob?: string
}

export interface SkyItem {
  name: string
  /** Where it drops, each place it can; none for the Wind Runes, which any Plane of Sky mob drops. */
  drops: SkyDrop[]
  /** No Drop: whoever does the quest loots it. */
  noDrop?: true
}

/** The first island an item drops on; 0 for a Wind Rune or one with no place. */
export const firstIsland = (i: SkyItem): number => (i.drops.length ? Math.min(...i.drops.map((d) => d.island)) : 0)

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
export const questNeeds = (q: SkyQuest): SkyItem[] => [...q.runes.map((name): SkyItem => ({ name, drops: [] })), ...q.items]

/** The keys of every item a Test takes or gives: the only ones the log is counted for. */
const SKY_KEYS: ReadonlySet<string> = new Set(SKY_QUESTS.flatMap((q) => [...questNeeds(q).map((i) => itemKey(i.name)), ...q.rewards.map(itemKey)]))
const GIVERS: ReadonlySet<string> = new Set(SKY_QUESTS.map((q) => q.giver))

// ---- The log ----

/** One stretch of log's count of the Sky's items, and the Tests it saw handed in. */
export interface SkyTally extends ItemTally {
  /** By Test name: when each hand-in was. */
  runs: Record<string, number[]>
}

export const emptySkyTally = (): SkyTally => ({ items: {}, runs: {} })

export { lastLooted, loggedCounts } from '../../core/itemTally'

const isSkyKey = (k: string) => SKY_KEYS.has(k)

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

/** Reads one line into a stretch's tally (the LogHistory consumer's reader): the items, and a trade with a giver as the Test it was. */
export function readSkyLine(line: LogLine, into: SkyTally): void {
  const t = readItemLine(line, into, isSkyKey)
  const q = t && GIVERS.has(t.npc) ? questOfTrade(t.npc, Object.keys(t.items)) : null
  if (q) (into.runs[q.name] ??= []).push(line.time)
}

/** The stretches of a character's history, oldest first, as one tally (the open trade is the last one's). */
export function joinSkyTallies(stretches: readonly SkyTally[]): SkyTally {
  const out = emptySkyTally()
  for (const s of stretches) {
    addItemTally(out, s)
    for (const [q, ts] of Object.entries(s.runs)) (out.runs[q] ??= []).push(...ts)
  }
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
  /** Tests starred, by name. */
  favorites: string[]
  /** Tests the player never wants to see, by name: on the Ignored tab alone. */
  ignored: string[]
  /** By Test name: hand-ins the player added (or took away) over what the log saw. */
  turnIns: Record<string, number>
}

/** What the inventory export (/outputfile inventory) holds of the Sky's items: bags, bank, depot, worn. Not the currency tab or the Dragon Hoard. */
export interface SkyExport {
  file: string
  modified: number
  /** By item key, a merged copy's +N ignored; the Tests' rewards too. */
  counts: Record<string, number>
}

/** What the achievements export (/outputfile achievements) says of the Primary Class Unlocks. */
export interface SkyAchieved {
  modified: number
  /** Tests whose reward the export says was obtained, by name, under classes unlocked by playing. */
  obtained: string[]
  /** By class: unlocked as a Primary Class or not; a class missing the export cannot say of. */
  unlocked: Record<string, boolean>
  /** Classes whose unlock was granted (confirmed, or a token): their "Obtain" rows say nothing of the Tests. */
  granted: string[]
}

/** What the page shows for a character: the log's counts and hand-ins, the exports, and what the player keeps. */
export interface SkyState extends SkyCharacter {
  character: string
  /** By item key. */
  logged: Record<string, number>
  /** By item key: when the log last saw one come in. */
  last: Record<string, number>
  /** By Test name: when the log saw each hand-in. */
  runs: Record<string, number[]>
  /** The character's classes, from its record, its main one first: the page opens on them. */
  classes: string[]
  /** Null without an inventory export. */
  exported: SkyExport | null
  /** Null without an achievements export. */
  achieved: SkyAchieved | null
  /** What your Respawns records say of each mob the Tests' items drop from, by mob name: "died 40 min ago, seen since" (LT-735). */
  respawns: Record<string, string>
}

/** Every mob the Tests' items drop from, by name. */
export function skyMobs(): string[] {
  return [...new Set(SKY_QUESTS.flatMap((q) => q.items.flatMap((i) => i.drops.flatMap((d) => (d.mob && !/^any mob/i.test(d.mob) ? [d.mob] : [])))))]
}

/** Held, by item key: the log's count with the player's correction, never under none. */
export const heldOf = (s: Pick<SkyState, 'logged' | 'adjust'>, name: string): number => heldOfCounts(s, name)

/** The hand-ins that count toward a wish: those the log saw since it was made, and those the player added. */
export function wishDone(w: SkyWish, runs: Readonly<Record<string, readonly number[]>>): number {
  return (runs[w.quest] ?? []).filter((t) => t >= w.since).length + (w.extra ?? 0)
}

/** How many more times a wish wants its Test done. */
export const wishLeft = (w: SkyWish, runs: Readonly<Record<string, readonly number[]>>): number => Math.max(0, w.want - wishDone(w, runs))

/**
 * The Test that gives a reward, by the reward’s name (a merged one’s +N is ignored).
 * @public
 */
export const questOfReward = (reward: string): SkyQuest | undefined => SKY_QUESTS.find((q) => q.rewards.some((r) => itemKey(r) === itemKey(reward)))

/** The Tests by name. */
export const SKY_NAMES: ReadonlySet<string> = new Set(SKY_QUESTS.map((q) => q.name))

/** A character with nothing kept yet. */
export const emptySkyCharacter = (): SkyCharacter => ({ wishes: [], adjust: {}, favorites: [], ignored: [], turnIns: {} })

/** sky.json's character part as read back: wishes, stars and ignores for Tests there are, and whole-number corrections. */
export function sanitizeSkyCharacter(v: unknown): SkyCharacter {
  const o = v && typeof v === 'object' ? (v as Partial<Record<keyof SkyCharacter, unknown>>) : {}
  const names = SKY_NAMES
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
  const tests = (x: unknown) => [...new Set(Array.isArray(x) ? x.filter((n): n is string => typeof n === 'string' && names.has(n)) : [])]
  const turnIns: Record<string, number> = {}
  if (o.turnIns && typeof o.turnIns === 'object')
    for (const [q, n] of Object.entries(o.turnIns)) if (names.has(q) && Number.isInteger(n) && n !== 0 && Math.abs(n as number) <= 99) turnIns[q] = n as number
  return {
    wishes: wishes.filter((w, i) => wishes.findIndex((x) => x.quest === w.quest) === i),
    adjust,
    favorites: tests(o.favorites),
    ignored: tests(o.ignored),
    turnIns
  }
}

/** Whether an item is one a Test takes or gives: the only ones a correction is kept for. */
export const isSkyItem = (name: string): boolean => SKY_KEYS.has(itemKey(name))

// ---- The exports ----

/** The Sky's items in an inventory export, by item key: every place it lists, but not what is socketed in another item. */
export function exportCounts(inv: Pick<Inventory, 'worn' | 'bags' | 'bank' | 'sharedBank' | 'depot' | 'keyRing'>): Record<string, number> {
  const out: Record<string, number> = {}
  const add = (name: string, n: number) => {
    const k = itemKey(name)
    if (SKY_KEYS.has(k) && n > 0) out[k] = (out[k] ?? 0) + n
  }
  for (const it of [...inv.worn, ...inv.bags, ...inv.bank, ...inv.sharedBank, ...inv.depot]) add(it.name, it.count || 1)
  for (const k of inv.keyRing) add(k.name, 1)
  return out
}

const CLASS_UNLOCK = /^Primary Class Unlock - (.+?)\s*$/i
const OBTAIN = /^Obtain (.+?)\.?\s*$/i
/** The two lines every class unlock carries, each with its own status: done, the unlock was granted (confirmed, or a token). */
const GRANTED = /will autocomplete|can be bypassed/i

/**
 * What an achievements export says of the Primary Class Unlocks. Each has an "Obtain <reward>." part
 * per Test, done once the reward was had; but an unlock granted rather than played marks every part
 * done, so a class whose autocomplete or bypass line is done says nothing of its Tests. An export made
 * with completed achievements hidden leaves out a class that is unlocked (leftOutIsDone).
 */
export function skyAchieved(sections: readonly AchSection[], modified: number): SkyAchieved {
  const out: SkyAchieved = { modified, obtained: [], unlocked: {}, granted: [] }
  for (const s of sections)
    for (const a of s.ach) {
      const cls = CLASS_UNLOCK.exec(a.n)?.[1]
      if (!cls) continue
      out.unlocked[cls] = a.d === true
      if (a.c.some((o) => o.d && GRANTED.test(o.t))) {
        out.granted.push(cls)
        continue
      }
      for (const o of a.c) {
        const reward = o.d ? OBTAIN.exec(o.t)?.[1] : undefined
        const q = reward ? SKY_QUESTS.find((x) => x.cls === cls && x.rewards.some((r) => itemKey(r) === itemKey(reward))) : undefined
        if (q && !out.obtained.includes(q.name)) out.obtained.push(q.name)
      }
    }
  if (leftOutIsDone(sections as AchSection[], (_s, a) => CLASS_UNLOCK.test(a.n))) for (const cls of new Set(SKY_QUESTS.map((q) => q.cls))) out.unlocked[cls] ??= true
  return out
}
