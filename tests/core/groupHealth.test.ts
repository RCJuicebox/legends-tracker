import { describe, expect, it } from 'vitest'
import {
  barFill,
  barsArea,
  calibrateColours,
  findGroupBars,
  findPlayerMana,
  GROUP_COLOURS,
  GroupHealthAlarm,
  groupHealthPhrase,
  JUICEBOX_PROFILE,
  manaFill,
  namesFromWords,
  parseColours,
  parseGroupHealthProfile,
  playerArea,
  playerManaFill,
  rgbOf,
  type Frame,
  type GroupColours,
  type GroupHealthProfile
} from '../../src/core/groupHealth'
import { parseSkinGroupHealth } from '../../src/core/skinBuild'
import { RE_GROUP_CHANGE } from '../../src/core/combatLines'

// The group health watch reads JuiceboxUI's Group window off the screen. These frames are drawn the
// way the skin draws it (Interface/barwindows.py group()): flat colours in a 1-pixel outline, health
// 18 tall, mana 12 tall 20 down, endurance 12 tall 34 down, rows 60 apart.

type Rgb = readonly [number, number, number]
const BG: Rgb = [16, 20, 24]
const WHITE: Rgb = [255, 255, 255]

function frame(width: number, height: number, x = 0, y = 0): Frame {
  const f = { data: new Uint8Array(width * height * 4), width, height, x, y }
  fill(f, 0, 0, width, height, BG)
  return f
}

function fill(f: Frame, x: number, y: number, w: number, h: number, c: Rgb): void {
  for (let r = y; r < y + h; r++)
    for (let col = x; col < x + w; col++) {
      const i = (r * f.width + col) * 4
      f.data[i] = c[2]
      f.data[i + 1] = c[1]
      f.data[i + 2] = c[0]
    }
}

/**
 * A bar `w` × `h` with its outline, its top-left corner (the outline's) at (x, y), filled `pct` of the way with `ink`.
 * Shaded, as JBUI draws it (Interface/fieldkit.py, gradient 0.55): the fill from 55% of its colour at the left to the
 * whole of it at the right, and the empty inside darkening to black in its middle rows.
 */
function bar(f: Frame, x: number, y: number, w: number, h: number, ink: Rgb, pct: number, shaded = false): void {
  fill(f, x, y, w, h, GROUP_COLOURS.outline)
  const inside = w - 2
  for (let r = 0; r < h - 2; r++) {
    const dark = shaded ? 1 - Math.min(r, h - 3 - r) / ((h - 2) / 2) : 1
    fill(f, x + 1, y + 1 + r, inside, 1, GROUP_COLOURS.empty.map((v) => Math.round(v * dark)) as unknown as Rgb)
  }
  const filled = Math.floor(inside * pct)
  if (!shaded) return fill(f, x + 1, y + 1, filled, h - 2, ink)
  for (let i = 0; i < filled; i++) fill(f, x + 1 + i, y + 1, 1, h - 2, ink.map((v) => Math.round(v * (0.55 + (0.45 * i) / (inside - 1)))) as unknown as Rgb)
}

/** A Group window's member row: the health bar's outline at (x, t), 202 wide inside. */
function member(f: Frame, x: number, t: number, hp: number, opts: { name?: boolean; mana?: boolean; shaded?: boolean } = {}): void {
  bar(f, x, t, 204, 18, GROUP_COLOURS.hp, hp, opts.shaded)
  if (opts.mana !== false) bar(f, x, t + 20, 204, 12, GROUP_COLOURS.mana, 0.6, opts.shaded)
  bar(f, x, t + 34, 204, 12, GROUP_COLOURS.end, 0.9, opts.shaded)
  // The name in white over the bar's middle rows, 4 in from its left.
  if (opts.name !== false) fill(f, x + 6, t + 4, 40, 10, WHITE)
}

