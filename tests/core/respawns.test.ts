import { describe, expect, it } from 'vitest'
import { CombatMeter } from '../../src/core/combatMeter'
import { parseLogLine } from '../../src/core/logLine'
import { compilePhrase } from '../../src/core/triggers'
import {
  RespawnLog,
  respawnEstimate,
  respawnLength,
  respawnKey,
  respawnPhrase,
  respawnTimerSpec,
  respawnTrigger,
  respawnTriggerId,
  mergeRespawns,
  respawnChanges,
  respawnView,
  type RespawnRecords
} from '../../src/core/respawns'
import { sanitizeRespawns, sanitizeSpawnLink } from '../../src/core/validate'
import type { Trigger } from '../../src/shared/types'

// Line shapes copied from the log (September 2026); times moved to make the gaps.

const ZONE = 'The Plane of Hate 50 (Refined)'

/** The engine's order: the meter reads each line, then the respawn log gets the meter's event. */
function feed(records: RespawnRecords = {}) {
  const meter = new CombatMeter({ fightGapSec: 10, newSessionOnZone: true })
  meter.setSelf('Kelwyn')
  let changes = 0
  const spotKills: { spawn: string; at: number }[] = []
  const log = new RespawnLog(records, {
    onChange: () => changes++,
    kindOf: (n) => meter.kindOf(n).kind,
    onSpot: (r, death) => spotKills.push({ spawn: r.name, at: death.time })
  })
  const run = (lines: string) => {
    for (const raw of lines.split('\n').filter((l) => l.trim())) {
      const line = parseLogLine(raw.trim())
      if (!line) throw new Error(`not a log line: ${raw}`)
      const ev = meter.handle(line)
      log.handle(line, meter.currentZone || ZONE, ev)
    }
  }
  return { log, run, records, spotKills, changes: () => changes }
}

const KEY = respawnKey(ZONE, 'Coercer T`vala')

