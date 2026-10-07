import { describe, expect, it } from 'vitest'
import {
  isFullPath,
  meterOptions,
  sanitizeBuffs,
  sanitizeCasts,
  sanitizeMoteStock,
  sanitizeMotes,
  sanitizeRespawns,
  sanitizeRespawnTimer,
  sanitizeSpawnLink,
  sanitizeSettings,
  sanitizeSheet,
  sanitizeSpellRule,
  sanitizeStockCounts,
  sanitizeStockItem,
  sanitizeTrigger
} from '../../src/core/validate'
import { DEFAULT_METER_OPTIONS } from '../../src/shared/overlays'
import { defaultSettings } from '../../src/main/storeCore'
import type { BuffsFile } from '../../src/core/buffs'
import type { RespawnRecords } from '../../src/core/respawns'

const NOT_OBJECTS = [null, undefined, 'x', 42, true, [1, 2]]

describe('respawn records read back from disk', () => {
  const good: RespawnRecords = {
    'zone|a mob': { zone: 'zone', name: 'A mob', kills: 3, lastDeath: 1_790_000_000_000, pendingSince: 0, gaps: [400, 420], shared: false },
    'zone|a pair': { zone: 'zone', name: 'A pair', kills: 9, lastDeath: 5, pendingSince: 7, gaps: [], shared: true }
  }

  it('pass good records through unchanged', () => {
    expect(sanitizeRespawns(structuredClone(good))).toEqual(good)
  })

  it('come back empty from something that is not a record list', () => {
    for (const v of NOT_OBJECTS) expect(sanitizeRespawns(v)).toEqual({})
  })

  it('drop records with no name or zone', () => {
    const out = sanitizeRespawns({ a: { zone: 'z' }, b: { zone: 'z', name: '' }, c: { name: 'A mob', zone: 5 }, d: 'junk', e: null, f: { zone: '', name: 'Kept' } })
    expect(Object.keys(out)).toEqual(['f'])
  })

  it('hold each number to its range and drop fields nobody knows', () => {
    const out = sanitizeRespawns({
      k: { zone: 'z', name: 'A mob', kills: -4, lastDeath: 'yesterday', pendingSince: Number.NaN, gaps: [5, -1, 'x', Infinity, 0], shared: 'yes', note: 'junk' }
    })
    expect(out.k).toEqual({ zone: 'z', name: 'A mob', kills: 0, lastDeath: 0, pendingSince: 0, gaps: [5, 0], shared: false })
    expect(sanitizeRespawns({ k: { zone: 'z', name: 'A mob', kills: 1e12, lastDeath: 1e20 } }).k).toMatchObject({ kills: 1e9, lastDeath: 1e15 })
  })

  it('take the gap list only when it is a list', () => {
    expect(sanitizeRespawns({ k: { zone: 'z', name: 'A mob', gaps: { 0: 5 } } }).k.gaps).toEqual([])
  })

  it("keep a spawn point's names, and only names", () => {
    const out = sanitizeRespawns({ k: { zone: 'z', name: 'A spot', names: ['A mob', '', 5, 'Boog Mudtoe'] }, l: { zone: 'z', name: 'A mob', names: 'x' } })
    expect(out.k.names).toEqual(['A mob', 'Boog Mudtoe'])
    expect(out.l).not.toHaveProperty('names')
  })
})

describe('a spawn point from the Respawns page', () => {
  it('needs a zone, a name and two different mobs', () => {
    const good = { zone: ' OoT ', name: " Boog Mudtoe's spawn ", names: ['a seafury cyclops', ' Boog Mudtoe', 'A SEAFURY CYCLOPS', ''] }
    expect(sanitizeSpawnLink(good)).toEqual({ zone: 'OoT', name: "Boog Mudtoe's spawn", names: ['A SEAFURY CYCLOPS', 'Boog Mudtoe'] })
    for (const v of NOT_OBJECTS) expect(sanitizeSpawnLink(v)).toBeNull()
    expect(sanitizeSpawnLink({ ...good, zone: '' })).toBeNull()
    expect(sanitizeSpawnLink({ ...good, name: 5 })).toBeNull()
    expect(sanitizeSpawnLink({ ...good, names: ['a mob', 'A mob'] })).toBeNull()
  })
})

