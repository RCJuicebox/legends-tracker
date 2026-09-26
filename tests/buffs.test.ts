import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { askText, BuffWatch, buffNeeds, buffOffers, buffPlan, defaultWanted, parseWho, PROC_VALUE, type ActiveBuff, type BuffOffer, type Person } from '../src/core/buffs'
import { SpellBook, type Spell } from '../src/core/spells'
import { effectValue } from '../src/core/effectValue'
import { DEFAULT_TIER_DURATION_PCT } from '../src/shared/types'

// /who lines are the game's own shape (names swapped); the spells are made up, with the fields the
// watcher reads.

describe('who is who', () => {
  it('reads /who lines, three classes and all', () => {
    expect(parseWho('[50 SHD/BRD/WIZ] Aldric (Erudite) <Test Guild> ZONE: The Plane of Hate 10025 (hateplane)  ', 7)).toEqual({
      name: 'Aldric', classes: ['shd', 'brd', 'wiz'], level: 50, race: 'Erudite', at: 7
    })
    expect(parseWho('[24 WAR/BRD/WIZ] Corvin (Dark Elf) <Other Guild> ZONE: The Estate of Unrest (unrest)', 0)?.classes).toEqual(['war', 'brd', 'wiz'])
    expect(parseWho('[50 CLR] Brenna (Human)', 0)?.classes).toEqual(['clr'])
    expect(parseWho('[ANONYMOUS] Brenna', 0)).toBeNull()
    expect(parseWho('Players in EverQuest Legends:', 0)).toBeNull()
  })
})

const spell = (name: string, over: Partial<Spell>): Spell => ({
  id: 0, name, castMs: 3000, recastMs: 0, mana: 100, formula: 3, cap: 600, beneficial: true, classLevels: Array(16).fill(255), targetType: 5, skill: 5, icon: 0,
  effects: [], category: 'buff', landSelf: '', landOther: '', fade: '', ...over
})
const temperance = spell('Temperance', { landSelf: 'You feel the power of temperance.', fade: 'Your temperance fades.' })
const aegis = spell('Holy Aegis', { landSelf: 'You feel the power of temperance.', fade: 'Your temperance fades.' })
const clarity = spell('Clarity', { landSelf: 'A soft breeze passes over you.', fade: 'The breeze fades.' })
const book = { all: () => [temperance, aegis, clarity].values() } as unknown as SpellBook
/** An offer with its effects slot by slot: [slot, spa, value] (stacking commands: [slot, 148/149, spa, slot, below]). */
const offer = (name: string, line: BuffOffer['line'], classes: Record<string, number>, value = 100, stack: number[][] = [[1, 100 + name.length, 1]]): BuffOffer => ({
  spell: name, line, effects: [], classes, seconds: 3600, group: false, self: false, category: 'buff', value,
  stack: stack.map(([slot, spa, base, base2 = 0, max = 0]) => ({ slot, spa, base, base2, formula: 100, max }))
})
const OFFERS = [offer('Temperance', 'hpac', { clr: 40 }), offer('Holy Aegis', 'hpac', { pal: 45 }), offer('Clarity', 'manaRegen', { enc: 26 })]

function watch(active: ActiveBuff[] = []) {
  const events: string[] = []
  const w = new BuffWatch(active, {
    seconds: () => 3600,
    onChange: () => {},
    onLand: (b) => events.push(`land ${b.spell} from ${b.caster || '?'}`),
    onFade: (b, why) => events.push(`${why} ${b.spell}`)
  })
  w.setBook(book, OFFERS)
  const resolve = (n: string) => {
    const s = [temperance, aegis, clarity].find((x) => x.name === n)
    return s ? { spell: s, rank: 0 } : undefined
  }
  return { w, events, feed: (text: string, at: number) => w.handle(text, at, resolve) }
}

