// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, expect, it, vi } from 'vitest'
import { defaultSettings } from '../../src/main/storeCore'
import { DEFAULT_CHARACTER } from '../../src/shared/types'
import type { AppState } from '../../src/shared/ipc'
import type { CrawlXpData, XpRun } from '../../src/features/crawl/xp'

// Motes › Crawl XP drawn: the run in hand, the runs with their worked-out reward and rate (completed
// crawls only until switched), and what a kill of each level is worth at the player's level.

const seen = (el: Element) => {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('.sr-only').forEach((n) => n.remove())
  return c.textContent ?? ''
}

const appState: AppState = {
  settings: defaultSettings(),
  status: { watching: false, logFile: '', character: '', zone: '', spellsLoaded: 0, spellError: '', lastLineAt: 0, logSize: 0 },
  timers: [],
  feed: [],
  archive: { busy: false, message: '', pendingUntilGameExits: [], gameRunning: false, liveRotation: 'unknown' },
  character: DEFAULT_CHARACTER,
  characterKey: 'Kelwyn_neriak',
  voices: [],
  speechError: '',
  kokoro: { state: 'absent', fraction: null, error: '' },
  arranging: false,
  devices: [],
  triggerErrors: [],
  hotkeysTaken: []
}

const T = Date.UTC(2026, 10, 23, 11, 24, 12)
const d1: XpRun = {
  zone: "Nagafen's Lair 1 (Awakened)",
  tier: 1,
  startedAt: T,
  lastAt: T + 1_092_000,
  doneAt: T + 1_092_000,
  kills: 62,
  xp: 18.422,
  xpDone: 18.422,
  level: 49,
  levels: 0
}
const sitting: XpRun = { zone: "Nagafen's Lair", tier: 0, startedAt: T - 9_000_000, lastAt: T - 3_000_000, kills: 120, xp: 150.5, level: 46, levels: 2 }
const now: XpRun = { zone: "Nagafen's Lair 4 (Refined)", tier: 4, startedAt: T + 1_300_000, lastAt: T + 1_900_000, kills: 20, xp: 7.5 }
const answer: CrawlXpData = { runs: [now, d1, sitting], current: now, level: 49, values: { 49: { 44: 0.4871, 36: 0.1121 }, 48: { 36: 0.123 } } }

const invoke = vi.fn((channel: string) => {
  switch (channel) {
    case 'app:state':
      return Promise.resolve(structuredClone(appState))
    case 'character:exports':
      return Promise.resolve({ inventory: [], achievements: [], factions: [], current: '' })
    case 'logs:list':
      return Promise.resolve([{ character: 'Kelwyn_neriak' }])
    case 'crawl:xp':
      return Promise.resolve(answer)
    default:
      return new Promise(() => {})
  }
})

let CrawlXpPage: ComponentType
let StateProvider: ComponentType<{ children: React.ReactNode }>

beforeAll(async () => {
  Object.assign(window, { eql: { invoke, send: vi.fn(), on: vi.fn(() => () => {}) }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  ;({ StateProvider } = await import('../../src/renderer/src/state'))
  ;({ CrawlXpPage } = await import('../../src/features/crawl/xpPage'))
})

async function draw() {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <StateProvider>
        <CrawlXpPage />
      </StateProvider>
    )
  )
  for (let i = 0; i < 10 && !host.querySelector('table'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)))
  return { host, done: () => (act(() => root.unmount()), host.remove()) }
}

it('shows the run in hand, the completed crawls with their reward and rate, and what each level is worth', async () => {
  const { host, done } = await draw()
  const text = seen(host)
  expect(invoke).toHaveBeenCalledWith('crawl:xp', 'Kelwyn_neriak')
  expect(text).toContain('Run in hand')
  expect(text).toContain('(+ a fifth on completing)')
  // The D1 crawl: 18.422% from kills, a fifth of it the reward, 22.106% in 18:12.
  const rows = [...host.querySelectorAll('tbody')[0].querySelectorAll('tr')]
  expect(rows).toHaveLength(1)
  expect(seen(rows[0])).toContain("Nagafen's Lair 1 (Awakened) D1 completed")
  expect(seen(rows[0])).toContain('18.422%3.684%22.106%')
  expect(seen(rows[0])).toContain('18:12')
  // Every run once the switch is off: the evening sat in the base instance, two levels gained.
  const chip = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Completed crawls only'))!
  await act(async () => chip.click())
  const all = [...host.querySelectorAll('tbody')[0].querySelectorAll('tr')].map(seen)
  expect(all).toHaveLength(3)
  expect(all[2]).toContain('46→48')
  // At level 49, D0 and the difficulties after it, and kills a level.
  const values = seen(host.querySelectorAll('tbody')[1])
  expect(values).toContain('440.487%0.536%0.682%206')
  expect(values).toContain('360.112%')
  done()
})
