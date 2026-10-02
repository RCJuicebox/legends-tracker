import { describe, expect, it } from 'vitest'
import { CombatMeter } from '../../src/core/combatMeter'
import { parseLogLine } from '../../src/core/logLine'
import { compilePhrase } from '../../src/core/triggers'
import {
  RespawnLog,
  respawnEstimate,
  respawnKey,
  respawnPhrase,
  respawnTimerSpec,
  respawnTrigger,
  respawnTriggerId,
  respawnView,
  type RespawnRecords
} from '../../src/core/respawns'
import type { Trigger } from '../../src/shared/types'

// Line shapes copied from the log (September 2026); times moved to make the gaps.

const ZONE = 'The Plane of Hate 50 (Refined)'

/** The engine's order: the meter reads each line, then the respawn log gets the meter's event. */
function feed(records: RespawnRecords = {}) {
  const meter = new CombatMeter({ fightGapSec: 10, newSessionOnZone: true })
  meter.setSelf('Kelwyn')
  let changes = 0
  const log = new RespawnLog(records, { onChange: () => changes++, kindOf: (n) => meter.kindOf(n).kind })
  const run = (lines: string) => {
    for (const raw of lines.split('\n').filter((l) => l.trim())) {
      const line = parseLogLine(raw.trim())
      if (!line) throw new Error(`not a log line: ${raw}`)
      const ev = meter.handle(line)
      log.handle(line, meter.currentZone || ZONE, ev)
    }
  }
  return { log, run, records, changes: () => changes }
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
    expect(f.log.namesOf("boog mudtoe's SPAWN")).toEqual(['A seafury cyclops', 'An aqua goblin', 'Boog Mudtoe'])
    expect(f.log.namesOf('Boog Mudtoe')).toBeNull()
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
