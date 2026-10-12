import { useMemo } from 'react'
import { useInvoke } from '../../renderer/src/hooks'
import { Pending } from '../../renderer/src/components/ui'
import { duration } from '../../core/format'
import type { SlayerMap } from './spawns'

// A step's zone as the game's own map files draw it, with a dot at every spot its mobs pop at (TAKP's
// spawn tables). The game's maps put x to the right and y down, as drawn here.

const PAD = 0.04

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

function SpawnMapView({ map }: { map: SlayerMap }) {
  const [x, y, w, h] = useMemo(() => box(map), [map])
  const path = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i + 3 < map.lines.length; i += 4) out.push(`M${map.lines[i]} ${map.lines[i + 1]}L${map.lines[i + 2]} ${map.lines[i + 3]}`)
    return out.join('')
  }, [map])
  const r = Math.max(w, h) / 140
  const font = Math.max(w, h) / 70
  return (
    <svg className="sl-map" viewBox={`${x} ${y} ${w} ${h}`} role="img" aria-label={`Map of ${map.zone} with ${map.spots.length} spawn spots`}>
      <path d={path} className="sl-map-line" vectorEffect="non-scaling-stroke" />
      {map.labels
        .filter((l) => /^to /i.test(l.text))
        .map((l, i) => (
          <text key={i} x={l.x} y={l.y} fontSize={font} className="sl-map-label">
            {l.text}
          </text>
        ))}
      {map.spots.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={r} className="sl-map-spot">
          <title>
            {s.mobs.map((m) => `${m.name}${m.chance < 100 ? ` ${m.chance}%` : ''}`).join(' or ')} · {duration(s.timer)} classic · /loc {-s.y}, {-s.x}
          </title>
        </circle>
      ))}
    </svg>
  )
}

/** A step's map, asked of main when shown. */
export function SpawnMap({ zone, mobs }: { zone: string; mobs: string[] }) {
  const q = useInvoke('slayer:map', [zone, mobs], [zone, mobs.join('|')])
  if (!q.data) return <Pending error={q.error} retry={q.reload} what="the map" />
  const map = q.data
  if (!map.short) return <div className="faint small">TAKP’s spawn tables do not have {zone}.</div>
  return (
    <div className="sl-map-wrap">
      <SpawnMapView map={map} />
      <div className="faint small">
        {map.spots.length ? `${map.spots.length} spot${map.spots.length === 1 ? '' : 's'} (classic, from TAKP)` : 'No spot of these mobs in TAKP’s tables'}
        {!map.lines.length && ' · the game’s map for this zone was not found'}
      </div>
    </div>
  )
}
