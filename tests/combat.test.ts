import { describe, expect, it } from 'vitest'
import { parseCombatLine, parseMods, SELF } from '../src/core/combatLines'
import { CombatMeter, durationMs, fightName, summarize } from '../src/core/combatMeter'
import { attackerRows, copyText, damageRows, defenseOf, healerRows, rolling, skillRows, targetRows, totalsOf } from '../src/core/combatView'
import { parseLogLine } from '../src/core/logLine'
import { at } from './helpers'

// Every line below is copied from a real log (names changed to the test characters).

describe('combat lines', () => {
  const p = parseCombatLine
  it('reads your melee, with its modifiers', () => {
    expect(p('You punch a fetid fiend for 48 points of damage.')).toEqual({ kind: 'damage', source: SELF, target: 'a fetid fiend', amount: 48, how: 'melee', skill: 'punch', mods: [] })
    expect(p('You kick a marsh bear cub for 59 points of damage. (Critical)')).toMatchObject({ mods: ['critical'] })
    expect(p('You punch Amygdalan warrior for 18 points of damage. (Riposte)')).toMatchObject({ target: 'Amygdalan warrior', mods: ['riposte'] })
    expect(p('You punch a fetid fiend for 221 points of damage. (Finishing Blow)')).toMatchObject({ mods: ['finishing blow'] })
    expect(parseMods('Riposte Critical')).toEqual(['riposte', 'critical'])
  })
  it("reads others' melee: pets, players, mobs on you and on others", () => {
    expect(p('Jobarab slashes an ire ghast for 47 points of damage.')).toMatchObject({ kind: 'damage', source: 'Jobarab', target: 'an ire ghast', amount: 47, how: 'melee', skill: 'slashes' })
    expect(p('A forsaken revenant hits YOU for 122 points of damage.')).toMatchObject({ source: 'A forsaken revenant', target: SELF, amount: 122 })
    expect(p('Grandmaster R`tal pet slashes Jobarab for 14 points of damage.')).toMatchObject({ source: 'Grandmaster R`tal pet', target: 'Jobarab' })
    expect(p('An ire ghast hits YOU for 67 points of damage. (Riposte)')).toMatchObject({ mods: ['riposte'] })
    expect(p('Innoruuk`s Chosen punches YOU for 93 points of damage.')).toMatchObject({ source: 'Innoruuk`s Chosen' })
  })
  it('reads misses and every avoidance', () => {
    expect(p('You try to punch a scareling, but miss! (Riposte)')).toEqual({ kind: 'miss', source: SELF, target: 'a scareling', skill: 'punch', outcome: 'miss', mods: ['riposte'] })
    expect(p('A scareling tries to hit YOU, but YOU dodge!')).toMatchObject({ kind: 'miss', source: 'A scareling', target: SELF, outcome: 'dodge' })
    expect(p('A shiverback tries to hit YOU, but YOU block!')).toMatchObject({ outcome: 'block' })
    expect(p('Amygdalan warrior tries to bash YOU, but YOU parry!')).toMatchObject({ outcome: 'parry' })
    expect(p('Amygdalan warrior pet tries to punch YOU, but YOU riposte!')).toMatchObject({ outcome: 'riposte' })
    expect(p('Amygdalan warrior pet tries to kick YOU, but YOUR magical skin absorbs the blow!')).toMatchObject({ outcome: 'absorb' })
    expect(p('You try to punch a fetid fiend, but a fetid fiend parries!')).toMatchObject({ outcome: 'parry', target: 'a fetid fiend' })
    expect(p('You try to bash a loathling lich, but a loathling lich\'s magical skin absorbs the blow!')).toMatchObject({ outcome: 'absorb' })
    expect(p('A snow orc trooper tries to hit YOU, but misses!')).toMatchObject({ outcome: 'miss' })
    expect(p('Merik tries to pierce Cleric of Innoruuk, but Cleric of Innoruuk dodges!')).toMatchObject({ source: 'Merik', target: 'Cleric of Innoruuk', outcome: 'dodge' })
    // A spell being shrugged off is not a swing.
    expect(p('Malrik tries to cast a spell on you, but you are protected.')).toBeNull()
  })
  it('reads direct spells, yours, theirs and on you', () => {
    expect(p('You hit a fetid fiend for 444 points of magic damage by Drain Spirit.')).toEqual({ kind: 'damage', source: SELF, target: 'a fetid fiend', amount: 444, how: 'spell', skill: 'Drain Spirit', mods: [] })
    expect(p('You hit a scareling pet for 2013 points of magic damage by Denon\'s Desperate Dirge. (Critical)')).toMatchObject({ target: 'a scareling pet', skill: "Denon's Desperate Dirge", mods: ['critical'] })
    expect(p('Jobarab hit an ire ghast for 200 points of prismatic damage by Puma Maw V.')).toMatchObject({ source: 'Jobarab', skill: 'Puma Maw V', how: 'spell' })
    expect(p('a fetid fiend hit you for 220 points of fire damage by Scorching Arrow.')).toMatchObject({ source: 'a fetid fiend', target: SELF, amount: 220, skill: 'Scorching Arrow' })
  })
  it('reads DoT ticks, yours, theirs, on you, and unattributed', () => {
    expect(p('Cleric of Innoruuk has taken 499 damage from your Odium X.')).toEqual({ kind: 'damage', source: SELF, target: 'Cleric of Innoruuk', amount: 499, how: 'dot', skill: 'Odium X', mods: [] })
    expect(p('Cleric of Innoruuk has taken 1483 damage from your Odium X. (Critical)')).toMatchObject({ mods: ['critical'] })
    expect(p('A loathling lich has taken 80 damage from Oathbreaker\'s Curse by Jobarab.')).toMatchObject({ source: 'Jobarab', target: 'A loathling lich', amount: 80, skill: "Oathbreaker's Curse" })
    expect(p('You have taken 105 damage from Scorching Arrow by a fetid fiend.')).toMatchObject({ source: 'a fetid fiend', target: SELF, amount: 105, how: 'dot' })
    expect(p('Jobarab has taken 30 damage by Deadly Poison.')).toMatchObject({ source: '', target: 'Jobarab', amount: 30, skill: 'Deadly Poison' })
  })
  it('reads damage shields both ways', () => {
    expect(p('A fetid fiend is pierced by YOUR thorns for 3 points of non-melee damage.')).toMatchObject({ source: SELF, target: 'A fetid fiend', amount: 3, how: 'ds' })
    expect(p('YOU are burned by a fetid fiend\'s flames for 24 points of non-melee damage!')).toMatchObject({ source: 'a fetid fiend', target: SELF, amount: 24, how: 'ds' })
    expect(p('Dorran is burned by a decrepit warder\'s flames for 16 points of non-melee damage.')).toMatchObject({ source: 'a decrepit warder', target: 'Dorran', amount: 16 })
    expect(p('Jobarab is pierced by Coercer T`vala\'s thorns for 19 points of non-melee damage.')).toMatchObject({ source: 'Coercer T`vala', target: 'Jobarab' })
  })
  it('reads heals, with overheal and heals over time', () => {
    expect(p('You healed Kelwyn for 444 hit points by Drain Spirit.')).toEqual({ kind: 'heal', source: SELF, target: 'Kelwyn', amount: 444, raw: 444, spell: 'Drain Spirit', hot: false, mods: [] })
    expect(p('Brenna healed itself for 0 (80) hit points by Oathbreaker\'s Curse.')).toMatchObject({ source: 'Brenna', target: 'Brenna', amount: 0, raw: 80 })
    expect(p('Elowen healed itself for 255 (270) hit points by Skin like Nature.')).toMatchObject({ amount: 255, raw: 270 })
    expect(p('You healed Kelwyn over time for 469 hit points by Slugs Healing. (Critical)')).toMatchObject({ hot: true, mods: ['critical'] })
    expect(p('Lord of Ire healed you for 451 hit points by Leech Touch I.')).toMatchObject({ source: 'Lord of Ire', target: SELF })
    expect(p('a snow orc shaman healed a snow orc trooper for 19 hit points by Inner Fire.')).toMatchObject({ source: 'a snow orc shaman', target: 'a snow orc trooper' })
    expect(p('You gain a rune for 32 points of absorption.')).toEqual({ kind: 'rune', target: SELF, amount: 32 })
  })
  it('reads kills, deaths, resists, pets and the group', () => {
    expect(p('You have slain a forsaken revenant!')).toEqual({ kind: 'kill', target: 'a forsaken revenant', killer: SELF })
    expect(p('A skeleton has been slain by Gabartik!')).toEqual({ kind: 'kill', target: 'A skeleton', killer: 'Gabartik' })
    expect(p('Cleric of Innoruuk died.')).toEqual({ kind: 'kill', target: 'Cleric of Innoruuk', killer: null })
    expect(p('You have been slain by a spinechiller spider!')).toEqual({ kind: 'kill', target: SELF, killer: 'a spinechiller spider' })
    expect(p('A scareling resisted your Selo\'s Chords of Cessation!')).toEqual({ kind: 'resist', source: SELF, target: 'A scareling', spell: "Selo's Chords of Cessation" })
    expect(p('A decrepit warder resisted Dorran\'s Malaria!')).toEqual({ kind: 'resist', source: 'Dorran', target: 'A decrepit warder', spell: 'Malaria' })
    expect(p("Jobarab told you, 'Attacking a forsaken revenant Master.'")).toEqual({ kind: 'pet', pet: 'Jobarab', owner: SELF })
    expect(p("Xanthar says, 'My leader is Aldric.'")).toEqual({ kind: 'pet', pet: 'Xanthar', owner: 'Aldric' })
    expect(p("Aldric tells you, 'hey'")).toBeNull()
    expect(p('Tobin has joined the group.')).toEqual({ kind: 'group', who: 'Tobin', action: 'joined' })
    expect(p('You have been removed from the group.')).toEqual({ kind: 'group', who: SELF, action: 'youLeft' })
    expect(p('You begin casting Envenomed Bolt X.')).toEqual({ kind: 'cast', source: SELF, spell: 'Envenomed Bolt X' })
    expect(p('Jobarab begins casting Malaria.')).toEqual({ kind: 'cast', source: 'Jobarab', spell: 'Malaria' })
  })
  it('leaves other lines alone', () => {
    for (const t of [
      'Your Mithril-Runed Tunic (Exaltation) shimmers briefly.',
      'You have entered The Plane of Fear 4 (Refined).',
      'Jobarab is torn between life and death.',
      'Your target is too far away, get closer!',
      "A kiraikuei's corpse says, 'My form was weak, your style was excellent.  I hate you!'",
      'You regain your concentration and continue your casting.',
      'Master of Spite is rent by a savage maw.'
    ]) {
      expect(p(t), t).toBeNull()
    }
  })
})

