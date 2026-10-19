import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useInvoke, useVisibleInterval } from '../../renderer/src/hooks'
import { Pending } from '../../renderer/src/components/ui'
import { duration } from '../../core/format'
import { waypoint, type SlayerMap } from './spawns'
import { zoneKey } from '../../core/zones'
import type { PlayerLocation } from '../../shared/tracking'

// A step's zone as the game's own map files draw it, with a dot at every spot its mobs pop at (TAKP's
// spawn tables, and Legends' own spawns the player found). The game's maps put x to the right and y
// down, as drawn here. The wheel zooms where the pointer is and a drag moves the map; a spot hovered or
// focused says what pops there and its /waypoint under the map (LT-675).

const PAD = 0.04
/** The map's tallest, in CSS pixels: its width follows from the zone's shape. */
const MAX_H = 420
/** Zoomed in no further than this many times. */
const MAX_ZOOM = 12

type View = [number, number, number, number]

/** The map's extent: its lines and its spots, a little room around. */
function box(map: SlayerMap): [number, number, number, number] {
  const xs: number[] = map.spots.map((s) => s.x)
  const ys: number[] = map.spots.map((s) => s.y)
  for (let i = 0; i + 3 < map.lines.length; i += 4) {
    xs.push(map.lines[i], map.lines[i + 2])
    ys.push(map.lines[i + 1], map.lines[i + 3])
  }
  if (!xs.length) return [0, 0, 100, 100]
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const pad = Math.max(x1 - x0, y1 - y0, 100) * PAD
  return [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad]
}

/** Where players say to stand, as /waypoint takes it (y, x), and what they say of it. */
interface Stand {
  at: [number, number]
  label: string
}

/** "You, at /loc 661, -301, 4 min ago". */
const youText = (l: PlayerLocation, now: number) => {
  const mins = Math.max(0, Math.round((now - l.at) / 60_000))
  return `you at /loc ${Math.round(l.y)}, ${Math.round(l.x)}, ${mins ? `${mins} min ago` : 'just now'}`
}

/** What pops at a spot, its timer and its /waypoint, as one line. */
const spotText = (s: SlayerMap['spots'][number]) =>
  `${s.mobs.map((m) => `${m.name}${m.chance < 100 ? ` ${m.chance}%` : ''}`).join(' or ')} · ${s.timer ? `${duration(s.timer)} classic` : (s.where ?? 'Legends')} · ${waypoint(s)}`

