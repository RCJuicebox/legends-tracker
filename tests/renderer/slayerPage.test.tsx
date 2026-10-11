// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, expect, it, vi } from 'vitest'
import { defaultSettings } from '../../src/main/storeCore'
import { DEFAULT_CHARACTER } from '../../src/shared/types'
import type { AppState } from '../../src/shared/ipc'
import { DEFAULT_CHOICES, type SlayerPlanData } from '../../src/features/slayer/core'

// The Slayer page with a plan to draw: its steps, the raid lockouts beside them, and a camp ruled out
// from its step's button kept as a choice.

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
  arranging: false,
  devices: [],
  triggerErrors: [],
  hotkeysTaken: []
}

const data: SlayerPlanData = {
  character: 'Kelwyn_neriak',
  export: { file: 'Kelwyn_neriak-Achievements.txt', modified: Date.now() - 3600_000 },
  goals: [
    { name: 'Orc Stomp!', section: 'Slayer: Conquest', races: 'Orcs and Wereorcs.', count: 4900, max: 5000, optional: false, tier: 0 },
    { name: 'Re-Extinction', section: 'Slayer: Skill', races: 'Kedge', count: 40, max: 50, optional: false, tier: 0 }
  ],
  camps: [
    {
      id: 'log:Clan Crushbone',
      zone: 'Clan Crushbone',
      mobs: ['an orc pawn'],
      source: 'log',
      pace: { 0: 150 },
      hours: 5,
      kills: 750,
      factions: [{ faction: 'Kaladim Residents', perHour: -40 }]
    },
    {
      id: 'play:Kedge Keep|Phinigel Autropos',
      zone: 'Kedge Keep',
      mobs: ['Phinigel Autropos'],
      source: 'play',
      pace: { 1: 5 },
      daily: true,
      note: 'One a difficulty a day.',
      said: 'test'
    }
  ],
  unplaced: [{ name: 'a mystery', n: 3 }],
  pending: 0
}

const invoke = vi.fn((channel: string, ...args: unknown[]) => {
  switch (channel) {
    case 'app:state':
      return Promise.resolve(structuredClone(appState))
    case 'logs:list':
      return Promise.resolve([{ character: 'Kelwyn_neriak', file: 'eqlog_Kelwyn_neriak.txt', size: 1, modified: 0 }])
    case 'character:exports':
      return Promise.resolve({ current: 'Kelwyn_neriak', achievements: ['Kelwyn_neriak'], inventory: [], factions: [] })
    case 'slayer:plan':
      return Promise.resolve({ data, choices: DEFAULT_CHOICES })
    case 'slayer:choices':
      return Promise.resolve(args.length)
    default:
      return new Promise(() => {})
  }
})

let Slayer: ComponentType
let StateProvider: ComponentType<{ children: React.ReactNode }>

beforeAll(async () => {
  Object.assign(window, { eql: { invoke, send: vi.fn(), on: vi.fn(() => () => {}) }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  ;({ StateProvider } = await import('../../src/renderer/src/state'))
  ;({ Slayer } = await import('../../src/features/slayer/page'))
})

it('draws the plan, the lockouts beside it, and keeps a camp ruled out', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <StateProvider>
        <Slayer />
      </StateProvider>
    )
  )
  for (let i = 0; i < 10 && !host.textContent?.includes('step by step'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)))
  const text = host.textContent ?? ''
  expect(text).toContain('The plan, step by step')
  expect(text).toContain('Clan Crushbone')
  expect(text).toContain('Orc Stomp! +100 done')
  expect(text).toContain('costs Kaladim Residents −40 an hour')
  // Ten kedge at five a day.
  expect(text).toContain('Every day')
  expect(text).toContain('5 a day · 2 days')
  // The steps under the Banestrike tier they work toward.
  expect(text).toContain('ProgressiveBanestrike rank 2')
  expect(text).toContain('a mystery ×3')
  const out = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Rule out')!
  await act(async () => out.click())
  expect(invoke).toHaveBeenCalledWith('slayer:choices', 'Kelwyn_neriak', expect.objectContaining({ outCamps: ['log:Clan Crushbone'] }))
  expect(host.textContent).toContain('Ruled out')
  const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text))!
  // Brought back from the list of camps ruled out.
  await act(async () => button('Ruled out').click())
  await act(async () => button('Bring back').click())
  expect(invoke).toHaveBeenLastCalledWith('slayer:choices', 'Kelwyn_neriak', expect.objectContaining({ outCamps: [] }))
  // An achievement turned off, from the list of those in the plan.
  await act(async () => button('Achievements in the plan').click())
  await act(async () => button('Orc Stomp!').click())
  expect(invoke).toHaveBeenLastCalledWith('slayer:choices', 'Kelwyn_neriak', expect.objectContaining({ excluded: ['orc stomp!'] }))
  await act(async () => button('Orc Stomp!').click())
  expect(invoke).toHaveBeenLastCalledWith('slayer:choices', 'Kelwyn_neriak', expect.objectContaining({ excluded: [] }))
  // The minutes between camps, typed in.
  const travel = host.querySelector<HTMLInputElement>('input[type="number"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(travel, '25')
    travel.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(invoke).toHaveBeenLastCalledWith('slayer:choices', 'Kelwyn_neriak', expect.objectContaining({ travelMin: 25 }))
  await act(async () => button('Read again').click())
  act(() => root.unmount())
  host.remove()
})
