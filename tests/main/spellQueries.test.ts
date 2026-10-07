import { describe, expect, it } from 'vitest'
import { SpellQueries } from '../../src/main/engine/spellQueries'
import type { EngineStore } from '../../src/main/engine/contracts'
import { defaultSettings } from '../../src/main/storeCore'
import type { BuffsFile } from '../../src/core/buffs'
import type { MoteState } from '../../src/core/motes'
import type { MoteStock, SpellRule } from '../../src/shared/types'
import { fixtureBook } from '../helpers'

function cell<T>(value: T) {
  return {
    value,
    get(): T {
      return this.value
    },
    set(v: T) {
      this.value = v
    }
  }
}

function queries(rules: Record<string, SpellRule>, casts: Record<string, { rankedName: string; lastCast: number; count: number }>) {
  const store = {
    settings: cell({ ...defaultSettings(), logFile: 'C:/nowhere/Logs/eqlog_Kelwyn_neriak.txt' }),
    triggers: cell([]),
    rules: cell(rules),
    casts: cell(casts),
    motes: cell<MoteState>({ active: null, sessions: [], daily: {} }),
    stock: cell<MoteStock>({ counts: {}, item: { name: '', lvl: 0, xp: 0, to: 1 }, autoAdd: true }),
    respawns: cell({}),
    buffs: cell<BuffsFile>({ people: {}, wanted: {}, active: {} }),
    motesFresh: false,
    characterOf: () => ({ level: 50, classLevels: {}, focusSources: [] })
  } satisfies EngineStore
  const book = fixtureBook()
  return new SpellQueries(store, () => book)
}

describe('the Spell Timers page list', () => {
  it('lists a cast spell once with its rank, and a spell only a rule names', () => {
    const rows = queries({ Plague: { track: false } }, { 'Envenomed Bolt X': { rankedName: 'Envenomed Bolt X', lastCast: 5, count: 2 } }).knownSpells()
    expect(rows.map((r) => [r.name, r.rankedName, r.rank])).toEqual([
      ['Envenomed Bolt', 'Envenomed Bolt X', 10],
      ['Plague', 'Plague', 0]
    ])
  })

  it('gives a spell one row when a rule is keyed by its ranked name', () => {
    // A rule saved as "Envenomed Bolt X" (a name the file once held as its own) resolves to the same
    // spell as the cast: one row, or the page would key two rows alike.
    const rows = queries({ 'Envenomed Bolt X': { recastCue: false } }, { 'Envenomed Bolt X': { rankedName: 'Envenomed Bolt X', lastCast: 5, count: 2 } }).knownSpells()
    expect(rows.map((r) => r.name)).toEqual(['Envenomed Bolt'])
    expect(rows[0].lastCast).toBe(5)
  })
})
