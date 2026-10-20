import EPIC_DATA from '../../shared/game/epicItems.json'
import { itemKey } from '../../core/inventory'
import { addItemTally, emptyItemTally, readItemLine, type ItemTally } from '../../core/itemTally'
import type { LogLine } from '../../core/logLine'
import type { Inventory } from '../../shared/character'
import { SPELL_QUEST_DATA } from './spellQuests'

// Goals › Epics (an optional module): what to keep for every class's epic quest, pre-Kunark, as the
// eqlwiki's "Epic Items To Keep" checklist by Manlaan lists it (scripts/epic-items.mjs builds
// src/shared/game/epicItems.json from the page; SEQO, https://github.com/RealMaeel/seqo, reads the same
// page and gave the finished epics' names and the Shadow Knight's two hand-in recipes). Each class's
// list is a tree: a piece is what to hold, where and how it comes; a step with pieces under it is a
// quest or a craft whose reward those pieces make, so the reward in hand covers them. What the player
// holds comes from the log (src/core/itemTally.ts) and the inventory export; what the player keeps is
// the steps ticked off by hand (a turn-in no file can see) and the corrections to the counts. What the
// page draws from them (each class's steps, what is still needed of each item, where to hunt) is views.ts.
// The five class spell quests (spellQuests.ts) are lists of the same kind, one a spell, counted and
// ticked the same way and kept in the same file; Goals › Spell Quests is their page and module.

/** One step of a class's list: a piece to hold, or a quest or craft whose parts are the steps under it. */
export interface EpicStep {
  /** The item to hold, or the reward the parts make; absent for a quest the page names no reward of. */
  item?: string
  /** The quest the step is, when it is one ("Darkforge Armor Quests"). */
  quest?: string
  /** How many of the item the step takes. */
  qty: number
  /** How it comes: "Kill Lady Vox (raid)", "Forage", "Craft (Tailoring 36)", "Buy", "Complete Monk Headband Quests"; blank where the page says nothing. */
  how: string
  /** The zone, where the page names one. */
  zone?: string
  /** The page marks it unverified (or says it does not drop now). */
  unverified?: true
  /** What else the page says of it: a /loc, a warning. */
  note?: string
  /** Which of several same-named pieces it is ("Azia", of the ten Old Silver Coins): its name is "Old Silver Coin (Azia)", its count the item's. */
  label?: string
  parts: EpicStep[]
}

export interface EpicClass {
  cls: string
  /** The finished epic (two for a Ranger), by name: in hand, nothing of the class is needed. None known for a Beastlord or Berserker. */
  epic: string[]
  steps: EpicStep[]
}

/**
 * A list the page counts: a class's epic, or a spell quest. Its `epic` is what finishes it (the epic,
 * or the spell's scroll): in hand, nothing under it is needed.
 */
export interface EpicList extends EpicClass {
  /** What its ticks are kept under: the class for an epic (as they always were), the spell for a spell quest. */
  key: string
  kind: 'epic' | 'spell'
  /** A spell quest's spell, its level and its eqlwiki page. */
  spell?: { name: string; level: number; page: string }
}

export const EPIC_SOURCE: string = EPIC_DATA.source
export const EPIC_URL: string = EPIC_DATA.url
export const EPIC_CLASSES: readonly EpicList[] = (EPIC_DATA.classes as EpicClass[]).map((c) => ({ ...c, key: c.cls, kind: 'epic' }))

/** The class spell quests, a list each. */
export const SPELL_QUESTS: readonly EpicList[] = SPELL_QUEST_DATA.map((q) => ({
  cls: q.cls,
  key: q.spell,
  kind: 'spell',
  epic: [`Spell: ${q.spell}`],
  spell: { name: q.spell, level: q.level, page: q.page },
  steps: q.steps
}))

/** Every list: the epics, then the spell quests. */
export const EPIC_LISTS: readonly EpicList[] = [...EPIC_CLASSES, ...SPELL_QUESTS]

/** What a step is called: its item (with which one it is, of several the same), or its quest. */
export const stepName = (s: EpicStep): string => (s.item ? (s.label ? `${s.item} (${s.label})` : s.item) : (s.quest ?? ''))

/** Every step under the given, depth first, each before its parts. */
export const everyStep = (steps: readonly EpicStep[]): EpicStep[] => steps.flatMap((s) => [s, ...everyStep(s.parts)])

