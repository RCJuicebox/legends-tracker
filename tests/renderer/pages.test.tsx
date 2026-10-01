// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../../src/main/storeCore'
import { DEFAULT_CHARACTER } from '../../src/shared/types'
import type { AppState } from '../../src/shared/ipc'
import type { PageId } from '../../src/renderer/src/main'

// Each page drawn once with nothing from the main process yet and once with every call failing: a
// hook called out of order, or a page reading what has not arrived, throws here rather than on a
// player's screen. Every tab a page has is opened too.

const appState: AppState = {
  settings: defaultSettings(),
  status: { watching: false, logFile: '', character: '', zone: '', spellsLoaded: 0, spellError: '', lastLineAt: 0, logSize: 0 },
  timers: [],
  feed: [],
  archive: { busy: false, message: '', pendingUntilGameExits: [], gameRunning: false, liveRotation: 'unknown' },
  character: DEFAULT_CHARACTER,
  characterKey: '',
  voices: [],
  speechError: '',
  arranging: false,
  devices: [],
  triggerErrors: [],
  hotkeysTaken: []
}

/** What every call other than app:state does: never answers, or fails. */
let mode: 'pending' | 'fail' = 'pending'

const bridge = {
  invoke: vi.fn((channel: string) => {
    if (channel === 'app:state') return Promise.resolve(structuredClone(appState))
    return mode === 'pending' ? new Promise(() => {}) : Promise.reject(new Error(`${channel} is not answered here`))
  }),
  send: vi.fn(),
  on: vi.fn(() => () => {})
}

type Page = ComponentType<{ go: (p: PageId) => void }>

/** The window's pages, as main.tsx imports them. */
const PAGE_NAMES = [
  'Dashboard',
  'DamageMeter',
  'Buffs',
  'Respawns',
  'Motes',
  'Achievements',
  'Stats',
  'Gear',
  'Upgrades',
  'Tradeskills',
  'Loot',
  'Spells',
  'Triggers',
  'Overlays',
  'Audio',
  'Logs',
  'DataSources',
  'Settings',
  'Factions'
]
let pages: Record<string, Page>
let StateProvider: ComponentType<{ children: React.ReactNode }>

beforeAll(async () => {
  // The bridge is read when api.ts is first imported, so it is in place before any page is.
  Object.assign(window, { eql: bridge, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  ;({ StateProvider } = await import('../../src/renderer/src/state'))
  pages = {
    Dashboard: (await import('../../src/renderer/src/pages/Dashboard')).Dashboard,
    DamageMeter: (await import('../../src/renderer/src/pages/DamageMeter')).DamageMeter,
    Buffs: (await import('../../src/renderer/src/pages/Buffs')).Buffs,
    Respawns: (await import('../../src/renderer/src/pages/Respawns')).Respawns,
    Motes: (await import('../../src/renderer/src/pages/Motes')).Motes,
    Achievements: (await import('../../src/renderer/src/pages/Achievements')).Achievements,
    Stats: (await import('../../src/renderer/src/pages/Stats')).Stats,
    Gear: (await import('../../src/renderer/src/pages/Gear')).Gear,
    Upgrades: (await import('../../src/renderer/src/pages/Upgrades')).Upgrades,
    Tradeskills: (await import('../../src/renderer/src/pages/Tradeskills')).Tradeskills,
    Loot: (await import('../../src/renderer/src/pages/Loot')).Loot,
    Spells: (await import('../../src/renderer/src/pages/Spells')).Spells,
    Triggers: (await import('../../src/renderer/src/pages/Triggers')).Triggers,
    Overlays: (await import('../../src/renderer/src/pages/Overlays')).Overlays,
    Audio: (await import('../../src/renderer/src/pages/Audio')).Audio,
    Logs: (await import('../../src/renderer/src/pages/Logs')).Logs,
    DataSources: (await import('../../src/renderer/src/pages/DataSources')).DataSources,
    Settings: (await import('../../src/renderer/src/pages/Settings')).Settings,
    Factions: (await import('../../src/features/factions/page')).Factions
  }
})

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = host = null
  localStorage.clear()
})

/** Draws the page, opens each of its tabs, and returns what went wrong on the way and the tabs opened. */
async function draw(Page: Page): Promise<{ errors: string[]; tabs: string[] }> {
  const errors: string[] = []
  const opened = new Set<string>()
  const said = (e: unknown) =>
    errors.push(
      e instanceof Error
        ? `${e.message}
${e.stack ?? ''}`
        : String(e)
    )
  const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => said(args.map(String).join(' ')))
  try {
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host, { onUncaughtError: said, onCaughtError: said, onRecoverableError: said })
    await act(async () =>
      root!.render(
        <StateProvider>
          <main>
            <Page go={() => {}} />
          </main>
        </StateProvider>
      )
    )
    // Past the app's own loading line: the page itself drew something, if only its own loading line.
    expect(host.querySelector('main')?.childElementCount, `the page, in ${host.innerHTML.slice(0, 300)}`).toBeGreaterThan(0)
    // Tabs, opened one after another; a tab may bring tabs of its own, opened while the list grows.
    for (let tab = nextTab(host, opened); tab; tab = nextTab(host, opened)) {
      opened.add(tabName(tab))
      await act(async () => tab.click())
    }
  } finally {
    consoleError.mockRestore()
  }
  return { errors, tabs: [...opened] }
}

const tabName = (t: HTMLElement) => `${t.closest('[role="tablist"]')?.getAttribute('aria-label') ?? ''}/${t.textContent}`
const nextTab = (host: HTMLElement, opened: Set<string>) => [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => !opened.has(tabName(t))) ?? null

describe('every page draws', () => {
  it('covers every page the window has', () => {
    const shell = readFileSync(join(__dirname, '../../src/renderer/src/main.tsx'), 'utf8')
    const drawn = [...shell.matchAll(/^import \{ (\w+) \} from '[./\w]+\/(?:pages|features\/\w+)\/\w+'$/gm)].map((m) => m[1])
    expect(drawn.sort()).toEqual([...PAGE_NAMES].sort())
    expect(Object.keys(pages).sort()).toEqual([...PAGE_NAMES].sort())
  })

  it('opens a page’s tabs', async () => {
    mode = 'pending'
    expect((await draw(pages.Upgrades)).tabs).toEqual(['Upgrades view/Best merge', 'Upgrades view/Merge planner', 'Upgrades view/Spell upgrades'])
  })

  for (const which of ['pending', 'fail'] as const)
    describe(which === 'pending' ? 'before the main process answers' : 'when every call fails', () => {
      it.each(PAGE_NAMES)('%s', async (name) => {
        mode = which
        expect((await draw(pages[name])).errors).toEqual([])
      })
    })
})
