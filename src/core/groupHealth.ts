// Group members' health, read off the game's Group window the way a player reads it: the bars are
// found on the screen by their colours and shape, then each one's fill is measured. This needs
// JuiceboxUI's Group window (Interface/barwindows.py group()): its bars are flat colour in a 1-pixel
// outline, so a pixel either is the health colour or is not. The stock window's textured gauges do
// not read this way.
//
// A member's row there: health 18 tall (16 inside its outline), mana under it 12 tall from 20 down,
// endurance 12 tall from 34 down, the pet's 5-pixel bar, rows 60 apart. That shape, a 16-tall health
// bar with a 10-tall bar 20 or 34 under it at the same width, is the Group window's alone: the Player
// and Target windows' health bars are 14 inside, the threat bar has no bar under it.

/** A screen picture: 4 bytes a pixel (blue, green, red, then one unused), rows top first. `x`, `y`: where it was on the screen. */
export interface Frame {
  data: Uint8Array
  width: number
  height: number
  x: number
  y: number
}

type Rgb = readonly [number, number, number]

/** JuiceboxUI's colours, as the game draws them (measured off the Player window, 2026-10-04). */
export const GROUP_COLOURS = {
  outline: [41, 48, 57],
  empty: [13, 15, 19],
  hp: [193, 75, 66],
  mana: [91, 117, 174],
  end: [181, 131, 50]
} satisfies Record<string, Rgb>

/** How far a channel may be off and still count: a little for a window fading, none of text's blends. */
const TOLERANCE = 14

/** The health bar's inside height, and where the mana and endurance bars' insides start below its inside's top. */
const HP_INNER = 16
const BELOW = [
  { at: 20, height: 10, ink: GROUP_COLOURS.mana },
  { at: 34, height: 10, ink: GROUP_COLOURS.end }
]
/** Narrower than this is not a group bar (the window is 250 wide; its bars are some 200 inside). */
const MIN_WIDTH = 80

/** A member's health bar, in screen pixels: the first and last columns inside its outline, and its inside's top row. */
export interface GroupBar {
  left: number
  right: number
  top: number
}

function at(f: Frame, x: number, y: number): number {
  return (y * f.width + x) * 4
}

function is(f: Frame, x: number, y: number, c: Rgb): boolean {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return false
  const i = at(f, x, y)
  const d = f.data
  return Math.abs(d[i + 2] - c[0]) <= TOLERANCE && Math.abs(d[i + 1] - c[1]) <= TOLERANCE && Math.abs(d[i] - c[2]) <= TOLERANCE
}

const hpOrEmpty = (f: Frame, x: number, y: number) => is(f, x, y, GROUP_COLOURS.hp) || is(f, x, y, GROUP_COLOURS.empty)

/** A bar `height` tall inside its outline, filled with `ink` or empty, its inside's top-left at (x, y): frame coordinates. */
function barAt(f: Frame, x: number, y: number, height: number, ink: Rgb): boolean {
  if (!is(f, x, y - 1, GROUP_COLOURS.outline) || !is(f, x, y + height, GROUP_COLOURS.outline) || !is(f, x - 1, y, GROUP_COLOURS.outline)) return false
  for (let r = 0; r < height; r++) if (!is(f, x, y + r, ink) && !is(f, x, y + r, GROUP_COLOURS.empty)) return false
  return true
}

/**
 * Every member's health bar in the frame, top to bottom, in screen pixels. A scan line through a bar
 * reads outline, health colour, then empty, then outline; the bar's left column (never under its
 * text, which starts 4 in) gives its top and height, and the bars under it confirm it is the Group
 * window's.
 */
export function findGroupBars(f: Frame): GroupBar[] {
  const found = new Map<string, GroupBar>()
  for (let y = 1; y < f.height - 1; y++) {
    for (let x = 0; x < f.width - MIN_WIDTH; x++) {
      if (!is(f, x, y, GROUP_COLOURS.outline) || !hpOrEmpty(f, x + 1, y)) continue
      let e = x + 1
      while (e < f.width && is(f, e, y, GROUP_COLOURS.hp)) e++
      while (e < f.width && is(f, e, y, GROUP_COLOURS.empty)) e++
      if (!is(f, e, y, GROUP_COLOURS.outline) || e - x - 1 < MIN_WIDTH) continue
      const left = x + 1
      const right = e - 1
      x = e - 1
      let top = y
      while (top > 0 && hpOrEmpty(f, left, top - 1)) top--
      let bottom = y
      while (bottom < f.height - 1 && hpOrEmpty(f, left, bottom + 1)) bottom++
      const key = `${left},${top}`
      if (found.has(key) || bottom - top + 1 !== HP_INNER) continue
      if (!is(f, left, top - 1, GROUP_COLOURS.outline) || !is(f, right + 1, top, GROUP_COLOURS.outline)) continue
      if (!BELOW.some((b) => barAt(f, left, top + b.at, b.height, b.ink))) continue
      found.set(key, { left: left + f.x, right: right + f.x, top: top + f.y })
    }
  }
  return group([...found.values()])
}

