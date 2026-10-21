// Group members' health, read off the game's Group window the way a player reads it: the bars are
// found on the screen by their colours and shape, then each one's fill is measured. This needs a skin
// whose bars are flat colour in a 1-pixel outline, so a pixel either is the health colour or is not:
// JuiceboxUI's Group window (Interface/barwindows.py group()) is, and its colours and shape are the
// defaults. Another skin drawn that way says its own in its legends-tracker.json (src/core/skinBuild.ts),
// or has its colours sampled off the screen (calibrateColours). The stock window's textured gauges do
// not read this way.
//
// A member's row there: health 18 tall (16 inside its outline), mana under it 12 tall from 20 down,
// endurance 12 tall from 34 down, the pet's 5-pixel bar, rows 60 apart. That shape, a 16-tall health
// bar with a 10-tall bar 20 or 34 under it at the same width, is the Group window's alone: the Player
// and Target windows' health bars are 14 inside, the threat bar has no bar under it. The Player
// window's three bars are 14 inside, 20 apart: health, mana, endurance (Interface/playerwindow.py).

/** A screen picture: 4 bytes a pixel (blue, green, red, then one unused), rows top first. `x`, `y`: where it was on the screen. */
export interface Frame {
  data: Uint8Array
  width: number
  height: number
  x: number
  y: number
}

export type Rgb = readonly [number, number, number]

/** The bars' colours, as the game draws them: the outline, an empty bar's inside, and each bar's fill. */
export interface GroupColours {
  outline: Rgb
  empty: Rgb
  hp: Rgb
  mana: Rgb
  end: Rgb
}

export const COLOUR_KEYS: readonly (keyof GroupColours)[] = ['outline', 'empty', 'hp', 'mana', 'end']

/** A bar under the health bar: where its inside starts below the health bar's inside top, its inside's height and its fill. */
export interface BarBelow {
  at: number
  height: number
  ink: 'mana' | 'end'
}

/** How a skin draws the bars: its colours and the shape the Group and Player windows' bars are found by (FEAT-040). */
export interface GroupHealthProfile {
  colours: GroupColours
  /** The Group window's health bar's inside height. */
  hpInner: number
  /** The bars under it, at least one of which a row must show. */
  below: BarBelow[]
  /** Narrower than this is not a group bar. */
  minWidth: number
  /** The Player window's bars' inside height, and from one bar's inside top to the next's. */
  playerInner: number
  playerStep: number
}

/** JuiceboxUI's colours, as the game draws them (measured off the Player window, 2026-10-04). */
export const GROUP_COLOURS: GroupColours = {
  outline: [41, 48, 57],
  empty: [13, 15, 19],
  hp: [193, 75, 66],
  mana: [91, 117, 174],
  end: [181, 131, 50]
}

/** JuiceboxUI's bars: what a skin without a profile of its own is read as. Its Group window is 250 wide, its bars some 200 inside. */
export const JUICEBOX_PROFILE: GroupHealthProfile = {
  colours: GROUP_COLOURS,
  hpInner: 16,
  below: [
    { at: 20, height: 10, ink: 'mana' },
    { at: 34, height: 10, ink: 'end' }
  ],
  minWidth: 80,
  playerInner: 14,
  playerStep: 20
}

/** How far a channel may be off and still count: a little for a window fading, none of text's blends. */
const TOLERANCE = 14

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const wholeIn = (v: unknown, lo: number, hi: number, fb: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : fb)

/** A colour as a skin's file gives it: [red, green, blue] or "#rrggbb"; null for anything else. */
export function rgbOf(v: unknown): Rgb | null {
  if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255)) return [v[0], v[1], v[2]]
  const m = typeof v === 'string' ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v.trim()) : null
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}

/** Colours read from a file or the settings, each one it gets wrong or leaves out taken from `fb`. */
export function parseColours(v: unknown, fb: GroupColours = GROUP_COLOURS): GroupColours {
  const o = isObj(v) ? v : {}
  return Object.fromEntries(COLOUR_KEYS.map((k) => [k, rgbOf(o[k]) ?? fb[k]])) as unknown as GroupColours
}