describe('a respawn timer from the Respawns page', () => {
  it('passes a good timer through unchanged', () => {
    const t = { name: 'A mob', seconds: 400, overlay: 'respawns', warnSec: 30, announce: false }
    expect(sanitizeRespawnTimer({ ...t })).toEqual(t)
  })

  it('is refused without a name or a length', () => {
    for (const v of NOT_OBJECTS) expect(sanitizeRespawnTimer(v)).toBeNull()
    expect(sanitizeRespawnTimer({ seconds: 60 })).toBeNull()
    expect(sanitizeRespawnTimer({ name: '   ', seconds: 60 })).toBeNull()
    expect(sanitizeRespawnTimer({ name: 5, seconds: 60 })).toBeNull()
    expect(sanitizeRespawnTimer({ name: 'A mob' })).toBeNull()
    expect(sanitizeRespawnTimer({ name: 'A mob', seconds: '60' })).toBeNull()
  })

  it('fills the optional fields and drops unknown ones', () => {
    expect(sanitizeRespawnTimer({ name: 'A mob', seconds: 60, overlay: 7, announce: 'yes', junk: 1 })).toEqual({
      name: 'A mob',
      seconds: 60,
      overlay: 'respawns',
      warnSec: 0,
      announce: true
    })
  })

  it('holds the length to a second through a day, in whole seconds', () => {
    expect(sanitizeRespawnTimer({ name: 'A mob', seconds: 0 })!.seconds).toBe(1)
    expect(sanitizeRespawnTimer({ name: 'A mob', seconds: -30 })!.seconds).toBe(1)
    expect(sanitizeRespawnTimer({ name: 'A mob', seconds: 1e9 })!.seconds).toBe(86_400)
    expect(sanitizeRespawnTimer({ name: 'A mob', seconds: 12.6 })!.seconds).toBe(13)
    expect(sanitizeRespawnTimer({ name: 'A mob', seconds: Number.NaN })!.seconds).toBe(1)
    expect(sanitizeRespawnTimer({ name: 'A mob', seconds: 60, warnSec: -5 })!.warnSec).toBe(0)
    expect(sanitizeRespawnTimer({ name: 'A mob', seconds: 60, warnSec: 9999.7 })!.warnSec).toBe(3600)
  })

  it('trims the name and cuts a long one', () => {
    expect(sanitizeRespawnTimer({ name: '  A mob  ', seconds: 60 })!.name).toBe('A mob')
    expect(sanitizeRespawnTimer({ name: 'x'.repeat(500), seconds: 60 })!.name).toBe('x'.repeat(100))
  })
})

