import { describe, expect, it } from 'vitest'
import { parseLogLine } from '../../../src/core/logLine'
import { lastLooted, loggedCounts } from '../../../src/core/itemTally'
import {
  emptyEpicCharacter,
  emptyEpicTally,
  EPIC_CLASSES,
  EPIC_KEYS,
  everyStep,
  exportCounts,
  isEpicItem,
  isTick,
  joinEpicTallies,
  readEpicLine,
  sanitizeEpicCharacter,
  stepName,
  tickKey,
  type EpicStep,
  type EpicTally
} from '../../../src/features/epics/core'

// Goals › Epics: the checklist as the wiki lists it, the pieces counted from the log, and what the
// player keeps read back. The loot lines are real ones' wording; the hand-in is the wording every NPC trade has.

const cls = (name: string) => EPIC_CLASSES.find((c) => c.cls === name)!
const step = (steps: readonly EpicStep[], name: string): EpicStep => everyStep(steps).find((s) => stepName(s) === name)!

function read(lines: string[], into: EpicTally = emptyEpicTally()): EpicTally {
  for (const raw of lines) {
    const line = parseLogLine(raw)
    if (line) readEpicLine(line, into)
  }
  return into
}

const at = (hms: string, text: string) => `[Tue Sep 29 ${hms} 2026] ${text}`

describe('the checklist', () => {
  it('is every class’s, as the wiki lists it, with the finished epics named', () => {
    expect(EPIC_CLASSES.map((c) => c.cls)).toHaveLength(16)
    expect(cls('Bard').epic).toEqual(['Singing Short Sword'])
    expect(cls('Ranger').epic).toEqual(['Earthcaller', 'Swiftwind'])
    expect(cls('Beastlord')).toMatchObject({ epic: [], steps: [] })
    expect(everyStep(EPIC_CLASSES.flatMap((c) => c.steps)).filter((s) => s.item).length).toBeGreaterThanOrEqual(100)
  })

  it('keeps a quest’s pieces under its reward: the Darkforge Breastplate is made of two Decayed pieces and two bars', () => {
    const bp = step(cls('Shadow Knight').steps, 'Darkforge Breastplate')
    expect(bp.quest).toBe('Darkforge Armor Quests')
    expect(bp.parts.map((p) => [p.item, p.qty])).toEqual([
      ['Decayed Chainmail', 1],
      ['Decayed Breastplate', 1],
      ['Enchanted Platinum Bar', 2]
    ])
    expect(bp.parts[0]).toMatchObject({ how: 'Kill A Lizard Crusader or A lizard ritualist', zone: 'Temple of Cazic-Thule' })
  })

  it('has the Shadow Knight’s hand-ins the page leaves out, with the Decrepit Sheath inside the Corrupted Ghoulbane', () => {
    const cg = step(cls('Shadow Knight').steps, 'Corrupted Ghoulbane')
    expect(cg.parts.map((p) => p.item)).toEqual(['Ghoulbane', 'Soul Leech, Dark Sword of Blood', 'Blade of Abrogation', 'Decrepit Sheath'])
    const sheath = cg.parts[3]
    expect(sheath.parts.map((p) => [p.item, p.qty])).toEqual([
      ['Drake Spine', 1],
      ['Decrepit Hide', 1],
      ['Enchanted Platinum Bar', 1]
    ])
    expect(sheath.parts[0].unverified).toBe(true)
    // Moved under the hand-in, not listed twice.
    expect(cls('Shadow Knight').steps.map((s) => s.item)).not.toContain('Ghoulbane')
  })

  it('puts a craft’s quested parts under it: the Robe of the Lost Circle takes the Needle of the Void and its chain', () => {
    const robe = cls('Monk').steps.find((s) => s.item === 'Robe of the Lost Circle')!
    expect(robe.how).toBe('Craft (Tailoring no fail)')
    expect(robe.parts.map((p) => p.item)).toEqual(['Shadow Silk', "Jonthan's Whistling Warsong", 'Rare Robe Pattern', 'Needle of the Void'])
    const needle = robe.parts[3]
    expect(needle.quest).toBe('Monks of The Whistling Fist')
    const headband = needle.parts.find((p) => p.item === 'Purple Headband')!
    expect(headband.parts.find((p) => p.item === 'Gnoll Pup Scalp')?.qty).toBe(4)
    // A quest the page names no reward of is a step without an item.
    const antonica = cls('Druid').steps[0]
    expect(antonica).toMatchObject({ quest: 'Cleansed Spirit of Antonica', parts: expect.any(Array) })
    expect(antonica.item).toBeUndefined()
    expect(stepName(antonica)).toBe('Cleansed Spirit of Antonica')
  })

  it('reads where and how each piece comes, the quantity, and what the wiki marks unverified', () => {
    expect(step(cls('Bard').steps, 'White Dragon Scales')).toMatchObject({ how: 'Kill Lady Vox (raid)', zone: 'Permafrost', qty: 1 })
    expect(step(cls('Druid').steps, 'Chilled Tundra Root')).toMatchObject({ how: 'Forage', zone: 'Everfrost' })
    expect(step(cls('Paladin').steps, "Drom's Champagne")).toMatchObject({ how: 'Buy', qty: 4 })
    expect(step(cls('Shaman').steps, 'Envy')).toMatchObject({ how: 'Kill Glaron the Wicked', unverified: true })
    expect(step(cls('Shaman').steps, 'Woe')).toMatchObject({ how: 'Kill Glaron the Wicked', unverified: true })
    expect(step(cls('Wizard').steps, 'Blue Crystal Staff')).toMatchObject({ unverified: true, note: 'The wiki says it does not drop now' })
    expect(step(cls('Magician').steps, 'Torn Page of Mastery Earth')).toMatchObject({ how: 'Kill A Magician or an alligator', zone: 'Najena or Temple of Cazic-Thule' })
    expect(step(cls('Magician').steps, 'Gargoyle Eye')).toMatchObject({ how: 'Kill A Gargoyle' })
    expect(step(cls('Magician').steps, 'Gargoyle Eye').zone).toBeUndefined()
  })

  it('counts every piece and every finished epic, and names each step’s tick', () => {
    expect(EPIC_KEYS.has('innoruuks curse')).toBe(true)
    expect(isEpicItem('Ghoulbane')).toBe(true)
    expect(isEpicItem('Rusty Dagger')).toBe(false)
    const bp = step(cls('Shadow Knight').steps, 'Darkforge Breastplate')
    expect(tickKey('Shadow Knight', bp)).toBe('Shadow Knight|Darkforge Breastplate')
    expect(isTick('Shadow Knight|Darkforge Breastplate')).toBe(true)
    expect(isTick('Druid|Cleansed Spirit of Antonica')).toBe(true)
    expect(isTick('Bard|Darkforge Breastplate')).toBe(false)
  })
})

