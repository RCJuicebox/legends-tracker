// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, expect, it, vi } from 'vitest'
import { defaultSettings } from '../../src/main/storeCore'
import { DEFAULT_CHARACTER } from '../../src/shared/types'
import type { AppState } from '../../src/shared/ipc'
import type { AchievementTrack } from '../../src/shared/tracking'

// Live's hunting row drawn with a track: the named killed lately called out, the named left and down,
// and the Slayer counts the kills since the export moved, the latest first.

const NOW = Date.now()

const appState: AppState = {
  settings: defaultSettings(),
  status: { watching: true, logFile: '', character: 'Kelwyn', zone: 'Permafrost Keep', spellsLoaded: 0, spellError: '', lastLineAt: NOW, logSize: 0 },
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

const row = (name: string, count: number, since: number, max: number, last: number) => ({
  name,
  section: 'Slayer: Conquest',
  races: 'Goblins.',
  count,
  since,
  guessed: 0,
  max,
  last,
  done: false
})

const track: AchievementTrack = {
  character: 'Kelwyn_neriak',
  at: NOW,
  faction: null,
  slayer: {
    exportFile: 'x',
    exportAt: NOW - 3_600_000,
    rows: [row('Goblin Gobblin’', 400, 25, 500, NOW - 60_000), row('Not Moving', 3, 0, 50, 0), row('Older', 10, 2, 50, NOW - 1_800_000)],
    unplaced: [],
    pending: 0
  },
  skills: null,
  hunter: {
    zone: 'Permafrost Keep',
    rows: [
      {
        achievement: 'Hunter of The Permafrost Caverns',
        left: ['a goblin archaeologist'],
        total: 3,
        since: ['a goblin alchemist'],
        killed: { 'a goblin alchemist': NOW - 120_000 },
        seen: { 'a goblin archaeologist': 'not seen die in your log' }
      }
    ]
  },
  epics: null,
  slayerPlan: null,
  tracked: []
}

const invoke = vi.fn((channel: string) => {
  if (channel === 'app:state') return Promise.resolve(structuredClone(appState))
  if (channel === 'achievements:track') return Promise.resolve(structuredClone(track))
  return new Promise(() => {})
})

let HuntCards: ComponentType<{ go: () => void }>
let StateProvider: ComponentType<{ children: React.ReactNode }>

beforeAll(async () => {
  Object.assign(window, { eql: { invoke, send: vi.fn(), on: vi.fn(() => () => {}) }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  ;({ StateProvider } = await import('../../src/renderer/src/state'))
  ;({ HuntCards } = (await import('../../src/renderer/src/components/LiveHunt')) as unknown as { HuntCards: typeof HuntCards })
})

it('calls out the named killed, lists those left, and the Slayer counts moving, latest first', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <StateProvider>
        <HuntCards go={() => {}} />
      </StateProvider>
    )
  )
  for (let i = 0; i < 50 && !host.textContent?.includes('Hunter of'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)))
  const down = host.querySelector('.hunt-down')
  expect(down?.textContent).toContain('a goblin alchemist killed at')
  expect(down?.textContent).toContain('1 left for Hunter of The Permafrost Caverns')
  expect(host.querySelector('.hunt-list li.done')?.textContent).toContain('✓ a goblin alchemist')
  expect(host.querySelector('.hunt-list li:not(.done)')?.textContent).toBe('a goblin archaeologist · not seen die in your log')
  // Only the counts that moved, the latest kill first.
  const counts = [...host.querySelectorAll('.hunt-count')].map((c) => c.textContent ?? '')
  expect(counts).toHaveLength(2)
  expect(counts[0]).toContain('Goblin Gobblin’')
  expect(counts[0]).toContain('425 / 500 +25')
  expect(counts[1]).toContain('Older')
  await act(async () => root.unmount())
})