describe('buffs on you', () => {
  it('ties a landing to the cast before it, when two spells share its text', () => {
    const { w, events, feed } = watch()
    feed('Aldric begins casting Holy Aegis.', 1000)
    feed('You feel the power of temperance.', 4500)
    expect(events).toEqual(['land Holy Aegis from Aldric'])
    expect(w.active[0]).toMatchObject({ spell: 'Holy Aegis', caster: 'Aldric', line: 'hpac', landedAt: 4500, endsAt: 4500 + 3600_000 })
  })

  it('knows a spell by its text alone when only one has it, and ends it on its fade', () => {
    const { w, events, feed } = watch()
    feed('A soft breeze passes over you.', 1000)
    expect(w.active.map((b) => [b.spell, b.caster])).toEqual([['Clarity', '']])
    feed('The breeze fades.', 9000)
    expect(w.active).toEqual([])
    expect(events).toEqual(['land Clarity from ?', 'faded Clarity'])
  })

  it('takes nothing on a shared text with no cast to go by, and ignores stale casts', () => {
    const { w, feed } = watch()
    feed('Aldric begins casting Temperance.', 1000)
    feed('You feel the power of temperance.', 60_000)
    expect(w.active).toEqual([])
  })

  it('loses everything on death', () => {
    const { w, events, feed } = watch()
    feed('A soft breeze passes over you.', 1000)
    feed('You have been slain by a fetid fiend!', 2000)
    expect(w.active).toEqual([])
    expect(events).toContain('died Clarity')
  })
})

