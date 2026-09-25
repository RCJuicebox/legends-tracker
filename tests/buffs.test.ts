import { describe, expect, it } from 'vitest'
import { askText, BuffWatch, buffNeeds, defaultWanted, parseWho, type ActiveBuff, type BuffOffer, type Person } from '../src/core/buffs'
import type { Spell, SpellBook } from '../src/core/spells'

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
  id: 0, name, castMs: 3000, recastMs: 0, formula: 3, cap: 600, beneficial: true, classLevels: Array(16).fill(255), targetType: 5, skill: 5, icon: 0,
  effects: [], category: 'buff', landSelf: '', landOther: '', fade: '', ...over
})
const temperance = spell('Temperance', { landSelf: 'You feel the power of temperance.', fade: 'Your temperance fades.' })
const aegis = spell('Holy Aegis', { landSelf: 'You feel the power of temperance.', fade: 'Your temperance fades.' })
const clarity = spell('Clarity', { landSelf: 'A soft breeze passes over you.', fade: 'The breeze fades.' })
const book = { all: () => [temperance, aegis, clarity].values() } as unknown as SpellBook
const offer = (name: string, line: BuffOffer['line'], classes: Record<string, number>): BuffOffer => ({ spell: name, line, effects: [], classes, seconds: 3600, group: false, category: 'buff' })
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
  const enc: Person = { name: 'Corvin', classes: ['enc'], level: 20, race: 'Gnome', at: 0 }

  it('asks the groupmate who can cast the best wanted buff of each line not covered', () => {
    const needs = buffNeeds({ offers: OFFERS, wanted: ['Temperance', 'Holy Aegis', 'Clarity'], group: [cleric, enc], active: [] })
    // Corvin is level 20, too low for Clarity (26); nobody here is a paladin.
    expect(needs).toEqual([{ line: 'hpac', spell: 'Temperance', from: 'Brenna' }])
    expect(askText(needs)).toBe('Ask Brenna for Temperance')
  })

  it('counts a line as covered by any buff of it', () => {
    const active: ActiveBuff[] = [{ spell: 'Holy Aegis', ranked: 'Holy Aegis', line: 'hpac', caster: 'Aldric', landedAt: 0, endsAt: null }]
    expect(buffNeeds({ offers: OFFERS, wanted: ['Temperance'], group: [cleric], active })).toEqual([])
  })

  it('asks for nothing that is not wanted', () => {
    expect(buffNeeds({ offers: OFFERS, wanted: [], group: [cleric], active: [] })).toEqual([])
  })

  it('reads well with several people', () => {
    expect(
      askText([
        { line: 'hpac', spell: 'Temperance', from: 'Brenna' },
        { line: 'spellHaste', spell: 'Blessing of Faith', from: 'Brenna' },
        { line: 'manaRegen', spell: 'Clarity', from: 'Corvin' }
      ])
    ).toBe('Ask Brenna for Temperance and Blessing of Faith; ask Corvin for Clarity')
  })

  it('wants each class’s best of the main lines out of the box', () => {
    const offers = [offer('Courage', 'hpac', { clr: 1 }), offer('Temperance', 'hpac', { clr: 40 }), offer('Charisma', 'stats', { shm: 30 }), offer('Clarity', 'manaRegen', { enc: 26 })]
    expect(defaultWanted(offers)).toEqual(['Clarity', 'Temperance'])
  })
})
