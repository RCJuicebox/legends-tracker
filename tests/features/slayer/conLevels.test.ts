import { describe, expect, it } from 'vitest'
import { conLevel, emptyKillTallies, joinConLevels, readKillLine } from '../../../src/features/slayer/core'

// A mob's level as /con says it: what the pet plan holds a mob the spawn tables lack to (New Sebilis
// Expedition's golems, the Plane of Sky's soul tamers).

describe('levels from /con', () => {
  it('reads the mob and its level from any faction con, a rare creature too', () => {
    expect(conLevel('A soul tamer regards you indifferently -- what would you like your tombstone to say? (Lvl: 56)')).toEqual({ mob: 'a soul tamer', level: 56 })
    expect(conLevel('Abomination of Ro - a rare creature - scowls at you, ready to attack -- You could probably win this fight. (Lvl: 16)')).toEqual({
      mob: 'abomination of ro',
      level: 16
    })
    expect(conLevel('A gnoll looks your way apprehensively -- looks like quite a gamble. (Lvl: 50)')).toEqual({ mob: 'a gnoll', level: 50 })
    expect(conLevel("Guard Gruilka says, 'Hail (Lvl: 3)'")).toBeNull()
    expect(conLevel('You have slain a gnoll!')).toBeNull()
  })

  it('keeps each mob’s highest level over every stretch, cons outside a zone too', () => {
    const a = emptyKillTallies()
    readKillLine({ time: 1000, text: 'A failed experiment glares at you threateningly -- You could probably win this fight. (Lvl: 12)' }, a)
    readKillLine({ time: 2000, text: 'You have entered New Sebilis Expedition.' }, a)
    readKillLine({ time: 3000, text: 'A failed experiment glares at you threateningly -- You could probably win this fight. (Lvl: 14)' }, a)
    const b = emptyKillTallies()
    readKillLine({ time: 4000, text: 'A failed experiment glares at you threateningly -- You could probably win this fight. (Lvl: 13)' }, b)
    readKillLine({ time: 5000, text: 'A soul tamer regards you indifferently -- what would you like your tombstone to say? (Lvl: 56)' }, b)
    expect(joinConLevels([a, b])).toEqual({ 'a failed experiment': 14, 'a soul tamer': 56 })
    // A con is no kill.
    expect(a.zones).toEqual({})
  })
})
