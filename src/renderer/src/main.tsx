import { type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { StateProvider, useApp } from './state'
import { Icon } from './components/ui'
import { ago, api } from './api'
import { useUpdate } from './update'
import { useRemembered } from './remember'
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
import { Stats } from './pages/Stats'

const PAGES = [
  { id: 'dashboard', group: 'Play', label: 'Live', icon: 'dashboard', el: Dashboard },
  { id: 'spells', group: 'Play', label: 'Spell Timers', icon: 'spells', el: Spells },
  { id: 'motes', group: 'Play', label: 'Motes', icon: 'motes', el: Motes },
  { id: 'achievements', group: 'Character', label: 'Achievements', icon: 'trophy', el: Achievements },
  { id: 'stats', group: 'Character', label: 'Stats', icon: 'stats', el: Stats },
  { id: 'gear', group: 'Character', label: 'Gear', icon: 'bag', el: Gear },
  { id: 'triggers', group: 'Setup', label: 'Triggers', icon: 'triggers', el: Triggers },
  { id: 'overlays', group: 'Setup', label: 'Overlays', icon: 'overlays', el: Overlays },
  { id: 'audio', group: 'Setup', label: 'Audio', icon: 'audio', el: Audio },
  { id: 'logs', group: 'Setup', label: 'Log Files', icon: 'logs', el: Logs },
  { id: 'settings', group: 'Setup', label: 'Settings', icon: 'settings', el: Settings }
] as const

export type PageId = (typeof PAGES)[number]['id']

function Shell() {
  const { state } = useApp()
  // Opens where it was left, including across restarts.
  const [saved, setPage] = useRemembered<string>('page', 'dashboard')
  // 'inventory' was Gear's first name.
  const wanted = saved === 'inventory' ? 'gear' : saved
  const page = (PAGES.some((p) => p.id === wanted) ? wanted : 'dashboard') as PageId
  const Page = PAGES.find((p) => p.id === page)!.el as ComponentType<{ go: (p: PageId) => void }>
  const s = state.status
  const update = useUpdate()
  return (
    <div className="shell">
      <div className="titlebar">
        <span className="brand">
          Legends <b>Tracker</b>
        </span>
        {state.settings.audio.muted && <span className="chip warn">Muted</span>}
        {state.arranging && <span className="chip warn">Arranging overlays</span>}
        {update.status?.state === 'ready' && (
          <button className="btn small primary" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} onClick={() => api.invoke('update:install')}>
            Update ready ({update.status.version}): restart
          </button>
        )}
      </div>
      <nav className="sidebar">
        {PAGES.map((p, i) => [
          p.group !== PAGES[i - 1]?.group && (
            <div key={`g-${p.group}`} className="nav-group">
              {p.group}
            </div>
          ),
          <button key={p.id} className={`nav-item${page === p.id ? ' active' : ''}`} onClick={() => setPage(p.id)}>
            <Icon name={p.icon} />
            {p.label}
            {p.id === 'dashboard' && state.timers.length > 0 && <span className="count">{state.timers.length}</span>}
          </button>
        ])}
        <div className="sidebar-foot">
          <div className="row tight">
            <span className={`status-dot${s.watching ? ' live' : ''}`} />
            <span className="who">{s.character || 'No character'}</span>
          </div>
          <div>{s.zone || 'Zone unknown'}</div>
          <div className="faint">{s.watching ? `Last line ${ago(s.lastLineAt)}` : 'Not watching'}</div>
        </div>
      </nav>
      <main className="main">
        <Page go={setPage} />
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StateProvider>
    <Shell />
  </StateProvider>
)
