import { describe, expect, it } from 'vitest'
import { IllusionWatch, classLevelsFromWho, describeClasses, recordFromWho, type SelfWho } from '../../src/core/selfWho'
import { parseWho } from '../../src/core/buffs'
import type { CharacterSettings } from '../../src/shared/types'

// Your own /who keeps the character record current. /who lists the classes in class-number order and
// one level, the lowest of the three (as the player's own /who lines show).

const rec = (classLevels: CharacterSettings['classLevels'], race = 'Iksar'): CharacterSettings => ({ level: 50, classLevels, race, focusSources: [] })

/** What the engine passes on for a /who line. */
function seen(line: string): SelfWho {
  const p = parseWho(line, 0)
  if (!p) throw new Error(`not a /who line: ${line}`)
  return { race: p.race, classes: p.classes, level: p.level }
}

describe('Classes from your own /who', () => {
  it("follows a class change, keeping the player's order for the classes that stay", () => {
    const out = classLevelsFromWho({ 'Shadow Knight': 50, Monk: 50, Shaman: 50 }, ['mnk', 'brd', 'enc'], 50)
    expect(out).toEqual({ Monk: 50, Bard: 50, Enchanter: 50 })
    expect(Object.keys(out)).toEqual(['Monk', 'Bard', 'Enchanter'])
  })

  it('puts every class at the cap when /who shows the cap', () => {
    expect(classLevelsFromWho({ Monk: 50, Bard: 42 }, ['mnk', 'brd', 'enc'], 50)).toEqual({ Monk: 50, Bard: 50, Enchanter: 50 })
  })

  it('below the cap, takes the level shown as the least any class can be', () => {
    expect(classLevelsFromWho({ Monk: 50, Bard: 42, Enchanter: 38 }, ['mnk', 'brd', 'enc'], 40)).toEqual({ Monk: 50, Bard: 42, Enchanter: 40 })
  })

  it('brings a new class in at the level shown', () => {
    expect(classLevelsFromWho({ Monk: 50, Bard: 45, Shaman: 44 }, ['mnk', 'brd', 'enc'], 44)).toEqual({ Monk: 50, Bard: 45, Enchanter: 44 })
  })

  it('brings the lowest class down to the level shown when every class on record is above it', () => {
    expect(classLevelsFromWho({ Monk: 50, Bard: 45, Enchanter: 44 }, ['mnk', 'brd', 'enc'], 40)).toEqual({ Monk: 50, Bard: 45, Enchanter: 40 })
    // With a tie, the later class: the first is the player's main one.
    expect(classLevelsFromWho({ Monk: 45, Bard: 45, Enchanter: 45 }, ['mnk', 'brd', 'enc'], 40)).toEqual({ Monk: 45, Bard: 45, Enchanter: 40 })
  })

  it('fills a record with no classes yet', () => {
    expect(classLevelsFromWho({}, ['dru', 'enc', 'ber'], 17)).toEqual({ Druid: 17, Enchanter: 17, Berserker: 17 })
  })
})

