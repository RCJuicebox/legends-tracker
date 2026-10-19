import { describe, expect, it } from 'vitest'
import { at, harness, exampleShaman } from '../helpers'
import { timerKey } from '../../src/core/spellTracker'
import { parseLogLine } from '../../src/core/logLine'

// Every sequence below is copied from Kelwyn's real log.

describe('DoT tracking', () => {
  const lifecycle = `
    [Tue Sep 01 12:15:08 2026] You begin casting Envenomed Bolt X.
    [Tue Sep 01 12:15:09 2026] Bazzt Zzzt has been poisoned.`

  it('starts a timer on the landing line, estimating the end until a tick is seen', () => {
    const h = harness()
    h.feed(lifecycle)
    const t = h.board.get(timerKey('Envenomed Bolt', 'Bazzt Zzzt'))!
    expect(t).toBeDefined()
    expect(t.rank).toBe(10)
    expect(t.exact).toBe(false)
    // 10 ticks: wears off 54–60s after landing; until a tick pins it, the bar aims at the earliest.
    expect(t.endsAt - at('Tue Sep 01 12:15:09 2026')).toBe(54_000)
  })

  it('pins the end exactly from the first tick, and the real fade lands on it', () => {
    const h = harness()
    h.feed(lifecycle)
    h.feed('[Tue Sep 01 12:15:14 2026] Bazzt Zzzt has taken 489 damage from your Envenomed Bolt X.')
    const t = h.board.get(timerKey('Envenomed Bolt', 'Bazzt Zzzt'))!
    expect(t.exact).toBe(true)
    // The log's own fade line for this cast is at 12:16:08.
    expect(t.endsAt).toBe(at('Tue Sep 01 12:16:08 2026'))
    h.feed('[Tue Sep 01 12:15:20 2026] Bazzt Zzzt has taken 462 damage from your Envenomed Bolt X.')
    // The recast cue comes exactly 12 seconds before the real fade: at 12:15:56, not before.
    h.feed('[Tue Sep 01 12:15:55 2026] Bazzt Zzzt has taken 476 damage from your Envenomed Bolt X.')
    expect(h.spoken).toEqual([])
    h.feed('[Tue Sep 01 12:15:56 2026] Kelwyn hits Bazzt Zzzt for 200 points of damage.')
    expect(h.spoken).toEqual(['Recast Envenomed Bolt'])
    h.feed(`
      [Tue Sep 01 12:16:08 2026] Bazzt Zzzt has taken 543 damage from your Envenomed Bolt X.
      [Tue Sep 01 12:16:08 2026] Your Envenomed Bolt spell has worn off of Bazzt Zzzt.`)
    expect(h.board.list()).toHaveLength(0)
    expect(h.spoken).toEqual(['Recast Envenomed Bolt', 'Envenomed Bolt off'])
  })

  it('joins a DoT already running when only its ticks are seen', () => {
    const h = harness()
    h.feed('[Tue Sep 01 12:15:14 2026] Bazzt Zzzt has taken 489 damage from your Envenomed Bolt X.')
    const t = h.board.get(timerKey('Envenomed Bolt', 'Bazzt Zzzt'))!
    expect(t.exact).toBe(false)
    expect(t.endsAt).toBe(at('Tue Sep 01 12:16:08 2026'))
  })

  it('ends every timer on a target when it dies, regardless of capitalisation', () => {
    const h = harness()
    h.feed(`
      [Sat Sep 12 23:11:04 2026] You begin casting Envenomed Bolt X.
      [Sat Sep 12 23:11:04 2026] A ratman warrior has been poisoned.
      [Sat Sep 12 23:11:07 2026] You begin casting Odium X.
      [Sat Sep 12 23:11:07 2026] A ratman warrior staggers under a dark curse.`)
    expect(h.board.list()).toHaveLength(2)
    h.feed('[Sat Sep 12 23:11:30 2026] You have slain a ratman warrior!')
    expect(h.board.list()).toHaveLength(0)
  })

  it('only credits landings to spells you are casting', () => {
    const h = harness()
    h.feed(`
      [Sat Sep 12 23:11:04 2026] Corvin begins casting Odium V.
      [Sat Sep 12 23:11:05 2026] Innoruuk\`s Chosen staggers under a dark curse.`)
    expect(h.board.list()).toHaveLength(0)
  })

  it('pins the end from a first tick that crits', () => {
    const h = harness()
    h.feed(lifecycle)
    h.feed('[Tue Sep 01 12:15:14 2026] Bazzt Zzzt has taken 1,534 damage from your Envenomed Bolt X. (Critical)')
    const t = h.board.get(timerKey('Envenomed Bolt', 'Bazzt Zzzt'))!
    expect(t.exact).toBe(true)
    expect(t.endsAt).toBe(at('Tue Sep 01 12:16:08 2026'))
    // The bar says what a tick does (LT-728).
    expect(h.board.views()[0].tickDamage).toBe(1534)
  })

  it('drops a cast the target resisted, the way Legends prints it, and says so', () => {
    const h = harness()
    h.feed(`
      [Fri Sep 25 21:00:02 2026] You begin casting Envenomed Bolt X.
      [Fri Sep 25 21:00:03 2026] A ratman warrior resisted your Envenomed Bolt X!
      [Fri Sep 25 21:00:04 2026] A ratman warrior has been poisoned.`)
    expect(h.board.list()).toHaveLength(0)
    expect(h.feedItems).toContainEqual(['info', 'Envenomed Bolt X resisted'])
  })

  it('says nothing of a resist of a spell you did not cast: a proc', () => {
    const h = harness()
    h.feed(`
      [Fri Sep 25 21:00:02 2026] Lord of Ire resisted your Blade Dance II!
      [Fri Sep 25 21:00:10 2026] You begin casting Envenomed Bolt X.
      [Fri Sep 25 21:00:30 2026] A ratman warrior resisted your Envenomed Bolt X!`)
    // The second: the cast was twenty seconds before, long since landed or not.
    expect(h.feedItems.filter(([k, t]) => k === 'info' && t.endsWith('resisted'))).toEqual([])
  })

  it('drops a cast that is interrupted or resisted', () => {
    const h = harness()
    h.feed(`
      [Sat Sep 12 23:11:04 2026] You begin casting Envenomed Bolt X.
      [Sat Sep 12 23:11:05 2026] Your Envenomed Bolt spell is interrupted.
      [Sat Sep 12 23:11:05 2026] A ratman warrior has been poisoned.`)
    expect(h.board.list()).toHaveLength(0)
  })

  it('drops a cast that did not take hold, as Legends prints it with what blocked it (LT-516)', () => {
    const h = harness()
    h.feed(`
      [Sat Sep 12 23:11:04 2026] You begin casting Envenomed Bolt X.
      [Sat Sep 12 23:11:05 2026] Your Envenomed Bolt X spell did not take hold on a ratman warrior. (Blocked by Envenomed Bolt X.)
      [Sat Sep 12 23:11:05 2026] A ratman warrior has been poisoned.`)
    expect(h.board.list()).toHaveLength(0)
  })

  it('leaves a cast in flight alone when a later attempt is refused (LT-517)', () => {
    const h = harness()
    h.feed(`
      [Sat Sep 12 23:11:04 2026] You begin casting Envenomed Bolt X.
      [Sat Sep 12 23:11:06 2026] Insufficient Mana to cast this spell!
      [Sat Sep 12 23:11:06 2026] You can't cast spells while stunned!
      [Sat Sep 12 23:11:07 2026] A ratman warrior has been poisoned.`)
    expect(h.board.list().map((t) => t.label)).toEqual(['Envenomed Bolt'])
  })

  it('drops a cast refused in the second it began', () => {
    const h = harness()
    h.feed(`
      [Sat Sep 12 23:11:04 2026] You begin casting Envenomed Bolt X.
      [Sat Sep 12 23:11:04 2026] Insufficient Mana to cast this spell!
      [Sat Sep 12 23:11:05 2026] A ratman warrior has been poisoned.`)
    expect(h.board.list()).toHaveLength(0)
  })

  it('drops a detrimental cast that did not take hold on its target, named', () => {
    const h = harness()
    h.feed(`
      [Sat Sep 12 23:11:04 2026] You begin casting Envenomed Bolt X.
      [Sat Sep 12 23:11:05 2026] Your Envenomed Bolt X spell did not take hold on a ratman warrior.
      [Sat Sep 12 23:11:05 2026] A ratman warrior has been poisoned.`)
    expect(h.board.list()).toHaveLength(0)
  })

  it('ends a timer when the log says the spell was overwritten, and does not cue its recast', () => {
    const h = harness()
    h.feed(`
      [Tue Sep 01 12:15:08 2026] You begin casting Envenomed Bolt X.
      [Tue Sep 01 12:15:09 2026] Bazzt Zzzt has been poisoned.
      [Tue Sep 01 12:15:30 2026] Your Envenomed Bolt spell on Bazzt Zzzt has been overwritten.`)
    expect(h.board.get(timerKey('Envenomed Bolt', 'Bazzt Zzzt'))).toBeUndefined()
    expect(h.feedItems).toContainEqual(['fade', 'Envenomed Bolt on Bazzt Zzzt was overwritten'])
    h.feed('[Tue Sep 01 12:16:00 2026] Kelwyn hits Bazzt Zzzt for 200 points of damage.')
    expect(h.spoken).toEqual([])
  })

  it('keeps a timer your own recast started in the second its old one was overwritten', () => {
    const h = harness()
    h.feed(`
      [Tue Sep 01 12:15:08 2026] You begin casting Envenomed Bolt X.
      [Tue Sep 01 12:15:09 2026] Bazzt Zzzt has been poisoned.
      [Tue Sep 01 12:15:40 2026] You begin casting Envenomed Bolt X.
      [Tue Sep 01 12:15:41 2026] Bazzt Zzzt has been poisoned.
      [Tue Sep 01 12:15:41 2026] Your Envenomed Bolt spell on Bazzt Zzzt has been overwritten.`)
    const t = h.board.get(timerKey('Envenomed Bolt', 'Bazzt Zzzt'))!
    expect(t).toBeDefined()
    expect(t.startedAt).toBe(at('Tue Sep 01 12:15:41 2026'))
  })
})

