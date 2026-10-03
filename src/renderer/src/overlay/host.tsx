import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { api } from '../api'
import { OverlayRegion } from './regions'
import type { CombatSnapshot, OverlayConfig, TimerView } from '../../../shared/types'
import type { AchievementTrack } from '../../../shared/tracking'
import { opacityStyle } from '../../../shared/overlays'

// The overlays on one monitor, each a region of one transparent window over the game: one
// renderer instead of one per overlay. The window covers just their area; `origin` is where its
// top left sits on the screen, so an overlay at screen x is drawn at x - origin.x.

const NO_TIMERS: TimerView[] = []

/**
 * One overlay's region. Each is given only what it draws (a meter region never sees the timers, a
 * timers region only its own), and is drawn again only when that changes: timers come up to five
 * times a second and the meter twice.
 */
const Region = memo(function Region(p: { c: OverlayConfig; origin: { x: number; y: number }; timers: TimerView[]; combat: CombatSnapshot | null; track: AchievementTrack | null }) {
  const { c, origin } = p
  return (
    <div
      className="host-region"
      style={{ left: Math.round(c.x) - origin.x, top: Math.round(c.y) - origin.y, width: Math.round(c.width), height: Math.round(c.height), ...opacityStyle(c) }}
    >
      <div className="overlay">
        <OverlayRegion config={c} timers={p.timers} combat={p.combat} track={p.track} arranging={false} />
      </div>
    </div>
  )
})

function Host() {
  const [configs, setConfigs] = useState<OverlayConfig[]>([])
  const [origin, setOrigin] = useState({ x: 0, y: 0 })
  const [timers, setTimers] = useState<TimerView[]>([])
  const [combat, setCombat] = useState<CombatSnapshot | null>(null)
  const [track, setTrack] = useState<AchievementTrack | null>(null)
  // The timers split once by overlay, each list kept as it was when its timers did not change, so a
  // push for one overlay does not draw the others again (LT-360).
  const split = useRef(new Map<string, { key: string; list: TimerView[] }>())
  const byOverlay = useMemo(() => {
    const next = new Map<string, TimerView[]>()
    for (const t of timers) next.set(t.overlay, [...(next.get(t.overlay) ?? []), t])
    const kept = new Map<string, { key: string; list: TimerView[] }>()
    for (const [id, list] of next) {
      const key = JSON.stringify(list)
      const had = split.current.get(id)
      kept.set(id, had && had.key === key ? had : { key, list })
    }
    split.current = kept
    return kept
  }, [timers])

  useEffect(() => {
    // What to draw, asked for once the page listens (a push sent while it loaded may be gone).
    const display = Number(new URLSearchParams(location.search).get('display'))
    void api.invoke('overlay:hostState', display).then((s) => {
      if (!s) return
      setConfigs(s.configs)
      setOrigin(s.origin)
      setTimers(s.timers)
      if (s.combat) setCombat(s.combat)
      if (s.achievements) setTrack(s.achievements)
    })
    const offs = [
      api.on('overlay:host', (p: { configs: OverlayConfig[]; origin: { x: number; y: number } }) => {
        setConfigs(p.configs)
        setOrigin(p.origin)
      }),
      api.on('overlay:timers', (views: TimerView[]) => setTimers(views)),
      api.on('overlay:combat', (snap: CombatSnapshot) => setCombat(snap)),
      api.on('overlay:achievements', (t: AchievementTrack | null) => setTrack(t))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  return (
    <>
      {configs.map((c) => (
        <Region
          key={c.id}
          c={c}
          origin={origin}
          timers={(c.kind === 'timers' && byOverlay.get(c.id)?.list) || NO_TIMERS}
          combat={c.kind === 'meter' ? combat : null}
          track={c.kind === 'achievements' ? track : null}
        />
      ))}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Host />)
