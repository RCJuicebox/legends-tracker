import { describe, expect, it } from 'vitest'
import { conBasis, parseFactionModifiers, standingBand, withCons, type FactionRow, type FactionView } from '../../../src/features/factions/core'

// What a faction cons at: the standing with the race's, the best class's and the deity's modifiers.
// The rows below are the client's own (Resources/Faction/FactionAssociations.txt) for Tunare's Scouts
// (316), Guardians of the Vale (263), Song Weavers (401) and Dreadguard Inner (370); the cons they are
// checked against were seen in play.

const MODS = parseFactionModifiers(
  [
    '316^5^-200^',
    '316^9^50^',
    '316^11^-200^',
    '316^51^-1^',
    '316^52^-1^',
    '316^54^100^',
    '316^55^50^',
    '316^56^-750^',
    '316^57^50^',
    '316^59^-750^',
    '316^60^-750^',
    '316^62^-1^',
    '316^178^-750^',
    '316^180^-1^',
    '316^201^-200^',
    '316^203^-200^',
    '316^205^50^',
    '316^206^-800^',
    '316^207^50^',
    '316^209^100^',
    '316^215^100^',
    '316^661^-1^',
    '316^1106^-1^',
    '263^1^50^',
    '263^3^25^',
    '263^4^25^',
    '263^5^-300^',
    '263^6^50^',
    '263^11^-300^',
    '263^16^50^',
    '263^51^-15^',
    '263^52^-25^',
    '263^53^-25^',
    '263^55^-25^',
    '263^56^-300^',
    '263^57^-10^',
    '263^58^-5^',
    '263^59^-750^',
    '263^60^-700^',
    '263^61^50^',
    '263^178^-1000^',
    '263^180^-25^',
    '263^201^-400^',
    '263^202^25^',
    '263^203^-300^',
    '263^205^25^',
    '263^206^-300^',
    '263^207^25^',
    '263^210^25^',
    '263^211^50^',
    '263^212^15^',
    '263^215^15^',
    '263^661^-15^',
    '263^1106^-15^',
    '401^5^-300^',
    '401^8^50^',
    '401^11^-200^',
    '401^51^-25^',
    '401^52^-25^',
    '401^54^50^',
    '401^55^50^',
    '401^56^-1000^',
    '401^57^50^',
    '401^58^-25^',
    '401^59^-800^',
    '401^60^-600^',
    '401^178^-1000^',
    '401^180^-25^',
    '401^661^-25^',
    '401^1106^-25^',
    '370^3^-750^',
    '370^4^25^',
    '370^5^50^',
    '370^6^-750^',
    '370^7^-300^',
    '370^9^25^',
    '370^11^50^',
    '370^51^-200^',
    '370^52^-875^',
    '370^53^-200^',
    '370^54^-875^',
    '370^55^-875^',
    '370^56^50^',
    '370^57^-875^',
    '370^58^-875^',
    '370^59^-400^',
    '370^60^-450^',
    '370^61^-875^',
    '370^62^-200^',
    '370^178^-875^',
    '370^180^-875^',
    '370^201^0^',
    '370^202^-750^',
    '370^203^-25^',
    '370^204^-750^',
    '370^205^-75^',
    '370^206^50^',
    '370^207^-750^',
    '370^208^-750^',
    '370^209^-750^',
    '370^210^-750^',
    '370^211^-50^',
    '370^212^-750^',
    '370^213^-75^',
    '370^214^-750^',
    '370^215^-750^',
    '370^216^-150^',
    '370^661^-200^',
    '370^1106^-200^'
  ].join('\n')
)

const EXPORT = 'Kelwyn_neriak-MNK-Factions.txt'

function row(id: number, name: string, value: number | null): FactionRow {
  const standing = value === null ? null : { id, value, atExport: value, since: 0, sinceAll: true }
  return { name, net: 0, changes: 0, first: 0, last: 0, cap: null, recent: [], standing, achievement: null }
}

const VIEW: FactionView = {
  factions: [
    row(316, "Tunare's Scouts", 0),
    row(263, 'Guardians of the Vale', 2000),
    row(401, 'Song Weavers', 0),
    row(370, 'Dreadguard Inner', 2000),
    row(999, 'Faction999', null)
  ],
  export: { file: EXPORT, modified: 0 },
  exportError: ''
}

/** The con of one faction for a race, classes (the record's, by name) and deity. */
function con(name: string, race: string, deity: string, classes: string[] = ['Monk']) {
  const c = conBasis(race, classes, EXPORT, deity)
  if (!c) throw new Error(`no basis for ${race}`)
  return withCons(VIEW, MODS, c).factions.find((r) => r.name === name)?.standing?.con
}
const seen = (name: string, race: string, deity: string, classes?: string[]) => {
  const v = con(name, race, deity, classes)?.value ?? NaN
  return [v, standingBand(v).word]
}