describe('findGroupBars', () => {
  it("finds each member's health bar, top to bottom, at its screen position", () => {
    const f = frame(400, 300, 1000, 500)
    member(f, 50, 20, 1)
    member(f, 50, 80, 0.5)
    member(f, 50, 140, 0)
    expect(findGroupBars(f)).toEqual([
      { left: 1051, right: 1252, top: 521 },
      { left: 1051, right: 1252, top: 581 },
      { left: 1051, right: 1252, top: 641 }
    ])
  })

  it('takes a member with no mana bar by their endurance bar', () => {
    const f = frame(400, 120)
    member(f, 50, 20, 0.7, { mana: false })
    expect(findGroupBars(f)).toHaveLength(1)
  })

  it("passes over the Player and Target windows' bars (14 inside) and the threat bar (nothing under it)", () => {
    const f = frame(700, 200)
    // Player window: health, mana, endurance 16 tall, 20 apart.
    bar(f, 20, 20, 258, 16, GROUP_COLOURS.hp, 0.3)
    bar(f, 20, 40, 258, 16, GROUP_COLOURS.mana, 1)
    bar(f, 20, 60, 258, 16, GROUP_COLOURS.end, 1)
    // Threat: one bar 18 tall in the health colour, text under it.
    bar(f, 320, 20, 200, 18, GROUP_COLOURS.hp, 0.4)
    fill(f, 325, 44, 60, 10, WHITE)
    expect(findGroupBars(f)).toEqual([])
  })
})

describe('barFill', () => {
  it('reads how full each bar is, past a name over it', () => {
    const f = frame(400, 300)
    member(f, 50, 20, 1)
    member(f, 50, 80, 0.5)
    member(f, 50, 140, 0)
    member(f, 50, 200, 0.24)
    const fills = findGroupBars(f).map((b) => barFill(f, b))
    expect(fills[0]).toBe(1)
    expect(fills[1]).toBeCloseTo(0.5, 2)
    expect(fills[2]).toBe(0)
    expect(fills[3]).toBeCloseTo(0.24, 2)
  })

  it("finds and reads JBUI's shaded bars, health and mana", () => {
    const f = frame(400, 200)
    member(f, 50, 20, 0.73, { shaded: true })
    member(f, 50, 80, 0.18, { shaded: true })
    const bars = findGroupBars(f)
    expect(bars).toHaveLength(2)
    expect(barFill(f, bars[0])).toBeCloseTo(0.73, 2)
    expect(barFill(f, bars[1])).toBeCloseTo(0.18, 2)
    expect(manaFill(f, bars[1])).toBeCloseTo(0.6, 2)
  })

  it('reads a sample captured around the bars alone, and says when a bar is gone', () => {
    const whole = frame(400, 200)
    member(whole, 50, 20, 0.2)
    const bars = findGroupBars(whole)
    const a = barsArea(bars)
    const piece = frame(a.width, a.height, a.x, a.y)
    member(piece, 50 - a.x, 20 - a.y, 0.2)
    expect(barFill(piece, bars[0])).toBeCloseTo(0.2, 2)
    // Something over it, or the window moved: not a reading.
    expect(barFill(frame(a.width, a.height, a.x, a.y), bars[0])).toBeNull()
  })
})

describe('manaFill', () => {
  it('reads the mana bar under each health bar, from a sample of the bars alone (LT-751)', () => {
    const whole = frame(400, 200)
    member(whole, 50, 20, 0.9)
    member(whole, 50, 80, 0.9, { mana: false })
    const bars = findGroupBars(whole)
    expect(manaFill(whole, bars[0])).toBeCloseTo(0.6, 2)
    // No mana bar (a warrior's row): nothing to read, never said.
    expect(manaFill(whole, bars[1])).toBeNull()
    const a = barsArea(bars)
    const piece = frame(a.width, a.height, a.x, a.y)
    member(piece, 50 - a.x, 20 - a.y, 0.9)
    member(piece, 50 - a.x, 80 - a.y, 0.9)
    expect(manaFill(piece, bars[1])).toBeCloseTo(0.6, 2)
  })
})