function meter(opts: { fightGapSec?: number; newSessionOnZone?: boolean } = {}) {
  const m = new CombatMeter({ fightGapSec: opts.fightGapSec ?? 10, newSessionOnZone: opts.newSessionOnZone ?? true })
  m.setSelf('Kelwyn')
  const feed = (text: string) => {
    for (const raw of text.trim().split('\n')) {
      const line = parseLogLine(raw.trim())
      if (!line) throw new Error(`bad fixture line: ${raw}`)
      m.handle(line)
    }
  }
  return { m, feed }
}

const FIGHT = `
  [Thu Sep 24 20:00:00 2026] You have entered The Plane of Fear 4 (Refined).
  [Thu Sep 24 20:00:05 2026] You begin casting Envenomed Bolt X.
  [Thu Sep 24 20:00:05 2026] You punch a fetid fiend for 100 points of damage.
  [Thu Sep 24 20:00:05 2026] Jobarab slashes a fetid fiend for 40 points of damage.
  [Thu Sep 24 20:00:06 2026] A fetid fiend hits YOU for 50 points of damage.
  [Thu Sep 24 20:00:06 2026] A fetid fiend tries to hit YOU, but YOU dodge!
  [Thu Sep 24 20:00:07 2026] You punch a fetid fiend for 200 points of damage. (Critical)
  [Thu Sep 24 20:00:07 2026] You try to punch a fetid fiend, but miss!
  [Thu Sep 24 20:00:08 2026] Jobarab told you, 'Attacking a fetid fiend Master.'
  [Thu Sep 24 20:00:11 2026] A fetid fiend has taken 300 damage from your Envenomed Bolt X.
  [Thu Sep 24 20:00:11 2026] A fetid fiend is pierced by YOUR thorns for 3 points of non-melee damage.
  [Thu Sep 24 20:00:12 2026] YOU are burned by a fetid fiend's flames for 24 points of non-melee damage!
  [Thu Sep 24 20:00:13 2026] Aldric healed Kelwyn for 150 (200) hit points by Superior Healing.
  [Thu Sep 24 20:00:14 2026] You have slain a fetid fiend!`

