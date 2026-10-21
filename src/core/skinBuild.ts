import { parseJson } from './json'
import { parseGroupHealthProfile, type GroupHealthProfile } from './groupHealth'

// A UI skin can ask for a rebuild button. A skin made by a script (one that sizes its windows from
// the inventory export, say) leaves a file in its folder naming the command that rebuilds it:
//
//   uifiles/<skin>/legends-tracker.json   { "label": "Rebuild bag sizes", "command": ["C:/…/python.exe", "build.py", "--install"] }
//
// The app shows a button for each skin that has one and runs the command, with no shell, in the
// skin's own folder (so "build.py" is the skin's), when it is pressed. A skin without the file shows nothing.
//
// It can also name a command to run each time the game starts (a script that puts back game files the
// launcher's check replaces, say), the same way; the app runs it only once the player has switched it
// on, on Settings › UI, with the whole command in view:
//
//   "onGameStart": { "label": "Live player models", "command": ["C:/…/python.exe", "C:/…/models.py"] }
//
// The same file can say how the skin draws its Group and Player windows' bars, for the group health
// alert (src/core/groupHealth.ts, FEAT-040), with or without a command: every part is optional, and
// what it leaves out is JuiceboxUI's.
//
//   "groupHealth": { "colours": { "outline": [41, 48, 57], "empty": [13, 15, 19], "hp": "#c14b42", "mana": [91, 117, 174], "end": [181, 131, 50] },
//                    "hpInner": 16, "below": [{ "at": 20, "height": 10, "ink": "mana" }, { "at": 34, "height": 10, "ink": "end" }],
//                    "minWidth": 80, "playerInner": 14, "playerStep": 20 }

/** The file a skin folder holds to ask for a rebuild button. */
export const SKIN_BUILD_FILE = 'legends-tracker.json'

/** A skin's rebuild button: what it says and the command it runs. */
export interface SkinBuild {
  skin: string
  label: string
  command: string[]
  /** The skin draws bags in rows it lets the player shape (Tradeskills › Bag layout). */
  bagLayout?: BagLayoutSpec
  /** A command to run each time the game starts, once the player switches it on. */
  onGameStart?: SkinCommand
  /** How that command last went, this session (added by the app, not read from the file). */
  lastStart?: SkinStartRun
}

/** A command a skin's file names, and what it says on its button or switch. */
export interface SkinCommand {
  label: string
  command: string[]
}

/** How a skin's game-start command went. */
export interface SkinStartRun {
  at: number
  ok: boolean
  output: string
}

/** How a game-start command is kept in the settings once switched on: the command exactly as shown. */
export function startKey(command: readonly string[]): string {
  return JSON.stringify(command)
}

// A skin that draws each bag as a block of cells (the bag's own slot, then its contents) wrapping
// every so many cells can say so in its file, and the app shows a tab for choosing how many cells go
// on a line, bag by bag. The choices go in the skin's folder, in BAG_LAYOUT_FILE:
//
//   { "version": 1, "columns": { "General 1": 13, "Bank3": 8 } }
//
// keyed by the inventory export's names for the bag slots. A bag the file does not name takes the
// skin's default for its kind.

/** The bag slots a skin can draw, by the inventory export's names: General 1, Bank1, SharedBank1. */
export type BagKind = 'General' | 'Bank' | 'SharedBank'
export const BAG_KINDS: readonly BagKind[] = ['General', 'Bank', 'SharedBank']

/** The file in a skin's folder that keeps its bag layout. */
export const BAG_LAYOUT_FILE = 'bag-layout.json'

/** What a skin's file says about its bag layout. */
export interface BagLayoutSpec {
  /** Cells per line for a bag the layout does not name, by kind. */
  defaults: Record<BagKind, number>
  /** How many of each kind of slot the skin draws (the bank window may show fewer than the export lists). */
  slots: Record<BagKind, number>
  /** Content slots the skin keeps room for in a smaller bag or an empty slot. */
  minSlots: number
  maxColumns: number
}

/** A bag slot as the export has it: the bag in it (empty for none) and how many slots that bag has. */
export interface BagSlot {
  location: string
  kind: BagKind
  name: string
  slots: number
}

/** The Bag layout tab's data: the skin's rules, its saved choices and the bags the export holds. */
export interface BagLayoutView {
  skin: string
  spec: BagLayoutSpec
  columns: Record<string, number>
  bags: BagSlot[]
  /** When the inventory export was written (0 for none), and why it could not be read. */
  exportedAt: number
  error: string
}

const DEFAULT_SLOTS: Record<BagKind, number> = { General: 12, Bank: 24, SharedBank: 6 }

const wholeIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

/** The export's name for slot `n` (from 1) of a kind: General 1, Bank1, SharedBank1. */
const bagLocation = (kind: BagKind, n: number): string => (kind === 'General' ? `General ${n}` : `${kind}${n}`)

/** The kind of a bag slot named as the export names it, or null for anything else. */
export function bagKindOf(location: string): BagKind | null {
  const m = /^(General |Bank|SharedBank)([1-9]\d?)$/.exec(location)
  return !m ? null : m[1] === 'General ' ? 'General' : (m[1] as BagKind)
}