describe('self buff tracking', () => {
  it('tracks Spirit of the Puma X on you, warns before it ends, and announces the fade', () => {
    // Kelwyn's focus: Spell Casting Reinforcement 50% + Extended Enhancement II 10.5% (decayed at
    // level 50), so 10 x 2.0 x 1.605 = 32 ticks, wearing off 192-198s after landing. This cast landed
    // 13:29:06 and faded 13:32:22, 196s later.
    const h = harness({ character: exampleShaman(), rules: { 'Spirit of the Puma': { alias: 'Puma' } } })
    h.feed(`
      [Wed Sep 23 13:29:05 2026] You begin casting Spirit of the Puma X.
      [Wed Sep 23 13:29:06 2026] You begin to snarl as your features become feline.`)
    const t = h.board.get(timerKey('Spirit of the Puma', 'You'))!
    expect(t.label).toBe('Puma')
    // The bar aims at the earliest it can wear off, 13:32:18 (192s after landing); the 12-second cue
    // comes at 13:32:06. The real fade was 13:32:22.
    expect((t.endsAt - t.startedAt) / 1000).toBe(192)
    h.feed('[Wed Sep 23 13:32:05 2026] Brenna hits a ratman warrior for 55 points of damage.')
    expect(h.spoken).toEqual([])
    h.feed('[Wed Sep 23 13:32:06 2026] Brenna hits a ratman warrior for 55 points of damage.')
    expect(h.spoken).toEqual(['Recast Puma'])
    h.feed('[Wed Sep 23 13:32:22 2026] The spirit of the puma departs.')
    expect(h.board.list()).toHaveLength(0)
    expect(h.spoken).toEqual(['Recast Puma', 'Puma down'])
  })

  it('keeps buffs through a zone change but clears DoTs', () => {
    const h = harness()
    h.feed(`
      [Wed Sep 23 13:29:05 2026] You begin casting Spirit of the Puma X.
      [Wed Sep 23 13:29:06 2026] You begin to snarl as your features become feline.
      [Wed Sep 23 13:29:10 2026] You begin casting Envenomed Bolt X.
      [Wed Sep 23 13:29:11 2026] A ratman warrior has been poisoned.
      [Wed Sep 23 13:29:40 2026] You have entered Neriak - Commons.`)
    expect(h.board.list().map((t) => t.spell)).toEqual(['Spirit of the Puma'])
    expect(h.tracker.currentZone).toBe('Neriak - Commons')
  })

  it('says when one target resists three of your spells in a row, once until it dies (LT-722)', () => {
    const h = harness()
    const resist = (t: string) => `
      [${t}] You begin casting Envenomed Bolt X.
      [${t}] A ratman warrior resisted your Envenomed Bolt X!`
    h.feed(resist('Sat Sep 12 23:11:04 2026') + resist('Sat Sep 12 23:11:08 2026'))
    // A landing between starts the count again.
    h.feed(`
      [Sat Sep 12 23:11:12 2026] You begin casting Envenomed Bolt X.
      [Sat Sep 12 23:11:13 2026] A ratman warrior has been poisoned.`)
    h.feed(resist('Sat Sep 12 23:11:20 2026') + resist('Sat Sep 12 23:11:24 2026'))
    expect(h.spoken).toEqual([])
    h.feed(resist('Sat Sep 12 23:11:28 2026') + resist('Sat Sep 12 23:11:32 2026'))
    expect(h.spoken).toEqual(['Three resists in a row on A ratman warrior'])
    h.feed('[Sat Sep 12 23:11:40 2026] You have slain a ratman warrior!')
    h.feed(resist('Sat Sep 12 23:12:04 2026') + resist('Sat Sep 12 23:12:08 2026') + resist('Sat Sep 12 23:12:12 2026'))
    expect(h.spoken).toEqual(['Three resists in a row on A ratman warrior', 'Three resists in a row on A ratman warrior'])
  })

  it('says which lines it read, a pet recourse fading with no timer among them (FEAT-025, LT-729)', () => {
    const h = harness()
    const read = (text: string) => h.tracker.handle(parseLogLine(`[Tue Oct 06 12:10:01 2026] ${text}`)!)
    expect(read("Your pet's Oathbreaker's Curse Recourse spell has worn off.")).toBe(true)
    expect(read('You begin casting Spirit of the Puma X.')).toBe(true)
    expect(read('You begin to snarl as your features become feline.')).toBe(true)
    expect(read('The spirit of the puma departs.')).toBe(true)
    expect(read('Your target is too far away, get closer!')).toBe(false)
  })

  it('holds a buff still while the zone loads: the silence before "You have entered" (LT-718)', () => {
    const h = harness()
    h.feed(`
      [Tue Oct 06 12:10:01 2026] You begin casting Spirit of the Puma X.
      [Tue Oct 06 12:10:02 2026] You begin to snarl as your features become feline.
      [Tue Oct 06 12:10:38 2026] Kelwyn says, 'ready'`)
    const before = h.board.get(timerKey('Spirit of the Puma', 'You'))!.endsAt
    h.feed('[Tue Oct 06 12:10:52 2026] You have entered The Ruins of Old Paineel.')
    expect(h.board.get(timerKey('Spirit of the Puma', 'You'))!.endsAt - before).toBe(14_000)
    // An idle hour then a zone is not an hour's load.
    h.feed(`
      [Tue Oct 06 12:11:52 2026] Kelwyn says, 'back'
      [Tue Oct 06 12:12:58 2026] You have entered Neriak - Commons.`)
    expect(h.board.get(timerKey('Spirit of the Puma', 'You'))!.endsAt - before).toBe(74_000)
  })

  it('tracks a buff cast on another player and ends it on the worn-off line', () => {
    const h = harness()
    h.feed(`
      [Wed Sep 23 13:29:05 2026] You begin casting Slugs Healing V.
      [Wed Sep 23 13:29:06 2026] Aldric is healed by the spirit of the slug.`)
    expect(h.board.get(timerKey('Slugs Healing', 'Aldric'))).toBeDefined()
    h.feed('[Wed Sep 23 13:30:02 2026] Your Slugs Healing spell has worn off of Aldric.')
    expect(h.board.list()).toHaveLength(0)
  })

  it('clears a ticked DoT soon after its exact end even without a worn-off line (Harm Touch prints none)', () => {
    const h = harness()
    h.feed(`
      [Tue Sep 01 12:15:08 2026] You begin casting Envenomed Bolt X.
      [Tue Sep 01 12:15:09 2026] Bazzt Zzzt has been poisoned.
      [Tue Sep 01 12:15:14 2026] Bazzt Zzzt has taken 489 damage from your Envenomed Bolt X.
      [Tue Sep 01 12:16:10 2026] Kelwyn hits a ratman warrior for 55 points of damage.`)
    expect(h.board.list()).toHaveLength(1)
    h.feed('[Tue Sep 01 12:16:11 2026] Kelwyn hits a ratman warrior for 55 points of damage.')
    expect(h.board.list()).toHaveLength(0)
  })

  it('keeps the timer but drops the recast warning and fade announcement when switched off', () => {
    const h = harness({ character: exampleShaman(), rules: { 'Spirit of the Puma': { alias: 'Puma', recastCue: false, fadeCue: false } } })
    h.feed(`
      [Wed Sep 23 13:29:05 2026] You begin casting Spirit of the Puma X.
      [Wed Sep 23 13:29:06 2026] You begin to snarl as your features become feline.`)
    expect(h.board.get(timerKey('Spirit of the Puma', 'You'))).toBeDefined()
    h.feed(`
      [Wed Sep 23 13:32:10 2026] Brenna hits a ratman warrior for 55 points of damage.
      [Wed Sep 23 13:32:22 2026] The spirit of the puma departs.`)
    expect(h.board.list()).toHaveLength(0)
    expect(h.spoken).toEqual([])
  })

  it('respects a rule that turns a spell off', () => {
    const h = harness({ rules: { 'Spirit of the Puma': { track: false } } })
    h.feed(`
      [Wed Sep 23 13:29:05 2026] You begin casting Spirit of the Puma X.
      [Wed Sep 23 13:29:06 2026] You begin to snarl as your features become feline.`)
    expect(h.board.list()).toHaveLength(0)
  })
})

