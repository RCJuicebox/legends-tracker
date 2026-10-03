import { describe, expect, it } from 'vitest'
import { closedKey, mergeCombat, type CombatSnapshot, type SegmentSummary } from '../../src/shared/combat'

const seg = (id: string, open = false): SegmentSummary => ({
  id,
  kind: 'fight',
  name: id,
  zone: '',
  startedAt: 0,
  endedAt: 0,
  open,
  total: 0,
  dps: 0,
  yours: 0,
  kills: 0,
  deaths: 0,
  mine: false
})

const snap = (fights: SegmentSummary[], sessions: SegmentSummary[] = []): CombatSnapshot => ({
  fights,
  sessions,
  liveFight: null,
  liveSession: null,
  self: 'Kelwyn',
  roster: [],
  pets: [],
  otherPets: {},
  reading: ''
})

describe('the meter sent to an overlay (LT-370)', () => {
  it('keeps the closed fights and sessions it has when sent the open ones alone', () => {
    const full = snap([seg('f3', true), seg('f2'), seg('f1')], [seg('s2', true), seg('s1')])
    const next = { ...snap([seg('f3', true)], [seg('s2', true)]), openOnly: true as const }
    expect(mergeCombat(full, next).fights.map((f) => f.id)).toEqual(['f3', 'f2', 'f1'])
    expect(mergeCombat(full, next).sessions.map((f) => f.id)).toEqual(['s2', 's1'])
    expect(mergeCombat(full, next)).not.toHaveProperty('openOnly')
    // A whole snapshot replaces what was there.
    expect(mergeCombat(full, snap([seg('f4')])).fights.map((f) => f.id)).toEqual(['f4'])
  })

  it('tells a change in the closed ones by their count and newest', () => {
    const a = snap([seg('f3', true), seg('f2'), seg('f1')])
    expect(closedKey(a)).toBe(closedKey(snap([seg('f3', true), seg('f2'), seg('f1')])))
    expect(closedKey(a)).not.toBe(closedKey(snap([seg('f3'), seg('f2'), seg('f1')])))
  })
})
