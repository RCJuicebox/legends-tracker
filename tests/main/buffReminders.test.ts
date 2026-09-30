import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BuffCoordinator } from '../../src/main/engine/buffs'
import { Notifier } from '../../src/main/engine/notifier'
import { SpellQueries } from '../../src/main/engine/spellQueries'
import type { EngineStore } from '../../src/main/engine/contracts'
import { defaultSettings } from '../../src/main/storeCore'
import { SpellBook } from '../../src/core/spells'
import { TimerBoard } from '../../src/core/timers'
import type { BuffsFile, Person } from '../../src/core/buffs'
import type { MoteState } from '../../src/core/motes'
import type { FeedItem, MoteStock } from '../../src/shared/types'
import { at } from '../helpers'

// The buff coordinator (engine/buffs.ts) over the real stacking fixture: Symbol of Pinzarn is wanted,
// a cleric groupmate can cast it. Its landing text, "The symbol of Pinzarn flashes before your eyes.",
// is its own; its fade text is shared with Symbol of Naltron.

const book = SpellBook.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'stacking_spells_us.txt'), 'latin1'),
  readFileSync(join(__dirname, '..', 'fixtures', 'stacking_spells_us_str.txt'), 'latin1')
)

const SYMBOL = 'Symbol of Pinzarn'
const CAST = 'Brenna begins casting Symbol of Pinzarn.'
const LANDS = 'The symbol of Pinzarn flashes before your eyes.'
const FADES = 'The mystic symbol fades.'
const ASK = 'Ask Brenna for Symbol of Pinzarn'
const KEY = 'Kelwyn_neriak'
const T0 = at('Thu Sep 24 16:00:00 2026')

const brenna: Person = { name: 'Brenna', classes: ['clr'], level: 50, race: 'Human', at: 0 }

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

function setup(o: { groupBuffs?: boolean; group?: string[] } = {}) {
  const settings = defaultSettings()
  const store = {
    settings: cell({ ...settings, logFile: join('C:', 'nowhere', 'Logs', `eqlog_${KEY}.txt`), tracking: { ...settings.tracking, groupBuffs: o.groupBuffs ?? true } }),
    triggers: cell([]),
    rules: cell({}),
    casts: cell({}),
    motes: cell<MoteState>({ active: null, sessions: [], daily: {} }),
    stock: cell<MoteStock>({ counts: {}, item: { name: '', lvl: 0, xp: 0, to: 1 }, autoAdd: true }),
    respawns: cell({}),
    buffs: cell<BuffsFile>({ people: { brenna }, wanted: { [KEY]: [SYMBOL] }, active: {} }),
    motesFresh: false,
    characterOf: () => ({ level: 50, classLevels: {}, focusSources: [] })
  } satisfies EngineStore
  const feed: FeedItem[] = []
  const alerts: { text: string; color: string; durationSec: number }[] = []
  const spoken: string[] = []
  const pushed: { channel: string; view: unknown }[] = []
  const notifier = new Notifier(
    {
      synthesize: async (text: string) => {
        spoken.push(text)
        return Buffer.alloc(0)
      }
    },
    { alert: (a) => alerts.push(a), audio: () => {}, feed: (i) => feed.push(i) },
    () => store.settings.get(),
    () => []
  )
  const board = new TimerBoard({ onChange: () => {}, onNotify: (ns) => notifier.notify(ns) })
  const state = { group: o.group ?? ['Brenna'], fighting: false, readingHistory: false, live: true }
  const out = { push: (channel: string, view: unknown) => void pushed.push({ channel, view }) }
  const buffs = new BuffCoordinator(store, out, board, new SpellQueries(store, () => book), notifier, {
    book: () => book,
    group: () => state.group,
    fighting: () => state.fighting,
    readingHistory: () => state.readingHistory,
    live: () => state.live
  })
  buffs.spellsLoaded(book)
  buffs.watching(store.settings.get().logFile, T0)
  const asks = () => feed.filter((f) => f.text.startsWith('Buffs: ')).map((f) => f.text)
  return { store, buffs, board, feed, alerts, spoken, pushed, state, asks }
}