describe('more tracking rules', () => {
  it('starts a timer on every group member a buff lands on within the group window, and no later', () => {
    const h = harness()
    h.feed(`
      [Wed Sep 23 13:29:05 2026] You begin casting Slugs Healing V.
      [Wed Sep 23 13:29:06 2026] Aldric is healed by the spirit of the slug.
      [Wed Sep 23 13:29:06 2026] Brenna is healed by the spirit of the slug.
      [Wed Sep 23 13:29:08 2026] Corvin is healed by the spirit of the slug.`)
    expect(
      h.board
        .list()
        .map((t) => t.target)
        .sort()
    ).toEqual(['Aldric', 'Brenna'])
  })

  it("ends the buff on your pet when the pet's buff wears off, not a groupmate's of the same spell (LT-514)", () => {
    const h = harness({ yourPets: ['Gabobn'] })
    h.feed(`
      [Wed Sep 23 13:29:05 2026] You begin casting Slugs Healing V.
      [Wed Sep 23 13:29:06 2026] Gabobn is healed by the spirit of the slug.
      [Wed Sep 23 13:29:15 2026] You begin casting Slugs Healing V.
      [Wed Sep 23 13:29:16 2026] Brenna is healed by the spirit of the slug.
      [Wed Sep 23 13:29:30 2026] Your pet's Slugs Healing spell has worn off.`)
    expect(h.board.list().map((t) => t.target)).toEqual(['Brenna'])
  })

  it("ends nothing on a pet's fade while the roster does not know the pet", () => {
    const h = harness()
    h.feed(`
      [Wed Sep 23 13:29:15 2026] You begin casting Slugs Healing V.
      [Wed Sep 23 13:29:16 2026] Brenna is healed by the spirit of the slug.
      [Wed Sep 23 13:29:30 2026] Your pet's Slugs Healing spell has worn off.`)
    expect(h.board.list().map((t) => t.target)).toEqual(['Brenna'])
  })

  it('ends your own buffs when you die, and leaves those on others', () => {
    const h = harness()
    h.feed(`
      [Wed Sep 23 13:29:05 2026] You begin casting Spirit of the Puma X.
      [Wed Sep 23 13:29:06 2026] You begin to snarl as your features become feline.
      [Wed Sep 23 13:29:10 2026] You begin casting Slugs Healing V.
      [Wed Sep 23 13:29:11 2026] Aldric is healed by the spirit of the slug.
      [Wed Sep 23 13:29:40 2026] You died.`)
    expect(h.board.list().map((t) => t.target)).toEqual(['Aldric'])
  })

  it('keeps at most six casts waiting to land, dropping the oldest', () => {
    const casts = (bolts: number) =>
      [
        '[Sat Sep 12 23:11:04 2026] You begin casting Odium X.',
        ...Array(bolts).fill('[Sat Sep 12 23:11:04 2026] You begin casting Envenomed Bolt X.'),
        '[Sat Sep 12 23:11:05 2026] A ratman warrior staggers under a dark curse.'
      ].join('\n')
    const kept = harness()
    kept.feed(casts(5))
    expect(kept.board.list().map((t) => t.spell)).toEqual(['Odium'])
    const dropped = harness()
    dropped.feed(casts(6))
    expect(dropped.board.list()).toEqual([])
  })
})

