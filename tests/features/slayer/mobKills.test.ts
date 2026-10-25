import { describe, expect, it } from 'vitest'
import { emptyKillTallies, joinKillTallies, mobKills, readKillLine } from '../../../src/features/slayer/core'

// Respawns › Kill counts: each mob's kills zone by zone, a zone's instances together, over every
// stretch of log (an archive and the live log here).

describe('kill counts per mob', () => {
  it('counts each mob by zone, instances folded in, over every stretch, the most killed first', () => {
    const archive = emptyKillTallies()
    const live = emptyKillTallies()
    readKillLine({ time: 1000, text: 'You have entered Nektropos Castle.' }, archive)
    readKillLine({ time: 2000, text: 'You have slain The Game Master!' }, archive)
    readKillLine({ time: 3000, text: 'You have entered Nektropos Castle 4 (Refined).' }, live)
    readKillLine({ time: 4000, text: 'The Game Master has been slain by Kelwyn!' }, live)
    readKillLine({ time: 5000, text: 'You have slain The Game Master!' }, live)
    readKillLine({ time: 6000, text: 'You have slain a spectral handmaiden!' }, live)
    // A mob's pet, and a kill by a mob, are not the player's side's kills.
    readKillLine({ time: 7000, text: 'You have slain The Game Master pet!' }, live)
    readKillLine({ time: 8000, text: 'A spectral handmaiden has been slain by a crypt guardian!' }, live)
    readKillLine({ time: 9000, text: 'You have entered Lake Nerius.' }, live)
    readKillLine({ time: 10000, text: 'You have slain a spectral handmaiden!' }, live)
    expect(mobKills(joinKillTallies([archive, live]))).toEqual([
      { mob: 'The Game Master', zone: 'Nektropos Castle', kills: 3, last: 5000 },
      { mob: 'A spectral handmaiden', zone: 'Lake Nerius', kills: 1, last: 10000 },
      { mob: 'A spectral handmaiden', zone: 'Nektropos Castle', kills: 1, last: 6000 }
    ])
  })

  it('has nothing for no kills', () => {
    expect(mobKills(joinKillTallies([emptyKillTallies()]))).toEqual([])
  })
})