describe('respawn log', () => {
  it('measures death to the next line that names the mob', () => {
    const f = feed()
    f.run(`
      [Fri Sep 25 10:40:00 2026] You have slain Coercer T\`vala!
      [Fri Sep 25 10:40:00 2026] You looted an Insidious Pantaloons +4 from Coercer T\`vala's corpse and sold it for free.
      [Fri Sep 25 10:58:47 2026] Coercer T\`vala scowls at you, ready to attack -- what would you like your tombstone to say? (Lvl: 56)
      [Fri Sep 25 10:59:00 2026] You have slain Coercer T\`vala!
    `)
    const r = f.records[KEY]
    expect(r).toMatchObject({ name: 'Coercer T`vala', zone: ZONE, kills: 2, gaps: [1127], shared: false })
    expect(r.pendingSince).toBe(r.lastDeath)
    expect(respawnEstimate(r)).toBe(1127)
  })

  it('counts a spell, a blow or speech as a sighting, and the next kill when nothing came before it', () => {
    const f = feed()
    f.run(`
      [Thu Sep 24 12:00:00 2026] Lord of Ire has been slain by Jobarab!
      [Thu Sep 24 12:10:00 2026] Lord of Ire begins casting Skin like Nature.
      [Thu Sep 24 12:11:00 2026] Lord of Ire has been slain by Jobarab!
      [Thu Sep 24 12:20:00 2026] Lord of Ire hits YOU for 122 points of damage.
      [Thu Sep 24 12:21:00 2026] You have slain Lord of Ire!
      [Thu Sep 24 12:30:30 2026] You have slain Lord of Ire!
    `)
    expect(f.records[respawnKey(ZONE, 'Lord of Ire')].gaps).toEqual([600, 540, 570])
  })

  it('ignores the corpse and anything in the seconds after the death', () => {
    const f = feed()
    f.run(`
      [Fri Sep 25 11:41:21 2026] You have slain Magi P\`tasa!
      [Fri Sep 25 11:41:22 2026] Magi P\`tasa's corpse falls to the ground.
      [Fri Sep 25 11:41:23 2026] Magi P\`tasa has been slain by Jobarab!
    `)
    const r = f.records[respawnKey(ZONE, 'Magi P`tasa')]
    expect(r).toMatchObject({ kills: 1, gaps: [] })
    expect(r.pendingSince).toBeGreaterThan(0)
  })

  it('stops watching when you leave the zone', () => {
    const f = feed()
    f.run(`
      [Fri Sep 25 11:00:00 2026] You have slain Coercer T\`vala!
      [Fri Sep 25 11:05:00 2026] You have entered Neriak - Commons.
      [Fri Sep 25 11:15:00 2026] You have entered ${ZONE}.
      [Fri Sep 25 11:16:00 2026] Coercer T\`vala scowls at you, ready to attack -- what would you like your tombstone to say? (Lvl: 56)
    `)
    expect(f.records[KEY]).toMatchObject({ kills: 1, gaps: [], pendingSince: 0 })
  })

  it('keeps zones apart', () => {
    const f = feed()
    f.run(`
      [Fri Sep 25 11:00:00 2026] You have entered ${ZONE}.
      [Fri Sep 25 11:00:10 2026] You have slain a shiverback!
      [Fri Sep 25 11:05:00 2026] You have entered Neriak - Commons.
      [Fri Sep 25 11:06:00 2026] You have slain a shiverback!
    `)
    expect(Object.keys(f.records).sort()).toEqual([respawnKey('Neriak - Commons', 'a shiverback'), respawnKey(ZONE, 'a shiverback')].sort())
    expect(f.records[respawnKey(ZONE, 'A shiverback')].name).toBe('A shiverback')
  })

  it('flags a name several mobs share and leaves its short gaps out of the estimate', () => {
    const f = feed()
    f.run(`
      [Fri Sep 25 10:48:10 2026] You have slain Cleric of Innoruuk!
      [Fri Sep 25 10:48:24 2026] Cleric of Innoruuk hits YOU for 90 points of damage.
    `)
    const r = f.records[respawnKey(ZONE, 'Cleric of Innoruuk')]
    expect(r).toMatchObject({ gaps: [14], shared: true })
    expect(respawnEstimate(r)).toBeNull()
  })

  it('leaves out you, your group and pets', () => {
    const f = feed()
    f.run(`
      [Fri Sep 25 11:00:00 2026] Aldric has joined the group.
      [Fri Sep 25 11:00:05 2026] Aldric has been slain by a shiverback!
      [Fri Sep 25 11:00:06 2026] You have been slain by a shiverback!
      [Fri Sep 25 11:00:07 2026] Avatar of Abhorrence pet has been slain by Jobarab!
      [Fri Sep 25 11:00:08 2026] Wanderer has been slain by a shiverback!
    `)
    expect(Object.keys(f.records)).toEqual([])
  })

  it('counts nothing twice when the same log is read again after a restart', () => {
    const lines = `
      [Fri Sep 25 10:40:00 2026] You have slain Coercer T\`vala!
      [Fri Sep 25 10:58:47 2026] Coercer T\`vala scowls at you, ready to attack -- what would you like your tombstone to say? (Lvl: 56)
      [Fri Sep 25 10:59:00 2026] You have slain Coercer T\`vala!
    `
    const first = feed()
    first.run(lines)
    const saved = JSON.parse(JSON.stringify(first.records)) as RespawnRecords
    const again = feed(saved)
    again.run(`[Fri Sep 25 10:30:00 2026] You have entered ${ZONE}.\n${lines}`)
    expect(again.records).toEqual(first.records)
    expect(again.changes()).toBe(0)
  })
})

// A placeholder spot in Ocean of Tears: a seafury cyclops or an aqua goblin, or Boog Mudtoe in their place
// (line shapes from the log, October 2026).
const OOT = 'The Ocean of Tears'
const BOOG = "Boog Mudtoe's spawn"
const SPAWN = respawnKey(OOT, BOOG)
const SPOT = { zone: OOT, name: BOOG, names: ['a seafury cyclops', 'an aqua goblin', 'Boog Mudtoe'] }