let s: ReturnType<typeof setup>

describe('Asking for a wanted buff that is missing', () => {
  beforeEach(() => {
    s = setup()
  })

  it('pushes its view to the pages on its own channel', () => {
    s.buffs.tick(T0 + 6000)
    expect(s.pushed.at(-1)).toMatchObject({ channel: 'state:buffs', view: { wanted: [SYMBOL], plan: { needs: [{ spell: SYMBOL }] } } })
  })

  it('names who to ask, in the feed and as a six-second alert', () => {
    s.buffs.tick(T0 + 6000)
    expect(s.asks()).toEqual([`Buffs: ${ASK}.`])
    expect(s.alerts).toEqual([{ text: ASK, color: expect.any(String), durationSec: 6 }])
    // On screen only: nothing is spoken.
    expect(s.spoken).toEqual([])
  })

  it('says it again only after ten minutes while it still holds', () => {
    s.buffs.tick(T0 + 6000)
    for (let t = T0 + 12_000; t < T0 + 6000 + 10 * 60_000; t += 60_000) s.buffs.tick(t)
    expect(s.asks().length).toBe(1)
    s.buffs.tick(T0 + 6000 + 10 * 60_000 + 1000)
    expect(s.asks().length).toBe(2)
  })

  it('checks at most every five seconds', () => {
    s.buffs.tick(T0 + 6000)
    s.buffs.groupChanged()
    // Changed, but under a second since the last look.
    s.buffs.tick(T0 + 6500)
    expect(s.asks().length).toBe(1)
    s.buffs.tick(T0 + 7100)
    expect(s.asks().length).toBe(2)
  })

  it('waits for the fight to end, then says it at once', () => {
    s.state.fighting = true
    s.buffs.tick(T0 + 6000)
    expect(s.asks()).toEqual([])
    s.state.fighting = false
    s.buffs.tick(T0 + 12_000)
    expect(s.asks()).toEqual([`Buffs: ${ASK}.`])
  })

  it('says nothing while fights are read back from the log, or while not watching the log live', () => {
    s.state.readingHistory = true
    s.buffs.tick(T0 + 6000)
    s.state.readingHistory = false
    s.state.live = false
    s.buffs.tick(T0 + 12_000)
    expect(s.asks()).toEqual([])
    expect(s.alerts).toEqual([])
  })

  it('says nothing with group buffs turned off, though the Buffs page still lists it', () => {
    s = setup({ groupBuffs: false })
    s.buffs.tick(T0 + 6000)
    expect(s.asks()).toEqual([])
    expect(s.buffs.view().needs.map((n) => [n.spell, n.from])).toEqual([[SYMBOL, 'Brenna']])
  })

  it('says nothing when nobody in the group can cast it', () => {
    s = setup({ group: [] })
    s.buffs.tick(T0 + 6000)
    expect(s.asks()).toEqual([])
  })

  it('tells the player once to /who a groupmate it knows nothing of', () => {
    s = setup({ group: ['Brenna', 'Corvin'] })
    s.buffs.tick(T0 + 6000)
    s.buffs.tick(T0 + 12_000)
    expect(s.feed.filter((f) => f.text.startsWith('Type /who')).map((f) => f.text)).toEqual(['Type /who Corvin so the buff tracker knows the classes Corvin plays.'])
  })

  it('asks again at once when the wanted list changes', () => {
    s.buffs.tick(T0 + 6000)
    s.buffs.setWanted([SYMBOL])
    s.buffs.tick(T0 + 12_000)
    expect(s.asks().length).toBe(2)
  })

  it('works the plans out again only when what they are made from changes', () => {
    const first = s.buffs.view()
    // Nothing new: the same plans, not two more searches.
    expect(s.buffs.view().plan).toBe(first.plan)
    expect(s.buffs.view().planAnyone).toBe(first.planAnyone)
    s.buffs.setWanted([])
    expect(s.buffs.view().plan).not.toBe(first.plan)
  })
})