describe('What a faction cons at', () => {
  it("cons Tunare's Scouts at 0 the four ways it was seen in play", () => {
    const trio = ['Monk', 'Enchanter', 'Bard']
    expect(seen("Tunare's Scouts", 'Iksar', 'Cazic Thule', trio)).toEqual([-950, 'Scowling'])
    expect(seen("Tunare's Scouts", 'Iksar', 'Agnostic', trio)).toEqual([-750, 'Threatening'])
    expect(seen("Tunare's Scouts", 'Wood Elf', 'Cazic Thule', trio)).toEqual([-100, 'Apprehensive'])
    expect(seen("Tunare's Scouts", 'Wood Elf', 'Agnostic', trio)).toEqual([100, 'Amiably'])
  })

  it('counts the best of the three classes, whichever it is', () => {
    // The bards' Song Weavers at 0, as Sylia Windlehands conned it: Indifferent beside a Shadow Knight
    // (-300) and a Shaman, Amiable once a Bard (+50) was one of the three; Monk, the main class, has none.
    expect(seen('Song Weavers', 'Wood Elf', 'Agnostic', ['Monk', 'Shadow Knight', 'Shaman'])).toEqual([50, 'Indifferent'])
    expect(seen('Song Weavers', 'Wood Elf', 'Agnostic', ['Monk', 'Enchanter', 'Bard'])).toEqual([100, 'Amiably'])
    // Neriak's Dreadguard Inner at 2000, as Divn L`Crit conned it: an Ally, where the Monk's -300 alone would be Warmly.
    expect(con('Dreadguard Inner', 'Wood Elf', 'Agnostic', ['Monk', 'Bard', 'Enchanter'])).toEqual({ value: 1125, race: -875, cls: 0, clsIndex: 1, deity: 0 })
    expect(seen('Dreadguard Inner', 'Wood Elf', 'Agnostic', ['Monk'])).toEqual([825, 'Warmly'])
  })

  it('cons Guardians of the Vale at 2000 as Deputy Vastin did before the race change and after', () => {
    // A Shadow Knight's -300 does not count beside a Monk's 0.
    expect(con('Guardians of the Vale', 'Iksar', 'Cazic Thule', ['Shadow Knight', 'Monk', 'Shaman'])).toEqual({ value: 700, race: -1000, cls: 0, clsIndex: 1, deity: -300 })
    expect(standingBand(700).word).toBe('Kindly')
    expect(con('Guardians of the Vale', 'Wood Elf', 'Agnostic', ['Monk', 'Enchanter', 'Bard'])?.value).toBe(2000)
  })

  it('gives a tie to the first class, the main one', () => {
    expect(con('Guardians of the Vale', 'Wood Elf', 'Agnostic', ['Monk', 'Bard'])?.clsIndex).toBe(0)
  })

  it('takes the class the factions export is named for when the record has none, and none without either', () => {
    expect(conBasis('Iksar', [], 'Kelwyn_neriak-SHD-Factions.txt', 'Agnostic')).toEqual({
      basis: { race: 'Iksar', classes: ['Shadow Knight'], deity: 'Agnostic' },
      keys: { race: 178, classes: [5], deity: null }
    })
    const none = conBasis('Iksar', [], null, 'Agnostic')!
    expect(none.keys.classes).toEqual([])
    expect(withCons(VIEW, MODS, none).factions[1].standing?.con).toEqual({ value: 1000, race: -1000, cls: 0, clsIndex: -1, deity: 0 })
  })

  it('counts no deity set as Agnostic, which has no modifiers', () => {
    expect(conBasis('Wood Elf', ['Monk'], EXPORT, undefined)).toEqual({ basis: { race: 'Wood Elf', classes: ['Monk'], deity: '' }, keys: { race: 54, classes: [7], deity: null } })
    expect(con("Tunare's Scouts", 'Wood Elf', '')?.value).toBe(100)
  })

  it('knows the Legends races classic EQ did not have', () => {
    expect(conBasis('Kerran', [], EXPORT, 'Agnostic')?.keys.race).toBe(180)
    expect(conBasis('Froglok', [], EXPORT, 'Agnostic')?.keys.race).toBe(661)
    expect(conBasis('Drakkin', [], EXPORT, 'Agnostic')?.keys.race).toBe(1106)
  })

  it('works out no con without a race it knows', () => {
    expect(conBasis('', ['Monk'], EXPORT, 'Agnostic')).toBeNull()
    expect(conBasis('Elemental', ['Monk'], EXPORT, 'Agnostic')).toBeNull()
  })

  it('keeps a faction the export does not list as it is, and says whose modifiers it added', () => {
    const view = withCons(VIEW, MODS, conBasis('Wood Elf', ['Monk', 'Enchanter', 'Bard'], EXPORT, 'Agnostic')!)
    expect(view.factions[4]).toEqual(VIEW.factions[4])
    expect(view.conBasis).toEqual({ race: 'Wood Elf', classes: ['Monk', 'Enchanter', 'Bard'], deity: 'Agnostic' })
  })
})