describe('spawn points', () => {
  it('takes in what its mobs had on record: their kills and the latest death, not their gaps', () => {
    const f = feed()
    f.run(`
      [Fri Oct 02 10:00:00 2026] You have entered ${OOT}.
      [Fri Oct 02 10:48:25 2026] You have slain a seafury cyclops!
      [Fri Oct 02 10:51:12 2026] You have slain an aqua goblin!
      [Fri Oct 02 10:54:16 2026] You have slain a seafury cyclops!
    `)
    expect(f.records[respawnKey(OOT, 'a seafury cyclops')].gaps).toEqual([351])
    expect(f.log.link(SPOT)).toBe(SPAWN)
    expect(Object.keys(f.records)).toEqual([SPAWN])
    expect(f.records[SPAWN]).toMatchObject({
      zone: OOT,
      name: BOOG,
      names: ['A seafury cyclops', 'An aqua goblin', 'Boog Mudtoe'],
      kills: 3,
      gaps: [],
      lastDeath: new Date(2026, 9, 2, 10, 54, 16).getTime()
    })
    expect(f.records[SPAWN].pendingSince).toBe(f.records[SPAWN].lastDeath)
  })

  it('measures from a death of any of its mobs to any of them seen, speech included', () => {
    const f = feed()
    f.log.link(SPOT)
    f.run(`
      [Fri Oct 02 10:00:00 2026] You have entered ${OOT}.
      [Fri Oct 02 10:57:01 2026] You have slain a seafury cyclops!
      [Fri Oct 02 10:59:26 2026] Boog Mudtoe says, 'Smash you... No one bash better than Mudtoe.'
      [Fri Oct 02 10:59:38 2026] Boog Mudtoe has been slain by Jobarab!
      [Fri Oct 02 11:02:01 2026] An aqua goblin hits YOU for 12 points of damage.
      [Fri Oct 02 11:03:11 2026] You have slain an aqua goblin!
    `)
    expect(Object.keys(f.records)).toEqual([SPAWN])
    expect(f.records[SPAWN]).toMatchObject({ kills: 3, gaps: [145, 143], shared: false })
    expect(respawnEstimate(f.records[SPAWN])).toBe(143)
  })

  it('leaves the same names in another zone to themselves', () => {
    const f = feed()
    f.log.link(SPOT)
    f.run(`
      [Fri Oct 02 11:20:00 2026] You have entered Erud's Crossing.
      [Fri Oct 02 11:21:00 2026] You have slain an aqua goblin!
    `)
    expect(f.records[SPAWN].kills).toBe(0)
    expect(f.records[respawnKey("Erud's Crossing", 'an aqua goblin')].kills).toBe(1)
  })

  it('changes its mobs when linked again under its name, and takes a mob from another spawn', () => {
    const f = feed()
    f.log.link(SPOT)
    const other = f.log.link({ zone: OOT, name: 'The far spot', names: ['an aqua goblin', 'a seafury sentry'] })
    expect(f.records[SPAWN].names).toEqual(['A seafury cyclops', 'Boog Mudtoe'])
    expect(f.records[other].names).toEqual(['An aqua goblin', 'A seafury sentry'])
    f.log.link({ ...SPOT, names: ['a seafury cyclops', 'Boog Mudtoe', 'an aqua goblin', 'a seafury sentry'] })
    expect(f.records[other]).toBeUndefined()
    expect(f.records[SPAWN].names).toHaveLength(4)
  })

  it('will not be named after a mob of its own that is not one of its mobs', () => {
    const f = feed()
    f.run(`
      [Fri Oct 02 10:00:00 2026] You have entered ${OOT}.
      [Fri Oct 02 10:48:25 2026] You have slain an old shark!
    `)
    expect(() => f.log.link({ zone: OOT, name: 'an old shark', names: ['a seafury cyclops', 'Boog Mudtoe'] })).toThrow(/mob of its own/)
    // One of its mobs is fine: its record becomes the spawn's.
    f.log.link({ zone: OOT, name: 'an old shark', names: ['an old shark', 'Boog Mudtoe'] })
    expect(f.records[respawnKey(OOT, 'an old shark')]).toMatchObject({ kills: 1, names: ['An old shark', 'Boog Mudtoe'] })
  })

  it('forgets its kills and gaps but keeps its mobs', () => {
    const f = feed()
    f.log.link(SPOT)
    f.run(`
      [Fri Oct 02 10:00:00 2026] You have entered ${OOT}.
      [Fri Oct 02 10:57:01 2026] You have slain a seafury cyclops!
    `)
    expect(f.log.forget(SPAWN)).toBe(true)
    expect(f.records[SPAWN]).toMatchObject({ kills: 0, lastDeath: 0, pendingSince: 0, gaps: [], names: ['A seafury cyclops', 'An aqua goblin', 'Boog Mudtoe'] })
    f.run('[Fri Oct 02 11:03:11 2026] You have slain an aqua goblin!')
    expect(Object.keys(f.records)).toEqual([SPAWN])
    expect(f.records[SPAWN].kills).toBe(1)
  })

  it('splits up into mobs of their own, starting afresh', () => {
    const f = feed()
    f.log.link(SPOT)
    expect(f.log.unlink(respawnKey(OOT, 'a seafury cyclops'))).toBe(false)
    expect(f.log.unlink(SPAWN)).toBe(true)
    f.run(`
      [Fri Oct 02 10:00:00 2026] You have entered ${OOT}.
      [Fri Oct 02 10:48:25 2026] You have slain a seafury cyclops!
    `)
    expect(Object.keys(f.records)).toEqual([respawnKey(OOT, 'a seafury cyclops')])
  })

  it('counts nothing twice when the same log is read again after a restart', () => {
    const lines = `
      [Fri Oct 02 10:00:00 2026] You have entered ${OOT}.
      [Fri Oct 02 10:57:01 2026] You have slain a seafury cyclops!
      [Fri Oct 02 10:59:38 2026] Boog Mudtoe has been slain by Jobarab!
    `
    const first = feed()
    first.log.link(SPOT)
    first.run(lines)
    const saved = JSON.parse(JSON.stringify(first.records)) as RespawnRecords
    const again = feed(saved)
    again.run(lines)
    expect(again.records).toEqual(first.records)
    expect(again.changes()).toBe(0)
  })

  it('names its mobs for its timer', () => {
    const f = feed()
    f.log.link(SPOT)
    expect(f.log.spawnOf("boog mudtoe's SPAWN")).toEqual({ names: ['A seafury cyclops', 'An aqua goblin', 'Boog Mudtoe'] })
    expect(f.log.spawnOf('Boog Mudtoe')).toBeNull()
  })
})