describe('what to ask for', () => {
  const cleric: Person = { name: 'Brenna', classes: ['clr', 'mnk', 'war'], level: 50, race: 'Human', at: 0 }
  const paladin: Person = { name: 'Aldric', classes: ['pal', 'war', 'rog'], level: 50, race: 'Human', at: 0 }
  const shaman: Person = { name: 'Dorran', classes: ['shm', 'war', 'rog'], level: 50, race: 'Troll', at: 0 }
  const enc: Person = { name: 'Corvin', classes: ['enc'], level: 20, race: 'Gnome', at: 0 }
  const on = (spell: string, line: BuffOffer['line'] = 'hpac'): ActiveBuff => ({ spell, ranked: spell, line, caster: 'someone', landedAt: 0, endsAt: null })

  // The slot layouts of the spell file (spa 69 HP, 1 AC, 4 STR, 5 DEX, 6 AGI, 7 STA; 148 blocks, and 149 overwrites, slot-3 HP below 2800).
  const temperance = offer('Temperance', 'hpac', { clr: 40 }, 1120, [[1, 148, 69, 3, 2800], [2, 69, 800], [4, 1, 160], [5, 149, 69, 3, 2800]])
  const blessing = { ...offer('Blessing of Temperance', 'hpac', { clr: 45 }, 1120, [[1, 148, 69, 3, 2800], [2, 69, 800], [4, 1, 160], [5, 149, 69, 3, 2800]]), group: true }
  const symbol = offer('Symbol of Pinzarn', 'hpac', { pal: 46, clr: 31 }, 307, [[3, 69, 307]])
  const HP = [temperance, blessing, symbol]

  it('asks the cleric when a cleric and a paladin are both in the group', () => {
    expect(buffNeeds({ offers: HP, wanted: ['Temperance', 'Symbol of Pinzarn'], group: [paladin, cleric], active: [] })).toEqual([
      { line: 'hpac', spell: 'Temperance', from: 'Brenna', replaces: '', after: [], clickOff: [] }
    ])
  })

  it('asks the paladin for the symbol when the paladin is the only one who can', () => {
    expect(buffNeeds({ offers: HP, wanted: ['Temperance', 'Symbol of Pinzarn'], group: [paladin], active: [] })).toEqual([
      { line: 'hpac', spell: 'Symbol of Pinzarn', from: 'Aldric', replaces: '', after: [], clickOff: [] }
    ])
  })

  it('asks for the better buff over one on you it blocks, and nothing once the best there is is on', () => {
    expect(buffNeeds({ offers: HP, wanted: ['Temperance', 'Symbol of Pinzarn'], group: [paladin, cleric], active: [on('Symbol of Pinzarn')] })).toEqual([
      { line: 'hpac', spell: 'Temperance', from: 'Brenna', replaces: 'Symbol of Pinzarn', after: [], clickOff: [] }
    ])
    expect(buffNeeds({ offers: HP, wanted: ['Temperance', 'Symbol of Pinzarn'], group: [paladin, cleric], active: [on('Temperance')] })).toEqual([])
    expect(buffNeeds({ offers: HP, wanted: ['Temperance', 'Symbol of Pinzarn'], group: [paladin], active: [on('Symbol of Pinzarn')] })).toEqual([])
  })

  it('never asks for a buff’s twin over it: Temperance on, Blessing of Temperance wanted', () => {
    expect(buffNeeds({ offers: HP, wanted: ['Blessing of Temperance'], group: [cleric], active: [on('Temperance')] })).toEqual([])
  })

  it('picks the combination that stacks for the most over the single biggest buff', () => {
    // Harnessing: HP and STR/DEX in slots 1, 4, 5; it overwrites slot-1 STR below 67 and DEX below 50, and blocks them below 1067/1050.
    const harnessing = offer('Harnessing of Spirit', 'hpac', { shm: 46 }, 368, [[1, 69, 251], [4, 4, 67], [5, 5, 50], [6, 149, 4, 1, 67], [7, 149, 5, 1, 50], [8, 148, 4, 1, 1067], [9, 148, 5, 1, 1050]])
    const infusion = offer('Infusion of Spirit', 'stats', { shm: 49 }, 173, [[4, 4, 50], [5, 5, 55], [6, 7, 45]])
    const strength = offer('Strength', 'stats', { shm: 44 }, 67, [[1, 4, 67]])
    const dexterity = offer('Dexterity', 'stats', { shm: 48 }, 50, [[1, 5, 50]])
    const stamina = offer('Stamina', 'stats', { shm: 44 }, 60, [[1, 7, 40]])
    const agility = offer('Agility', 'stats', { shm: 41 }, 45, [[1, 6, 45]])
    const altuna = offer('Talisman of Altuna', 'hpac', { shm: 40 }, 250, [[1, 69, 250]])
    const offers = [harnessing, infusion, strength, dexterity, stamina, agility, altuna]
    const plan = buffPlan({ offers, wanted: offers.map((o) => o.spell), group: [shaman], active: [] })
    expect(plan.chosen.map((c) => c.spell).sort()).toEqual(['Agility', 'Dexterity', 'Infusion of Spirit', 'Stamina', 'Strength', 'Talisman of Altuna'])
    // Strength and Dexterity are no bar: Harnessing lands over a level-50 Strength (67 is not below 67).
    expect(plan.leftOut).toEqual([{ spell: 'Harnessing of Spirit', line: 'hpac', value: 368, reason: 'stack', blockedBy: ['Talisman of Altuna', 'Infusion of Spirit'] }])
    // With Harnessing on you, the combination is still the better one, but none of it lands over Harnessing
    // (Infusion's slot-4 STR is the weaker; the log shows it blocked): it must be clicked off first.
    const needs = buffNeeds({ offers, wanted: offers.map((o) => o.spell), group: [shaman], active: [on('Harnessing of Spirit')] })
    expect(needs.find((n) => n.spell === 'Infusion of Spirit')).toMatchObject({ replaces: '', clickOff: ['Harnessing of Spirit'] })
    expect(needs.find((n) => n.spell === 'Strength')).toMatchObject({ replaces: '', clickOff: ['Harnessing of Spirit'] })
    expect(needs.find((n) => n.spell === 'Talisman of Altuna')).toMatchObject({ replaces: '', clickOff: ['Harnessing of Spirit'] })
  })

  it('says the order when it matters: Harnessing of Spirit after Strength', () => {
    const harnessing = offer('Harnessing of Spirit', 'hpac', { shm: 46 }, 368, [[1, 69, 251], [4, 4, 67], [5, 5, 50], [6, 149, 4, 1, 67], [8, 148, 4, 1, 1067]])
    const strength = offer('Strength', 'stats', { shm: 44 }, 67, [[1, 4, 67]])
    const plan = buffPlan({ offers: [harnessing, strength], wanted: ['Harnessing of Spirit', 'Strength'], group: [shaman], active: [] })
    expect(plan.chosen.map((c) => [c.spell, c.after])).toEqual([
      ['Harnessing of Spirit', ['Strength']],
      ['Strength', []]
    ])
    expect(askText(plan.needs)).toBe('Ask Dorran for Harnessing of Spirit (after Strength) and Strength')
    // Strength on already: only Harnessing to ask for. Harnessing on: Strength cannot go on.
    expect(buffNeeds({ offers: [harnessing, strength], wanted: ['Harnessing of Spirit', 'Strength'], group: [shaman], active: [on('Strength', 'stats')] }).map((n) => n.spell)).toEqual(['Harnessing of Spirit'])
    const blocked = buffPlan({ offers: [harnessing, strength], wanted: ['Harnessing of Spirit', 'Strength'], group: [shaman], active: [on('Harnessing of Spirit')] })
    expect(blocked.needs).toEqual([])
    expect(blocked.leftOut).toEqual([{ spell: 'Strength', line: 'stats', value: 67, reason: 'stack', blockedBy: ['Harnessing of Spirit'] }])
    // A level-46 shaman's Strength is weaker than the threshold, so Harnessing simply replaces it: the two are not both worth having.
    const low: Person = { ...shaman, level: 46 }
    const weak = { ...strength, stack: [{ slot: 1, spa: 4, base: 42, base2: 0, formula: 101, max: 67 }] }
    expect(buffPlan({ offers: [harnessing, weak], wanted: ['Harnessing of Spirit', 'Strength'], group: [low], active: [] }).chosen.map((c) => c.spell)).toEqual(['Harnessing of Spirit'])
  })

  it('leaves out what nobody here can cast or is too small to ask for', () => {
    const clarity = offer('Clarity', 'manaRegen', { enc: 26 }, 270)
    const tiny = offer('Rising Dexterity', 'stats', { shm: 25 }, 5)
    const plan = buffPlan({ offers: [clarity, tiny], wanted: ['Clarity', 'Rising Dexterity'], group: [enc, shaman], active: [] })
    // Corvin is level 20, too low for Clarity (26).
    expect(plan.chosen).toEqual([])
    expect(plan.leftOut.map((l) => [l.spell, l.reason])).toEqual([
      ['Clarity', 'nobody'],
      ['Rising Dexterity', 'small']
    ])
  })

  it('plans with anyone, naming the class and level to look for', () => {
    const plan = buffPlan({ offers: HP, wanted: ['Symbol of Pinzarn'], group: 'anyone', active: [] })
    expect(plan.chosen).toEqual([{ spell: 'Symbol of Pinzarn', line: 'hpac', value: 307, from: 'CLR 31', on: false, after: [] }])
  })

  it('counts your own self-only buffs as yours to cast, once /who has said what you are', () => {
    const yaulp = { ...offer('Yaulp IV', 'attack', { clr: 44 }, 90, [[1, 2, 40], [2, 4, 30]]), self: true }
    const me: Person = { name: 'Kelwyn', classes: ['clr', 'mnk', 'shm'], level: 50, race: 'Iksar', at: 0 }
    const stranger: Person = { ...me, classes: ['mnk', 'shm', 'nec'] }
    // A groupmate cleric cannot cast it on you; you can.
    expect(buffPlan({ offers: [yaulp], wanted: ['Yaulp IV'], group: [cleric], active: [] }).leftOut.map((l) => l.reason)).toEqual(['nobody'])
    const plan = buffPlan({ offers: [yaulp], wanted: ['Yaulp IV'], group: [cleric], active: [], me })
    expect(plan.chosen).toEqual([{ spell: 'Yaulp IV', line: 'attack', value: 90, from: 'you', on: false, after: [] }])
    expect(askText(plan.needs)).toBe('Cast Yaulp IV')
    expect(buffPlan({ offers: [yaulp], wanted: ['Yaulp IV'], group: 'anyone', active: [], me: stranger }).leftOut.map((l) => l.reason)).toEqual(['nobody'])
    // Nothing to do once it is on you.
    expect(buffNeeds({ offers: [yaulp], wanted: ['Yaulp IV'], group: [cleric], active: [{ ...on('Yaulp IV', 'attack'), caster: 'You' }], me })).toEqual([])
  })

  it('has you cast what you can, group or no group, and asks the group for the rest', () => {
    const me: Person = { name: 'Kelwyn', classes: ['shm', 'mnk', 'brd'], level: 50, race: 'Iksar', at: 0 }
    const altuna = offer('Talisman of Altuna', 'hpac', { shm: 40 }, 250, [[1, 69, 250]])
    const offers = [...HP, altuna]
    const alone = buffPlan({ offers, wanted: ['Temperance', 'Talisman of Altuna'], group: [], active: [], me })
    expect(alone.chosen.map((c) => [c.spell, c.from])).toEqual([['Talisman of Altuna', 'you']])
    expect(alone.leftOut.map((l) => [l.spell, l.reason])).toEqual([['Temperance', 'nobody']])
    const grouped = buffPlan({ offers, wanted: ['Temperance', 'Talisman of Altuna'], group: [cleric], active: [], me })
    expect(askText(grouped.needs)).toBe('Cast Talisman of Altuna; ask Brenna for Temperance')
  })

  it('reads well with several people', () => {
    expect(
      askText([
        { line: 'hpac', spell: 'Temperance', from: 'Brenna', replaces: '', after: [], clickOff: [] },
        { line: 'spellHaste', spell: 'Blessing of Faith', from: 'Brenna', replaces: '', after: [], clickOff: [] },
        { line: 'manaRegen', spell: 'Clarity', from: 'Corvin', replaces: '', after: [], clickOff: ['Breeze'] }
      ])
    ).toBe('Ask Brenna for Temperance and Blessing of Faith; ask Corvin for Clarity (once Breeze is clicked off)')
    expect(
      askText([
        { line: 'hpac', spell: 'Temperance', from: 'Brenna', replaces: '', after: [], clickOff: [] },
        { line: 'attack', spell: 'Yaulp IV', from: 'you', replaces: '', after: [], clickOff: [] }
      ])
    ).toBe('Cast Yaulp IV; ask Brenna for Temperance')
  })

  it('wants every buff of the main lines worth something out of the box, worth most first', () => {
    const offers = [offer('Courage', 'hpac', { clr: 1 }, 30), offer('Temperance', 'hpac', { clr: 40 }, 1120), offer('Charisma', 'stats', { shm: 30 }, 0), offer('Clarity', 'manaRegen', { enc: 26 }, 270)]
    expect(defaultWanted(offers)).toEqual(['Temperance', 'Clarity', 'Courage'])
  })
})

