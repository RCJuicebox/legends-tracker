import { describe, expect, it } from 'vitest'
import { clock, day, duration, num, num1, numExact, pct, round, timeOfDay, when, who, whoList, wikiUrl } from '../../src/core/format'

describe('numbers', () => {
  it('whole numbers, one place, rounding', () => {
    expect(num(12345.6)).toBe((12346).toLocaleString())
    expect(numExact(1.5)).toBe((1.5).toLocaleString())
    expect(num1(1415)).toBe((1415).toLocaleString())
    expect(num1(12.345)).toBe('12.3')
    expect(round(1.2345, 2)).toBe(1.23)
    expect(round(-0.5, 0)).toBe(-0)
  })

  it('percentages, with the trailing zeros left off', () => {
    expect(pct(0.1234)).toBe('12%')
    expect(pct(0.1234, 1)).toBe('12.3%')
    expect(pct(0.12, 1)).toBe('12%')
    expect(pct(0.12345, 2)).toBe('12.35%')
    expect(pct(0)).toBe('0%')
    expect(pct(-0.0001)).toBe('0%')
  })
})

describe('lengths of time', () => {
  it('a clock, rounded first so it never reads 0:60, never negative, ∞ for no end', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(59.6)).toBe('1:00')
    expect(clock(245)).toBe('4:05')
    expect(clock(3729)).toBe('1:02:09')
    expect(clock(-3)).toBe('0:00')
    expect(clock(Infinity)).toBe('∞')
  })

  it('in words, seconds up to a minute and a half, minutes up to an hour and a half', () => {
    expect(duration(40)).toBe('40 s')
    expect(duration(89)).toBe('89 s')
    expect(duration(90)).toBe('2 min')
    expect(duration(12 * 60)).toBe('12 min')
    expect(duration(89 * 60)).toBe('89 min')
    expect(duration(3 * 3600 + 20 * 60)).toBe('3 h 20 min')
    expect(duration(3 * 3600)).toBe('3 h')
    expect(duration(Infinity)).toBe('permanent')
  })
})

describe('days and times', () => {
  const t = new Date(2026, 8, 25, 21, 5, 3).getTime()
  it('a day with its weekday, and the year only when it is not this one', () => {
    expect(day(t, t)).toBe(new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))
    const lastYear = new Date(2025, 7, 7, 12).getTime()
    expect(day(lastYear, t)).toBe(new Date(lastYear).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))
  })

  it('the time of day, with seconds when asked, and both together', () => {
    expect(timeOfDay(t)).toBe(new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    expect(timeOfDay(t, true)).toBe(new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    expect(when(t, t)).toBe(`${day(t, t)}, ${timeOfDay(t)}`)
  })
})

describe('names', () => {
  it('character keys and wiki links', () => {
    expect(who('Kelwyn_neriak')).toBe('Kelwyn · neriak')
    expect(whoList(['Kelwyn_neriak', 'Aldric_tunare'])).toBe('Kelwyn · neriak, Aldric · tunare')
    expect(wikiUrl("King Ak'Anon")).toBe("https://eqlwiki.com/index.php?title=King_Ak'Anon")
  })
})