const PF = 'Permafrost Keep 4 (Refined)'
const PRIEST = respawnKey(PF, 'a goblin priest')
const PIN = { zone: PF, name: 'A goblin priest at 289, -375', names: ['a goblin priest'], spot: { at: [288.63, -374.69, 4.69] as [number, number, number], within: 50 } }
const PINNED = respawnKey(PF, PIN.name)
const at = (h: number, m: number, s: number) => new Date(2026, 9, 19, h, m, s).getTime()

describe('spawn points pinned to a spot', () => {
  it('counts a kill there only when the next /loc, soon after, is near the spot', () => {
    const f = feed()
    f.log.link(PIN)
    f.run(`
      [Mon Oct 19 20:00:00 2026] You have entered ${PF}.
      [Mon Oct 19 20:01:20 2026] You have slain a goblin priest!
      [Mon Oct 19 20:01:30 2026] Your Location is 290.12, -370.55, 4.69
      [Mon Oct 19 20:02:00 2026] You have slain a goblin priest!
      [Mon Oct 19 20:02:05 2026] Your Location is 600.00, -100.00, 4.00
      [Mon Oct 19 20:02:40 2026] You have slain a goblin priest!
      [Mon Oct 19 20:03:30 2026] Your Location is 288.00, -374.00, 4.69
    `)
    expect(f.records[PINNED]).toMatchObject({ kills: 1, lastDeath: at(20, 1, 20), pendingSince: at(20, 1, 20) })
    expect(f.spotKills).toEqual([{ spawn: PIN.name, at: at(20, 1, 20) }])
    // The name keeps its own record of every kill in the zone.
    expect(f.records[PRIEST].kills).toBe(3)
  })

  it('times a gap from a death there to the start of the fight that ends in the next kill there', () => {
    const f = feed()
    f.log.link(PIN)
    f.run(`
      [Mon Oct 19 20:00:00 2026] You have entered ${PF}.
      [Mon Oct 19 20:01:20 2026] You have slain a goblin priest!
      [Mon Oct 19 20:01:25 2026] Your Location is 290.12, -370.55, 4.69
      [Mon Oct 19 20:02:00 2026] A goblin priest hits YOU for 12 points of damage.
      [Mon Oct 19 20:02:10 2026] You have slain a goblin priest!
      [Mon Oct 19 20:02:12 2026] Your Location is 600.00, -100.00, 4.00
      [Mon Oct 19 20:02:40 2026] A goblin priest hits YOU for 12 points of damage.
      [Mon Oct 19 20:02:46 2026] A goblin priest hits YOU for 14 points of damage.
      [Mon Oct 19 20:03:00 2026] You have slain a goblin priest!
      [Mon Oct 19 20:03:05 2026] Your Location is 287.40, -376.02, 4.69
    `)
    expect(f.records[PINNED]).toMatchObject({ kills: 2, gaps: [80], shared: false })
    expect(respawnEstimate(f.records[PINNED])).toBe(80)
  })

  it('gives a kill to the nearest of two spots, and drops one held over a zone line', () => {
    const f = feed()
    f.log.link(PIN)
    const far = f.log.link({ ...PIN, name: 'A goblin priest at 320, -375', spot: { at: [320, -375], within: 50 } })
    f.run(`
      [Mon Oct 19 20:00:00 2026] You have entered ${PF}.
      [Mon Oct 19 20:01:20 2026] You have slain a goblin priest!
      [Mon Oct 19 20:01:30 2026] Your Location is 315.00, -375.00, 4.69
      [Mon Oct 19 20:02:20 2026] You have slain a goblin priest!
      [Mon Oct 19 20:02:21 2026] You have entered ${PF}.
      [Mon Oct 19 20:02:30 2026] Your Location is 288.63, -374.69, 4.69
    `)
    expect(f.records[far].kills).toBe(1)
    expect(f.records[PINNED].kills).toBe(0)
  })

  it('counts nothing twice when the same log is read again after a restart', () => {
    const lines = `
      [Mon Oct 19 20:00:00 2026] You have entered ${PF}.
      [Mon Oct 19 20:01:20 2026] You have slain a goblin priest!
      [Mon Oct 19 20:01:30 2026] Your Location is 290.12, -370.55, 4.69
    `
    const first = feed()
    first.log.link(PIN)
    first.run(lines)
    const again = feed(sanitizeRespawns(JSON.parse(JSON.stringify(first.records))))
    again.run(lines)
    expect(again.records).toEqual(first.records)
    expect(again.spotKills).toEqual([])
  })

  it('will not take the name of a mob of its own, and comes undone by being linked without a spot', () => {
    const f = feed()
    f.run(`
      [Mon Oct 19 20:00:00 2026] You have entered ${PF}.
      [Mon Oct 19 20:01:20 2026] You have slain a goblin priest!
    `)
    expect(() => f.log.link({ ...PIN, name: 'a goblin priest' })).toThrow(/mob of its own/)
    f.log.link(PIN)
    expect(f.log.spawnOf(PIN.name)).toEqual({ names: ['A goblin priest'], spot: PIN.spot })
    f.log.link({ zone: PF, name: PIN.name, names: ['a goblin priest', 'a goblin prelate'] })
    expect(f.records[PINNED].spot).toBeUndefined()
    // Unpinned, it takes the names' own records in.
    expect(f.records[PRIEST]).toBeUndefined()
  })

  it('has a timer with no phrase of its own, which the respawn log starts', () => {
    const t = respawnTrigger({ name: PIN.name, names: ['A goblin priest'], spot: PIN.spot, seconds: 66, overlay: 'respawns', warnSec: 30, announce: true })
    expect(t.phrases).toEqual([])
    expect(t.comment).toMatch(/your \/loc within 30 s of it is within 50 of 289, -375/)
  })

  it('is read back and linked only with a spot that is numbers', () => {
    expect(sanitizeSpawnLink(PIN)).toEqual({ ...PIN, names: ['a goblin priest'] })
    expect(sanitizeSpawnLink({ ...PIN, spot: undefined })).toBeNull()
    expect(sanitizeSpawnLink({ ...PIN, spot: { at: ['288', -374] } })).toBeNull()
    expect(sanitizeSpawnLink({ ...PIN, spot: { at: [288, -374] } })?.spot).toEqual({ at: [288, -374], within: 50 })
    const read = sanitizeRespawns({ [PINNED]: { zone: PF, name: PIN.name, names: ['A goblin priest'], spot: PIN.spot } })
    expect(read[PINNED].spot).toEqual(PIN.spot)
  })
})