describe('CombatMeter', () => {
  it('books one fight from first blow to the kill, per entity and skill', () => {
    const { m, feed } = meter()
    feed(FIGHT)
    expect(m.fights).toHaveLength(1)
    const f = m.fights[0]
    expect(f.open).toBe(false)
    expect(f.name).toBe('A fetid fiend')
    expect(f.zone).toBe('The Plane of Fear 4 (Refined)')
    expect(f.startedAt).toBe(at('Thu Sep 24 20:00:05 2026'))
    expect(f.endedAt).toBe(at('Thu Sep 24 20:00:14 2026'))
    expect(durationMs(f)).toBe(10_000)
    expect(f.kills).toBe(1)
    expect(f.mine).toBe(true)
    const you = f.entities['you']
    expect(you.kind).toBe('you')
    expect(you.out).toEqual({ total: 603, hits: 4, crits: 1, critTotal: 200, max: 300, min: 3 })
    expect(you.skills['punch']).toMatchObject({ how: 'melee', total: 300, hits: 2, crits: 1, misses: 1, mods: { critical: 1 } })
    expect(you.skills['Envenomed Bolt X']).toMatchObject({ how: 'dot', total: 300, hits: 1 })
    expect(you.skills['Damage shield (thorns)']).toMatchObject({ how: 'ds', total: 3 })
    // The cast came before the first blow: the session saw it, the fight had not begun.
    expect(you.casts).toBe(0)
    expect(m.liveSession?.entities['you'].casts).toBe(1)
    expect(you.kills).toBe(1)
    expect(you.in.total).toBe(74)
    expect(you.attackers['A fetid fiend'].total).toBe(74)
    expect(you.defense).toEqual({ swings: 2, hit: 1, miss: 0, dodge: 1, parry: 0, block: 0, riposte: 0, absorb: 0 })
    expect(you.healIn).toMatchObject({ total: 150, raw: 200, count: 1 })
    // Jobarab was a stranger until the pet claim; the claim rewrites what it already did.
    const pet = f.entities['jobarab']
    expect(pet.kind).toBe('pet')
    expect(pet.owner).toBe(SELF)
    expect(pet.out.total).toBe(40)
    const mob = f.entities['a fetid fiend']
    expect(mob.kind).toBe('npc')
    expect(mob.in.total).toBe(643)
    expect(mob.defense).toEqual({ swings: 4, hit: 3, miss: 1, dodge: 0, parry: 0, block: 0, riposte: 0, absorb: 0 })
    expect(f.entities['aldric'].kind).toBe('player')
    expect(f.entities['aldric'].healOut).toMatchObject({ total: 150, raw: 200 })
    // The session holds the same fight, and stays open.
    expect(m.sessions).toHaveLength(1)
    expect(m.liveSession?.open).toBe(true)
    expect(m.liveSession?.entities['you'].out.total).toBe(603)
    expect(m.liveSession?.name).toBe('The Plane of Fear 4 (Refined)')
  })

  it('rows, totals and the copy text', () => {
    const { m, feed } = meter()
    feed(FIGHT)
    const f = m.fights[0]
    const rows = damageRows(f, 'everyone', false)
    expect(rows.map((r) => [r.name, r.total, r.kind])).toEqual([
      ['You', 603, 'you'],
      ['Jobarab', 40, 'pet']
    ])
    expect(rows[0].fill).toBe(1)
    expect(rows[0].share).toBeCloseTo(603 / 643)
    expect(rows[0].dps).toBeCloseTo(60.3)
    const combined = damageRows(f, 'you', true)
    expect(combined).toHaveLength(1)
    expect(combined[0].total).toBe(643)
    expect(combined[0].pets?.[0].name).toBe('Jobarab')
    const skills = skillRows(f, combined[0])
    expect(skills.map((s) => [s.name, s.total])).toEqual([
      ['punch', 300],
      ['Envenomed Bolt X', 300],
      ['Jobarab', 40],
      ['Damage shield (thorns)', 3]
    ])
    expect(targetRows(f, 'everyone')[0]).toMatchObject({ name: 'A fetid fiend', total: 643 })
    expect(attackerRows(f, 'you')[0]).toMatchObject({ name: 'A fetid fiend', total: 74, hits: 2 })
    expect(defenseOf(f, 'you')).toMatchObject({ swings: 2, dodge: 1 })
    expect(healerRows(f, 'everyone')[0]).toMatchObject({ name: 'Aldric', total: 150, raw: 200, overheal: 0.25 })
    expect(totalsOf(f, rows)).toMatchObject({ total: 643, dps: 64.3 })
    expect(copyText(f, 'damage', 'everyone', rows, 'A fetid fiend').split('\n')).toEqual([
      'A fetid fiend · 0:10 · Damage 643 · 64 DPS · everyone',
      '1. You  603 (94%)  60 DPS',
      '2. Jobarab (pet)  40 (6%)  4 DPS'
    ])
    // The summary the pickers list.
    expect(summarize(f)).toMatchObject({ name: 'A fetid fiend', total: 643, yours: 643, kills: 1, mine: true, open: false })
    expect(fightName(f)).toBe('A fetid fiend')
  })

  it('a quiet spell ends the fight; the next blow opens another', () => {
    const { m, feed } = meter({ fightGapSec: 10 })
    feed(`
      [Thu Sep 24 20:00:05 2026] You punch a fetid fiend for 100 points of damage.
      [Thu Sep 24 20:00:09 2026] You punch a fetid fiend for 100 points of damage.
      [Thu Sep 24 20:00:30 2026] You punch a scareling for 100 points of damage.`)
    expect(m.fights.map((f) => [f.name || fightName(f), f.open])).toEqual([
      ['A fetid fiend', false],
      ['A scareling', true]
    ])
    expect(durationMs(m.fights[0])).toBe(5000)
    // The clock ends the second one: the log goes quiet, so a tick must close it.
    m.tick(at('Thu Sep 24 20:00:35 2026'))
    expect(m.fights[1].open).toBe(true)
    m.tick(at('Thu Sep 24 20:00:41 2026'))
    expect(m.fights[1].open).toBe(false)
    expect(m.liveFight).toBeNull()
  })

  it('a fight with two mobs is named after the one that took the most, and ends with the last', () => {
    const { m, feed } = meter()
    feed(`
      [Thu Sep 24 20:00:05 2026] You punch a fetid fiend for 100 points of damage.
      [Thu Sep 24 20:00:06 2026] You punch a scareling for 300 points of damage.
      [Thu Sep 24 20:00:07 2026] You have slain a fetid fiend!`)
    expect(m.liveFight?.open).toBe(true)
    expect(fightName(m.liveFight!)).toBe('A scareling +1')
    feed('[Thu Sep 24 20:00:08 2026] A scareling has been slain by Jobarab!')
    expect(m.liveFight).toBeNull()
    expect(m.fights[0].kills).toBe(2)
    expect(m.fights[0].name).toBe('A scareling +1')
  })

  it('places a stranger by whom they hit, and a named mob by whom it hits', () => {
    const { m, feed } = meter()
    feed(`
      [Thu Sep 24 20:00:05 2026] Dorran pierces a decrepit warder for 46 points of damage.
      [Thu Sep 24 20:00:06 2026] Phoboplasm hits YOU for 120 points of damage.
      [Thu Sep 24 20:00:07 2026] Dorran stings Phoboplasm for 35 points of damage.`)
    const f = m.liveFight!
    expect(f.entities['dorran'].kind).toBe('player')
    expect(f.entities['phoboplasm'].kind).toBe('npc')
    expect(f.entities['dorran'].out.total).toBe(81)
    // Dorran is not you: the meter's own scope leaves them out, Everyone lists them.
    expect(damageRows(f, 'you', true)).toHaveLength(0)
    expect(damageRows(f, 'everyone', true).map((r) => r.name)).toEqual(['Dorran'])
    // A stranger's fight is not marked as yours until you or your pet strike.
    expect(f.mine).toBe(true)
  })

  it('the group: joins and leaves from the log, additions by hand, and the Group scope', () => {
    const { m, feed } = meter()
    feed(`
      [Thu Sep 24 20:00:01 2026] Tobin has joined the group.
      [Thu Sep 24 20:00:05 2026] Tobin slashes a fetid fiend for 40 points of damage.
      [Thu Sep 24 20:00:05 2026] Dorran slashes a fetid fiend for 30 points of damage.
      [Thu Sep 24 20:00:06 2026] You punch a fetid fiend for 100 points of damage.`)
    const f = m.liveFight!
    expect(f.entities['tobin'].kind).toBe('group')
    expect(damageRows(f, 'group', true).map((r) => r.name)).toEqual(['You', 'Tobin'])
    m.addMember('Dorran')
    expect(f.entities['dorran'].kind).toBe('group')
    expect(damageRows(f, 'group', true).map((r) => r.name)).toEqual(['You', 'Tobin', 'Dorran'])
    feed('[Thu Sep 24 20:00:07 2026] Tobin has left the group.')
    expect(f.entities['tobin'].kind).toBe('player')
    expect(m.snapshot().roster).toEqual([{ name: 'Dorran', from: 'you' }])
    feed('[Thu Sep 24 20:00:08 2026] You have been removed from the group.')
    // A member added by hand stays.
    expect(m.snapshot().roster).toEqual([{ name: 'Dorran', from: 'you' }])
  })

  it("a group-mate's pet, once it names its leader, is theirs", () => {
    const { m, feed } = meter()
    feed(`
      [Thu Sep 24 20:00:01 2026] Aldric has joined the group.
      [Thu Sep 24 20:00:05 2026] Xanthar slashes a fetid fiend for 40 points of damage.
      [Thu Sep 24 20:00:06 2026] Xanthar says, 'My leader is Aldric.'
      [Thu Sep 24 20:00:07 2026] Aldric hit a fetid fiend for 10 points of magic damage by Ice Spear.`)
    const f = m.liveFight!
    expect(f.entities['xanthar']).toMatchObject({ kind: 'pet', owner: 'Aldric' })
    const rows = damageRows(f, 'group', true)
    expect(rows.map((r) => [r.name, r.total])).toEqual([['Aldric', 50]])
    expect(rows[0].pets?.[0].name).toBe('Xanthar')
    expect(m.snapshot().otherPets).toEqual({ Xanthar: 'Aldric' })
  })

  it('a zone change closes the fight and starts a session named after the zone', () => {
    const { m, feed } = meter()
    feed(`
      [Thu Sep 24 20:00:00 2026] You have entered The Plane of Fear 4 (Refined).
      [Thu Sep 24 20:00:05 2026] You punch a fetid fiend for 100 points of damage.
      [Thu Sep 24 20:00:06 2026] You have entered The Plane of Hate 2 (Adaptive).
      [Thu Sep 24 20:00:07 2026] You punch a scareling for 100 points of damage.`)
    expect(m.fights.map((f) => f.open)).toEqual([false, true])
    expect(m.sessions.map((s) => [s.name, s.open])).toEqual([
      ['The Plane of Fear 4 (Refined)', false],
      ['The Plane of Hate 2 (Adaptive)', true]
    ])
    expect(m.sessions[1].entities['you'].out.total).toBe(100)
    // Pressing New session splits again, by hand.
    m.newSession(at('Thu Sep 24 20:00:08 2026'))
    expect(m.sessions).toHaveLength(3)
    expect(m.sessions[2].name).toBe('The Plane of Hate 2 (Adaptive)')
    expect(m.snapshot().sessions[0].id).toBe(m.sessions[2].id)
  })

  it('your own name in a line means you; heals do not open a fight; enemy heals are damage undone', () => {
    const { m, feed } = meter()
    feed(`
      [Thu Sep 24 20:00:01 2026] Aldric healed Kelwyn for 150 hit points by Superior Healing.
      [Thu Sep 24 20:00:05 2026] You punch a fetid fiend for 100 points of damage.
      [Thu Sep 24 20:00:06 2026] a fetid fiend healed itself for 60 hit points by Inner Fire.
      [Thu Sep 24 20:00:07 2026] You healed Aldric for 20 hit points by Lifebite.`)
    expect(m.fights).toHaveLength(1)
    const f = m.liveFight!
    expect(f.startedAt).toBe(at('Thu Sep 24 20:00:05 2026'))
    expect(f.enemyHeal).toBe(60)
    expect(f.entities['you'].healOut.total).toBe(20)
    expect(m.liveSession?.entities['you'].healIn.total).toBe(150)
    expect(m.liveSession?.entities['aldric'].kind).toBe('player')
  })

  it('a rolling average for the chart', () => {
    expect(rolling([10, 0, 0, 30], 4, 2)).toEqual([10, 5, 0, 15])
  })

  it('a timeline per second for a fight, and none for a session', () => {
    const { m, feed } = meter()
    feed(FIGHT)
    const tl = m.fights[0].timeline!
    expect(tl.you[0]).toBe(100)
    // Jobarab's first blow came before the line that proved it a pet: the chart keeps it with the rest of your side.
    expect(tl.group[0]).toBe(40)
    expect(tl.pet[0]).toBeUndefined()
    expect(tl.inc[1]).toBe(50)
    expect(tl.you[6]).toBe(303)
    expect(m.sessions[0].timeline).toBeUndefined()
  })

  it('reset forgets everything for a new character', () => {
    const { m, feed } = meter()
    feed(FIGHT)
    m.reset()
    expect(m.snapshot()).toMatchObject({ fights: [], sessions: [], liveFight: null, liveSession: null, pets: [] })
  })
})
