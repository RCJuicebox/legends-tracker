// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, expect, it, vi } from 'vitest'
import { defaultSettings } from '../../src/main/storeCore'
import { DEFAULT_CHARACTER } from '../../src/shared/types'
import type { AppState } from '../../src/shared/ipc'
import type { HunterPlanData } from '../../src/features/hunter/core'

// Plan › Hunter with named to draw: each zone's named left with what their spawns allow, a zone's
// map, and the marks on the game's map.

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

const spawn = (name: string, up: number, timer: number) => ({ name, race: 'Orc', lo: 15, hi: 15, spots: 1, up, timer, timerFrom: 'classic' as const, ceiling: 0 })
const data: HunterPlanData = {
  character: 'Kelwyn_neriak',
  export: { file: 'Kelwyn_neriak-Achievements.txt', modified: Date.now() - 3600_000 },
  zones: [
    {
      zone: 'Clan Crushbone',
      achievement: 'Hunter of Clan Crushbone',
      left: [
        { name: 'Lord Darish', spawn: spawn('Lord Darish', 0.25, 600), wait: 2400, seen: 'died 6 min ago; back in ~2 min as you timed it' },
        { name: 'Emperor Crush', spawn: { ...spawn('Emperor Crush', 1, 384), spots: 2, timerFrom: 'timed' }, wait: 0 }
      ],
      total: 4,
      since: ['Ambassador DVinn'],
      wait: 2400
    },
    {
      zone: 'Kedge Keep',
      achievement: 'Hunter of Kedge Keep',
      left: [{ name: 'Seahorse Patriarch' }, { name: 'Cauldron Hammerhead', spawn: { ...spawn('x', 0.5, 900), timerFrom: 'zone' }, wait: 1800 }],
      total: 2,
      since: [],
      wait: null
    }
  ],
  broken: ['Hunter of Befallen']
}
let answer: HunterPlanData = data

const invoke = vi.fn((channel: string, ...args: unknown[]) => {
  switch (channel) {
    case 'app:state':
      return Promise.resolve(structuredClone(appState))
    case 'logs:list':
      return Promise.resolve([{ character: 'Kelwyn_neriak', file: 'eqlog_Kelwyn_neriak.txt', size: 1, modified: 0 }])
    case 'character:exports':
      return Promise.resolve({ current: 'Kelwyn_neriak', achievements: ['Kelwyn_neriak'], inventory: [], factions: [] })
    case 'hunter:plan':
      return Promise.resolve(answer)
    case 'hunter:broken':
      return args[1] ? Promise.resolve([]) : Promise.reject(new Error('read-only'))
    case 'slayer:map':
      return Promise.resolve({ zone: 'Lake Nerius', short: '', lines: [], labels: [], spots: [] })
    case 'slayer:mark':
      return (args[0] as unknown[]).length ? Promise.resolve({ folder: 'maps/LegendsTracker', zones: 2, spots: 3 }) : Promise.reject('locked')
    default:
      return new Promise(() => {})
  }
})

let Hunter: ComponentType
let StateProvider: ComponentType<{ children: React.ReactNode }>

beforeAll(async () => {
  Object.assign(window, { eql: { invoke, send: vi.fn(), on: vi.fn(() => () => {}) }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  ;({ StateProvider } = await import('../../src/renderer/src/state'))
  ;({ Hunter } = await import('../../src/features/hunter/page'))
})

async function draw() {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <StateProvider>
        <Hunter />
      </StateProvider>
    )
  )
  for (let i = 0; i < 10 && !host.querySelector('.fp-step, .card.empty'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)))
  return { host, done: () => (act(() => root.unmount()), host.remove()) }
}

it('lists the named left, zone by zone, with what their spawns allow', async () => {
  const { host, done } = await draw()
  const text = host.textContent ?? ''
  expect(text).toContain('2 Hunter achievements to go, 4 named')
  expect(text).toContain('Lord Darish (1 spot · 25% · 10:00 · ≈ 40 min) · died 6 min ago; back in ~2 min as you timed it')
  expect(text).toContain('Emperor Crush (2 spots · always up · 6:24 · up now, then every 6:24) · not seen die in your log')
  expect(text).toContain('Emperor Crush (2 spots · always up · 6:24')
  expect(text).toContain('Seahorse Patriarch (not in TAKP’s tables)')
  expect(text).toContain('Killed since your export: Ambassador DVinn')
  expect(text).toContain('2 of 4 left')
  const button = (t: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(t))!
  await act(async () => button('Map').click())
  for (let i = 0; i < 10 && !host.textContent?.includes('do not have'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)))
  expect(host.textContent).toContain('TAKP’s spawn tables do not have Clan Crushbone')
  await act(async () => button('Map').click())
  await act(async () => button('Mark on the game’s map').click())
  expect(host.textContent).toContain('Marked 3 spots in 2 zones')
  expect(invoke).toHaveBeenLastCalledWith(
    'slayer:mark',
    [
      { zone: 'Clan Crushbone', mobs: [], named: ['Lord Darish', 'Emperor Crush'] },
      { zone: 'Kedge Keep', mobs: [], named: ['Seahorse Patriarch', 'Cauldron Hammerhead'] }
    ],
    'hunter'
  )
  await act(async () => button('Clear marks').click())
  expect(host.textContent).toContain('Could not mark the map: locked')
  // One that does not work in Legends, said so; one said not to work, working again (here, failing).
  expect(host.textContent).toContain('Hunter of BefallenWorks again')
  await act(async () => button('Doesn’t work').click())
  expect(invoke).toHaveBeenCalledWith('hunter:broken', 'Hunter of Clan Crushbone', true)
  await act(async () => button('Works again').click())
  expect(invoke).toHaveBeenLastCalledWith('hunter:broken', 'Hunter of Befallen', false)
  expect(host.textContent).toContain('Could not save that: read-only')
  done()
})

it('says when every Hunter achievement is done, and when there is no export', async () => {
  answer = { ...data, zones: [] }
  let d = await draw()
  expect(d.host.textContent).toContain('Every Hunter achievement that works is done.')
  d.done()
  answer = { ...data, zones: [], broken: [] }
  d = await draw()
  expect(d.host.textContent).toContain('Every Hunter achievement is done.')
  d.done()
  answer = { ...data, export: null, zones: [] }
  d = await draw()
  expect(d.host.textContent).toContain('No achievements export for')
  d.done()
})

it('finds a zone by any of its words, its achievement or a named, and the zone the player is in at a click', async () => {
  answer = data
  appState.status.zone = 'Kedge Keep'
  const { host, done } = await draw()
  const zones = () => [...host.querySelectorAll('.fp-zone')].map((z) => z.textContent)
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!
  const type = async (v: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  await type('crush clan')
  expect(zones()).toEqual(['Clan Crushbone'])
  await type('hammerhead')
  expect(zones()).toEqual(['Kedge Keep'])
  // Its number in the list stays the one it has among them all.
  expect(host.querySelector('.fp-num')?.textContent).toBe('2')
  await type('karana')
  expect(zones()).toEqual([])
  expect(host.textContent).toContain('Nothing to go matches “karana”.')
  const here = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Kedge Keep')!
  await act(async () => here.click())
  expect(input.value).toBe('Kedge Keep')
  expect(zones()).toEqual(['Kedge Keep'])
  appState.status.zone = ''
  done()
})