describe('effect values', () => {
  it('follow the spell file’s level formulas and caps', () => {
    // From spells_us.txt: slot|spa|base|base2|formula|max.
    expect(effectValue({ base: 150, formula: 103, max: 250 }, 50)).toBe(250) // Protection of Nature, HP
    expect(effectValue({ base: 150, formula: 103, max: 250 }, 20)).toBe(190)
    expect(effectValue({ base: 5, formula: 102, max: 55 }, 50)).toBe(55) // Protection of Nature, AC
    expect(effectValue({ base: 224, formula: 117, max: 307 }, 50)).toBe(307) // Symbol of Pinzarn
    expect(effectValue({ base: 1, formula: 109, max: 9 }, 50)).toBe(9) // Clarity
    expect(effectValue({ base: 1, formula: 119, max: 9 }, 50)).toBe(7) // Boon of the Clear Mind
    expect(effectValue({ base: 160, formula: 100, max: 160 }, 50)).toBe(160) // Swift Like the Wind
    expect(effectValue({ base: -20, formula: 102, max: 0 }, 10)).toBe(-30)
  })
})

describe('offers from the spell file', () => {
  const book = SpellBook.parse(readFileSync(join(__dirname, 'fixtures', 'stacking_spells_us.txt'), 'latin1'), readFileSync(join(__dirname, 'fixtures', 'stacking_spells_us_str.txt'), 'latin1'))
  const offers = buffOffers(book, DEFAULT_TIER_DURATION_PCT)
  const named = (n: string) => offers.find((o) => o.spell === n)

  it('offers permanent procs and utility buffs, but nothing timed of the kind and no vision', () => {
    // Vampiric Embrace: a permanent self-only weapon proc (a combat innate).
    expect(named('Vampiric Embrace')).toMatchObject({ line: 'proc', self: true, seconds: Infinity, value: PROC_VALUE, effects: [{ line: 'proc', label: 'proc', value: 'Vampiric Embrace' }] })
    expect(named('Divine Might')?.effects[0].value).toBe('Divine Might Strike')
    expect(named('Breath of the Dead')).toMatchObject({ line: 'other', effects: [{ label: 'enduring breath' }] })
    // Deadeye is see-invisible and infravision only; Levitate is timed.
    expect(named('Deadeye')).toBeUndefined()
    expect(named('Levitate')).toBeUndefined()
    // Every offer is castable at 50 by some class and is on a line.
    for (const o of offers) expect(Object.values(o.classes).every((l) => l <= 50)).toBe(true)
  })

  it('keeps Rune I to IV apart, and reads wards and heal-per-hit', () => {
    expect(offers.filter((o) => /^Rune /.test(o.spell)).map((o) => [o.spell, o.classes.enc])).toEqual([['Rune I', 13], ['Rune II', 22], ['Rune III', 33], ['Rune IV', 40]])
    expect(named('Guard of Vie')).toMatchObject({ line: 'rune', value: 350, effects: [{ label: 'melee ward', value: '700 (10%)' }] })
    expect(named('Blessing of the Knight')).toMatchObject({ line: 'hpRegen', effects: [{ label: 'heal per hit', value: '+4' }] })
  })
})
