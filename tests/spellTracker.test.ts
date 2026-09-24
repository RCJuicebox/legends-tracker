import { describe, expect, it } from 'vitest'
import { at, harness, exampleShaman } from './helpers'
import { timerKey } from '../src/core/spellTracker'

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

  it('drops a cast that is interrupted or resisted', () => {
    const h = harness()
    h.feed(`
      [Sat Sep 12 23:11:04 2026] You begin casting Envenomed Bolt X.
      [Sat Sep 12 23:11:05 2026] Your Envenomed Bolt spell is interrupted.
      [Sat Sep 12 23:11:05 2026] A ratman warrior has been poisoned.`)
    expect(h.board.list()).toHaveLength(0)
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