describe("anyone's casts (a rule with others)", () => {
  const others = { 'Envenomed Bolt': { others: true } }

  it("times another player's cast from their cast and the landing line, with their name, and says who and how long", () => {
    const h = harness({ rules: others })
    h.feed(`
      [Sat Sep 12 23:11:04 2026] Corvin begins casting Envenomed Bolt X.
      [Sat Sep 12 23:11:05 2026] A ratman warrior has been poisoned.`)
    const t = h.board.get(timerKey('Envenomed Bolt', 'A ratman warrior'))!
    expect(t.label).toBe('Envenomed Bolt')
    expect(t.caster).toBe('Corvin')
    expect(t.rank).toBe(10)
    expect(t.endsAt - at('Sat Sep 12 23:11:05 2026')).toBe(54_000)
    expect(h.spoken).toEqual(['Corvin cast Envenomed Bolt on A ratman warrior, do not cast for 54 seconds'])
  })

  it('joins from their tick when the cast was missed, pins the end on the tick, and says nothing of recasting', () => {
    const h = harness({ rules: others })
    h.feed('[Sat Sep 12 23:11:10 2026] A ratman warrior has taken 489 damage from Envenomed Bolt X by Corvin.')
    const t = h.board.get(timerKey('Envenomed Bolt', 'A ratman warrior'))!
    // Joined at a tick: the end is the last tick's, 9 ticks on, held as an estimate as your own joined DoT is.
    expect(t.endsAt).toBe(at('Sat Sep 12 23:12:04 2026'))
    expect(t.warnSec).toBe(0)
    expect(h.board.views()[0]).toMatchObject({ caster: 'Corvin', tickDamage: 489 })
    expect(h.spoken).toEqual(['Corvin cast Envenomed Bolt on A ratman warrior, do not cast for 54 seconds'])
    h.feed('[Sat Sep 12 23:12:20 2026] A ratman warrior hits Kelwyn for 10 points of damage.')
    expect(h.board.list()).toEqual([])
    expect(h.spoken).toEqual(['Corvin cast Envenomed Bolt on A ratman warrior, do not cast for 54 seconds'])
  })

  it("uses the rule's own words, and the target dying ends it", () => {
    const h = harness({ rules: { 'Envenomed Bolt': { others: true, othersSpeech: '{caster} bolted {target}, hold {seconds}' } } })
    h.feed(`
      [Sat Sep 12 23:11:04 2026] Corvin begins casting Envenomed Bolt X.
      [Sat Sep 12 23:11:05 2026] A ratman warrior has been poisoned.
      [Sat Sep 12 23:11:30 2026] A ratman warrior has been slain by Corvin!`)
    expect(h.spoken).toEqual(['Corvin bolted A ratman warrior, hold 54'])
    expect(h.board.list()).toEqual([])
  })

  it("ignores a mob's cast and ticks, and anyone's without the rule", () => {
    const h = harness({ rules: others })
    h.feed(`
      [Sat Sep 12 23:11:04 2026] A ratman shaman begins casting Envenomed Bolt X.
      [Sat Sep 12 23:11:05 2026] Kelwyn has been poisoned.
      [Sat Sep 12 23:11:10 2026] Kelwyn has taken 89 damage from Envenomed Bolt X by a ratman shaman.`)
    expect(h.board.list()).toEqual([])
    const plain = harness()
    plain.feed(`
      [Sat Sep 12 23:11:04 2026] Corvin begins casting Envenomed Bolt X.
      [Sat Sep 12 23:11:05 2026] A ratman warrior has been poisoned.
      [Sat Sep 12 23:11:10 2026] A ratman warrior has taken 489 damage from Envenomed Bolt X by Corvin.`)
    expect(plain.board.list()).toEqual([])
    expect(plain.spoken).toEqual([])
  })

  it("takes a pet the damage meter knows for no player, and a cast that lands on you for no player's (LT-504)", () => {
    // A pet's name is one word like a player's: "Vonartik begins casting", and its ticks "by Vonartik".
    const h = harness({ rules: others, pets: ['Vonartik'] })
    h.feed(`
      [Sat Sep 12 23:11:04 2026] Vonartik begins casting Envenomed Bolt X.
      [Sat Sep 12 23:11:05 2026] A ratman warrior has been poisoned.
      [Sat Sep 12 23:11:10 2026] A ratman warrior has taken 89 damage from Envenomed Bolt X by Vonartik.`)
    expect(h.board.list()).toEqual([])
    expect(h.spoken).toEqual([])
    // A player never lands a DoT on you: what does is a mob, whatever the log calls it.
    const you = harness({ rules: others })
    you.feed(`
      [Sat Sep 12 23:11:04 2026] Corvin begins casting Envenomed Bolt X.
      [Sat Sep 12 23:11:05 2026] You have been poisoned.
      [Sat Sep 12 23:11:10 2026] You have taken 89 damage from Envenomed Bolt X by Corvin.`)
    expect(you.board.list()).toEqual([])
    expect(you.spoken).toEqual([])
  })

  it('shares the bar with your own cast: yours replaces theirs on the same target', () => {
    const h = harness({ rules: others })
    h.feed(`
      [Sat Sep 12 23:11:04 2026] Corvin begins casting Envenomed Bolt X.
      [Sat Sep 12 23:11:05 2026] A ratman warrior has been poisoned.
      [Sat Sep 12 23:11:20 2026] You begin casting Envenomed Bolt X.
      [Sat Sep 12 23:11:21 2026] A ratman warrior has been poisoned.`)
    const list = h.board.list()
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('Envenomed Bolt')
    expect(list[0].startedAt).toBe(at('Sat Sep 12 23:11:21 2026'))
  })
})

