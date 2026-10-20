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

/** The text as drawn: a Tip in a list of rows carries its words for screen readers in a hidden span, left out here. */
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
      kinds: [
        {
          name: 'an orc pawn',
          perHour: 150,
          goals: [0],
          spawn: { name: 'an orc pawn', race: 'Orc', lo: 1, hi: 3, spots: 12, up: 12, timer: 384, timerFrom: 'zone' as const, ceiling: 112 },
          bound: true
        }
      ],
      source: 'log',
      pace: { 0: 150 },
      hours: 5,
      kills: 750,
      factions: [{ faction: 'Kaladim Residents', perHour: -40 }]
    },
    {
      id: 'play:Kedge Keep|Phinigel Autropos',
      zone: 'Kedge Keep',
      kinds: [{ name: 'Phinigel Autropos', perHour: 5, goals: [1] }],
      source: 'play',
      pace: { 1: 5 },
      daily: true,
      note: 'One a difficulty a day.',
      said: 'test',
      today: 2
    }
  ],
  raising: ['Kaladim Residents'],
  unplaced: [{ name: 'a mystery', n: 3 }],
  pending: 0,
  moves: [],
  killSpeed: 90,
  timings: [
    {
      zone: 'Clan Crushbone',
      timer: 384,
      timed: [
        { name: 'Orc scoutsman', legends: 384, classic: 600 },
        { name: 'A wanderer', legends: 300, classic: null }
      ]
    },
    { zone: 'Kedge Keep', timer: null, timed: [{ name: 'A sailfin', legends: 300, classic: null }] }
  ],
  hunter: [
    {
      zone: 'Clan Crushbone',
      achievement: 'Hunter of Clan Crushbone',
      left: [
        { name: 'Lord Darish', spawn: { name: 'Lord Darish', race: 'Orc', lo: 15, hi: 15, spots: 1, up: 0.25, timer: 384, timerFrom: 'zone', ceiling: 2.3 } },
        { name: 'Ambassador DVinn' }
      ],
      total: 3,
      since: [],
      wait: null,
      dueIn: 0
    }
  ]
}

let answer: SlayerPlanData = data

