import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { api } from '../api'
import { TimerBars } from '../components/TimerBars'
import { MeterOverlay } from './regions'
import type { CombatSnapshot, OverlayConfig, TimerView } from '../../../shared/types'

// One overlay in a window of its own: how the overlays are drawn while being arranged. While
// playing they share a host window per monitor instead (host.tsx).

/** Timers and the damage meter; the alerts overlay has a page of its own (src/alerts). */
function Overlay() {
  const [config, setConfig] = useState<OverlayConfig | null>(null)
  const [arranging, setArranging] = useState(false)
  const [timers, setTimers] = useState<TimerView[]>([])
  const [combat, setCombat] = useState<CombatSnapshot | null>(null)

  useEffect(() => {
    const offs = [
      api.on('overlay:config', (p: { config: OverlayConfig; arranging: boolean }) => {
        setConfig(p.config)
        setArranging(p.arranging)
      }),
      api.on('overlay:timers', (views: TimerView[]) => setTimers(views)),
      api.on('overlay:combat', (snap: CombatSnapshot) => setCombat(snap))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  if (!config) return null
  const mine = timers.filter((t) => t.overlay === config.id)
  return (
    <div className={`overlay${arranging ? ' arranging' : ''}`}>
      {config.kind === 'timers' ? (
        <TimerBars timers={mine} grouped={config.groupByTarget} fontSize={config.fontSize} />
      ) : config.kind === 'meter' ? (
        <MeterOverlay config={config} snap={combat} arranging={arranging} />
      ) : null}
      {arranging && <div className="arrange-label">{config.name} — drag to move, drag edges to resize</div>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Overlay />)
