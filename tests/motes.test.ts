import { describe, expect, it } from 'vitest'
import { MoteTracker, moteValue, parseMoteLoot, sessionHours, totalMotes, type MoteSession } from '../src/core/motes'
import { parseLogLine } from '../src/core/logLine'

function tracker() {
  const t = new MoteTracker({ active: null, sessions: [], daily: {} }, { onChange: () => {} })
  const feed = (text: string) => {
    for (const raw of text.trim().split('\n')) t.handle(parseLogLine(raw.trim())!)
  }
  return { t, feed }
}

describe('parseMoteLoot', () => {
  it('reads single, stacked and unnamed-rank motes', () => {
    expect(parseMoteLoot("You looted a Mote of Major Potential from a turmoil toad's corpse and stored it in your currency")).toEqual({
      rank: 'major', count: 1, source: 'a turmoil toad'
    })
    expect(parseMoteLoot('You looted 4 Mote of Major Potential from Reward Chest and stored it in your currency')).toEqual({
      rank: 'major', count: 4, source: 'Reward Chest'
    })
    expect(parseMoteLoot("You looted a Mote of Potential from a scareling's corpse and stored it in your currency")?.rank).toBe('potential')
    expect(parseMoteLoot('You looted a Puma Skin from a snow leopard\'s corpse and stored it in your tradeskill depot')).toBeNull()
  })
})

// Kelwyn's crawl of 2026-09-24, from the real log (lines trimmed to the ones that matter).
const TODAY = `
[Thu Sep 24 11:06:14 2026] You have entered The Plane of Fear.
[Thu Sep 24 11:06:26 2026] Player Kelwyn creating instance The Plane of Fear 45.
[Thu Sep 24 11:06:56 2026] You have entered The Plane of Fear 4 (Refined).
[Thu Sep 24 11:08:17 2026] You looted a Mote of Major Potential from Amygdalan warrior's corpse and stored it in your currency
[Thu Sep 24 11:09:54 2026] You have entered New Sebilis Expedition.
[Thu Sep 24 11:16:57 2026] You have entered The Feerrott.
[Thu Sep 24 11:20:54 2026] You have entered The Plane of Fear.
[Thu Sep 24 11:21:48 2026] You have entered The Plane of Fear 4 (Refined).
[Thu Sep 24 11:23:16 2026] You have entered The Plane of Fear.
[Thu Sep 24 11:24:18 2026] Player Kelwyn creating instance The Plane of Fear 57.
[Thu Sep 24 11:24:47 2026] You have entered The Plane of Fear 4 (Refined).
[Thu Sep 24 11:42:11 2026] You looted a Mote of Superior Potential from a boogeyman's corpse and stored it in your currency
[Thu Sep 24 11:46:02 2026] You looted a Mote of Major Potential from a shiverback's corpse and stored it in your currency
[Thu Sep 24 11:49:02 2026] You looted a Mote of Major Potential from a spinechiller spider's corpse and stored it in your currency
[Thu Sep 24 12:02:16 2026] You looted a Mote of Major Potential from a turmoil toad's corpse and stored it in your currency
[Thu Sep 24 12:02:27 2026] You looted a Mote of Major Potential from a fetid fiend's corpse and stored it in your currency
[Thu Sep 24 12:05:10 2026] You looted a Mote of Major Potential from phoboplasm's corpse and stored it in your currency
[Thu Sep 24 12:05:13 2026] You looted a Mote of Major Potential from phoboplasm's corpse and stored it in your currency
[Thu Sep 24 12:13:29 2026] You looted a Mote of Major Potential from a turmoil toad's corpse and stored it in your currency
[Thu Sep 24 12:14:06 2026] You have completed the Dungeon Crawl and earned reward loot!
[Thu Sep 24 12:14:06 2026] You looted 4 Mote of Major Potential from Reward Chest and stored it in your currency
`