describe('respawn timers', () => {
  const lines = (name: string) => [`You have slain ${name}!`, `${name} has been slain by Jobarab!`, `${name} died.`]

  it('is a trigger on the three ways the log reports that one death', () => {
    const re = compilePhrase({ text: respawnPhrase('Coercer T`vala'), regex: true }, 'Kelwyn')
    for (const l of lines('Coercer T`vala')) expect(re.test(l)).toBe(true)
    expect(re.test("You looted an Insidious Pantaloons +4 from Coercer T`vala's corpse and sold it for free.")).toBe(false)
    expect(re.test('You have slain Coercer T`vala the Elder!')).toBe(false)
    const a = compilePhrase({ text: respawnPhrase('A shiverback'), regex: true }, 'Kelwyn')
    expect(a.test('You have slain a shiverback!')).toBe(true)
    expect(a.test('A shiverback has been slain by Jobarab!')).toBe(true)
  })

  it('makes a timer with speech the voice can say, and keeps what was added to it later', () => {
    const t = respawnTrigger({ name: 'Coercer T`vala', seconds: 1127, overlay: 'respawns', warnSec: 30, announce: true })
    expect(t).toMatchObject({ id: 'respawn-coercer-t-vala', folder: 'Respawns', enabled: true })
    expect(t.actions).toEqual([
      expect.objectContaining({
        type: 'timer',
        name: 'Coercer T`vala',
        durationSec: 1127,
        overlay: 'respawns',
        warnSec: 30,
        warnSpeech: 'Coercer Tvala in 30 seconds',
        endSpeech: 'Coercer Tvala is up',
        restart: 'restart'
      })
    ])
    const edited: Trigger = { ...t, folder: 'Camps', actions: [...t.actions, { type: 'sound', file: 'ding.wav', volume: 1 }] }
    const again = respawnTrigger({ name: 'Coercer T`vala', seconds: 1100, overlay: 'targets', warnSec: 0, announce: false }, edited)
    expect(again.folder).toBe('Camps')
    expect(again.actions).toEqual([
      expect.objectContaining({ type: 'timer', durationSec: 1100, overlay: 'targets', warnSpeech: '', endSpeech: '' }),
      { type: 'sound', file: 'ding.wav', volume: 1 }
    ])
  })

  it("starts a spawn point's timer at a death of any of its mobs", () => {
    const names = ['A seafury cyclops', 'An aqua goblin', 'Boog Mudtoe']
    const t = respawnTrigger({ name: BOOG, names, seconds: 143, overlay: 'respawns', warnSec: 0, announce: true })
    expect(t).toMatchObject({ id: 'respawn-boog-mudtoe-s-spawn', name: `${BOOG} respawn` })
    expect(t.comment).toContain('any of A seafury cyclops, An aqua goblin, Boog Mudtoe')
    expect(t.actions[0]).toMatchObject({ type: 'timer', name: BOOG, endSpeech: `${BOOG} is up` })
    const re = compilePhrase(t.phrases[0], 'Kelwyn')
    for (const n of names) for (const l of lines(n)) expect(re.test(l)).toBe(true)
    expect(re.test('You have slain a seafury sentry!')).toBe(false)
    expect(respawnTimerSpec(t)).toEqual({ name: BOOG, seconds: 143, overlay: 'respawns', warnSec: 0, announce: true })
  })

  it('shows each record with its timer, and a timer whose mob has no record', () => {
    const f = feed()
    f.run('[Fri Sep 25 10:40:00 2026] You have slain Coercer T`vala!')
    const triggers = [
      respawnTrigger({ name: 'Coercer T`vala', seconds: 1127, overlay: 'respawns', warnSec: 30, announce: true }),
      respawnTrigger({ name: 'Fippy Darkpaw', seconds: 400, overlay: 'respawns', warnSec: 0, announce: true })
    ]
    const v = respawnView(f.records, triggers, ZONE)
    expect(v.rows.map((r) => [r.name, r.timer?.seconds])).toEqual([
      ['Coercer T`vala', 1127],
      ['Fippy Darkpaw', 400]
    ])
    expect(v.rows[1]).toMatchObject({ zone: '', kills: 0, key: `timer|${respawnTriggerId('Fippy Darkpaw')}` })
  })
})