describe("A groupmate's buff on you", () => {
  beforeEach(() => {
    s = setup()
  })

  function land(time: number) {
    s.buffs.handle(CAST, time - 3000)
    s.buffs.handle(LANDS, time)
    return s.board.get(`buff:${SYMBOL}`)
  }

  it('goes on the buffs overlay with a spoken warning a minute before it fades, naming who to ask', () => {
    const timer = land(T0 + 10_000)
    expect(timer).toMatchObject({
      label: SYMBOL,
      target: 'You',
      overlay: 'buffs',
      category: 'buff',
      startedAt: T0 + 10_000,
      warnSec: 60,
      onWarn: [{ kind: 'speak', text: `${SYMBOL} is fading, ask Brenna`, interrupt: false }]
    })
    expect(timer!.endsAt).toBe(s.buffs.watch.active[0].endsAt)
    expect(timer!.endsAt - timer!.startedAt).toBeGreaterThanOrEqual(5 * 60_000)
    s.board.tick(timer!.endsAt - 61_000)
    expect(s.spoken).toEqual([])
    s.board.tick(timer!.endsAt - 59_000)
    expect(s.spoken).toEqual([`${SYMBOL} is fading, ask Brenna`])
  })

  it('stops the reminder while it is on', () => {
    land(T0 + 1000)
    s.buffs.tick(T0 + 6000)
    expect(s.asks()).toEqual([])
    expect(s.buffs.view().needs).toEqual([])
  })

  it('is asked for again at once when it fades, and its timer comes off the overlay', () => {
    s.buffs.tick(T0 + 6000)
    expect(s.asks().length).toBe(1)
    land(T0 + 10_000)
    s.buffs.tick(T0 + 20_000)
    s.buffs.handle(FADES, T0 + 30_000)
    expect(s.board.get(`buff:${SYMBOL}`)).toBeUndefined()
    expect(s.buffs.watch.active).toEqual([])
    // Well inside ten minutes of the first ask, but the buff was on in between.
    s.buffs.tick(T0 + 36_000)
    expect(s.asks()).toEqual([`Buffs: ${ASK}.`, `Buffs: ${ASK}.`])
  })

  it('is dropped when it outlives its estimate with no fade line, and asked for again', () => {
    const timer = land(T0 + 1000)
    s.buffs.tick(T0 + 6000)
    s.buffs.tick(timer!.endsAt + 12_001)
    expect(s.buffs.watch.active).toEqual([])
    expect(s.asks()).toEqual([`Buffs: ${ASK}.`])
  })

  it('carries no spoken warning when it was read back from history', () => {
    s.state.readingHistory = true
    expect(land(T0 + 1000)?.onWarn).toEqual([])
  })

  it('leaves the overlay with group buffs switched off', () => {
    land(T0 + 1000)
    s.store.settings.set({ ...s.store.settings.get(), tracking: { ...s.store.settings.get().tracking, groupBuffs: false } })
    s.buffs.reconfigure()
    expect(s.board.list().filter((t) => t.key.startsWith('buff:'))).toEqual([])
  })

  it('is saved under the character, so the next run starts with it', () => {
    land(T0 + 1000)
    expect(s.store.buffs.get().active[KEY]?.map((b) => [b.spell, b.caster])).toEqual([[SYMBOL, 'Brenna']])
  })

  it('is gone on death, and asked for again', () => {
    land(T0 + 1000)
    s.buffs.handle('You have been slain by a fetid fiend!', T0 + 2000)
    expect(s.buffs.watch.active).toEqual([])
    s.buffs.tick(T0 + 8000)
    expect(s.asks()).toEqual([`Buffs: ${ASK}.`])
  })

  it('gets no overlay timer when you cast it on yourself', () => {
    s.buffs.handle('You begin casting Symbol of Pinzarn.', T0)
    s.buffs.handle(LANDS, T0 + 3000)
    expect(s.buffs.watch.active.map((b) => b.caster)).toEqual(['You'])
    expect(s.board.get(`buff:${SYMBOL}`)).toBeUndefined()
  })
})
