import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { api } from '../api'
import { TimerBars } from '../components/TimerBars'
import type { OverlayConfig, TimerView } from '../../../shared/types'

interface Alert {
  id: number
  text: string
  color: string
  until: number
}

function Overlay() {
  const [config, setConfig] = useState<OverlayConfig | null>(null)
  const [arranging, setArranging] = useState(false)
  const [timers, setTimers] = useState<TimerView[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])

  useEffect(() => {
    const offs = [
      api.on('overlay:config', (p: { config: OverlayConfig; arranging: boolean }) => {
        setConfig(p.config)
        setArranging(p.arranging)
      }),
      api.on('overlay:timers', (views: TimerView[]) => setTimers(views)),
      api.on('overlay:alert', (a: { text: string; color: string; durationSec: number }) => {
        const id = Math.random()
        setAlerts((list) => [...list.slice(-5), { id, text: a.text, color: a.color || '#ffd84d', until: Date.now() + (a.durationSec || 5) * 1000 }])
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    if (!alerts.length) return
    const id = setInterval(() => setAlerts((list) => list.filter((a) => a.until > Date.now())), 250)
    return () => clearInterval(id)
  }, [alerts.length])

  if (!config) return null
  const mine = timers.filter((t) => t.overlay === config.id)
  return (
    <div className={`overlay${arranging ? ' arranging' : ''}`}>
      {config.kind === 'timers' ? (
        <TimerBars timers={mine} grouped={config.groupByTarget} fontSize={config.fontSize} />
      ) : (
        <div className="alerts">
          {alerts.map((a) => (
            <div key={a.id} className="alert-line" style={{ color: a.color, fontSize: config.fontSize }}>
              {a.text}
            </div>
          ))}
          {arranging && !alerts.length && (
            <div className="alert-line" style={{ color: '#ffd84d', fontSize: config.fontSize }}>
              Alert text appears here
            </div>
          )}
        </div>
      )}
      {arranging && <div className="arrange-label">{config.name} — drag to move, drag edges to resize</div>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Overlay />)
