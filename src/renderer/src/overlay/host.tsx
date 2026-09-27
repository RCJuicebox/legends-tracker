import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import '../alerts/alerts.css'
import { api } from '../api'
import { TimerBars } from '../components/TimerBars'
import { AlertsRegion, MeterOverlay } from './regions'
import type { CombatSnapshot, OverlayConfig, TimerView } from '../../../shared/types'

// The overlays on one monitor, each a region of one transparent window over the game: one
// renderer instead of one per overlay. The window covers just their area; `origin` is where its
// top left sits on the screen, so an overlay at screen x is drawn at x - origin.x.

function Host() {
  const [configs, setConfigs] = useState<OverlayConfig[]>([])
  const [origin, setOrigin] = useState({ x: 0, y: 0 })
  const [timers, setTimers] = useState<TimerView[]>([])
  const [combat, setCombat] = useState<CombatSnapshot | null>(null)

  useEffect(() => {
    // What to draw, asked for once the page listens (a push sent while it loaded may be gone).
    const display = Number(new URLSearchParams(location.search).get('display'))
    void api.invoke('overlay:hostState', display).then((s) => {
      if (!s) return
      setConfigs(s.configs)
      setOrigin(s.origin)
      setTimers(s.timers)
      if (s.combat) setCombat(s.combat)
    })
    const offs = [
      api.on('overlay:host', (p: { configs: OverlayConfig[]; origin: { x: number; y: number } }) => {
        setConfigs(p.configs)
        setOrigin(p.origin)
      }),
      api.on('overlay:timers', (views: TimerView[]) => setTimers(views)),
      api.on('overlay:combat', (snap: CombatSnapshot) => setCombat(snap))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  return (
    <>
      {configs.map((c) => (
        <div
          key={c.id}
          className="host-region"
          style={{ left: Math.round(c.x) - origin.x, top: Math.round(c.y) - origin.y, width: Math.round(c.width), height: Math.round(c.height), opacity: c.opacity }}
        >
          <div className="overlay">
            {c.kind === 'timers' ? (
              <TimerBars timers={timers.filter((t) => t.overlay === c.id)} grouped={c.groupByTarget} fontSize={c.fontSize} />
            ) : c.kind === 'meter' ? (
              <MeterOverlay config={c} snap={combat} arranging={false} />
            ) : (
              <AlertsRegion config={c} />
            )}
          </div>
        </div>
      ))}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Host />)
