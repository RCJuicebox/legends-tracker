import { memo, useCallback, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { StateProvider, useLive, useSettled } from './state'
import { Ago, Disclosure, Icon, type IconName } from './components/ui'
import { GoContext, TAB_KEY, type Go } from './nav'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Jobs } from './components/Jobs'
import { act, Toasts } from './toast'
import { useUpdate } from './update'
import { recall, remember, useRemembered } from './remember'
import { useUnsaved } from './unsaved'
import { Dashboard } from './pages/Dashboard'
import { Spells } from './pages/Spells'
import { Motes } from './pages/Motes'
import { Triggers } from './pages/Triggers'
import { Settings } from './pages/Settings'
import { Achievements } from './pages/Achievements'
import { Gear } from './pages/Gear'
import { Stats } from './pages/Stats'
import { Loot } from './pages/Loot'
import { Respawns } from './pages/Respawns'
import { Tradeskills } from './pages/Tradeskills'
import { Buffs } from './pages/Buffs'
import { DamageMeter } from './pages/DamageMeter'
import { FEATURE_PAGES, type FeaturePageId } from '../../features'
import { Factions } from '../../features/factions/page'

/**
 * The pages that are not feature modules, in sidebar order, grouped by the player's day: Play for
 * what runs beside the game, Plan for what is worked out between sessions (and looked back on), Setup
 * for what is set once. What is set once and seldom opened again (the overlays, audio, the log files,
 * the data sources) is a tab of Settings, not a page.
 */
const SHELL_PAGES = [
  { id: 'dashboard', group: 'Play', label: 'Live', icon: 'dashboard', el: Dashboard },
  { id: 'meter', group: 'Play', label: 'Damage Meter', icon: 'meter', el: DamageMeter },
  { id: 'buffs', group: 'Play', label: 'Buffs', icon: 'sparkle', el: Buffs },
  { id: 'respawns', group: 'Play', label: 'Respawns', icon: 'respawn', el: Respawns },
  // Read mid-session ("what just dropped?"), beside the meter it shares New session with (LT-494).
  { id: 'loot', group: 'Play', label: 'Loot', icon: 'loot', el: Loot },
  // Counted as you play, spent between sessions: one page, since it is one stock.
  { id: 'motes', group: 'Play', label: 'Motes', icon: 'motes', el: Motes },
  { id: 'achievements', group: 'Plan', label: 'Achievements', icon: 'trophy', el: Achievements },
  { id: 'stats', group: 'Plan', label: 'Stats', icon: 'stats', el: Stats },
  { id: 'gear', group: 'Plan', label: 'Gear', icon: 'bag', el: Gear },
  { id: 'tradeskills', group: 'Plan', label: 'Tradeskills', icon: 'flask', el: Tradeskills },
  { id: 'spells', group: 'Setup', label: 'Spell Timers', icon: 'spells', el: Spells },
  { id: 'triggers', group: 'Setup', label: 'Triggers', icon: 'triggers', el: Triggers },
  { id: 'settings', group: 'Setup', label: 'Settings', icon: 'settings', el: Settings }
] as const

export type PageId = (typeof SHELL_PAGES)[number]['id'] | FeaturePageId

type PageComponent = ComponentType<{ go: Go }>

/** Each feature module's page (src/features/<name>/page.tsx), by id. */
const FEATURE_ELEMENTS: Record<FeaturePageId, PageComponent> = { factions: Factions }

interface PageEntry {
  id: PageId
  group: string
  label: string
  icon: IconName
  el: PageComponent
}

/** Every page, in sidebar order: each feature's page goes in after the page its entry names. */
const PAGES: readonly PageEntry[] = (() => {
  const pages: PageEntry[] = [...SHELL_PAGES]
  for (const f of FEATURE_PAGES) {
    const at = pages.findIndex((p) => p.id === f.after)
    pages.splice(at < 0 ? pages.length : at + 1, 0, { ...f, el: FEATURE_ELEMENTS[f.id] })
  }
  return pages
})()

/** The sidebar's groups, in order. */
const GROUPS = [...new Set(PAGES.map((p) => p.group))]

/** Where a page that others open on a given tab keeps its tab, if it is one. */
const tabKey = (page: PageId): string | undefined => (TAB_KEY as Partial<Record<PageId, string>>)[page]

/** Pages that are now a tab of another, and Gear's first name: the page each is on, and its tab there. */
const MOVED = new Map<string, readonly [page: PageId, tab?: string]>([
  ['inventory', ['gear']],
  ['upgrades', ['motes', 'merge']],
  ['overlays', ['settings', 'overlays']],
  ['audio', ['settings', 'audio']],
  ['logs', ['settings', 'logs']],
  ['sources', ['settings', 'sources']]
])