describe('The record after your own /who', () => {
  it('takes a race and class change together, keeping everything else', () => {
    const before = rec({ 'Shadow Knight': 50, Monk: 50, Shaman: 50 })
    const after = recordFromWho(before, seen('[50 MNK/BRD/ENC] Kelwyn (Wood Elf) <Test Guild> ZONE: Misty Thicket 14 (misty)'))
    expect(after).toEqual({ level: 50, classLevels: { Monk: 50, Bard: 50, Enchanter: 50 }, race: 'Wood Elf', focusSources: [] })
  })

  it("changes nothing when only /who's order differs from the player's", () => {
    expect(recordFromWho(rec({ Monk: 50, 'Shadow Knight': 50, Shaman: 50 }), seen('[50 SHD/MNK/SHM] Kelwyn (Iksar)'))).toBeNull()
  })

  it('changes nothing when /who agrees with the record', () => {
    expect(recordFromWho(rec({ Monk: 50, Bard: 42, Enchanter: 40 }, 'Wood Elf'), seen('[40 MNK/BRD/ENC] Kelwyn (Wood Elf)'))).toBeNull()
  })

  it("keeps the race through an illusion's form while still following the classes", () => {
    expect(recordFromWho(rec({ Wizard: 50 }, 'Gnome'), seen('[50 WIZ/MAG/ENC] Kelwyn (Elemental)'))).toEqual(rec({ Wizard: 50, Magician: 50, Enchanter: 50 }, 'Gnome'))
  })

  it('keeps the race when /who shows the playable race of the illusion on you', () => {
    const disguised = { ...rec({ Ranger: 50, Monk: 50, Wizard: 50 }, 'Ogre'), illusion: { race: 'Dark Elf', at: 1 } }
    expect(recordFromWho(disguised, seen('[50 RNG/MNK/WIZ] Kelwyn (Dark Elf) <Test Guild> ZONE: The Lavastorm Mountains (lavastorm)'))).toBeNull()
    // Another race than the illusion's is a real change (a reincarnation into it, say).
    expect(recordFromWho(disguised, seen('[50 RNG/MNK/WIZ] Kelwyn (Gnome)'))?.race).toBe('Gnome')
    // With the illusion gone, the race /who shows is taken.
    expect(recordFromWho({ ...disguised, illusion: { race: '', at: 2 } }, seen('[50 RNG/MNK/WIZ] Kelwyn (Dark Elf)'))?.race).toBe('Dark Elf')
  })

  it('fills a new record from the first /who', () => {
    expect(recordFromWho(rec({}, ''), seen('[17 DRU/ENC/BER] Kelwyn (Kerran)  ZONE: The Northern Plains of Karana (northkarana)'))).toEqual(
      rec({ Druid: 17, Enchanter: 17, Berserker: 17 }, 'Kerran')
    )
  })
})

describe('Illusions from the log', () => {
  const read = (lines: [number, string][]) => {
    const w = new IllusionWatch()
    return lines.map(([at, text]) => w.line(text, at)).filter((x) => x)
  }

  it('put on the race of the illusion cast, once it lands on you', () => {
    // The player's own lines, 2026-11-20.
    expect(
      read([
        [0, 'You begin casting Illusion: Dark Elf.'],
        [2000, 'A gloomstalker mermaid begins casting Spirit of Wolf.'],
        [5000, 'You feel different.']
      ])
    ).toEqual([{ race: 'Dark Elf', at: 5000 }])
    // Cast by someone else, on you.
    expect(
      read([
        [0, 'Noamuth begins casting Illusion: Dark Elf.'],
        [6000, 'You feel different.']
      ])
    ).toEqual([{ race: 'Dark Elf', at: 6000 }])
  })

  it('know no race for a landing without a cast, or one long after it, or a form that is not a race', () => {
    expect(read([[0, 'You feel different.']])).toEqual([{ race: '', at: 0 }])
    expect(
      read([
        [0, 'You begin casting Illusion: Dark Elf.'],
        [3, 'Your Illusion: Dark Elf spell is interrupted.'],
        [60_000, 'You feel different.']
      ])
    ).toEqual([{ race: '', at: 60_000 }])
    expect(
      read([
        [0, 'You begin casting Illusion: Skeleton.'],
        [5000, 'You feel different.']
      ])
    ).toEqual([{ race: '', at: 5000 }])
  })

  it('come off when one fades or you die', () => {
    expect(read([[0, 'Your illusion fades.']])).toEqual([{ race: '', at: 0 }])
    expect(read([[0, 'You died.']])).toEqual([{ race: '', at: 0 }])
    expect(read([[0, 'You have been slain by a lava elemental!']])).toEqual([{ race: '', at: 0 }])
  })
})

describe('Classes described for the log', () => {
  it('names each class with its level, in order', () => {
    expect(describeClasses({ Monk: 50, Bard: 50, Enchanter: 50 })).toBe('Monk 50/Bard 50/Enchanter 50')
    expect(describeClasses({})).toBe('none')
  })
})