function SpawnMapView({ map, stand, you }: { map: SlayerMap; stand?: Stand; you?: PlayerLocation | null }) {
  const whole = useMemo<View>(() => box(stand ? { ...map, spots: [...map.spots, { x: -stand.at[1], y: -stand.at[0], z: 0, mobs: [], timer: 0 }] } : map), [map, stand])
  const [view, setView] = useState<View>(whole)
  useEffect(() => setView(whole), [whole])
  const [x, y, w, h] = view
  const [hot, setHot] = useState<number | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ px: number; py: number; view: View } | null>(null)
  const path = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i + 3 < map.lines.length; i += 4) out.push(`M${map.lines[i]} ${map.lines[i + 1]}L${map.lines[i + 2]} ${map.lines[i + 3]}`)
    return out.join('')
  }, [map])
  // The wheel zooms about the pointer. Listened to by hand: React's wheel listener cannot stop the page scrolling.
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      setView(([vx, vy, vw, vh]) => {
        const k = Math.exp(e.deltaY * 0.0015)
        const nw = Math.min(whole[2], Math.max(whole[2] / MAX_ZOOM, vw * k))
        const nh = (nw / vw) * vh
        const fx = rect.width ? (e.clientX - rect.left) / rect.width : 0.5
        const fy = rect.height ? (e.clientY - rect.top) / rect.height : 0.5
        return [vx + (vw - nw) * fx, vy + (vh - nh) * fy, nw, nh]
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [whole])
  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    drag.current = { px: e.clientX, py: e.clientY, view }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    const rect = svg.current?.getBoundingClientRect()
    if (!d || !rect?.width) return
    const scale = d.view[2] / rect.width
    setView([d.view[0] - (e.clientX - d.px) * scale, d.view[1] - (e.clientY - d.py) * scale, d.view[2], d.view[3]])
  }
  const up = () => (drag.current = null)
  const zoomed = w < whole[2] - 1e-6
  // Spots and labels keep their size on screen as the map zooms.
  const r = Math.max(w, h) / 140
  const font = Math.max(w, h) / 70
  return (
    <>
      <svg
        ref={svg}
        className={`sl-map${zoomed ? ' zoomed' : ''}`}
        style={{ maxWidth: `${Math.round((MAX_H * whole[2]) / whole[3])}px` }}
        viewBox={`${x} ${y} ${w} ${h}`}
        role="img"
        aria-label={`Map of ${map.zone} with ${map.spots.length} spawn spots: the wheel zooms, a drag moves it`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => setView(whole)}
      >
        <path d={path} className="sl-map-line" vectorEffect="non-scaling-stroke" />
        {map.labels
          .filter((l) => /^to /i.test(l.text))
          .map((l, i) => (
            <text key={i} x={l.x} y={l.y} fontSize={font} className="sl-map-label">
              {l.text}
            </text>
          ))}
        {map.spots.map((s, i) => (
          <circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={r}
            className={`sl-map-spot${hot === i ? ' hot' : ''}`}
            tabIndex={0}
            aria-label={spotText(s)}
            onPointerEnter={() => setHot(i)}
            onFocus={() => setHot(i)}
          >
            <title>{spotText(s)}</title>
          </circle>
        ))}
        {stand && (
          <circle cx={-stand.at[1]} cy={-stand.at[0]} r={r * 2.2} className="sl-map-stand">
            <title>{stand.label}</title>
          </circle>
        )}
        {/* Where the player last typed /loc in this zone (FEAT-023). */}
        {you && (
          <g className="sl-map-you">
            <circle cx={-you.x} cy={-you.y} r={r * 1.4}>
              <title>{youText(you, Date.now())}</title>
            </circle>
            <text x={-you.x + r * 2} y={-you.y + r * 0.6} fontSize={font}>
              you
            </text>
          </g>
        )}
      </svg>
      <div className="row tight small sl-map-hot" aria-live="polite">
        <span className="mono">{hot !== null && map.spots[hot] ? spotText(map.spots[hot]) : 'Point at a spot for what pops there and its /waypoint'}</span>
        <span className="spacer" />
        {zoomed && (
          <button className="btn small ghost" onClick={() => setView(whole)}>
            Whole zone
          </button>
        )}
      </div>
    </>
  )
}

/** A step's map, asked of main when shown. */
export function SpawnMap({ zone, mobs, stand }: { zone: string; mobs: string[]; stand?: Stand }) {
  const q = useInvoke('slayer:map', [zone, mobs], [zone, mobs.join('|')])
  // Where the player last typed /loc, asked again every half minute while the map shows (FEAT-023).
  const where = useInvoke('game:location')
  useVisibleInterval(where.reload, 30_000)
  const you = where.data && zoneKey(where.data.zone) === zoneKey(zone) ? where.data : null
  if (!q.data) return <Pending error={q.error} retry={q.reload} what="the map" />
  const map = q.data
  if (!map.short) return <div className="faint small">TAKP’s spawn tables do not have {zone}.</div>
  return (
    <div className="sl-map-wrap">
      <SpawnMapView map={map} stand={stand} you={you} />
      <div className="faint small">
        {map.spots.length
          ? `${map.spots.length} spot${map.spots.length === 1 ? '' : 's'} (${map.spots.some((s) => !s.timer) ? 'TAKP’s classic tables, and Legends’ own as found' : 'classic, from TAKP'})`
          : 'No spot of these mobs in TAKP’s tables'}
        {stand && ` · the ring: where to stand, /waypoint ${stand.at[0]}, ${stand.at[1]}`}
        {you ? ` · ${youText(you, Date.now())}` : ' · type /loc in game to see where you are on it'}
        {!map.lines.length && ' · the game’s map for this zone was not found'}
      </div>
    </div>
  )
}
