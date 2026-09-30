import { describe, expect, it } from 'vitest'
import { DEITIES, deityKey, deityName } from '../../src/shared/game/deities'

describe('Deities', () => {
  it('lists Agnostic and the sixteen gods the client has "Deity Unlock" achievements for', () => {
    expect(DEITIES).toHaveLength(17)
    expect(DEITIES[0]).toBe('Agnostic')
  })

  it("keys each god's faction modifiers 201 to 216 in the achievements' order, and Agnostic none", () => {
    expect(deityKey('Agnostic')).toBeNull()
    expect(deityKey('Bertoxxulous')).toBe(201)
    expect(deityKey('Cazic Thule')).toBe(203)
    expect(deityKey('Tunare')).toBe(215)
    expect(deityKey('Veeshan')).toBe(216)
    expect(deityKey('')).toBeNull()
    expect(deityKey('Zebuxoruk')).toBeNull()
  })

  it('reads the other spellings in use', () => {
    expect(deityName('Cazic-Thule')).toBe('Cazic Thule')
    expect(deityKey('Cazic-Thule')).toBe(203)
    expect(deityName('The Tribunal')).toBe('Tribunal')
    expect(deityKey('the tribunal')).toBe(214)
    expect(deityName('nobody')).toBe('')
  })
})
