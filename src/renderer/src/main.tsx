import { memo, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { StateProvider, useApp, useLive } from './state'
import { Ago, Icon, type IconName } from './components/ui'
import { GoContext } from './nav'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Jobs } from './components/Jobs'
import { act, Toasts } from './toast'
import { useUpdate } from './update'
import { useRemembered } from './remember'
import { useUnsaved } from './unsaved'
import { Dashboard } from './pages/Dashboard'
import { Spells } from './pages/Spells'
import { Motes } from './pages/Motes'
import { Triggers } from './pages/Triggers'
import { Overlays } from './pages/Overlays'
import { Audio } from './pages/Audio'
import { Logs } from './pages/Logs'
import { Settings } from './pages/Settings'
import { Achievements } from './pages/Achievements'
import { Gear } from './pages/Gear'
import { Upgrades } from './pages/Upgrades'
import { Stats } from './pages/Stats'
import { Loot } from './pages/Loot'
import { Respawns } from './pages/Respawns'
import { Tradeskills } from './pages/Tradeskills'
import { Buffs } from './pages/Buffs'
import { DamageMeter } from './pages/DamageMeter'
import { DataSources } from './pages/DataSources'
import { FEATURE_PAGES, type FeaturePageId } from '../../features'
import { Factions } from '../../features/factions/page'

/**
 * The pages that are not feature modules, in sidebar order, grouped by the player's day: Play for
 * what runs beside the game, Plan for what is worked out between sessions (and looked back on), Setup
 * for what is set once.
 */
const SHELL_PAGES = [
  { id: 'dashboard', group: 'Play', label: 'Live', icon: 'dashboard', el: Dashboard },
  { id: 'meter', group: 'Play', label: 'Damage Meter', icon: 'meter', el: DamageMeter },
  { id: 'buffs', group: 'Play', label: 'Buffs', icon: 'sparkle', el: Buffs },
  { id: 'respawns', group: 'Play', label: 'Respawns', icon: 'respawn', el: Respawns },
  { id: 'motes', group: 'Play', label: 'Motes', icon: 'motes', el: Motes },
  // Read mid-session ("what just dropped?"), beside the meter it shares New session with (LT-494).
  { id: 'loot', group: 'Play', label: 'Loot', icon: 'loot', el: Loot },
  { id: 'achievements', group: 'Plan', label: 'Achievements', icon: 'trophy', el: Achievements },
  { id: 'stats', group: 'Plan', label: 'Stats', icon: 'stats', el: Stats },
  { id: 'gear', group: 'Plan', label: 'Gear', icon: 'bag', el: Gear },
  { id: 'upgrades', group: 'Plan', label: 'Upgrades', icon: 'upgrade', el: Upgrades },
  { id: 'tradeskills', group: 'Plan', label: 'Tradeskills', icon: 'flask', el: Tradeskills },
  { id: 'spells', group: 'Setup', label: 'Spell Timers', icon: 'spells', el: Spells },
  { id: 'triggers', group: 'Setup', label: 'Triggers', icon: 'triggers', el: Triggers },
  { id: 'overlays', group: 'Setup', label: 'Overlays', icon: 'overlays', el: Overlays },
  { id: 'audio', group: 'Setup', label: 'Audio', icon: 'audio', el: Audio },
  { id: 'logs', group: 'Setup', label: 'Log Files', icon: 'logs', el: Logs },
  { id: 'sources', group: 'Setup', label: 'Data Sources', icon: 'sources', el: DataSources },
  { id: 'settings', group: 'Setup', label: 'Settings', icon: 'settings', el: Settings }
] as const

export type PageId = (typeof SHELL_PAGES)[number]['id'] | FeaturePageId

type PageComponent = ComponentType<{ go: (p: PageId) => void }>

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

/** How many timers run, beside Live in the sidebar. */
function TimerCount() {
  const n = useLive((l) => l.timers.length)
  return n > 0 ? <span className="count">{n}</span> : null
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
const PageHost = memo(function PageHost({ Page, go }: { Page: PageComponent; go: (p: PageId) => void }) {
  return <Page go={go} />
})

function Shell() {
  const { state } = useApp()
  // Opens where it was left, including across restarts.
  const [saved, setPage] = useRemembered<string>('page', 'dashboard')
  // 'inventory' was Gear's first name.
  const wanted = saved === 'inventory' ? 'gear' : saved
  const page = (PAGES.some((p) => p.id === wanted) ? wanted : 'dashboard') as PageId
  const Page = PAGES.find((p) => p.id === page)!.el
  const update = useUpdate()
  const unsaved = useUnsaved()
  return (
    <div className="shell">
      <div className="titlebar">
        <span className="brand">
          Legends <b>Tracker</b>
        </span>
        {state.settings.audio.muted && <span className="chip warn">Muted</span>}
        {state.arranging && <span className="chip warn">Arranging overlays</span>}
        {update.status?.state === 'ready' && (
          <button className="btn small primary" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} onClick={() => void act('update:install')}>
            Update ready ({update.status.version}): restart
          </button>
        )}
      </div>
      <nav className="sidebar" aria-label="Pages">
        {PAGES.map((p, i) => [
          p.group !== PAGES[i - 1]?.group && (
            <div key={`g-${p.group}`} className="nav-group">
              {p.group}
            </div>
          ),
          <button key={p.id} className={`nav-item${page === p.id ? ' active' : ''}`} aria-current={page === p.id ? 'page' : undefined} onClick={() => setPage(p.id)}>
            <Icon name={p.icon} />
            {p.label}
            {p.id === 'dashboard' && <TimerCount />}
            {unsaved.has(p.id) && (
              <span className="unsaved-mark" title="Changes not saved yet">
                ●<span className="sr-only"> (changes not saved)</span>
              </span>
            )}
          </button>
        ])}
        <WatchFoot />
      </nav>
      <main className="main">
        <Jobs />
        <ErrorBoundary key={page} what={`The ${PAGES.find((p) => p.id === page)!.label} page`}>
          <GoContext.Provider value={setPage}>
            <PageHost Page={Page} go={setPage} />
          </GoContext.Provider>
        </ErrorBoundary>
      </main>
      <Toasts />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary what="Legends Tracker">
    <StateProvider>
      <Shell />
    </StateProvider>
  </ErrorBoundary>
)
