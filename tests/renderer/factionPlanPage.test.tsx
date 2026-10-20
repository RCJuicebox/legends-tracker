// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, expect, it, vi } from 'vitest'
import { defaultSettings } from '../../src/main/storeCore'
import { DEFAULT_CHARACTER, type AppSettings } from '../../src/shared/types'
import type { AppState } from '../../src/shared/ipc'
import type { FactionPlanData } from '../../src/features/factions/planner'
import type { PlanActivity } from '../../src/features/factions/catalog'

// Factions › Plan drawn with a plan (LT-644): its steps, a camp ruled out saved as a choice, and the plan
// handed to the main process once a change of steps, not at every redraw. The planner runs here as it
// would in its worker (planRunner stood in).

vi.mock('../../src/features/factions/planRunner', async () => {
  const { planFactions } = await import('../../src/features/factions/planner')
  class Superseded extends Error {}
  return {
    Superseded,
    runPlan: vi.fn(async (input: never, settings: never, choices: never, keep?: never) => planFactions(input, settings, choices, keep)),
    pingPlanWorker: async () => true
  }
})

const seen = (el: Element) => {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('.sr-only').forEach((n) => n.remove())
  return c.textContent ?? ''
}

let settings: AppSettings = defaultSettings()

const appState = (): AppState => ({
  settings: structuredClone(settings),
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
})

const camp = (id: string, zone: string, mob: string, hits: Record<string, number>): PlanActivity => ({
  id,
  kind: 'kill',
  title: `Kill ${mob}`,
  zone,
  mobs: [mob],
  hits,
  source: 'log',
  seen: 40,
  common: 8
})

const data: FactionPlanData = {
  stamp: 'test',
  targets: [{ faction: 'Emerald Warriors', achievement: 'Emerald Warriors', standing: 1800 }],
  maxed: [],
  achievementsExport: true,
  standings: { 'Emerald Warriors': 1800, 'Crushbone Orcs': -500 },
  catalog: {
    activities: [
      camp('kill|Clan Crushbone|an orc centurion', 'Clan Crushbone', 'an orc centurion', { 'Emerald Warriors': 10, 'Crushbone Orcs': -5 }),
      camp('kill|Greater Faydark|an orc pawn', 'Greater Faydark', 'an orc pawn', { 'Emerald Warriors': 5 })
    ],
    killsPerHour: 120,
    guesses: { killUp: 5, killDown: -2, handUp: 5, handDown: -1 }
  },
  export: { file: 'Kelwyn_neriak-MNK-Factions.txt', modified: Date.now() - 3600_000 },
  inventory: null,
  wiki: { fetchedAt: Date.now(), pages: 2, quests: 0, error: '', unmatched: { pages: [], factions: [] } },
  log: { kills: 40, handIns: 0, unexplained: 0 },
  shared: { characters: [], kills: 0, handIns: 0 },
  alla: { read: 0, wanted: 0, error: '' },
  agnostic: true,
  races: null,
  unlocks: [],
  raceMods: null
}

const invoke = vi.fn((channel: string, ...args: unknown[]) => {
  switch (channel) {
    case 'app:state':
      return Promise.resolve(appState())
    case 'factions:plan':
      return Promise.resolve(structuredClone(data))
    case 'factions:follow':
    case 'factions:follow-step':
      return Promise.resolve(null)
    case 'settings:save':
      settings = args[0] as AppSettings
      return Promise.resolve(settings)
    case 'character:get':
      return Promise.resolve(DEFAULT_CHARACTER)
    case 'achievements:track':
      return Promise.resolve(null)
    default:
      return new Promise(() => {})
  }
})

let PlanTab: ComponentType<{ character: string; view: null }>
let StateProvider: ComponentType<{ children: React.ReactNode }>

beforeAll(async () => {
  Object.assign(window, { eql: { invoke, send: vi.fn(), on: vi.fn(() => () => {}) }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  ;({ StateProvider } = await import('../../src/renderer/src/state'))
  ;({ PlanTab } = await import('../../src/features/factions/planPage'))
})

const settle = async (host: Element, until: (text: string) => boolean) => {
  for (let i = 0; i < 50 && !until(seen(host)); i++) await act(async () => new Promise((r) => setTimeout(r, 20)))
}
const follows = () => invoke.mock.calls.filter((c) => c[0] === 'factions:follow')

it('draws the steps, saves a camp ruled out, and hands the plan on once a change of steps', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <StateProvider>
        <PlanTab character="Kelwyn_neriak" view={null} />
      </StateProvider>
    )
  )
  await settle(host, (t) => t.includes('Clan Crushbone'))
  const text = seen(host)
  // The quickest way to 2000: the centurions, at 10 a kill.
  expect(text).toContain('Clan Crushbone')
  expect(text).toContain('an orc centurion')
  expect(text).toContain('Emerald Warriors')

  // The plan goes to the main process once its steps are known, after a short wait, and once only.
  await act(async () => void vi.advanceTimersByTime(500))
  expect(follows()).toHaveLength(1)
  expect(follows()[0][1]).toBe('Kelwyn_neriak')
  await act(async () =>
    root.render(
      <StateProvider>
        <PlanTab character="Kelwyn_neriak" view={null} />
      </StateProvider>
    )
  )
  await act(async () => void vi.advanceTimersByTime(500))
  expect(follows()).toHaveLength(1)

  // The centurions ruled out: a choice in settings, and the pawns the plan instead, handed on again.
  // The first step's own Rule out.
  const out = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Rule out')
  expect(out, "the step's Rule out").toBeTruthy()
  await act(async () => out!.click())
  await settle(host, () => !!settings.factionPlan.choices['Kelwyn_neriak'])
  expect(settings.factionPlan.choices['Kelwyn_neriak']?.excluded).toEqual(['kill|Clan Crushbone|an orc centurion'])
  await settle(host, (t) => t.includes('an orc pawn'))
  await act(async () => void vi.advanceTimersByTime(500))
  expect(follows()).toHaveLength(2)
  vi.useRealTimers()
})