describe('the log', () => {
  it('counts what was kept, never what was sold as it dropped, nor other people’s loot or other items', () => {
    const t = read([
      at('22:01:24', "You looted a Ghoulbane from the froglok shin lord's corpse and sold it for free."),
      at('22:09:00', "--You have looted a Ghoulbane from the froglok shin lord's corpse.--"),
      at('22:09:01', "--Kelwyn has looted a Ghoulbane from the froglok shin lord's corpse.--"),
      at('22:09:02', "--You have looted 2 Gnoll Pup Scalp from a gnoll pup's corpse.--"),
      at('22:09:03', "--You have looted a Rusty Dagger from a gnoll pup's corpse.--")
    ])
    expect(loggedCounts(t)).toEqual({ ghoulbane: 1, 'gnoll pup scalp': 2 })
    expect(lastLooted(t).ghoulbane).toBe(parseLogLine(at('22:09:00', 'x'))!.time)
  })

  it('takes away what a completed trade took; a cancelled trade takes nothing', () => {
    const t = read([
      at('21:00:00', "--You have looted a Decayed Chainmail from a lizard crusader's corpse.--"),
      at('21:00:01', "--You have looted a Decayed Breastplate from a lizard crusader's corpse.--"),
      at('21:10:00', 'You offered 1 Decayed Chainmail to Mordin Frostcleaver.'),
      at('21:10:02', 'You have cancelled the trade.'),
      at('21:11:00', 'You offered 1 Decayed Chainmail to Mordin Frostcleaver.'),
      at('21:11:01', 'You offered 1 Decayed Breastplate to Mordin Frostcleaver.'),
      at('21:11:03', 'You complete the trade with Mordin Frostcleaver.')
    ])
    expect(loggedCounts(t)).toEqual({ 'decayed chainmail': 0, 'decayed breastplate': 0 })
    expect(t.trade).toBeUndefined()
  })

  it('keeps a trade open across reads, and joins stretches in order', () => {
    const first = read([at('21:00:00', "--You have looted a Ghoulbane from the froglok shin lord's corpse.--"), at('21:10:00', 'You offered 1 Ghoulbane to Zarvarg Nullheart.')])
    expect(first.trade).toEqual({ npc: 'Zarvarg Nullheart', items: { Ghoulbane: 1 } })
    read([at('21:10:05', 'You complete the trade with Zarvarg Nullheart.')], first)
    const second = read([at('22:00:00', "--You have looted a Ghoulbane from the froglok shin lord's corpse.--")])
    expect(loggedCounts(joinEpicTallies([first, second])).ghoulbane).toBe(1)
  })
})

describe('what the player keeps', () => {
  it('reads back ticks of steps there are and whole-number corrections of items there are, and nothing else', () => {
    expect(sanitizeEpicCharacter(null)).toEqual(emptyEpicCharacter())
    expect(
      sanitizeEpicCharacter({
        ticks: ['Shadow Knight|Darkforge Breastplate', 'Shadow Knight|Darkforge Breastplate', 'Bard|Nothing', 5],
        adjust: { ghoulbane: 2, 'rusty dagger': 1, 'drake spine': 0, 'decayed helm': 1.5, 'decayed visor': 99_999 }
      })
    ).toEqual({ ticks: ['Shadow Knight|Darkforge Breastplate'], adjust: { ghoulbane: 2 } })
  })

  it('counts the inventory export’s pieces from every place, a merged copy’s +N ignored', () => {
    const item = (location: string, name: string, count = 1) => ({ location, name, id: 1, count, augs: [] })
    const counts = exportCounts({
      worn: [item('Primary', "Innoruuk's Curse +3")],
      bags: [item('General 1-Slot1', 'Enchanted Platinum Bar', 2), item('General 1-Slot2', 'Rusty Dagger')],
      bank: [item('Bank1-Slot1', 'Enchanted Platinum Bar')],
      sharedBank: [item('SharedBank1-Slot1', 'Ghoulbane')],
      depot: [item('Personal-Depot1', 'Bone Chips', 20)],
      keyRing: [{ kind: 'Equipment', name: 'Darkforge Helm', id: 2 }]
    })
    expect(counts).toEqual({ 'innoruuks curse': 1, 'enchanted platinum bar': 3, ghoulbane: 1, 'bone chips': 20, 'darkforge helm': 1 })
  })
})