/** A window last left on a page that has since moved opens where that page is now. */
function carryPage(): void {
  const [page, tab] = MOVED.get(recall<string>('page', '')) ?? []
  if (!page) return
  const key = tabKey(page)
  if (key && tab) remember(key, tab)
  remember('page', page)
}

/** How many timers run, beside Live in the sidebar. */
function TimerCount() {
  const n = useLive((l) => l.timers.length)
  return n > 0 ? <span className="count">{n}</span> : null
}

/** A page, or a folded group holding one, has edits that are not saved yet. */
function UnsavedMark() {
  return (
    <span className="unsaved-mark" title="Changes not saved yet">
      ●<span className="sr-only"> (changes not saved)</span>
    </span>
  )
}

/** Who is being watched, where, and when the log last spoke. */
function WatchFoot() {
  const s = useLive((l) => l.status)
  return (
    <div className="sidebar-foot">
      <div className="row tight">
        <span className={`status-dot${s.watching ? ' live' : ''}`} />
        <span className="who">{s.character || 'No character'}</span>
      </div>
      <div>{s.zone || 'Zone unknown'}</div>
      {/* Ticks by itself: status comes only with a line, so a quiet log would freeze it (LT-450). */}
      <div className="faint">
        {s.watching ? (
          s.lastLineAt ? (
            <>
              Last line <Ago t={s.lastLineAt} />
            </>
          ) : (
            'Watching; no line yet'
          )
        ) : (
          'Not watching'
        )}
      </div>
    </div>
  )
}

/** The open page, rendered again only when it asks to be, not whenever the shell is. */
const PageHost = memo(function PageHost({ Page, go }: { Page: PageComponent; go: Go }) {
  return <Page go={go} />
})

function Shell() {
  const muted = useSettled((s) => s.settings.audio.muted)
  const arranging = useSettled((s) => s.arranging)
  // Opens where it was left, including across restarts.
  const [saved, setPage] = useRemembered<string>('page', 'dashboard')
  const page = (PAGES.some((p) => p.id === saved) ? saved : 'dashboard') as PageId
  const Page = PAGES.find((p) => p.id === page)!.el
  const go = useCallback<Go>(
    (to, tab) => {
      const key = tabKey(to)
      if (key && tab) remember(key, tab)
      setPage(to)
    },
    [setPage]
  )
  // Setup starts folded: it is set once. A folded group still shows the page that is open, if it is one of its own.
  const [folded, setFolded] = useRemembered<string[]>('nav.folded', ['Setup'])
  const update = useUpdate()
  const unsaved = useUnsaved()
  return (
    <div className="shell">
      <div className="titlebar">
        <span className="brand">
          Legends <b>Tracker</b>
        </span>
        {muted && <span className="chip warn">Muted</span>}
        {arranging && <span className="chip warn">Arranging overlays</span>}
        {update.status?.state === 'ready' && (
          <button className="btn small primary" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} onClick={() => void act('update:install')}>
            Update ready ({update.status.version}): restart
          </button>
        )}
      </div>
      <nav className="sidebar" aria-label="Pages">
        {GROUPS.map((group) => {
          const own = PAGES.filter((p) => p.group === group)
          const shut = folded.includes(group)
          return [
            <Disclosure key={`g-${group}`} className="nav-group" open={!shut} onToggle={() => setFolded(shut ? folded.filter((g) => g !== group) : [...folded, group])}>
              <span>{group}</span>
              {/* Edits waiting on a page that is folded away still show. */}
              {shut && own.some((p) => p.id !== page && unsaved.has(p.id)) && <UnsavedMark />}
            </Disclosure>,
            ...own
              .filter((p) => !shut || p.id === page)
              .map((p) => (
                <button key={p.id} className={`nav-item${page === p.id ? ' active' : ''}`} aria-current={page === p.id ? 'page' : undefined} onClick={() => setPage(p.id)}>
                  <Icon name={p.icon} />
                  {p.label}
                  {p.id === 'dashboard' && <TimerCount />}
                  {unsaved.has(p.id) && <UnsavedMark />}
                </button>
              ))
          ]
        })}
        <WatchFoot />
      </nav>
      <main className="main">
        <Jobs />
        <ErrorBoundary key={page} what={`The ${PAGES.find((p) => p.id === page)!.label} page`}>
          <GoContext.Provider value={go}>
            <PageHost Page={Page} go={go} />
          </GoContext.Provider>
        </ErrorBoundary>
      </main>
      <Toasts />
    </div>
  )
}

carryPage()
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary what="Legends Tracker">
    <StateProvider>
      <Shell />
    </StateProvider>
  </ErrorBoundary>
)
