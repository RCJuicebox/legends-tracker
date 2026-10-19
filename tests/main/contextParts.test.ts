import { describe, expect, it, vi } from 'vitest'
import { engineOutputs, updateListener, type OutputDeps, type UpdateDeps } from '../../src/main/contextParts'
import { sources } from '../../src/main/sources/registry'
import { DEFAULT_CHARACTER } from '../../src/shared/types'
import type { LootView } from '../../src/shared/ipc'
import type { RespawnView } from '../../src/core/respawns'

// What createContext wires, without an app (LT-638): the update notices and a restart at a lull,
// and the engine's outputs, the main window sent only what changed while it takes them.

function updates(over: Partial<UpdateDeps> = {}) {
  const pushed: unknown[][] = []
  const feed: string[] = []
  const notes: string[] = []
  const installs: (boolean | undefined)[] = []
  const timers: (() => void)[] = []
  let play = { fighting: true, lastLineAt: 0, watching: true, gameInFront: true }
  let clock = 1_000_000
  const d: UpdateDeps = {
    toMain: (...a: unknown[]) => void pushed.push(a),
    pushFeed: (_k, t) => void feed.push(t),
    announce: (key) => void notes.push(key),
    showMain: () => {},
    install: (u) => void installs.push(u),
    autoRestart: () => false,
    heldBack: () => false,
    play: () => play,
    now: () => clock,
    later: (fn) => void timers.push(fn),
    ...over
  } as UpdateDeps
  return { on: updateListener(d), pushed, feed, notes, installs, timers, setPlay: (p: typeof play) => (play = p), tick: (ms: number) => (clock += ms) }
}

describe('the update notices', () => {
  it('says each state on the Data Sources row and the feed, and a ready update once in a notice', () => {
    const u = updates()
    u.on({ state: 'downloading', version: '9.9.9', percent: 40 } as never)
    expect(sources.list().find((s) => s.id === 'updates')?.detail).toContain('Downloading 9.9.9, 40%')
    expect(u.notes).toEqual(['found:9.9.9'])
    u.on({ state: 'ready', version: '9.9.9' } as never)
    expect(u.feed.at(-1)).toBe('Version 9.9.9 is ready: restart to update.')
    expect(u.notes.at(-1)).toBe('ready:9.9.9')
    u.on({ state: 'error', message: 'could not reach GitHub' } as never)
    expect(sources.list().find((s) => s.id === 'updates')?.detail).toContain('Offline')
  })

  it('says a failed download once in the feed', () => {
    const u = updates()
    u.on({ state: 'downloading', version: '9.9.9', percent: 10 } as never)
    u.on({ state: 'error', message: 'disk full' } as never)
    expect(u.feed.at(-1)).toContain('could not be downloaded: disk full')
  })

  it('restarts by itself only at a lull in play, and not into a version that did not take', () => {
    const u = updates({ autoRestart: () => true })
    u.on({ state: 'ready', version: '9.9.9' } as never)
    expect(u.feed.at(-1)).toContain('restarting into it at the next lull')
    // Mid-fight: looked at again in half a minute.
    u.timers.shift()!()
    expect(u.installs).toEqual([])
    u.setPlay({ fighting: false, lastLineAt: 0, watching: true, gameInFront: true })
    u.tick(120_000)
    u.timers.shift()!()
    expect(u.installs).toEqual([true])
    const held = updates({ autoRestart: () => true, heldBack: () => true })
    held.on({ state: 'ready', version: '9.9.9' } as never)
    expect(held.feed.at(-1)).toContain('its install did not take last time')
    expect(held.timers).toEqual([])
  })
})

function outputs() {
  const sent: { channel: string; value: unknown }[] = []
  let watching = true
  const records: Record<string, typeof DEFAULT_CHARACTER> = { Kelwyn_neriak: { ...DEFAULT_CHARACTER } }
  const reconfigure = vi.fn()
  const d: OutputDeps = {
    toMain: ((channel: string, value: unknown) => void sent.push({ channel, value })) as OutputDeps['toMain'],
    mainWatches: () => watching,
    overlays: () => ({ timers: () => {}, alert: () => {}, combat: () => {} }),
    toAudio: () => {},
    combatToMain: () => {},
    reportStatus: () => {},
    characterKey: () => 'Kelwyn_neriak',
    pet: { merge: async () => true, get: async () => ({ gear: null, summon: null }) },
    record: { get: (k) => records[k] ?? null, set: (k, r) => void (records[k] = r) },
    reconfigure
  }
  return { out: engineOutputs(d), sent, records, reconfigure, setWatching: (w: boolean) => (watching = w) }
}

const loot = (ids: number[]) => ({ entries: ids.map((id) => ({ id })) }) as unknown as LootView
const respawns = (rows: [string, number][]) => ({ zone: 'Unrest', rows: rows.map(([key, lastDeath]) => ({ key, lastDeath })) }) as unknown as RespawnView

describe("the engine's outputs", () => {
  it('sends the loot whole first, then the entries added, and whole again while the window does not take it', () => {
    const o = outputs()
    o.out.loot(loot([2, 1]))
    o.out.loot(loot([4, 3, 2, 1]))
    expect((o.sent[1].value as LootView).entries.map((e) => e.id)).toEqual([4, 3])
    o.setWatching(false)
    o.out.loot(loot([5, 4, 3, 2, 1]))
    expect((o.sent[2].value as LootView).entries).toHaveLength(5)
  })

  it('sends the respawn rows whole first, then the changed ones only', () => {
    const o = outputs()
    o.out.respawns(
      respawns([
        ['a', 1],
        ['b', 2]
      ])
    )
    o.out.respawns(
      respawns([
        ['a', 1],
        ['b', 3]
      ])
    )
    expect((o.sent[1].value as RespawnView).rows.map((r) => r.key)).toEqual(['b'])
    o.out.respawns(
      respawns([
        ['a', 1],
        ['b', 3]
      ])
    )
    expect(o.sent).toHaveLength(2)
  })

  it('follows a /who of yourself into the character record', () => {
    const o = outputs()
    o.out.selfSeen!({ race: 'Wood Elf', classes: [{ cls: 'mnk', level: 50 }] } as never)
    expect(o.reconfigure).toHaveBeenCalled()
    expect(o.sent.at(-1)?.channel).toBe('state:character')
  })
})