function parseBagLayoutSpec(v: unknown): BagLayoutSpec | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const { defaults, slots, minSlots, maxColumns } = v as Record<string, unknown>
  const max = wholeIn(maxColumns, 1, 60) ? maxColumns : 30
  if (!defaults || typeof defaults !== 'object') return undefined
  const d = defaults as Record<string, unknown>
  const s = (slots && typeof slots === 'object' ? slots : {}) as Record<string, unknown>
  if (!BAG_KINDS.every((k) => wholeIn(d[k], 1, max))) return undefined
  return {
    defaults: { General: d.General as number, Bank: d.Bank as number, SharedBank: d.SharedBank as number },
    slots: Object.fromEntries(BAG_KINDS.map((k) => [k, wholeIn(s[k], 0, 99) ? s[k] : DEFAULT_SLOTS[k]])) as Record<BagKind, number>,
    minSlots: wholeIn(minSlots, 0, 99) ? minSlots : 0,
    maxColumns: max
  }
}

/** A saved layout held to what the skin allows: bag slots the export names, numbers it can draw. */
export function sanitizeColumns(v: unknown, spec: BagLayoutSpec): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (bagKindOf(k) && wholeIn(n, 1, spec.maxColumns)) out[k] = n
  return out
}

/** The cells a bag takes: its own slot and its contents, with room for at least the skin's minimum. */
export const bagCells = (slots: number, spec: Pick<BagLayoutSpec, 'minSlots'>): number => 1 + Math.max(slots, spec.minSlots)

/** How a bag's cells fall into lines of `columns`: so many lines, so many cells across the widest. */
export function bagGrid(cells: number, columns: number): { lines: number; across: number } {
  const c = Math.max(1, Math.floor(columns))
  return { lines: Math.max(1, Math.ceil(cells / c)), across: Math.min(cells, c) }
}

/** The bag slots a skin draws, as the inventory export has them (an empty slot has no name and no slots). */
export function readBagSlots(exportText: string, spec: BagLayoutSpec): BagSlot[] {
  const rows = new Map<string, { name: string; slots: number }>()
  for (const line of String(exportText).replace(/\r/g, '').split('\n')) {
    const [loc, name, , , slots] = line.split('\t')
    if (loc && bagKindOf(loc)) rows.set(loc, { name: !name || name === 'Empty' ? '' : name, slots: Number(slots) || 0 })
  }
  return BAG_KINDS.flatMap((kind) =>
    Array.from({ length: spec.slots[kind] }, (_, i) => {
      const location = bagLocation(kind, i + 1)
      const row = rows.get(location)
      return { location, kind, name: row?.name ?? '', slots: row?.name ? row.slots : 0 }
    })
  )
}

/** What a rebuild printed, and whether it finished well. */
export interface SkinBuildResult {
  skin: string
  ok: boolean
  output: string
  /** Not run: a command not run before, shown whole to be agreed to first (LT-442). */
  confirm?: string[]
}

const MAX_ARGS = 20
const MAX_ARG = 1000

/** A skin folder's name as the game's /loadskin takes it. */
export function isSkinName(v: unknown): v is string {
  return typeof v === 'string' && /^[\w][\w .-]{0,63}$/.test(v) && !v.endsWith('.') && !v.endsWith(' ')
}

/**
 * The rebuild a skin's file asks for, or null when the file is not one: the command is a program
 * named by its full path (an .exe) and its arguments, each a string.
 */
export function parseSkinBuild(skin: string, text: string): SkinBuild | null {
  if (!isSkinName(skin)) return null
  let data: unknown
  try {
    data = parseJson(text)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { label, command, bagLayout, onGameStart } = data as { label?: unknown; command?: unknown; bagLayout?: unknown; onGameStart?: unknown }
  if (!isCommand(command)) return null
  const named = typeof label === 'string' ? label.trim().slice(0, 60) : ''
  const layout = parseBagLayoutSpec(bagLayout)
  const start = parseStartCommand(skin, onGameStart)
  return { skin, label: named || `Rebuild ${skin}`, command, ...(layout ? { bagLayout: layout } : {}), ...(start ? { onGameStart: start } : {}) }
}

/** A program named by its full path (an .exe) and its arguments, each a short string with no control characters. */
function isCommand(v: unknown): v is string[] {
  if (!Array.isArray(v) || !v.length || v.length > MAX_ARGS) return false
  if (!v.every((a): a is string => typeof a === 'string' && a.length > 0 && a.length <= MAX_ARG && ![...a].some((c) => c.charCodeAt(0) < 32))) return false
  return /^[a-z]:[\\/].+\.exe$/i.test(v[0])
}

/** A file's `onGameStart`, or null when it has none or it is not a command. */
function parseStartCommand(skin: string, v: unknown): SkinCommand | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const { label, command } = v as { label?: unknown; command?: unknown }
  if (!isCommand(command)) return null
  const named = typeof label === 'string' ? label.trim().slice(0, 60) : ''
  return { label: named || `${skin} at game start`, command }
}

/** A skin file's `groupHealth` section (FEAT-040), or undefined when it has none or will not parse. */
export function parseSkinGroupHealth(text: string): GroupHealthProfile | undefined {
  try {
    const data = parseJson(text) as { groupHealth?: unknown } | null
    return data && typeof data === 'object' ? parseGroupHealthProfile(data.groupHealth) : undefined
  } catch {
    return undefined
  }
}

/** The end of what a command printed, enough to show what went wrong. */
export function tailOutput(text: string, max = 2000): string {
  const t = text.replace(/\r\n/g, '\n').trim()
  return t.length > max ? '…' + t.slice(-max) : t
}
