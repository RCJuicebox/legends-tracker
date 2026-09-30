import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { api } from '../api'
import { OverlayRegion } from './regions'
import type { CombatSnapshot, OverlayConfig, TimerView } from '../../../shared/types'
import type { AchievementTrack } from '../../../shared/tracking'
import { opacityStyle } from '../../../shared/overlays'

// One overlay in a window of its own: how the overlays are drawn while being arranged. While
// playing they share a host window per monitor instead (host.tsx).

/** Timers and the damage meter; the alerts overlay has a page of its own (src/alerts). */
function Overlay() {
  const [config, setConfig] = useState<OverlayConfig | null>(null)
  const [arranging, setArranging] = useState(false)
  const [timers, setTimers] = useState<TimerView[]>([])
  const [combat, setCombat] = useState<CombatSnapshot | null>(null)
  const [track, setTrack] = useState<AchievementTrack | null>(null)

  useEffect(() => {
    const offs = [
      api.on('overlay:config', (p: { config: OverlayConfig; arranging: boolean }) => {
        setConfig(p.config)
        setArranging(p.arranging)
      }),
      api.on('overlay:timers', (views: TimerView[]) => setTimers(views)),
      api.on('overlay:combat', (snap: CombatSnapshot) => setCombat(snap)),
      api.on('overlay:achievements', (t: AchievementTrack | null) => setTrack(t))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  if (!config) return null
  const mine = timers.filter((t) => t.overlay === config.id)
  return (
    <div className={`overlay${arranging ? ' arranging' : ''}`} style={opacityStyle(config)}>
      <OverlayRegion config={config} timers={mine} combat={combat} track={track} arranging={arranging} />
      {arranging && (
        <div className="arrange-label">
          {config.name} — drag to move, drag edges to resize
          <button onClick={() => void api.invoke('overlays:arrange', false)}>Done</button>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Overlay />)