describe('Quick Buff (LT-503)', () => {
  // Legends' Quick Buff prints "You activate Quick Buff." and then only the landings: no "You begin casting".
  const activation = `
    [Thu Sep 24 11:03:02 2026] You activate Quick Buff.
    [Thu Sep 24 11:03:05 2026] You begin to snarl as your features become feline.
    [Thu Sep 24 11:03:05 2026] Vonartik growls with the spirit of the puma.`

  it('times a landing of a buff you cast as your own cast, on you and on others, and counts the cast once', () => {
    const h = harness({ quickBuffs: ['Spirit of the Puma'] })
    h.feed(activation)
    const mine = h.board.get(timerKey('Spirit of the Puma', 'You'))!
    expect(mine).toBeDefined()
    expect(mine.label).toBe('Spirit of the Puma')
    expect(mine.meta?.caster).toBeUndefined()
    expect(h.board.get(timerKey('Spirit of the Puma', 'Vonartik'))).toBeDefined()
    expect(h.casts).toEqual(['Spirit of the Puma'])
  })

  it('takes landings for fifteen seconds only, and only of the buffs you cast', () => {
    const late = harness({ quickBuffs: ['Spirit of the Puma'] })
    late.feed(`
      [Thu Sep 24 11:03:02 2026] You activate Quick Buff.
      [Thu Sep 24 11:03:30 2026] You begin to snarl as your features become feline.`)
    expect(late.board.list()).toEqual([])
    expect(late.casts).toEqual([])
    // No buff of yours known: someone else's Puma landing on you is theirs.
    const none = harness()
    none.feed(activation)
    expect(none.board.list()).toEqual([])
  })
})

