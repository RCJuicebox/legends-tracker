import { describe, expect, it } from 'vitest'
import { lockoutDayStart } from '../../src/shared/game/slayerCamps'

// Raid lockouts open again at noon US Eastern: a kill counts toward the day that began at the last noon.

describe('lockoutDayStart', () => {
  it('is today noon Eastern after noon, in daylight time', () => {
    expect(lockoutDayStart(Date.parse('2026-10-20T13:00:00-04:00'))).toBe(Date.parse('2026-10-20T12:00:00-04:00'))
  })

  it('is yesterday noon before noon', () => {
    expect(lockoutDayStart(Date.parse('2026-10-20T10:30:00-04:00'))).toBe(Date.parse('2026-10-19T12:00:00-04:00'))
  })

  it('starts on the dot at noon', () => {
    const noon = Date.parse('2026-10-20T12:00:00-04:00')
    expect(lockoutDayStart(noon)).toBe(noon)
    expect(lockoutDayStart(noon - 1)).toBe(Date.parse('2026-10-19T12:00:00-04:00'))
  })

  it('follows standard time in winter', () => {
    expect(lockoutDayStart(Date.parse('2026-12-01T15:00:00-05:00'))).toBe(Date.parse('2026-12-01T12:00:00-05:00'))
  })

  it('lands right across the clock change', () => {
    // US clocks fall back 2026-11-01 at 2:00: the morning after, the day began at noon daylight time.
    expect(lockoutDayStart(Date.parse('2026-11-01T09:00:00-05:00'))).toBe(Date.parse('2026-10-31T12:00:00-04:00'))
    expect(lockoutDayStart(Date.parse('2026-11-01T01:30:00-04:00'))).toBe(Date.parse('2026-10-31T12:00:00-04:00'))
    expect(lockoutDayStart(Date.parse('2026-11-01T12:30:00-05:00'))).toBe(Date.parse('2026-11-01T12:00:00-05:00'))
  })
})