describe('GroupHealthAlarm', () => {
  it('gives a named member a line of their own, re-armed as far over it (LT-751)', () => {
    const alarm = new GroupHealthAlarm(25, 35)
    const lineOf = (i: number) => (i === 0 ? 40 : undefined)
    alarm.update([0.38, 0.38], [100, 120], lineOf)
    expect(alarm.update([0.38, 0.38], [100, 120], lineOf)).toEqual([{ slot: 1, pct: 38 }])
    // Back to 45: under their 50 re-arm, so not said again yet.
    alarm.update([0.45, 0.38], [100, 120], lineOf)
    alarm.update([0.39, 0.38], [100, 120], lineOf)
    expect(alarm.update([0.39, 0.38], [100, 120], lineOf)).toEqual([])
    alarm.update([0.55, 0.38], [100, 120], lineOf)
    alarm.update([0.39, 0.38], [100, 120], lineOf)
    expect(alarm.update([0.39, 0.38], [100, 120], lineOf)).toEqual([{ slot: 1, pct: 39 }])
  })

  it('says a member once as they fall to the line, two samples in a row, and again only after they are back 10 over', () => {
    const alarm = new GroupHealthAlarm(25, 35)
    expect(alarm.update([0.9, 0.8])).toEqual([])
    expect(alarm.update([0.24, 0.8])).toEqual([])
    expect(alarm.update([0.22, 0.8])).toEqual([{ slot: 1, pct: 22 }])
    expect(alarm.update([0.1, 0.8])).toEqual([])
    expect(alarm.update([0.3, 0.8])).toEqual([])
    expect(alarm.update([0.2, 0.8])).toEqual([])
    expect(alarm.update([0.2, 0.8])).toEqual([])
    expect(alarm.update([0.4, 0.8])).toEqual([])
    alarm.update([0.25, 0.8])
    expect(alarm.update([0.25, 0.8])).toEqual([{ slot: 1, pct: 25 }])
  })

  it('never says a member at 0 (dead or in another zone), nor their rez at low health', () => {
    const alarm = new GroupHealthAlarm(25, 35)
    alarm.update([0.5])
    expect(alarm.update([0])).toEqual([])
    alarm.update([0.1])
    expect(alarm.update([0.1])).toEqual([])
    alarm.update([0.6])
    alarm.update([0.2])
    expect(alarm.update([0.2])).toEqual([{ slot: 1, pct: 20 }])
  })

  it('keeps a row’s state by its place on the screen: a row added above moves it down, a window over it changes nothing (LT-550)', () => {
    const alarm = new GroupHealthAlarm(25, 35)
    // Rows at 100 and 120: the second falls to the line and is said.
    alarm.update([0.9, 0.2], [100, 120])
    expect(alarm.update([0.9, 0.2], [100, 120])).toEqual([{ slot: 2, pct: 20 }])
    // Unreadable for a moment, then a row joins above: the same row is now third, still said once.
    expect(alarm.update([null, null], [100, 120])).toEqual([])
    expect(alarm.update([0.8, 0.9, 0.2], [80, 100, 120])).toEqual([])
    expect(alarm.update([0.8, 0.9, 0.2], [80, 100, 120])).toEqual([])
    // Gone and back where it was: forgotten rows start over.
    alarm.update([0.8], [80])
    alarm.update([0.8, 0.2], [80, 120])
    expect(alarm.update([0.8, 0.2], [80, 120])).toEqual([{ slot: 2, pct: 20 }])
  })

  it('skips a sample that could not be read, and a single low frame', () => {
    const alarm = new GroupHealthAlarm(25, 35)
    alarm.update([0.2])
    expect(alarm.update([null])).toEqual([])
    expect(alarm.update([0.5])).toEqual([])
    expect(alarm.update([0.2])).toEqual([])
  })
})

describe('namesFromWords', () => {
  it("takes each row's name from the words over its bar, not the numbers on its right", () => {
    const bars = [
      { left: 100, right: 301, top: 50 },
      { left: 100, right: 301, top: 110 }
    ]
    const words = [
      { text: 'Tester', x: 105, y: 53, w: 40, h: 10 },
      { text: '100', x: 270, y: 53, w: 20, h: 10 },
      { text: "'Aldric", x: 105, y: 113, w: 38, h: 10 },
      { text: '24', x: 278, y: 113, w: 12, h: 10 }
    ]
    expect(namesFromWords(bars, words)).toEqual(['Tester', 'Aldric'])
  })
})

describe('groupHealthPhrase', () => {
  it('puts in the name and the health', () => {
    expect(groupHealthPhrase('{name} at {pct} percent', 'Aldric', 22)).toBe('Aldric at 22 percent')
    expect(groupHealthPhrase('Heal {NAME}!', 'Group member 2', 9)).toBe('Heal Group member 2!')
  })
})