/** The keys of every item a step takes or gives, and every finished epic and spell: the only ones the log is counted for. */
export const EPIC_KEYS: ReadonlySet<string> = new Set(EPIC_LISTS.flatMap((c) => [...everyStep(c.steps).flatMap((s) => (s.item ? [itemKey(s.item)] : [])), ...c.epic.map(itemKey)]))

/** Whether an item is one a step takes or gives: the only ones a correction is kept for. */
export const isEpicItem = (name: string): boolean => EPIC_KEYS.has(itemKey(name))

/** A step's tick, as it is kept: its list's key (an epic's class, a spell quest's spell) and the step's name. */
export const tickKey = (list: string, step: EpicStep): string => `${list}|${stepName(step)}`

/** Every tick there can be. */
const TICK_KEYS: ReadonlySet<string> = new Set(EPIC_LISTS.flatMap((c) => everyStep(c.steps).map((s) => tickKey(c.key, s))))

/** Whether a tick is one a step has. */
export const isTick = (key: string): boolean => TICK_KEYS.has(key)

// ---- The log ----

/** One stretch of log's count of the epic pieces. */
export type EpicTally = ItemTally

export const emptyEpicTally = (): EpicTally => emptyItemTally()

const isEpicKey = (k: string) => EPIC_KEYS.has(k)

/** Reads one line into a stretch's tally (the LogHistory consumer's reader). */
export function readEpicLine(line: LogLine, into: EpicTally): void {
  readItemLine(line, into, isEpicKey)
}

/** The stretches of a character's history, oldest first, as one tally. */
export function joinEpicTallies(stretches: readonly EpicTally[]): EpicTally {
  const out = emptyEpicTally()
  for (const s of stretches) addItemTally(out, s)
  return out
}

// ---- What the player keeps ----

/** One character's part of epics.json. */
export interface EpicCharacter {
  /** Steps ticked off by hand (handed in, made, or had before the log began), by tick key. */
  ticks: string[]
  /** By item key: what the player said they hold less what the log counted then. */
  adjust: Record<string, number>
}

export const emptyEpicCharacter = (): EpicCharacter => ({ ticks: [], adjust: {} })

/** epics.json's character part as read back: ticks of steps there are, and whole-number corrections of items there are. */
export function sanitizeEpicCharacter(v: unknown): EpicCharacter {
  const o = v && typeof v === 'object' ? (v as Partial<Record<keyof EpicCharacter, unknown>>) : {}
  const ticks = [...new Set(Array.isArray(o.ticks) ? o.ticks.filter((k): k is string => typeof k === 'string' && TICK_KEYS.has(k)) : [])]
  const adjust: Record<string, number> = {}
  if (o.adjust && typeof o.adjust === 'object')
    for (const [k, n] of Object.entries(o.adjust)) if (EPIC_KEYS.has(k) && Number.isInteger(n) && n !== 0 && Math.abs(n as number) < 10_000) adjust[k] = n as number
  return { ticks, adjust }
}

/** What the inventory export (/outputfile inventory) holds of the epic pieces: bags, bank, depot, worn and Storage. */
export interface EpicExport {
  file: string
  modified: number
  /** By item key, a merged copy's +N ignored; the finished epics too. */
  counts: Record<string, number>
}

/** What the page shows for a character: the log's counts, the export's, and what the player keeps. */
export interface EpicState extends EpicCharacter {
  character: string
  /** By item key. */
  logged: Record<string, number>
  /** By item key: when the log last saw one come in. */
  last: Record<string, number>
  /** The character's classes, from its record, its main one first: the page opens on them. */
  classes: string[]
  /** Null without an inventory export. */
  exported: EpicExport | null
}

/** The epic pieces in an inventory export, by item key: every place it lists, but not what is socketed in another item. */
export function exportCounts(inv: Pick<Inventory, 'worn' | 'bags' | 'bank' | 'sharedBank' | 'depot' | 'keyRing'>): Record<string, number> {
  const out: Record<string, number> = {}
  const add = (name: string, n: number) => {
    const k = itemKey(name)
    if (EPIC_KEYS.has(k) && n > 0) out[k] = (out[k] ?? 0) + n
  }
  for (const it of [...inv.worn, ...inv.bags, ...inv.bank, ...inv.sharedBank, ...inv.depot]) add(it.name, it.count || 1)
  for (const k of inv.keyRing) add(k.name, 1)
  return out
}
