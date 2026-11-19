// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, expect, it, vi } from 'vitest'
import { defaultSettings } from '../../src/main/storeCore'
import { DEFAULT_CHARACTER } from '../../src/shared/types'
import type { AppState } from '../../src/shared/ipc'
import ROUTES from '../../src/shared/game/crawlRoutes.json'
import type { CrawlData, CrawlRoutes } from '../../src/features/crawl/core'

// Motes › Crawl route drawn with the shipped Kedge Keep route: the stops in order with their floors, the
// map cut by depth, a run's ticks, and the route sent to the game's map.

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

const route = (ROUTES.zones as unknown as CrawlRoutes)['kedge']
let answer: CrawlData = { zones: ['Kedge Keep'], route, lines: [0, 0, 300, 50, 0, 300, 0, 0, -80, 50, 40, -80], marked: false, campsMarked: false, run: null, here: false }

const invoke = vi.fn((channel: string, ...args: unknown[]) => {
  switch (channel) {
    case 'app:state':
      return Promise.resolve(structuredClone(appState))
    case 'crawl:route':
      return Promise.resolve(answer)
    case 'crawl:mark':
      return args[1] ? Promise.resolve({ folder: 'maps/LegendsTracker', lines: args[2] === 'camps' ? 60 : 150 }) : Promise.reject(new Error('locked'))
    case 'game:location':
      return Promise.resolve({ zone: 'Kedge Keep 1 (Awakened)', y: -50, x: -100, z: -90, at: Date.now() })
    default:
      return new Promise(() => {})
  }
})

let CrawlRoutePage: ComponentType
let StateProvider: ComponentType<{ children: React.ReactNode }>
let Toasts: ComponentType

beforeAll(async () => {
  Object.assign(window, { eql: { invoke, send: vi.fn(), on: vi.fn(() => () => {}) }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  ;({ StateProvider } = await import('../../src/renderer/src/state'))
  ;({ CrawlRoutePage } = await import('../../src/features/crawl/page'))
  ;({ Toasts } = await import('../../src/renderer/src/toast'))
})

async function draw() {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <StateProvider>
        <CrawlRoutePage />
        <Toasts />
      </StateProvider>
    )
  )
  for (let i = 0; i < 10 && !host.querySelector('.fp-step, .card.empty'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)))
  return { host, done: () => (act(() => root.unmount()), host.remove()) }
}

const button = (host: Element, t: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(t))!