describe('buffs read back from disk', () => {
  const good: BuffsFile = {
    people: { tester: { name: 'Tester', classes: ['druid', 'cleric'], level: 60, race: 'Iksar', at: 1_790_000_000_000 } },
    wanted: { Tester_test: ['Spirit of Wolf', 'Temperance'] },
    active: {
      Tester_test: [
        { spell: 'Clarity', ranked: 'Clarity IV', line: 'manaRegen', caster: 'Tester', landedAt: 100, endsAt: 2000 },
        { spell: 'Aura', ranked: 'Aura', line: 'other', caster: '', landedAt: 100, endsAt: null }
      ]
    }
  }

  it('pass a good file through unchanged', () => {
    expect(sanitizeBuffs(structuredClone(good))).toEqual(good)
  })

  it('come back empty from something that is not a buffs file', () => {
    for (const v of NOT_OBJECTS) expect(sanitizeBuffs(v)).toEqual({ people: {}, wanted: {}, active: {} })
    expect(sanitizeBuffs({ people: 'x', wanted: [1], active: 5 })).toEqual({ people: {}, wanted: {}, active: {} })
  })

  it('keep people only with a name and a class list, filed by lower-case name', () => {
    const out = sanitizeBuffs({
      people: {
        Tester: { name: 'Tester', classes: ['druid', 3, null], level: 500, race: 7, at: -1, junk: 1 },
        NoName: { classes: [] },
        NoClasses: { name: 'Other', classes: 'druid' },
        Bad: 'x'
      }
    })
    expect(out.people).toEqual({ tester: { name: 'Tester', classes: ['druid'], level: 100, race: '', at: 0 } })
    expect(sanitizeBuffs({ people: { a: { name: 'A', classes: [], level: 0 } } }).people.a.level).toBe(1)
  })

  it('keep wanted lists only under a real character key, and only their names', () => {
    const out = sanitizeBuffs({ wanted: { Tester_test: ['Spirit of Wolf', 5, null], '..\\x': ['a'], 'a/b': ['a'], Other_test: 'Spirit of Wolf' } })
    expect(out.wanted).toEqual({ Tester_test: ['Spirit of Wolf'] })
  })

  it('keep active buffs with a spell and a line, filling the rest', () => {
    const out = sanitizeBuffs({
      active: {
        Tester_test: [{ spell: 'Clarity', line: 'manaRegen', landedAt: -5, endsAt: 'soon', extra: 1 }, { spell: 'No line' }, { line: 'other' }, 'junk'],
        '../x': [{ spell: 'Clarity', line: 'manaRegen' }],
        Other_test: 'x'
      }
    })
    expect(out.active).toEqual({ Tester_test: [{ spell: 'Clarity', ranked: 'Clarity', line: 'manaRegen', caster: '', landedAt: 0, endsAt: 0 }] })
  })
})

describe("a spell's own settings from the Spell Timers page", () => {
  it('pass good settings through unchanged', () => {
    const rule = {
      track: true,
      recastCue: false,
      fadeCue: true,
      alias: 'SoW',
      warnSec: 20,
      warnSpeech: 'Recast {spell}',
      fadeSpeech: '{spell} down',
      color: '#ffcc00',
      overlay: 'buffs',
      durationOverrideSec: 3600,
      extraFocusPct: 15
    }
    expect(sanitizeSpellRule({ ...rule })).toEqual(rule)
    expect(sanitizeSpellRule({ others: true, othersSpeech: '{caster} cast it', track: 'yes' })).toEqual({ others: true, othersSpeech: '{caster} cast it' })
    expect(sanitizeSpellRule({})).toEqual({})
  })

  it('are refused when not an object', () => {
    for (const v of NOT_OBJECTS) expect(sanitizeSpellRule(v)).toBeNull()
  })

  it('drop fields of the wrong kind and fields nobody knows', () => {
    expect(sanitizeSpellRule({ track: 'yes', recastCue: 1, alias: 5, color: null, warnSec: '20', durationOverrideSec: Number.NaN, extraFocusPct: Infinity, junk: 'x' })).toEqual({})
  })

  it('hold numbers to their range', () => {
    expect(sanitizeSpellRule({ warnSec: -1, durationOverrideSec: 1e9, extraFocusPct: -500 })).toEqual({ warnSec: 0, durationOverrideSec: 7 * 86_400, extraFocusPct: -100 })
    expect(sanitizeSpellRule({ warnSec: 99_999, durationOverrideSec: -3, extraFocusPct: 5000 })).toEqual({ warnSec: 3600, durationOverrideSec: 0, extraFocusPct: 1000 })
  })

  it('cut long text', () => {
    const out = sanitizeSpellRule({ alias: 'a'.repeat(2000), warnSpeech: 'w'.repeat(501), overlay: 'o'.repeat(500) })!
    expect(out.alias).toBe('a'.repeat(500))
    expect(out.warnSpeech).toBe('w'.repeat(500))
    expect(out.overlay).toBe('o'.repeat(500))
  })
})