describe('bard songs', () => {
  it("runs a song's timer on with each pulse, so it does not run out while the song plays (LT-521)", () => {
    const h = harness()
    h.feed(`
      [Thu Sep 24 11:18:46 2026] You begin singing Selo's Accelerating Chorus.
      [Thu Sep 24 11:18:48 2026] Your feet move faster.`)
    const key = timerKey("Selo's Accelerating Chorus", 'You')
    const first = h.board.get(key)!
    const span = first.endsAt - first.startedAt
    h.feed(`
      [Thu Sep 24 11:18:55 2026] Your feet move faster.
      [Thu Sep 24 11:19:01 2026] Your feet move faster.`)
    const t = h.board.get(key)!
    expect(t.startedAt).toBe(at('Thu Sep 24 11:19:01 2026'))
    expect(t.endsAt).toBe(at('Thu Sep 24 11:19:01 2026') + span)
    // One feed line for the song, not one a pulse.
    expect(h.feedItems.filter(([k]) => k === 'timer')).toHaveLength(1)
  })
})

describe('a fixed duration on a DoT (LT-515)', () => {
  it('pins the end at the override after the first tick', () => {
    const h = harness({ rules: { Odium: { durationOverrideSec: 48 } } })
    h.feed(`
      [Sat Sep 12 23:11:07 2026] You begin casting Odium X.
      [Sat Sep 12 23:11:07 2026] A ratman warrior staggers under a dark curse.
      [Sat Sep 12 23:11:10 2026] A ratman warrior has taken 300 damage from your Odium X.`)
    expect(h.board.get(timerKey('Odium', 'a ratman warrior'))!.endsAt).toBe(at('Sat Sep 12 23:11:10 2026') + 48_000)
  })
})

