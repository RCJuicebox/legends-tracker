import { describe, expect, it } from 'vitest'
import { barFill, barsArea, findGroupBars, GROUP_COLOURS, GroupHealthAlarm, groupHealthPhrase, namesFromWords, type Frame } from '../../src/core/groupHealth'
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

/** A bar `w` × `h` with its outline, its top-left corner (the outline's) at (x, y), filled `pct` of the way with `ink`. */
function bar(f: Frame, x: number, y: number, w: number, h: number, ink: Rgb, pct: number): void {
  fill(f, x, y, w, h, GROUP_COLOURS.outline)
  fill(f, x + 1, y + 1, w - 2, h - 2, GROUP_COLOURS.empty)
  fill(f, x + 1, y + 1, Math.floor((w - 2) * pct), h - 2, ink)
}

/** A Group window's member row: the health bar's outline at (x, t), 202 wide inside. */
function member(f: Frame, x: number, t: number, hp: number, opts: { name?: boolean; mana?: boolean } = {}): void {
  bar(f, x, t, 204, 18, GROUP_COLOURS.hp, hp)
  if (opts.mana !== false) bar(f, x, t + 20, 204, 12, GROUP_COLOURS.mana, 0.6)
  bar(f, x, t + 34, 204, 12, GROUP_COLOURS.end, 0.9)
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

describe('GroupHealthAlarm', () => {
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
