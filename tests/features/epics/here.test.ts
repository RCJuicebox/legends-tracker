import { describe, expect, it } from 'vitest'
import { hereCue, inZone, wantedHere } from '../../../src/features/epics/here'
import type { EpicState } from '../../../src/features/epics/core'

// Goals › Epics' "Wanted here": the pieces the character's classes still want from the zone the
// player is in, whatever the log or the wiki calls the zone, and the alert said on zoning in.

const state = (o: Partial<EpicState> = {}): EpicState => ({
  character: 'Kelwyn_neriak',
  ticks: [],
  adjust: {},
  logged: {},
  last: {},
  classes: ['Shadow Knight'],
  exported: null,
  ...o
})

describe('a step’s zone and the zone the log names', () => {
  it('matches the wiki’s short names to the zone lines', () => {
    expect(inZone('Upper Guk', 'The City of Guk')).toBe(true)
    expect(inZone('Lower Guk', 'Ruins of Old Guk')).toBe(true)
    expect(inZone('Permafrost', 'The Permafrost Caverns')).toBe(true)
    expect(inZone('Sol A', "Solusek's Eye")).toBe(true)
    expect(inZone('Mistmoore', 'Castle Mistmoore')).toBe(true)
    expect(inZone('Southern Karana', 'Southern Plains of Karana')).toBe(true)
    expect(inZone('Plane of Air', 'Plane of Sky')).toBe(true)
    expect(inZone('Everfrost', 'Everfrost Peaks')).toBe(true)
    expect(inZone('Oasis', 'Oasis of Marr')).toBe(true)
  })

  it('takes either of two zones, and an instance as its zone', () => {
    expect(inZone('Najena or Temple of Cazic-Thule', 'Najena')).toBe(true)
    expect(inZone('Najena or Temple of Cazic-Thule', 'The Temple of Cazic-Thule')).toBe(true)
    expect(inZone('Plane of Fear', 'The Plane of Fear 4 (Refined)')).toBe(true)
    expect(inZone('Upper Guk', 'Ruins of Old Guk')).toBe(false)
  })
})

describe('what is wanted here', () => {
  it('lists the pieces still needed from the zone, with who needs them', () => {
    expect(wantedHere(state(), 'The City of Guk', ['epic'])).toEqual([
      { name: 'Ghoulbane', how: 'Kill The froglok shin lord', have: 0, need: 1, lists: ['Shadow Knight'], unverified: false }
    ])
    expect(hereCue(wantedHere(state(), 'The City of Guk', ['epic']))).toBe('Epic pieces here: Ghoulbane (Shadow Knight)')
  })

  it('says how many are still to get, once each piece', () => {
    const rows = wantedHere(state(), 'The Temple of Cazic-Thule', ['epic'])
    expect(rows.map((r) => r.name)).toEqual(['Decayed Breastplate', 'Decayed Chainmail', 'Decayed Helm', 'Decayed Left Legplate', 'Decayed Right Legplate', 'Decayed Visor'])
    expect(hereCue(rows)).toBe(
      'Epic pieces here: Decayed Breastplate (Shadow Knight), Decayed Chainmail (Shadow Knight), Decayed Helm (Shadow Knight), Decayed Left Legplate (Shadow Knight), +2 more'
    )
  })

  it('leaves out what is held, covered or ticked off, and other classes’ pieces', () => {
    expect(wantedHere(state({ logged: { ghoulbane: 1 } }), 'The City of Guk', ['epic'])).toEqual([])
    expect(wantedHere(state({ logged: { 'innoruuks curse': 1 } }), 'The City of Guk', ['epic'])).toEqual([])
    expect(wantedHere(state({ ticks: ['Shadow Knight|Ghoulbane'] }), 'The City of Guk', ['epic'])).toEqual([])
    expect(wantedHere(state({ classes: ['Warrior'] }), 'The City of Guk', ['epic'])).toEqual([])
  })

  it('wants nothing of a module that is off, or nowhere', () => {
    expect(wantedHere(state(), 'The City of Guk', [])).toEqual([])
    expect(wantedHere(state(), '', ['epic'])).toEqual([])
    expect(hereCue([])).toBeNull()
  })

  it('counts a piece more than one list needs', () => {
    const rows = wantedHere(state({ classes: ['Enchanter', 'Rogue'] }), 'Ruins of Old Guk', ['epic'])
    const robes = rows.find((r) => r.name === 'Shining Metallic Robes')
    expect(robes).toMatchObject({ need: 2, have: 0, lists: ['Enchanter', 'Rogue'] })
    expect(hereCue(rows)).toContain('Shining Metallic Robes ×2 (Enchanter, Rogue)')
  })
})