describe('MoteTracker', () => {
  it('times a real crawl: abandons the first instance, completes the second, and counts the chest', () => {
    const { t, feed } = tracker()
    feed(TODAY)
    expect(t.state.active).toBeNull()
    const [done, first] = t.state.sessions as MoteSession[]
    // The first instance: left for the hub, came back, then a fresh instance was created. It never
    // completed, so it stays an instance run, kept because it produced a mote.
    expect(first).toMatchObject({ kind: 'instance', outcome: 'abandoned' })
    expect(first.motes).toEqual({ major: 1 })
    // The real crawl: 11:24:47 → 12:14:06, 7 Major + 1 Superior from mobs, 4 Major from the chest.
    expect(done).toMatchObject({ kind: 'crawl', outcome: 'completed' })
    expect(done.name).toBe('The Plane of Fear 4 (Refined)')
    expect((done.endedAt! - done.startedAt) / 60_000).toBeCloseTo(49.32, 1)
    expect(done.motes).toEqual({ major: 11, superior: 1 })
    expect(totalMotes(done.motes)).toBe(12)
    // Major is worth 16 Infinitesimal, Superior 64.
    expect(moteValue(done.motes)).toBe(11 * 16 + 64)
    // Every mote counts towards the day, crawl or not.
    expect(t.state.daily['2026-09-24']).toEqual({ major: 12, superior: 1 })
  })

  it('keeps a crawl open while you bank and come back to the same instance', () => {
    const { t, feed } = tracker()
    feed(`
      [Thu Sep 24 11:06:56 2026] You have entered The Plane of Fear 4 (Refined).
      [Thu Sep 24 11:09:54 2026] You have entered New Sebilis Expedition.
      [Thu Sep 24 11:21:48 2026] You have entered The Plane of Fear 4 (Refined).`)
    expect(t.state.active?.startedAt).toBe(parseLogLine('[Thu Sep 24 11:06:56 2026] x')!.time)
    expect(t.state.active!.outsideMs).toBe((11 * 60 + 54) * 1000)
  })

  it('ends a run you have been out of for 30 minutes, as of when you left, and drops it if it found nothing', () => {
    const { t, feed } = tracker()
    feed(`
      [Thu Sep 24 11:06:56 2026] You have entered The Plane of Fear 4 (Refined).
      [Thu Sep 24 11:08:17 2026] You looted a Mote of Major Potential from Amygdalan warrior's corpse and stored it in your currency
      [Thu Sep 24 11:09:54 2026] You have entered New Sebilis Expedition.`)
    const left = parseLogLine('[Thu Sep 24 11:09:54 2026] x')!.time
    t.tick(left + 31 * 60_000)
    expect(t.state.sessions[0]).toMatchObject({ kind: 'instance', outcome: 'abandoned', endedAt: left })

    const empty = tracker()
    empty.feed(`
      [Thu Sep 24 13:00:00 2026] You have entered The Plane of Hate 4 (Refined).
      [Thu Sep 24 13:05:00 2026] You have entered The Plane of Hate.`)
    empty.t.tick(parseLogLine('[Thu Sep 24 13:36:00 2026] x')!.time)
    expect(empty.t.state.active).toBeNull()
    expect(empty.t.state.sessions).toEqual([])
  })

  it('remembers how far it has read, so a restart can catch up', () => {
    const { t, feed } = tracker()
    feed('[Thu Sep 24 12:27:52 2026] You have entered The Plane of Hate 4 (Refined).')
    expect(t.state.seenUntil).toBe(parseLogLine('[Thu Sep 24 12:27:52 2026] x')!.time)
  })

  it('leaves paused time out of the per-hour rate, including a pause backdated to when you left', () => {
    const { t, feed } = tracker()
    const at = (s: string) => parseLogLine(`[Thu Sep 24 ${s} 2026] x`)!.time
    feed(`
      [Thu Sep 24 12:27:52 2026] You have entered The Plane of Hate 4 (Refined).
      [Thu Sep 24 12:47:41 2026] You looted a Mote of Major Potential from a forsaken revenant's corpse and stored it in your currency`)
    // Stepped away at 12:50:06; only noticed at 13:33.
    t.pause(at('12:50:06'), at('13:33:00'))
    expect(sessionHours(t.state.active!, at('13:33:00')) * 60).toBeCloseTo(22.23, 1)
    t.resume(at('13:40:00'))
    expect(t.state.active!.pausedMs).toBe(at('13:40:00') - at('12:50:06'))
    // Paused runs are not abandoned for being away.
    feed('[Thu Sep 24 13:41:00 2026] You have entered The Plane of Hate.')
    t.pause(at('13:41:00'), at('13:41:00'))
    t.tick(at('14:30:00'))
    expect(t.state.active).not.toBeNull()
  })

  it('runs a manual session that instances do not interrupt', () => {
    const { t, feed } = tracker()
    const start = parseLogLine('[Thu Sep 24 10:00:00 2026] x')!.time
    t.startManual(start)
    feed(`
      [Thu Sep 24 10:10:00 2026] You looted a Mote of Minor Potential from a gnoll's corpse and stored it in your currency
      [Thu Sep 24 10:20:00 2026] You have entered The Plane of Fear 4 (Refined).
      [Thu Sep 24 10:30:00 2026] You looted a Mote of Major Potential from a fetid fiend's corpse and stored it in your currency`)
    expect(t.state.active?.kind).toBe('manual')
    t.stop(start + 3_600_000)
    expect(t.state.sessions[0]).toMatchObject({ kind: 'manual', outcome: 'stopped', motes: { minor: 1, major: 1 } })
  })
})