/** A skin's `groupHealth` section, each part it gets wrong or leaves out JuiceboxUI's; undefined when it is not an object. */
export function parseGroupHealthProfile(v: unknown): GroupHealthProfile | undefined {
  if (!isObj(v)) return undefined
  const base = JUICEBOX_PROFILE
  const below = (Array.isArray(v.below) ? v.below : [])
    .filter(isObj)
    .filter((b) => b.ink === 'mana' || b.ink === 'end')
    .map((b) => ({ at: wholeIn(b.at, 2, 120, -1), height: wholeIn(b.height, 2, 40, -1), ink: b.ink as BarBelow['ink'] }))
    .filter((b) => b.at > 0 && b.height > 0)
    .slice(0, 4)
  return {
    colours: parseColours(v.colours),
    hpInner: wholeIn(v.hpInner, 4, 40, base.hpInner),
    below: below.length ? below : base.below,
    minWidth: wholeIn(v.minWidth, 20, 1000, base.minWidth),
    playerInner: wholeIn(v.playerInner, 4, 40, base.playerInner),
    playerStep: wholeIn(v.playerStep, 6, 80, base.playerStep)
  }
}

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

/**
 * How dark a fill may be shaded and still be its colour: JBUI and JuiceboxUI2 draw each fill from 55%
 * of its colour at the left to the whole of it at the right (Interface/fieldkit.py white_fill, the
 * theme's gradient), so a flat colour match found only the bars' last few pixels and no bar at all.
 */
const SHADE_FROM = 0.45
const SHADE_TO = 1.08

/** Whether a pixel is a bar's fill: `ink` at some brightness from SHADE_FROM to full, so a flat fill and a shaded one both read. */
function isInk(f: Frame, x: number, y: number, ink: Rgb): boolean {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return false
  const i = at(f, x, y)
  const d = f.data
  const [r, g, b] = [d[i + 2], d[i + 1], d[i]]
  const k = (r * ink[0] + g * ink[1] + b * ink[2]) / (ink[0] * ink[0] + ink[1] * ink[1] + ink[2] * ink[2] || 1)
  if (k < SHADE_FROM || k > SHADE_TO) return false
  return Math.abs(r - k * ink[0]) <= TOLERANCE && Math.abs(g - k * ink[1]) <= TOLERANCE && Math.abs(b - k * ink[2]) <= TOLERANCE
}

/** Whether a pixel is an empty bar's inside: the empty colour or darker, as JBUI shades it down to black mid-bar. */
function isEmpty(f: Frame, x: number, y: number, c: Rgb): boolean {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return false
  const i = at(f, x, y)
  const d = f.data
  return d[i + 2] <= c[0] + TOLERANCE && d[i + 1] <= c[1] + TOLERANCE && d[i] <= c[2] + TOLERANCE
}

/** A bar `height` tall inside its outline, filled with `ink` or empty, its inside's top-left at (x, y): frame coordinates. */
function barAt(f: Frame, x: number, y: number, height: number, ink: Rgb, c: GroupColours): boolean {
  if (!is(f, x, y - 1, c.outline) || !is(f, x, y + height, c.outline) || !is(f, x - 1, y, c.outline)) return false
  for (let r = 0; r < height; r++) if (!isInk(f, x, y + r, ink) && !isEmpty(f, x, y + r, c.empty)) return false
  return true
}

/**
 * Every bar `inner` tall inside, filled with `ink` or empty, that `fits` says is the one wanted, in
 * screen pixels. A scan line through a bar reads outline, the fill, then empty, then outline; the
 * bar's left column (never under its text, which starts 4 in) gives its top and height.
 */
function scan(f: Frame, p: GroupHealthProfile, ink: Rgb, inner: number, fits: (left: number, top: number) => boolean): GroupBar[] {
  const c = p.colours
  const inkOrEmpty = (x: number, y: number) => isInk(f, x, y, ink) || isEmpty(f, x, y, c.empty)
  const found = new Map<string, GroupBar>()
  for (let y = 1; y < f.height - 1; y++) {
    for (let x = 0; x < f.width - p.minWidth; x++) {
      if (!is(f, x, y, c.outline) || !inkOrEmpty(x + 1, y)) continue
      let e = x + 1
      while (e < f.width && isInk(f, e, y, ink)) e++
      while (e < f.width && isEmpty(f, e, y, c.empty)) e++
      if (!is(f, e, y, c.outline) || e - x - 1 < p.minWidth) continue
      const left = x + 1
      const right = e - 1
      x = e - 1
      let top = y
      while (top > 0 && inkOrEmpty(left, top - 1)) top--
      let bottom = y
      while (bottom < f.height - 1 && inkOrEmpty(left, bottom + 1)) bottom++
      const key = `${left},${top}`
      if (found.has(key) || bottom - top + 1 !== inner) continue
      if (!is(f, left, top - 1, c.outline) || !is(f, right + 1, top, c.outline)) continue
      if (!fits(left, top)) continue
      found.set(key, { left: left + f.x, right: right + f.x, top: top + f.y })
    }
  }
  return [...found.values()]
}