describe('mez and charm (LT-713, LT-714)', () => {
  // Mesmerize: formula 7 capped at 4 ticks, 24 s at level 50. The landing and fade lines are the client's own.
  const mez = `
    [Tue Sep 01 12:20:00 2026] You begin casting Mesmerize.
    [Tue Sep 01 12:20:01 2026] a gnoll pup has been mesmerized.`

  it('warns before a mez ends, naming the target, with the mez and charm default', () => {
    const h = harness()
    h.feed(mez)
    const t = h.board.get(timerKey('Mesmerize', 'a gnoll pup'))!
    expect(t.category).toBe('mez')
    expect(t.warnSec).toBe(12)
    expect(t.endsAt - at('Tue Sep 01 12:20:01 2026')).toBe(24_000)
    h.feed('[Tue Sep 01 12:20:13 2026] Kelwyn hits a gnoll pup for 10 points of damage.')
    expect(h.spoken).toEqual(['Recast Mesmerize on a gnoll pup'])
    expect(h.notified[0]).toMatchObject({ interrupt: false })
    expect(h.notified[0].urgent).toBeFalsy()
  })

  it('says a mez that ends a tick or more early broke, at once and ahead of everything waiting', () => {
    const h = harness()
    h.feed(mez)
    h.feed('[Tue Sep 01 12:20:06 2026] Your Mesmerize spell has worn off of a gnoll pup.')
    expect(h.board.list()).toHaveLength(0)
    expect(h.notified).toEqual([{ kind: 'speak', text: 'Mesmerize broke on a gnoll pup', interrupt: true, urgent: true }])
    expect(h.feedItems.at(-1)).toEqual(['fade', 'Mesmerize broke on a gnoll pup'])
  })

  it('says a mez that ran its course wore off, as a DoT does', () => {
    const h = harness()
    h.feed(mez)
    h.feed('[Tue Sep 01 12:20:14 2026] Kelwyn hits a gnoll pup for 10 points of damage.')
    h.feed('[Tue Sep 01 12:20:25 2026] Your Mesmerize spell has worn off of a gnoll pup.')
    expect(h.spoken).toEqual(['Recast Mesmerize on a gnoll pup', 'Mesmerize off'])
    expect(h.notified[1].urgent).toBeFalsy()
  })

  it('does the same for a charm', () => {
    const h = harness()
    h.feed(`
      [Tue Sep 01 12:30:00 2026] You begin casting Allure.
      [Tue Sep 01 12:30:01 2026] a gnoll pup has been charmed.`)
    const t = h.board.get(timerKey('Allure', 'a gnoll pup'))!
    expect(t.category).toBe('charm')
    expect(t.warnSec).toBe(12)
    h.feed('[Tue Sep 01 12:30:20 2026] Your Allure spell has worn off of a gnoll pup.')
    expect(h.notified).toEqual([{ kind: 'speak', text: 'Allure broke on a gnoll pup', interrupt: true, urgent: true }])
  })

  it('keeps a rule that turns the cues off, and one with its own words', () => {
    const quiet = harness({ rules: { Mesmerize: { recastCue: false, fadeCue: false } } })
    quiet.feed(mez)
    quiet.feed('[Tue Sep 01 12:20:06 2026] Your Mesmerize spell has worn off of a gnoll pup.')
    expect(quiet.spoken).toEqual([])
    const own = harness({ rules: { Mesmerize: { warnSec: 5, warnSpeech: 'Remez {target}' } } })
    own.feed(mez)
    own.feed('[Tue Sep 01 12:20:20 2026] Kelwyn hits a gnoll pup for 10 points of damage.')
    expect(own.spoken).toEqual(['Remez a gnoll pup'])
  })
})

describe('invisibility (LT-717)', () => {
  it('runs until you act, with no recast cue, and ends on the game’s warning that you are appearing', () => {
    const h = harness()
    h.feed(`
      [Tue Sep 01 12:40:00 2026] You begin casting Gather Shadows.
      [Tue Sep 01 12:40:02 2026] You gather shadows about you.`)
    const t = h.board.get(timerKey('Gather Shadows', 'You'))!
    expect(t.untilActed).toBe(true)
    expect(t.warnSec).toBe(0)
    expect(h.board.views()[0].untilActed).toBe(true)
    expect(h.feedItems.at(-1)).toEqual(['timer', 'Gather Shadows on You: until you act'])
    // Half an hour's formula; the first blow brings it down in half a minute.
    h.feed('[Tue Sep 01 12:40:34 2026] You feel yourself starting to appear.')
    expect(h.board.list()).toHaveLength(0)
    expect(h.spoken).toEqual([])
    expect(h.feedItems.at(-1)).toEqual(['fade', 'Gather Shadows is dropping'])
    // Its own fade line then finds nothing to end, and says nothing.
    h.feed('[Tue Sep 01 12:40:36 2026] Your shadows fade.')
    expect(h.spoken).toEqual([])
  })
})