describe('motes on hand from the planner', () => {
  it('pass good counts through unchanged', () => {
    expect(sanitizeStockCounts({ major: 60, minor: 3, infinite: 0 })).toEqual({ major: 60, minor: 3, infinite: 0 })
  })

  it('come back empty from something that is not a count list', () => {
    for (const v of NOT_OBJECTS) expect(sanitizeStockCounts(v)).toEqual({})
  })

  it('keep known ranks only, as whole numbers from zero', () => {
    expect(sanitizeStockCounts({ major: -4, minor: 2.6, lesser: '5', greater: Number.NaN, grand: 1e12, huge: 3 })).toEqual({ major: 0, minor: 3, grand: 1e9 })
  })
})

describe('paths in the settings', () => {
  const fb = defaultSettings()
  const withLog = (logFile: unknown) => sanitizeSettings({ ...fb, logFile }, { ...fb, logFile: 'E:\\EQ\\Logs\\eqlog_Kelwyn_neriak.txt' })?.logFile

  it('keep only a character log as the watched file', () => {
    expect(withLog('D:\\Games\\EQL\\Logs\\eqlog_Aldric_neriak.txt')).toBe('D:\\Games\\EQL\\Logs\\eqlog_Aldric_neriak.txt')
    expect(withLog('\\\\nas\\eq\\Logs\\eqlog_Aldric_neriak.txt')).toBe('\\\\nas\\eq\\Logs\\eqlog_Aldric_neriak.txt')
    expect(withLog('')).toBe('')
    for (const bad of ['C:\\Windows\\win.ini', 'eqlog_Aldric_neriak.txt', 'E:eqlog_Aldric_neriak.txt', 'C:\\x\\eqlog_.txt', 42]) {
      expect(withLog(bad)).toBe('E:\\EQ\\Logs\\eqlog_Kelwyn_neriak.txt')
    }
  })

  it('know a full path from one that depends on the current folder', () => {
    expect(['C:\\x', 'c:/x', '\\\\server\\share'].map(isFullPath)).toEqual([true, true, true])
    expect(['', 'C:', 'C:x', 'x\\y', '\\\\', 7].map(isFullPath)).toEqual([false, false, false, false, false, false])
  })
})

describe('mote history read back from disk', () => {
  const run = {
    id: 'r1',
    kind: 'crawl',
    name: 'The Plane of Fear 4 (Refined)',
    startedAt: 1000,
    endedAt: 5000,
    outcome: 'completed',
    motes: { major: 3 },
    outsideSince: null,
    outsideMs: 0
  }

  it('keeps a good file as it is', () => {
    const v = { active: null, sessions: [run], daily: { '2026-09-24': { major: 3 } }, seenUntil: 5000, marks: { 'x@1000': 'crawl' } }
    expect(sanitizeMotes(v)).toEqual(v)
  })

  it('is rebuilt (null) when its outline is wrong, so the engine never ticks over a missing list', () => {
    for (const v of NOT_OBJECTS) expect(sanitizeMotes(v)).toBeNull()
    expect(sanitizeMotes({ sessions: null, daily: {} })).toBeNull()
    expect(sanitizeMotes({ sessions: [], daily: [] })).toBeNull()
  })

  it('drops broken runs, days and marks and keeps the rest', () => {
    const v = sanitizeMotes({
      active: { id: 5 },
      sessions: [run, null, { id: 'r2' }, { ...run, id: 'r3', kind: 'raid', outcome: 'won', motes: 'lots', endedAt: 'soon' }],
      daily: { '2026-09-24': { major: 3 }, yesterday: { major: 1 }, '2026-09-25': 7 },
      marks: { a: 'crawl', b: 'boss' }
    })
    expect(v?.active).toBeNull()
    expect(v?.sessions.map((s) => s.id)).toEqual(['r1', 'r3'])
    expect(v?.sessions[1]).toMatchObject({ kind: 'instance', outcome: 'stopped', motes: {}, endedAt: null })
    expect(v?.daily).toEqual({ '2026-09-24': { major: 3 } })
    expect(v?.marks).toEqual({ a: 'crawl' })
  })
})