/**
 * Every member's health bar in the frame, top to bottom, in screen pixels: a health bar the
 * profile's height with one of the bars under it the profile names, which confirms it is the Group
 * window's.
 */
export function findGroupBars(f: Frame, p: GroupHealthProfile = JUICEBOX_PROFILE): GroupBar[] {
  const c = p.colours
  return group(scan(f, p, c.hp, p.hpInner, (left, top) => p.below.some((b) => barAt(f, left, top + b.at, b.height, c[b.ink], c))))
}

/**
 * Your own mana bar, in the Player window (FEAT-043): a mana bar the Player window's height with a
 * health bar its step above and an endurance bar its step below, at the same width; null when it is
 * not on the screen. A cast bar drawn over it hides it until the cast ends.
 */
export function findPlayerMana(f: Frame, p: GroupHealthProfile = JUICEBOX_PROFILE): GroupBar | null {
  const c = p.colours
  const h = p.playerInner
  const s = p.playerStep
  return scan(f, p, c.mana, h, (left, top) => barAt(f, left, top - s, h, c.hp, c) && barAt(f, left, top + s, h, c.end, c))[0] ?? null
}

/** The bars of one window: the most that share a left and right edge. Two windows' worth would be a second Group window, which the game does not have. */
function group<T extends GroupBar>(bars: T[]): T[] {
  const byEdges = new Map<string, T[]>()
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
export function barFill(f: Frame, bar: GroupBar, p: GroupHealthProfile = JUICEBOX_PROFILE): number | null {
  return inkFill(f, bar, 0, p.hpInner, p.colours.hp, p.colours)
}

/**
 * A member's mana, 0 to 1, from the mana bar under the health bar (LT-751); null where there is none
 * to read. A member with no mana shows an empty bar: 0, which is never said.
 */
export function manaFill(f: Frame, bar: GroupBar, p: GroupHealthProfile = JUICEBOX_PROFILE): number | null {
  const m = p.below.find((b) => b.ink === 'mana')
  return m ? inkFill(f, bar, m.at, m.height, p.colours.mana, p.colours) : null
}

/** Your mana, 0 to 1, from the Player window's mana bar (findPlayerMana); null while it cannot be read, a cast bar over it among others. */
export function playerManaFill(f: Frame, bar: GroupBar, p: GroupHealthProfile = JUICEBOX_PROFILE): number | null {
  return inkFill(f, bar, 0, p.playerInner, p.colours.mana, p.colours)
}

/** How full one of a row's bars is: the one `offset` under the health bar's inside top, `height` tall inside, filled with `ink`. */
function inkFill(f: Frame, bar: GroupBar, offset: number, height: number, ink: Rgb, c: GroupColours): number | null {
  const left = bar.left - f.x
  const right = bar.right - f.x
  const top = bar.top - f.y + offset
  if (!is(f, left - 1, top, c.outline) || !is(f, right + 1, top, c.outline) || !is(f, left, top - 1, c.outline)) return null
  if (!isInk(f, left, top, ink) && !isEmpty(f, left, top, c.empty)) return null
  let end = left - 1
  for (const y of [top, top + height - 1]) {
    for (let x = right; x > end; x--) {
      if (isInk(f, x, y, ink)) {
        end = x
        break
      }
    }
  }
  return (end - left + 1) / (right - left + 1)
}

/** A screen area, in physical pixels. */
export interface Area {
  x: number
  y: number
  width: number
  height: number
}

/** The screen area the bars and their names cover, a little over: what a sample captures. */
export function barsArea(bars: GroupBar[], p: GroupHealthProfile = JUICEBOX_PROFILE): Area {
  const x = Math.min(...bars.map((b) => b.left)) - 2
  const y = Math.min(...bars.map((b) => b.top)) - 2
  // Down to the mana bar's bottom, so a sample can read it too (LT-751).
  const m = p.below.find((b) => b.ink === 'mana')
  const under = m ? m.at + m.height : p.hpInner
  return { x, y, width: Math.max(...bars.map((b) => b.right)) + 3 - x, height: Math.max(...bars.map((b) => b.top)) + under + 2 - y }
}

/** The screen area your mana bar covers, its outline and a pixel more: what a sample of it captures. */
export function playerArea(bar: GroupBar, p: GroupHealthProfile = JUICEBOX_PROFILE): Area {
  return { x: bar.left - 2, y: bar.top - 2, width: bar.right - bar.left + 5, height: p.playerInner + 4 }
}

/** What sampling the colours off the screen found (FEAT-040): the colours, which of them were seen there (the rest kept), and the rows read. */
export interface Calibration {
  colours: GroupColours
  seen: (keyof GroupColours)[]
  rows: number
}

/** Whether two pixels of the frame are the same colour, give or take the tolerance; false off the frame. */
function alike(f: Frame, x1: number, y1: number, x2: number, y2: number): boolean {
  if (x2 < 0 || y2 < 0 || x2 >= f.width || y2 >= f.height) return false
  const i = at(f, x1, y1)
  const j = at(f, x2, y2)
  const d = f.data
  return Math.abs(d[i] - d[j]) <= TOLERANCE && Math.abs(d[i + 1] - d[j + 1]) <= TOLERANCE && Math.abs(d[i + 2] - d[j + 2]) <= TOLERANCE
}

function pixel(f: Frame, x: number, y: number): Rgb {
  const i = at(f, x, y)
  return [f.data[i + 2], f.data[i + 1], f.data[i]]
}

const near = (a: Rgb, b: Rgb) => a.every((v, i) => Math.abs(v - b[i]) <= TOLERANCE)
const distance = (a: Rgb, b: Rgb) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0)