describe('the Respawns push (LT-555)', () => {
  const rec = (name: string, lastDeath: number) => ({ zone: ZONE, name, kills: 1, lastDeath, pendingSince: 0, gaps: [], shared: false })
  it('sends the rows that changed and the keys gone, and the page merges them, newest death first', () => {
    const sent = new Map<string, string>()
    const first = respawnView({ a: rec('a goblin', 10), b: rec('a gnoll', 20) }, [], ZONE)
    expect(respawnChanges(first, sent)?.rows.map((r) => r.key)).toEqual(['b', 'a'])
    expect(respawnChanges(first, sent)).toBeNull()
    const later = respawnView({ a: rec('a goblin', 30), c: rec('a bat', 5) }, [], ZONE)
    const changes = respawnChanges(later, sent)!
    expect(changes.rows.map((r) => r.key)).toEqual(['a', 'c'])
    expect(changes.removed).toEqual(['b'])
    expect(mergeRespawns(first, changes).rows.map((r) => [r.key, r.lastDeath])).toEqual([
      ['a', 30],
      ['c', 5]
    ])
    // A whole view replaces what the page had.
    expect(mergeRespawns(first, later)).toBe(later)
  })
})

describe('an estimate one stray gap does not set (LT-736)', () => {
  const rec = (gaps: number[]) => ({ zone: 'Befallen', name: 'A skeleton', kills: gaps.length + 1, lastDeath: 1, pendingSince: 0, gaps, shared: false })

  it('leaves out a gap under half the rest once there are three, and says so on the row', () => {
    // One of the name wandering past 45 s after a kill, against a six-minute respawn.
    expect(respawnEstimate(rec([360, 45, 372, 365]))).toBe(360)
    expect(respawnEstimate(rec([360, 45]))).toBe(45)
    const view = respawnView({ k: rec([360, 45, 372, 365]) }, [], 'Befallen', () => ({ mob: { seconds: 400, from: 'classic' }, zone: 420 }))
    expect(view.rows[0]).toMatchObject({ estimate: 360, dropped: 1, tables: { seconds: 400, from: 'classic' }, zoneTimer: 420 })
  })

  it("takes the tables' timer, then the zone's, where the record has no gap", () => {
    expect(respawnLength({ timer: null, estimate: null, tables: { seconds: 400, from: 'classic' }, zoneTimer: 420 })).toBe(400)
    expect(respawnLength({ timer: null, estimate: null, zoneTimer: 420 })).toBe(420)
    expect(respawnLength({ timer: null, estimate: 360, zoneTimer: 420 })).toBe(360)
    expect(respawnLength({ timer: null, estimate: null })).toBeNull()
  })
})