describe('RE_GROUP_CHANGE', () => {
  it('matches the lines that change the group, and no others', () => {
    for (const l of [
      'Aldric has joined the group.',
      'Aldric has left the group.',
      'You have joined the group.',
      'Your group has been disbanded.',
      'You remove Aldric from the group.'
    ])
      expect(RE_GROUP_CHANGE.test(l)).toBe(true)
    expect(RE_GROUP_CHANGE.test('Aldric tells the group, hi')).toBe(false)
  })
})

// Another skin's bars (FEAT-040): the colours of a theme like JuiceboxUI2's, and a shape of its own.
const ARCANE: GroupColours = { outline: [60, 40, 90], empty: [40, 20, 50], hp: [220, 60, 110], mana: [70, 140, 230], end: [230, 180, 70] }

/** As bar(), in a skin's colours. */
function barIn(f: Frame, c: GroupColours, x: number, y: number, w: number, h: number, ink: Rgb, pct: number): void {
  fill(f, x, y, w, h, c.outline)
  fill(f, x + 1, y + 1, w - 2, h - 2, c.empty)
  fill(f, x + 1, y + 1, Math.floor((w - 2) * pct), h - 2, ink)
}

/** As member(), in a skin's colours: each bar's fill given. */
function memberIn(f: Frame, c: GroupColours, x: number, t: number, hp: number, mana: number, end: number): void {
  barIn(f, c, x, t, 204, 18, c.hp, hp)
  barIn(f, c, x, t + 20, 204, 12, c.mana, mana)
  barIn(f, c, x, t + 34, 204, 12, c.end, end)
  fill(f, x + 6, t + 4, 40, 10, WHITE)
}

/** JuiceboxUI's Player window: health, mana and endurance 16 tall (14 inside), 20 apart, the top one's outline at (x, t). */
function playerWindow(f: Frame, x: number, t: number, mana: number, o: { end?: boolean; shaded?: boolean } = {}): void {
  bar(f, x, t, 266, 16, GROUP_COLOURS.hp, 0.8, o.shaded)
  bar(f, x, t + 20, 266, 16, GROUP_COLOURS.mana, mana, o.shaded)
  if (o.end !== false) bar(f, x, t + 40, 266, 16, GROUP_COLOURS.end, 1, o.shaded)
  // "Mana" on the bar's left, its numbers on its right.
  fill(f, x + 6, t + 24, 30, 8, WHITE)
  fill(f, x + 200, t + 24, 50, 8, WHITE)
}

describe('parseGroupHealthProfile', () => {
  it("reads a skin's section, colours as [r, g, b] or #rrggbb, and takes JuiceboxUI's for whatever it leaves out or gets wrong", () => {
    expect(parseGroupHealthProfile(undefined)).toBeUndefined()
    expect(parseGroupHealthProfile([1, 2])).toBeUndefined()
    expect(parseGroupHealthProfile({})).toEqual(JUICEBOX_PROFILE)
    const p = parseGroupHealthProfile({
      colours: { outline: '#3c285a', hp: [220, 60, 110], mana: 'blue', end: [1, 2, 300] },
      hpInner: 12,
      below: [{ at: 16, height: 8, ink: 'mana' }, { at: 0, height: 8, ink: 'end' }, { at: 30, height: 8, ink: 'pet' }, 'x'],
      minWidth: 5,
      playerInner: 12,
      playerStep: 18
    })
    expect(p).toEqual({
      colours: { ...GROUP_COLOURS, outline: [60, 40, 90], hp: [220, 60, 110] },
      hpInner: 12,
      below: [{ at: 16, height: 8, ink: 'mana' }],
      minWidth: 80,
      playerInner: 12,
      playerStep: 18
    })
    // No bar under it worth keeping: JuiceboxUI's.
    expect(parseGroupHealthProfile({ below: [{ at: 1, height: 8, ink: 'mana' }] })!.below).toEqual(JUICEBOX_PROFILE.below)
  })

  it('reads the section out of the whole legends-tracker.json, with or without a rebuild command', () => {
    expect(parseSkinGroupHealth(JSON.stringify({ groupHealth: { hpInner: 12 } }))!.hpInner).toBe(12)
    expect(parseSkinGroupHealth(JSON.stringify({ label: 'Rebuild', command: ['C:/x.exe'] }))).toBeUndefined()
    expect(parseSkinGroupHealth('not json')).toBeUndefined()
    expect(parseSkinGroupHealth('null')).toBeUndefined()
  })

  it('keeps colours given for the settings, each one wrong taken from JuiceboxUI', () => {
    expect(parseColours({ hp: '#DC3C6E', mana: [1, 2] })).toEqual({ ...GROUP_COLOURS, hp: [220, 60, 110] })
    expect(parseColours(null)).toEqual(GROUP_COLOURS)
    expect(rgbOf(' #000000 ')).toEqual([0, 0, 0])
    expect(rgbOf([0.5, 1, 2])).toBeNull()
  })
})