/** The bars of one window: the most that share a left and right edge. Two windows' worth would be a second Group window, which the game does not have. */
function group(bars: GroupBar[]): GroupBar[] {
  const byEdges = new Map<string, GroupBar[]>()
  for (const b of bars) {
    const k = `${b.left},${b.right}`
    byEdges.set(k, [...(byEdges.get(k) ?? []), b])
  }
  const best = [...byEdges.values()].sort((a, b) => b.length - a.length)[0] ?? []
  return best.sort((a, b) => a.top - b.top)
}

/**
 * How full a bar is, 0 to 1, or null when the bar is not there (the member left, the window moved or
 * something covers it). Its inside's top and bottom rows are read; the furthest health-coloured pixel
 * on either is the fill's end, so a name or a cursor over one row does not cut it short.
 */
export function barFill(f: Frame, bar: GroupBar): number | null {
  const left = bar.left - f.x
  const right = bar.right - f.x
  const top = bar.top - f.y
  if (!is(f, left - 1, top, GROUP_COLOURS.outline) || !is(f, right + 1, top, GROUP_COLOURS.outline) || !is(f, left, top - 1, GROUP_COLOURS.outline)) return null
  if (!hpOrEmpty(f, left, top)) return null
  let end = left - 1
  for (const y of [top, top + HP_INNER - 1]) {
    for (let x = right; x > end; x--) {
      if (is(f, x, y, GROUP_COLOURS.hp)) {
        end = x
        break
      }
    }
  }
  return (end - left + 1) / (right - left + 1)
}

/** The screen area the bars and their names cover, a little over: what a sample captures. */
export function barsArea(bars: GroupBar[]): { x: number; y: number; width: number; height: number } {
  const x = Math.min(...bars.map((b) => b.left)) - 2
  const y = Math.min(...bars.map((b) => b.top)) - 2
  return { x, y, width: Math.max(...bars.map((b) => b.right)) + 3 - x, height: Math.max(...bars.map((b) => b.top)) + HP_INNER + 2 - y }
}

/** One member going low: the row (1 at the top) and their health, rounded to a whole percent. */
export interface LowHealth {
  slot: number
  pct: number
}

interface SlotState {
  /** Said already, until they are back above the re-arm point. */
  fired: boolean
  /** Samples in a row at or below the line: one is not trusted, a frame can catch the bar mid-redraw. */
  below: number
}

/**
 * Says when a member drops to `belowPct` or under, once, until they are back over `rearmPct`. An
 * empty bar (0) is a member dead or in another zone: never said, and they must be back over the
 * re-arm point before it is said for them again, so a rez at low health is not taken for a fall.
 */
export class GroupHealthAlarm {
  private slots: SlotState[] = []

  constructor(
    private belowPct: number,
    private rearmPct: number
  ) {}

  setLine(belowPct: number, rearmPct: number): void {
    this.belowPct = belowPct
    this.rearmPct = rearmPct
  }

  /** The group window is gone or changed: everyone starts over. */
  reset(): void {
    this.slots = []
  }

  /** Each row's fill (0 to 1, or null when it could not be read) → the members to say. */
  update(fills: (number | null)[]): LowHealth[] {
    const out: LowHealth[] = []
    fills.forEach((fill, i) => {
      if (fill === null) return
      const pct = Math.round(fill * 100)
      const s = (this.slots[i] ??= { fired: pct === 0, below: 0 })
      if (pct === 0) {
        s.fired = true
        s.below = 0
      } else if (pct >= this.rearmPct) {
        s.fired = false
        s.below = 0
      } else if (pct <= this.belowPct) {
        s.below++
        if (!s.fired && s.below >= 2) {
          s.fired = true
          out.push({ slot: i + 1, pct })
        }
      } else s.below = 0
    })
    return out
  }
}

/** The words said, with the member's name and their health put in. */
export function groupHealthPhrase(template: string, name: string, pct: number): string {
  return template.replace(/\{name\}/gi, name).replace(/\{pct\}/gi, String(pct))
}

/** A row's name from the words OCR found over its health bar: the letters on its left, not the numbers on its right. */
export function namesFromWords(bars: GroupBar[], words: { text: string; x: number; y: number; w: number; h: number }[]): string[] {
  return bars.map((b) => {
    const mid = b.left + (b.right - b.left) * 0.6
    return (
      words
        .filter((w) => w.y + w.h / 2 >= b.top - 1 && w.y + w.h / 2 <= b.top + HP_INNER + 1 && w.x < mid && /^[A-Za-z`']+$/.test(w.text))
        .sort((a, c) => a.x - c.x)
        // A stray mark from the text's shadow comes through as a quote at either end.
        .map((w) => w.text.replace(/^[`']+|[`']+$/g, ''))
        .filter(Boolean)
        .join(' ')
    )
  })
}