it('lists the stops in order with their floors and the way to each, and draws the map by depth', async () => {
  const { host, done } = await draw()
  const text = seen(host)
  expect(text).toContain(`${route.stops.length} stops`)
  expect(text).toContain('a fierce impaler')
  expect(text).toContain('from the zone-in')
  expect(text).toContain('from stop 1')
  expect(text).toContain('Top floor')
  expect(text).toMatch(/The way: Top ↓ /)
  expect(text).toContain('(rare by /con)')
  expect(text).toContain('you at /loc -50, -100, -90')
  // A stop for each, numbered; the zone's lines a path for each floor.
  expect(host.querySelectorAll('.cr-map-stop')).toHaveLength(route.stops.length)
  expect(host.querySelectorAll('.cr-map-line')).toHaveLength(route.floors.length)
  const top = host.querySelector('.cr-map')!.getAttribute('viewBox')
  // From the side: height up, another shape of map.
  await act(async () => button(host, 'From the side').click())
  expect(host.querySelector('.cr-map')!.getAttribute('viewBox')).not.toBe(top)
  expect(host.querySelector('.cr-map')!.getAttribute('aria-label')).toContain('from the side')
  await act(async () => button(host, 'Top').click())
  expect(host.querySelector('.cr-map')!.getAttribute('aria-label')).toContain('the Top floor')
  // Pointing at a stop says what pops there and its /waypoint.
  await act(async () => host.querySelector<SVGGElement>('.cr-map-stop')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
  expect(seen(host)).toMatch(/Stop 1 · Top floor · a fierce impaler · \/waypoint /)
  done()
})

it('draws the route on the game’s map, and says so when it cannot', async () => {
  const { host, done } = await draw()
  await act(async () => button(host, 'Draw it on the game’s map').click())
  expect(invoke).toHaveBeenCalledWith('crawl:mark', 'Kedge Keep', true, 'route')
  expect(seen(host)).toContain('Drew the route on Kedge Keep’s map, 150 lines and labels')
  done()
  answer = { ...answer, marked: true }
  const again = await draw()
  await act(async () => button(again.host, 'Take it off the game’s map').click())
  expect(seen(again.host)).toContain('Could not write the game’s map: locked')
  again.done()
})

it('shows the places to sit on a view of their own: those under the level wanted first, the one picked with what it sees', async () => {
  answer = { ...answer, marked: false }
  const { host, done } = await draw()
  expect(host.querySelectorAll('.cr-map-camp')).toHaveLength(0)
  await act(async () => button(host, 'Places to sit').click())
  const camps = route.camps!
  const text = seen(host)
  expect(text).toContain(`${camps.length} places with four or more spawn spots in sight, 2 of them of mobs under level 40`)
  expect(text).toContain('7 spawn spots in sight')
  expect(text).toContain('lancer swordfish 28–32')
  expect(text).toContain('levels 28–36')
  expect(text).toContain('All of the 7 within 70: they come at you as they pop')
  expect(text).toContain('respawn about 20 min')
  expect(text).toContain('Level 40 and over')
  // The route's stops give way to the places, lettered; the first is picked, with a line to each spot it sees.
  expect(host.querySelectorAll('.cr-map-stop:not(.cr-map-camp)')).toHaveLength(0)
  expect(host.querySelectorAll('.cr-map-camp')).toHaveLength(camps.length)
  expect(host.querySelectorAll('.cr-map-ray')).toHaveLength(7)
  expect(text).toMatch(/Place A · Top floor · 7 spots in sight, levels 28–36 · \/waypoint /)
  const steps = [...host.querySelectorAll('.fp-step:not([hidden] .fp-step)')]
  expect(steps[0].className).toContain('now')
  // Another picked from the list, or on the map.
  await act(async () => steps[1].querySelector<HTMLButtonElement>('.cr-pick')!.click())
  expect(seen(host)).toMatch(/Place B · /)
  expect(host.querySelectorAll('.cr-map-ray.over').length).toBe(camps[1].over?.length ?? 0)
  await act(async () => host.querySelectorAll<SVGGElement>('.cr-map-camp')[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(seen(host)).toMatch(/Place C · /)
  await act(async () => host.querySelectorAll<SVGGElement>('.cr-map-camp')[0].dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(seen(host)).toMatch(/Place A · /)
  // They go on the game's map on their own layer.
  await act(async () => button(host, 'Draw them on the game’s map').click())
  expect(invoke).toHaveBeenCalledWith('crawl:mark', 'Kedge Keep', true, 'camps')
  expect(seen(host)).toContain('Drew the places to sit on Kedge Keep’s map, 60 lines and labels')
  expect(seen(host)).toContain('layer 3')
  // Back to the route.
  await act(async () => button(host, 'Crawl route').click())
  expect(host.querySelectorAll('.cr-map-camp')).toHaveLength(0)
  expect(host.querySelectorAll('.cr-map-stop')).toHaveLength(route.stops.length)
  done()
})

it('ticks the stops of a run in hand and marks the next', async () => {
  answer = { ...answer, marked: false, here: true, run: { instance: 'Kedge Keep 1 (Awakened)', startedAt: 1, killed: { 'fierce impaler': 5 }, up: { cauldronbubble: 6 } } }
  const { host, done } = await draw()
  expect(seen(host)).toContain('Run in hand: 1 of 11 stops')
  const steps = [...host.querySelectorAll('.fp-step')]
  expect(steps[0].querySelector('.fp-num')?.textContent).toBe('✓')
  expect(steps[0].querySelector('.cr-dead')).not.toBeNull()
  expect(steps[1].className).toContain('now')
  expect(host.querySelector('.cr-up')?.textContent).toBe('up')
  expect(host.querySelectorAll('.cr-map-stop.done')).toHaveLength(1)
  done()
})

it('says so when no zone has a route', async () => {
  answer = { zones: [], route: null, lines: [], marked: false, campsMarked: false, run: null, here: false }
  const { host, done } = await draw()
  expect(seen(host)).toContain('No zone has a crawl route yet.')
  done()
})