const invoke = vi.fn((channel: string, ...args: unknown[]) => {
  switch (channel) {
    case 'app:state':
      return Promise.resolve(structuredClone(appState))
    case 'logs:list':
      return Promise.resolve([{ character: 'Kelwyn_neriak', file: 'eqlog_Kelwyn_neriak.txt', size: 1, modified: 0 }])
    case 'character:exports':
      return Promise.resolve({ current: 'Kelwyn_neriak', achievements: ['Kelwyn_neriak'], inventory: [], factions: [] })
    case 'slayer:plan':
      return Promise.resolve({ data: answer, choices: DEFAULT_CHOICES })
    case 'slayer:choices':
      return Promise.resolve(args.length)
    case 'slayer:map':
      return Promise.resolve({
        zone: 'Clan Crushbone',
        short: 'crushbone',
        lines: [0, 0, 100, 100, 50, 0, 50, 100],
        labels: [
          { x: 10, y: 10, text: 'to Greater Faydark' },
          { x: 20, y: 20, text: 'Throne' }
        ],
        spots: [{ x: 30, y: 40, z: 0, mobs: [{ name: 'an orc pawn', chance: 50 }], timer: 600 }],
        camps: [{ x: 30, y: 40, z: 0, radius: 150, spots: 1, perHour: 3 }]
      })
    case 'slayer:mark':
      return (args[0] as unknown[]).length ? Promise.resolve({ folder: 'maps/LegendsTracker', zones: 1, spots: 12 }) : Promise.reject(new Error('locked'))
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
  for (let i = 0; i < 10 && !seen(host).includes('step by step'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)))
  const text = seen(host)
  expect(text).toContain('The plan, step by step')
  // The headline's kills are the steps' own, the lockouts' beside them (LT-563).
  expect(text).toContain('2 achievements to go, 100 kills in the steps, 10 by the lockouts')
  expect(text).toContain('Clan Crushbone')
  // What the step is there for, and what to kill for it.
  expect(text).toContain('Orc Stomp! 4,900 / 5,000+100 done · an orc pawn ×100')
  expect(text).toContain('×100')
  expect(text).toContain('costs Kaladim Residents −40 an hour')
  // Ten kedge at five a day.
  expect(text).toContain('Every day')
  expect(text).toContain('5 a day · 2 days · 2 of 5 today')
  // The steps under the Banestrike tier they work toward.
  expect(text).toContain('ProgressiveBanestrike rank 2')
  expect(text).toContain('a mystery ×3')
  // A mob ruled out from beside its name.
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Rule out an orc pawn"]')!.click())
  expect(invoke).toHaveBeenLastCalledWith('slayer:choices', 'Kelwyn_neriak', expect.objectContaining({ outMobs: ['an orc pawn'] }))
  const toggle = () => [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Ruled out'))!
  await act(async () => toggle().click())
  expect(seen(host)).toContain('an orc pawn, wherever it is')
  await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Bring back')!.click())
  expect(invoke).toHaveBeenLastCalledWith('slayer:choices', 'Kelwyn_neriak', expect.objectContaining({ outMobs: [] }))
  const out = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Rule out')!
  await act(async () => out.click())
  expect(invoke).toHaveBeenCalledWith('slayer:choices', 'Kelwyn_neriak', expect.objectContaining({ outCamps: ['log:Clan Crushbone'] }))
  expect(seen(host)).toContain('Ruled out')
  const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text))!
  // Brought back from the list of camps ruled out, still open from the mob's.
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
  // Saved when the field is left, not a keystroke at a time (LT-507).
  expect(invoke).not.toHaveBeenLastCalledWith('slayer:choices', 'Kelwyn_neriak', expect.objectContaining({ travelMin: 25 }))
  await act(async () => travel.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(invoke).toHaveBeenLastCalledWith('slayer:choices', 'Kelwyn_neriak', expect.objectContaining({ travelMin: 25 }))
  await act(async () => button('Read again').click())
  // Built afresh, not the shared build of the last 30 s (LT-537).
  expect(invoke).toHaveBeenCalledWith('slayer:plan', 'Kelwyn_neriak', true)
  // What the spawns allow beside each mob, what holds the camp back, and the Hunter named on the way.
  expect(seen(host)).toContain('(12 spots · 6:24 · spawn-bound)')
  expect(seen(host)).toContain('Hunter of Clan Crushbone · Lord Darish (1 spot · 25% · 6:24), Ambassador DVinn')
  expect(seen(host)).toContain('your usual pace 90/h')
  // The step's map.
  await act(async () => button('Map').click())
  for (let i = 0; i < 10 && !host.querySelector('svg.sl-map'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)))
  expect(host.querySelectorAll('circle.sl-map-spot')).toHaveLength(1)
  expect(seen(host)).toContain('to Greater Faydark')
  expect(seen(host)).not.toContain('Throne')
  // Where to stand with a pet, ringed, its /waypoint (the /loc order) under the map.
  expect(host.querySelectorAll('.sl-map-camp circle.sl-map-reach')).toHaveLength(1)
  expect(seen(host)).toContain('AFK pet spot: /waypoint -40, -30 · 1 spawn within 150, about 3 an hour on classic timers')
  await act(async () => button('Map').click())
  // Timed respawns against classic, an input among the Assumptions, counted in the fold's summary.
  expect(seen(host)).toContain('2 zone respawns timed')
  expect(seen(host)).toContain('Clan Crushbone 6:24 · Orc scoutsman 6:24 (classic 10:00), A wanderer 5:00')
  expect(seen(host)).toContain('Kedge Keep no timer · A sailfin 5:00')
  // A step's map shows its own mobs, not the Hunter named there; nothing of the plan goes on the game's map.
  expect(invoke).toHaveBeenCalledWith('slayer:map', 'Clan Crushbone', ['an orc pawn'])
  expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Mark on the game'))).toBe(false)
  expect(invoke.mock.calls.some((c) => c[0] === 'slayer:mark')).toBe(false)
  act(() => root.unmount())
  host.remove()
})