describe('known casts read back from disk', () => {
  it('keeps good entries and drops the rest', () => {
    expect(sanitizeCasts({ Puma: { rankedName: 'Puma X', lastCast: 10, count: 4 }, Bad: { count: 2 }, Worse: null })).toEqual({
      Puma: { rankedName: 'Puma X', lastCast: 10, count: 4 }
    })
    for (const v of NOT_OBJECTS) expect(sanitizeCasts(v)).toEqual({})
  })
})

describe('the mote stock read back from disk', () => {
  it('fills what is missing and keeps the loot mark', () => {
    expect(sanitizeMoteStock({ counts: { major: 2 }, seenUntil: 99, seenAtSecond: 2 })).toEqual({
      counts: { major: 2 },
      item: { name: '', lvl: 0, xp: 0, to: 1 },
      autoAdd: true,
      seenUntil: 99,
      seenAtSecond: 2
    })
    for (const v of NOT_OBJECTS) expect(sanitizeMoteStock(v)).toEqual({ counts: {}, item: { name: '', lvl: 0, xp: 0, to: 1 }, autoAdd: true })
  })
})

describe('the item being planned', () => {
  it('passes a good item through unchanged', () => {
    const item = { name: 'Test cloak', lvl: 3, xp: 12.5, to: 6 }
    expect(sanitizeStockItem({ ...item })).toEqual(item)
  })

  it('is refused when not an object', () => {
    for (const v of NOT_OBJECTS) expect(sanitizeStockItem(v)).toBeNull()
  })

  it('fills missing fields, drops unknown ones and holds numbers to their range', () => {
    expect(sanitizeStockItem({ junk: 1 })).toEqual({ name: '', lvl: 0, xp: 0, to: 1 })
    expect(sanitizeStockItem({ name: 5, lvl: 2.6, xp: -3, to: 500 })).toEqual({ name: '', lvl: 3, xp: 0, to: 100 })
    expect(sanitizeStockItem({ name: 'x', lvl: 1e6, xp: 1e12, to: -1 })).toEqual({ name: 'x', lvl: 100, xp: 1e9, to: 0 })
  })

  it('cuts a long name', () => {
    expect(sanitizeStockItem({ name: 'n'.repeat(1000) })!.name).toBe('n'.repeat(200))
  })
})

describe('a character sheet from the Stats and Gear pages', () => {
  it('passes a good sheet through unchanged', () => {
    const sheet = { acOverrides: { 'item:1': 45, 'item:2': -3 }, shield: true, stats: { str: 200, notes: 'x', nested: { a: [1, 2] } } }
    expect(sanitizeSheet(structuredClone(sheet))).toEqual(sheet)
    expect(sanitizeSheet({ acOverrides: {}, shield: null, stats: {} })).toEqual({ acOverrides: {}, shield: null, stats: {} })
  })

  it('is refused when not an object', () => {
    for (const v of NOT_OBJECTS) expect(sanitizeSheet(v)).toBeNull()
  })

  it('fills missing fields and drops unknown ones', () => {
    expect(sanitizeSheet({ junk: 1 })).toEqual({ acOverrides: {}, shield: null, stats: {} })
    expect(sanitizeSheet({ acOverrides: [1], shield: 'yes', stats: [1, 2] })).toEqual({ acOverrides: {}, shield: null, stats: {} })
  })

  it('keeps AC overrides only as numbers in range, under cut keys', () => {
    const out = sanitizeSheet({ acOverrides: { a: 20_000, b: -20_000, c: '5', d: Number.NaN, e: Infinity, ['k'.repeat(300)]: 7 } })!
    expect(out.acOverrides).toEqual({ a: 10_000, b: -10_000, ['k'.repeat(200)]: 7 })
  })

  it('is refused when its stats are far larger than any real sheet', () => {
    expect(sanitizeSheet({ stats: { big: 'x'.repeat(200_000) } })).toBeNull()
    expect(sanitizeSheet({ stats: { big: 'x'.repeat(100_000) } })).not.toBeNull()
  })
})