describe("another skin's profile (FEAT-040)", () => {
  const profile: GroupHealthProfile = { ...JUICEBOX_PROFILE, colours: ARCANE }

  it('finds and reads its bars by its own colours, and JuiceboxUI’s find nothing there', () => {
    const f = frame(400, 200)
    memberIn(f, ARCANE, 50, 20, 0.5, 0.3, 1)
    memberIn(f, ARCANE, 50, 80, 1, 0.8, 1)
    expect(findGroupBars(f)).toEqual([])
    const bars = findGroupBars(f, profile)
    expect(bars).toHaveLength(2)
    expect(barFill(f, bars[0], profile)).toBeCloseTo(0.5, 2)
    expect(manaFill(f, bars[1], profile)).toBeCloseTo(0.8, 2)
  })

  it('finds bars of another shape: a shorter health bar with the mana bar nearer under it', () => {
    const shape: GroupHealthProfile = { ...JUICEBOX_PROFILE, hpInner: 12, below: [{ at: 16, height: 8, ink: 'mana' }] }
    const f = frame(400, 120)
    bar(f, 50, 20, 204, 14, GROUP_COLOURS.hp, 0.7)
    bar(f, 50, 36, 204, 10, GROUP_COLOURS.mana, 0.4)
    expect(findGroupBars(f)).toEqual([])
    const bars = findGroupBars(f, shape)
    expect(bars).toEqual([{ left: 51, right: 252, top: 21 }])
    expect(manaFill(f, bars[0], shape)).toBeCloseTo(0.4, 2)
    expect(barsArea(bars, shape)).toEqual({ x: 49, y: 19, width: 206, height: 28 })
    // With no mana bar under it, there is no mana to read and a sample stops at the health bar.
    const noMana: GroupHealthProfile = { ...JUICEBOX_PROFILE, below: [{ at: 34, height: 10, ink: 'end' }] }
    expect(manaFill(f, bars[0], noMana)).toBeNull()
    expect(barsArea(bars, noMana).height).toBe(20)
  })

  it("takes a name off a shorter health bar by the profile's height", () => {
    const bars = [{ left: 100, right: 301, top: 50 }]
    const words = [{ text: 'Kelwyn', x: 105, y: 62, w: 40, h: 8 }]
    expect(namesFromWords(bars, words)).toEqual(['Kelwyn'])
    expect(namesFromWords(bars, words, { ...JUICEBOX_PROFILE, hpInner: 8 })).toEqual([''])
  })
})