it('marks the steps in the zone the player is in, and jumps to the first', async () => {
  appState.status.zone = 'Clan Crushbone'
  const scrolled = vi.fn()
  Element.prototype.scrollIntoView = scrolled
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <StateProvider>
        <Slayer />
      </StateProvider>
    )
  )
  for (let i = 0; i < 10 && !seen(host).includes('step by step'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)))
  const now = [...host.querySelectorAll('li.fp-step.now')]
  expect(now).toHaveLength(1)
  expect(now[0].textContent).toContain('Clan Crushbone')
  expect(now[0].textContent).toContain('You are here')
  const here = [...host.querySelectorAll('button')].find((b) => b.textContent === 'You are here: step 1')!
  await act(async () => here.click())
  expect(scrolled).toHaveBeenCalledTimes(1)
  expect((scrolled.mock.instances[0] as HTMLElement).id).toBe('sl-step-1')
  // The camp costs a faction the faction plan is raising: flagged, and ruled out by choice, listed with the reason (LT-656).
  const cost = [...host.querySelectorAll('.bad-text')].find((e) => e.textContent?.includes('Kaladim Residents'))
  expect(cost).toBeDefined()
  const avoid = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Avoid my faction plan'))!
  await act(async () => avoid.click())
  expect(invoke).toHaveBeenLastCalledWith('slayer:choices', 'Kelwyn_neriak', expect.objectContaining({ avoidPlanFactions: true }))
  await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Ruled out'))!.click())
  expect(seen(host)).toContain('Clan Crushbone: an orc pawn')
  expect(seen(host)).toContain('costs Kaladim Residents, which your faction plan raises')
  act(() => root.unmount())
  host.remove()
  appState.status.zone = ''
})

it('draws what the plan leaves out, finds a step, and turns the overlay on once the choices are in (LT-662 to LT-667)', async () => {
  answer = {
    ...data,
    sinceKills: true,
    goals: [
      ...data.goals,
      { name: 'A Giant Problem', section: 'Slayer: Conquest', races: 'Giants', count: 10, max: 500, optional: false, tier: 0 },
      { name: 'Done Deal', section: 'Slayer: Conquest', races: 'Gnolls', count: 500, max: 500, optional: false, tier: 0 }
    ]
  }
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <StateProvider>
        <Slayer />
      </StateProvider>
    )
  )
  for (let i = 0; i < 10 && !seen(host).includes('step by step'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)))
  const text = seen(host)
  // The counts have the kills since, for the character being played.
  expect(text).toContain('plus your kills since')
  // An achievement nothing feeds, and the kills no race was found for.
  expect(text).toContain('Not planned')
  expect(text).toContain('A Giant Problem (Giants) 10/500')
  expect(text).toContain('Kills no race was found for')
  expect(text).toContain('a mystery ×3')
  const button = (t: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(t))!
  // The achievement chips: a count each, a done one ticked, a jump to the step.
  await act(async () => button('Achievements in the plan').click())
  expect(seen(host)).toContain('✓ Done Deal500/500')
  expect(seen(host)).toContain('Orc Stomp!4,900/5,000step 1')
  // A search dims the steps it does not find.
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!
  const type = async (v: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  await type('kedge')
  expect(seen(host)).toContain('0 of 1 steps match')
  expect(host.querySelector('#sl-step-1')?.classList.contains('sl-dim')).toBe(true)
  await type('orc pawn')
  expect(seen(host)).toContain('1 of 1 steps match')
  expect(host.querySelector('#sl-step-1')?.classList.contains('sl-dim')).toBe(false)
  // The overlay chip, once the saved choices are in.
  const chip = [...host.querySelectorAll('button')].find((b) => b.textContent === 'On the overlay')!
  expect(chip.classList.contains('waiting')).toBe(false)
  await act(async () => chip.click())
  expect(invoke).toHaveBeenLastCalledWith('slayer:choices', 'Kelwyn_neriak', expect.objectContaining({ overlay: true }))
  answer = data
  act(() => root.unmount())
  host.remove()
})