describe('one trigger for the trigger tester', () => {
  it('is checked the way a list of them is', () => {
    const t = sanitizeTrigger({ id: 'a', name: 'Mez', phrases: ['mesmerized'], cooldownSec: -1, actions: [{ type: 'speak', text: 'mez' }, { type: 'explode' }] })
    expect(t).toEqual({
      id: 'a',
      name: 'Mez',
      folder: '',
      enabled: true,
      comment: '',
      cooldownSec: 0,
      phrases: [{ text: 'mesmerized', regex: false }],
      actions: [{ type: 'speak', text: 'mez', interrupt: false }]
    })
  })

  it('is refused when not an object', () => {
    for (const v of NOT_OBJECTS) expect(sanitizeTrigger(v)).toBeNull()
  })
})

describe('meter overlay options', () => {
  it('pass good options through unchanged', () => {
    const o = { mode: 'healing' as const, span: 'session' as const, scope: 'you' as const, rows: 12, combinePet: false, header: false }
    expect(meterOptions({ ...o }, DEFAULT_METER_OPTIONS)).toEqual(o)
  })

  it('keep what was there when given something that is not options', () => {
    const fb = { ...DEFAULT_METER_OPTIONS, rows: 3 }
    for (const v of NOT_OBJECTS) expect(meterOptions(v, fb)).toBe(fb)
    expect(meterOptions(null, undefined)).toBeUndefined()
  })

  it('fall back field by field, to the defaults when there was nothing before', () => {
    expect(meterOptions({ mode: 'explode', span: 5, rows: 'many', header: 'no', junk: 1 }, undefined)).toEqual(DEFAULT_METER_OPTIONS)
    const fb = { ...DEFAULT_METER_OPTIONS, mode: 'incoming' as const, rows: 20 }
    expect(meterOptions({ mode: 'explode' }, fb)).toEqual(fb)
  })

  it('hold the row count to 1 through 50', () => {
    expect(meterOptions({ rows: 0 }, DEFAULT_METER_OPTIONS)!.rows).toBe(1)
    expect(meterOptions({ rows: 500 }, DEFAULT_METER_OPTIONS)!.rows).toBe(50)
  })
})

describe('achievements overlay options', () => {
  const fb = defaultSettings()
  const achievementsOverlay = (o: Record<string, unknown>) =>
    sanitizeSettings({ ...fb, overlays: fb.overlays.map((x) => (x.kind === 'achievements' ? { ...x, ...o } : x)) }, fb)?.overlays.find((x) => x.kind === 'achievements')

  it('show the faction plan unless it was hidden', () => {
    expect(achievementsOverlay({})?.achievements).toEqual({ factionPlan: true })
    expect(achievementsOverlay({ achievements: { factionPlan: false } })?.achievements).toEqual({ factionPlan: false })
    expect(achievementsOverlay({ achievements: { factionPlan: 'no', junk: 1 } })?.achievements).toEqual({ factionPlan: true })
  })

  it('belong to the achievements overlay only', () => {
    const others = sanitizeSettings({ ...fb, overlays: fb.overlays.map((x) => ({ ...x, achievements: { factionPlan: false } })) }, fb)?.overlays ?? []
    expect(others.filter((x) => x.achievements).map((x) => x.kind)).toEqual(['achievements'])
  })
})