/**
 * A box whose 1-pixel outline is one colour, `inner` rows inside, its outline's top-left corner at
 * (x, y) and `width` wide outside (0: as far as the top edge goes); its outside width, or 0 when it is
 * not one. Its inside's first and last columns are each one colour (the fill or empty) and not the
 * outline's: a flat patch of colour is not a box.
 */
function boxAt(f: Frame, x: number, y: number, inner: number, width = 0): number {
  const bottom = y + inner + 1
  if (!alike(f, x, y, x, bottom) || alike(f, x, y, x + 1, y + 1)) return 0
  let right = x + width - 1
  if (!width) {
    right = x
    while (alike(f, x, y, right + 1, y)) right++
  }
  if (right >= f.width) return 0
  for (let i = x; i <= right; i++) if (!alike(f, x, y, i, y) || !alike(f, x, y, i, bottom)) return 0
  for (let r = y + 1; r < bottom; r++) {
    if (!alike(f, x, y, x, r) || !alike(f, x, y, right, r)) return 0
    if (!alike(f, x + 1, y + 1, x + 1, r) || !alike(f, right - 1, y + 1, right - 1, r) || alike(f, x, y, right - 1, r)) return 0
  }
  return right - x + 1
}

/** The colour most of these are, or null for none. */
function mostOf(colours: Rgb[]): Rgb | null {
  const counts = new Map<string, { c: Rgb; n: number }>()
  for (const c of colours) {
    const k = c.join()
    counts.set(k, { c, n: (counts.get(k)?.n ?? 0) + 1 })
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.c ?? null
}

/**
 * The bars' colours, sampled off a picture of the Group window (FEAT-040). The rows are found by
 * their shape alone, the profile's: a box in a 1-pixel outline the health bar's height, with a box
 * the height of one of the bars under it, the same width, where the profile puts it. Each bar's
 * inside is read at its first and last column: a bar partly full shows its fill on the left and empty
 * on the right; a whole bar is one or the other, and a colour whole in bars of two kinds is empty
 * (a mana bar never shows health's colour). What none of the bars shows (every one full, say) is
 * judged by which of the profile's colours it is nearer, and what no bar shows at all is kept.
 */
export function calibrateColours(f: Frame, p: GroupHealthProfile = JUICEBOX_PROFILE): Calibration {
  type Sample = { kind: 'hp' | 'mana' | 'end'; l: Rgb; r: Rgb }
  const rows: (GroupBar & { outline: Rgb; samples: Sample[] })[] = []
  const minOutside = p.minWidth + 2
  const sample = (kind: Sample['kind'], x: number, y: number, inner: number, width: number): Sample => {
    const mid = y + 1 + Math.floor(inner / 2)
    return { kind, l: pixel(f, x + 1, mid), r: pixel(f, x + width - 2, mid) }
  }
  for (let y = 0; y < f.height - p.hpInner - 1; y++) {
    for (let x = 0; x < f.width - minOutside; x++) {
      // Quick turns away first: most pixels are not a corner.
      if (!alike(f, x, y, x + minOutside - 1, y) || !alike(f, x, y, x, y + p.hpInner + 1) || alike(f, x, y, x + 1, y + 1)) continue
      const width = boxAt(f, x, y, p.hpInner)
      if (width < minOutside) continue
      const under = p.below.filter((b) => alike(f, x, y, x, y + b.at) && boxAt(f, x, y + b.at, b.height, width) === width)
      if (!under.length) continue
      rows.push({
        left: x + 1 + f.x,
        right: x + width - 2 + f.x,
        top: y + 1 + f.y,
        outline: pixel(f, x, y),
        samples: [sample('hp', x, y, p.hpInner, width), ...under.map((b) => sample(b.ink, x, y + b.at, b.height, width))]
      })
      x += width - 1
    }
  }
  const window = group(rows)
  if (!window.length) return { colours: p.colours, seen: [], rows: 0 }
  const out: Partial<Record<keyof GroupColours, Rgb>> = { outline: mostOf(window.map((r) => r.outline))! }
  const all = window.flatMap((r) => r.samples)
  const split = all.filter((s) => !near(s.l, s.r))
  const whole = all.filter((s) => near(s.l, s.r))
  let empty = mostOf(split.map((s) => s.r)) ?? mostOf(whole.filter((s) => whole.some((o) => o.kind !== s.kind && near(o.l, s.l))).map((s) => s.l))
  const inks: Record<Sample['kind'], Rgb[]> = { hp: [], mana: [], end: [] }
  for (const s of split) inks[s.kind].push(s.l)
  for (const s of whole) {
    const isEmpty = empty ? near(s.l, empty) : distance(s.l, p.colours.empty) < distance(s.l, p.colours[s.kind])
    if (!isEmpty) inks[s.kind].push(s.l)
    else empty ??= s.l
  }
  if (empty) out.empty = empty
  for (const k of ['hp', 'mana', 'end'] as const) {
    const c = mostOf(inks[k])
    if (c) out[k] = c
  }
  return { colours: { ...p.colours, ...out }, seen: COLOUR_KEYS.filter((k) => out[k]), rows: window.length }
}

/** One member going low: the row (1 at the top) and their health, rounded to a whole percent. */
export interface LowHealth {
  slot: number
  pct: number
  /** The bar that went low: health, a member's mana (LT-751), or your own mana (FEAT-043). */
  what?: 'mana' | 'myMana'
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
  /** Each row's state by its key: its top edge on the screen where the rows are known, else its index. */
  private slots = new Map<number, SlotState>()

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
    this.slots.clear()
  }

  /**
   * Each row's fill (0 to 1, or null when it could not be read) → the members to say. With `keys`
   * (each row's top edge), a row keeps its state while it stays where it was, through a window over
   * it or a row added below (LT-550); rows no longer there are forgotten.
   */
  update(fills: (number | null)[], keys?: number[], lineOf?: (i: number) => number | undefined): LowHealth[] {
    const out: LowHealth[] = []
    const keyOf = (i: number) => keys?.[i] ?? i
    if (keys) for (const k of [...this.slots.keys()]) if (!keys.includes(k)) this.slots.delete(k)
    fills.forEach((fill, i) => {
      if (fill === null) return
      const pct = Math.round(fill * 100)
      let s = this.slots.get(keyOf(i))
      if (!s) this.slots.set(keyOf(i), (s = { fired: pct === 0, below: 0 }))
      // A row with a line of its own (a named member's, LT-751) re-arms as far over it as the others do.
      const below = lineOf?.(i) ?? this.belowPct
      const rearm = below + (this.rearmPct - this.belowPct)
      if (pct === 0) {
        s.fired = true
        s.below = 0
      } else if (pct >= rearm) {
        s.fired = false
        s.below = 0
      } else if (pct <= below) {
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
export function namesFromWords(bars: GroupBar[], words: { text: string; x: number; y: number; w: number; h: number }[], p: GroupHealthProfile = JUICEBOX_PROFILE): string[] {
  return bars.map((b) => {
    const mid = b.left + (b.right - b.left) * 0.6
    return (
      words
        .filter((w) => w.y + w.h / 2 >= b.top - 1 && w.y + w.h / 2 <= b.top + p.hpInner + 1 && w.x < mid && /^[A-Za-z`']+$/.test(w.text))
        .sort((a, c) => a.x - c.x)
        // A stray mark from the text's shadow comes through as a quote at either end.
        .map((w) => w.text.replace(/^[`']+|[`']+$/g, ''))
        .filter(Boolean)
        .join(' ')
    )
  })
}