describe('findPlayerMana (FEAT-043)', () => {
  it('finds your mana bar in the Player window, between its health and endurance bars, and reads it past its words', () => {
    const f = frame(400, 200, 2000, 100)
    playerWindow(f, 30, 40, 0.35)
    const bar = findPlayerMana(f)
    expect(bar).toEqual({ left: 2031, right: 2294, top: 161 })
    expect(playerManaFill(f, bar!)).toBeCloseTo(0.35, 2)
    // A sample of just the bar reads the same.
    const a = playerArea(bar!)
    expect(a).toEqual({ x: 2029, y: 159, width: 268, height: 18 })
    const piece = frame(a.width, a.height, a.x, a.y)
    playerWindow(piece, 2030 - a.x, 140 - a.y, 0.35)
    expect(playerManaFill(piece, bar!)).toBeCloseTo(0.35, 2)
  })

  it("reads JBUI's shaded bars: the fill darker to its left, the empty inside darker mid-bar", () => {
    const f = frame(400, 200, 2000, 100)
    playerWindow(f, 30, 40, 0.87, { shaded: true })
    const bar = findPlayerMana(f)
    expect(bar).toEqual({ left: 2031, right: 2294, top: 161 })
    expect(playerManaFill(f, bar!)).toBeCloseTo(0.87, 2)
    playerWindow(f, 30, 40, 0.12, { shaded: true })
    expect(playerManaFill(f, bar!)).toBeCloseTo(0.12, 2)
  })

  it('reads an empty bar (a class without mana) as 0, and a cast bar over it as nothing', () => {
    const f = frame(400, 120)
    playerWindow(f, 30, 20, 0)
    const bar = findPlayerMana(f)!
    expect(playerManaFill(f, bar)).toBe(0)
    // The cast bar drawn over the mana bar while casting: not a reading.
    fill(f, 31, 41, 264, 14, [224, 90, 180])
    expect(playerManaFill(f, bar)).toBeNull()
  })

  it("does not take the Group window's mana bars, or a mana-coloured bar without the Player window's around it", () => {
    const f = frame(400, 300)
    member(f, 50, 20, 0.9)
    member(f, 50, 80, 0.5)
    expect(findPlayerMana(f)).toBeNull()
    const g = frame(400, 120)
    playerWindow(g, 30, 20, 0.5, { end: false })
    expect(findPlayerMana(g)).toBeNull()
    // And the Player window is not taken for the Group window.
    playerWindow(g, 30, 20, 0.5)
    expect(findGroupBars(g)).toEqual([])
  })
})

describe('calibrateColours (FEAT-040)', () => {
  it("samples every colour off a Group window with bars partly full, and the window's rows read with them", () => {
    const f = frame(500, 260, 300, 400)
    memberIn(f, ARCANE, 60, 20, 0.5, 0.3, 0.9)
    memberIn(f, ARCANE, 60, 80, 0.8, 0.6, 0.2)
    memberIn(f, ARCANE, 60, 140, 0.2, 0.9, 0.5)
    const r = calibrateColours(f)
    expect(r.rows).toBe(3)
    expect(r.seen).toEqual(['outline', 'empty', 'hp', 'mana', 'end'])
    expect(r.colours).toEqual(ARCANE)
    expect(findGroupBars(f, { ...JUICEBOX_PROFILE, colours: r.colours })).toHaveLength(3)
  })

  it('tells empty from full when every bar is whole: a colour whole in bars of two kinds is empty', () => {
    const f = frame(400, 200)
    // A warrior at full health with no mana, and a member dead with full mana.
    memberIn(f, ARCANE, 50, 20, 1, 0, 1)
    memberIn(f, ARCANE, 50, 80, 0, 1, 1)
    const r = calibrateColours(f)
    expect(r.rows).toBe(2)
    expect(r.colours).toEqual(ARCANE)
    expect(r.seen).toHaveLength(5)
  })

  it('judges whole bars by the colours it had when nothing shows empty, and keeps what it never saw', () => {
    const f = frame(400, 200)
    memberIn(f, ARCANE, 50, 20, 1, 1, 1)
    const r = calibrateColours(f)
    expect(r.rows).toBe(1)
    expect(r.seen).toEqual(['outline', 'hp', 'mana', 'end'])
    expect(r.colours).toEqual({ ...ARCANE, empty: GROUP_COLOURS.empty })
    // A member at 0 health alone: nearer the old empty than the old health colour, so taken for empty.
    const g = frame(400, 120)
    memberIn(g, ARCANE, 50, 20, 0, 1, 1)
    expect(calibrateColours(g).colours.empty).toEqual(ARCANE.empty)
  })

  it('finds nothing where there is no Group window: the Player window, flat patches, a lone bar', () => {
    const f = frame(600, 200)
    playerWindow(f, 20, 20, 0.5)
    fill(f, 320, 20, 200, 60, [41, 48, 57])
    bar(f, 320, 100, 204, 18, GROUP_COLOURS.hp, 0.4)
    expect(calibrateColours(f)).toEqual({ colours: GROUP_COLOURS, seen: [], rows: 0 })
  })
})
