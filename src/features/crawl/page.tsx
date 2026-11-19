import { useMemo, useState } from 'react'
import { api } from '../../renderer/src/api'
import { useInvoke, useVisibleInterval } from '../../renderer/src/hooks'
import { useActions, useSettled } from '../../renderer/src/state'
import { GameCommand, Info, Pending, Switch, Tabs, Tip } from '../../renderer/src/components/ui'
import { showToast } from '../../renderer/src/toast'
import { num } from '../../core/format'
import { zoneKey } from '../../core/zones'
import { DEFAULT_ACHIEVEMENT_OPTIONS } from '../../shared/overlays'
import type { PlayerLocation } from '../../shared/tracking'
import { useMapView, type View } from '../../renderer/src/components/mapView'
import { floorColor, floorOf, legFloors, legPieces, rareKey, stopStates, type CrawlData, type CrawlRare, type CrawlRoute, type CrawlRun, type Point } from './core'

// Motes › Crawl route: a zone's Dungeon Crawl route. The zone's map, as the game's own files draw it,
// cut by depth: one floor at a time, or the whole zone from the side, so the floors a flat map piles
// on one another come apart. On it the stops (where the rares pop) numbered in the order that makes the
// shortest swim from the zone-in, and the way between them as it really runs (core.ts). The same route
// goes on the game's own map at a click, and the achievements overlay follows a run stop by stop.

const HOW = (
  <>
    <div>
      <b>A crawl</b> is finished, in the game’s own words, when you “slay every rare creature and enough of the zone’s original population”. Nothing respawns, and the game shows
      the rares that are up on your map, so not every stop has something every run.
    </div>
    <div>
      <b>The rares</b> are the game’s own Hunter list for the zone, those a /con called “a rare creature” in your log, and the zone’s other named, taken as rare.
    </div>
    <div>
      <b>The spots</b> are TAKP’s classic spawn tables. A rare that rolls at long odds over many spots goes with the nearest stop and is drawn faintly: look for it on the game’s
      map.
    </div>
    <div>
      <b>The way</b> is measured through the zone’s own geometry, read from the game’s files: it runs down the real tunnels and shafts, so no leg crosses a wall, and the order is
      the shortest that passes every stop once from the zone-in.
    </div>
  </>
)

type Show = 'all' | 'side' | `f${number}`

const rgb = (floor: number, alpha = 1) => `rgb(${floorColor(floor).join(' ')} / ${alpha})`

/** A stop's place as the game's /waypoint takes it: the /loc order, y, x, then height. */
const waypoint = (p: Point) => `/waypoint ${-p[1]}, ${-p[0]}, ${p[2]}`

const WHY: Record<CrawlRare['why'], string> = {
  hunter: 'On the game’s Hunter list for the zone',
  con: 'A /con in your log called it a rare creature',
  guess: 'A named of the zone, taken as rare: not on the Hunter list, and no /con has said so yet'
}

/** "you at /loc 661, -301, 4 min ago". */
const youText = (l: PlayerLocation, now: number) => {
  const mins = Math.max(0, Math.round((now - l.at) / 60_000))
  return `you at /loc ${Math.round(l.y)}, ${Math.round(l.x)}, ${Math.round(l.z)}, ${mins ? `${mins} min ago` : 'just now'}`
}

/** The map's tallest, in CSS pixels. */
const MAX_H = 600

function CrawlMap({ data, route, show, you, states }: { data: CrawlData; route: CrawlRoute; show: Show; you: PlayerLocation | null; states: ReturnType<typeof stopStates> }) {
  const side = show === 'side'
  const only = show.startsWith('f') ? Number(show.slice(1)) : null
  // Where a point is drawn: from above (the game's maps put x right and y down), or from the side, height up.
  const px = (p: readonly number[]) => p[0]
  const py = (p: readonly number[]) => (side ? -p[2] : p[1])
  const pieces = useMemo(() => legPieces(route), [route])
  // The zone's lines, a path for each floor.
  const floors = useMemo(() => {
    const out = route.floors.map(() => [] as string[])
    const l = data.lines
    for (let i = 0; i + 5 < l.length; i += 6) {
      const f = floorOf(route, (l[i + 2] + l[i + 5]) / 2)
      out[f].push(side ? `M${l[i]} ${-l[i + 2]}L${l[i + 3]} ${-l[i + 5]}` : `M${l[i]} ${l[i + 1]}L${l[i + 3]} ${l[i + 4]}`)
    }
    return out.map((p) => p.join(''))
  }, [data.lines, route, side])
  const whole = useMemo<View>(() => {
    const xs: number[] = [route.start[0]]
    const ys: number[] = [py(route.start)]
    const l = data.lines
    for (let i = 0; i + 5 < l.length; i += 6) {
      xs.push(l[i], l[i + 3])
      ys.push(side ? -l[i + 2] : l[i + 1], side ? -l[i + 5] : l[i + 4])
    }
    for (const p of pieces) {
      xs.push(px(p.from), px(p.to))
      ys.push(py(p.from), py(p.to))
    }
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const pad = Math.max(x1 - x0, y1 - y0, 100) * 0.04
    return [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad]
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- px and py follow `side`
  }, [data.lines, pieces, route, side])
  const { view, svg, zoomed, reset, on } = useMapView(whole)
  const [x, y, w, h] = view
  const [hot, setHot] = useState<number | null>(null)
  // Marks and labels keep their size on screen as the map zooms.
  const r = Math.max(w, h) / 62
  const shown = (floor: number) => only === null || only === floor
  // Where a leg leaves one floor for another: the shafts and stairs of the way.
  const changes = pieces.flatMap((p, i) => {
    const before = pieces[i - 1]
    return before && before.stop === p.stop && before.level !== p.level ? [{ at: p.from, from: before.level, to: p.level, stop: p.stop }] : []
  })
  const hotStop = hot !== null ? route.stops[hot] : null
  return (
    <>
      <svg
        ref={svg}
        className={`sl-map cr-map${zoomed ? ' zoomed' : ''}`}
        style={{ maxWidth: `${Math.round((MAX_H * whole[2]) / whole[3])}px` }}
        viewBox={`${x} ${y} ${w} ${h}`}
        role="img"
        aria-label={`Map of ${route.name} ${side ? 'from the side' : only === null ? 'from above, every floor' : `from above, the ${route.floors[only].name} floor`}, with the route’s ${route.stops.length} stops: the wheel zooms, a drag moves it`}
        {...on}
      >
        {floors.map((d, f) => (
          <path key={f} d={d} className="cr-map-line" style={{ stroke: rgb(f, shown(f) ? (only === null ? 0.5 : 0.85) : 0.12) }} vectorEffect="non-scaling-stroke" />
        ))}
        {pieces.map((p, i) => (
          <line
            key={i}
            x1={px(p.from)}
            y1={py(p.from)}
            x2={px(p.to)}
            y2={py(p.to)}
            className={`cr-map-way${states.visitedAt[p.stop] ? ' done' : ''}${p.stop === states.next ? ' next' : ''}`}
            style={{ stroke: rgb(p.floor, shown(p.floor) ? 1 : 0.25) }}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {!side &&
          changes.map((c, i) => (
            <text
              key={i}
              x={px(c.at)}
              y={py(c.at) + r * 0.4}
              fontSize={r * 1.3}
              textAnchor="middle"
              className="cr-map-change"
              style={{ fill: rgb(c.to), opacity: shown(c.from) || shown(c.to) ? 1 : 0.25 }}
            >
              {c.to > c.from ? '▼' : '▲'}
              <title>{`The way to stop ${c.stop + 1} goes ${c.to > c.from ? 'down' : 'up'} here, from the ${route.floors[c.from].name} floor to the ${route.floors[c.to].name} floor`}</title>
            </text>
          ))}
        {route.stops.flatMap((s, i) =>
          (s.far ?? []).map((p, j) => (
            <circle
              key={`far${i}-${j}`}
              cx={px(p)}
              cy={py(p)}
              r={r * 0.3}
              className="cr-map-far"
              style={{ fill: rgb(floorOf(route, p[2]), shown(floorOf(route, p[2])) ? 0.7 : 0.2) }}
            >
              <title>{`A long-odds spot of ${s.rares
                .filter((x) => x.far || x.spots > 1)
                .map((x) => x.name)
                .join(' or ')}, nearest stop ${i + 1}`}</title>
            </circle>
          ))
        )}
        <g className="cr-map-start" opacity={shown(floorOf(route, route.start[2])) ? 1 : 0.3}>
          <rect x={px(route.start) - r * 0.6} y={py(route.start) - r * 0.6} width={r * 1.2} height={r * 1.2} vectorEffect="non-scaling-stroke">
            <title>The zone-in: where the route starts</title>
          </rect>
          <text x={px(route.start) + r} y={py(route.start) + r * 0.4} fontSize={r * 1.1}>
            in
          </text>
        </g>
        {route.stops.map((s, i) => {
          const f = floorOf(route, s.at[2])
          return (
            <g
              key={i}
              className={`cr-map-stop${hot === i ? ' hot' : ''}${states.visitedAt[i] ? ' done' : ''}${i === states.next ? ' next' : ''}`}
              opacity={shown(f) ? 1 : 0.3}
              tabIndex={0}
              aria-label={`Stop ${i + 1}, ${route.floors[f].name} floor: ${s.rares.map((x) => x.name).join(', ')}`}
              onPointerEnter={() => setHot(i)}
              onFocus={() => setHot(i)}
            >
              <circle cx={px(s.at)} cy={py(s.at)} r={r} style={{ fill: rgb(f) }} vectorEffect="non-scaling-stroke" />
              <text x={px(s.at)} y={py(s.at) + r * 0.38} fontSize={r * 1.15} textAnchor="middle">
                {i + 1}
              </text>
            </g>
          )
        })}
        {you && (
          <g className="sl-map-you">
            <circle cx={-you.x} cy={side ? -you.z : -you.y} r={r * 0.7}>
              <title>{youText(you, Date.now())}</title>
            </circle>
            <text x={-you.x + r} y={(side ? -you.z : -you.y) + r * 0.4} fontSize={r * 1.1}>
              you
            </text>
          </g>
        )}
      </svg>
      <div className="row tight small sl-map-hot" aria-live="polite">
        <span className="mono">
          {hotStop && hot !== null
            ? `Stop ${hot + 1} · ${route.floors[floorOf(route, hotStop.at[2])].name} floor · ${hotStop.rares.map((x) => `${x.name}${x.far ? ' (near, long odds)' : ''}`).join(', ')} · ${waypoint(hotStop.at)}`
            : 'Point at a stop for what pops there and its /waypoint'}
        </span>
        <span className="spacer" />
        {zoomed && (
          <button className="btn small ghost" onClick={reset}>
            Whole zone
          </button>
        )}
      </div>
    </>
  )
}

/** A stop's rares, each with why it is one; those dead this run struck, those a /con saw up marked. */
function Rares({ rares, run }: { rares: CrawlRare[]; run: CrawlRun | null }) {
  return (
    <>
      {rares.map((x, i) => {
        const k = rareKey(x.name)
        const dead = !!run?.killed[k]
        return (
          <span key={x.name} className={x.far ? 'faint' : undefined}>
            {i > 0 && ', '}
            <Tip
              className={dead ? 'cr-dead' : undefined}
              text={`${WHY[x.why]}. ${x.far ? 'It pops near here at long odds only, out of the stop’s reach: the game’s map shows whether it is up.' : `Classic rolls it here ${x.chance}% of the time${x.spots > 1 ? `, over ${x.spots} spots` : ''}; a crawl makes rares likelier.`}${dead ? ' Killed this run.' : ''}`}
            >
              {x.far ? <>{x.name}</> : <b>{x.name}</b>}
            </Tip>
            {x.why !== 'hunter' && !dead && <span className="faint small"> ({x.why === 'con' ? 'rare by /con' : 'assumed'})</span>}
            {run?.up[k] && !dead && <span className="chip cr-up">up</span>}
          </span>
        )
      })}
    </>
  )
}

export function CrawlRoutePage() {
  const [zone, setZone] = useState('')
  const q = useInvoke('crawl:route', [zone || undefined], [zone])
  // A run in hand moves with the log: asked again every few seconds while the page shows.
  useVisibleInterval(q.reload, 5000)
  const where = useInvoke('game:location')
  useVisibleInterval(where.reload, 15_000)
  const [show, setShow] = useState<Show>('all')
  const { patchSettings } = useActions()
  const achOverlay = useSettled((s) => s.settings.overlays.find((o) => o.kind === 'achievements'))
  const onOverlay = (achOverlay?.achievements ?? DEFAULT_ACHIEVEMENT_OPTIONS).crawl ?? true
  const setOnOverlay = (on: boolean) =>
    void patchSettings((s) => ({
      ...s,
      overlays: s.overlays.map((o) => (o.kind === 'achievements' ? { ...o, achievements: { ...DEFAULT_ACHIEVEMENT_OPTIONS, ...o.achievements, crawl: on } } : o))
    }))
  const data = q.data
  const route = data?.route ?? null
  const states = useMemo(() => (route ? stopStates(route, data?.run ?? null) : { visitedAt: [], last: -1, next: -1 }), [route, data?.run])
  if (!data) return <Pending error={q.error} retry={q.reload} what="the route" />
  if (!route) return <div className="card empty">No zone has a crawl route yet.</div>
  const you = where.data && zoneKey(where.data.zone) === zoneKey(route.name) ? where.data : null
  const total = route.stops.reduce((s, x) => s + x.length, 0)
  const rares = new Set(route.stops.flatMap((s) => s.rares.map((x) => x.name))).size
  const run = data.run
  const mark = async (on: boolean) => {
    try {
      const r = await api.invoke('crawl:mark', route.name, on)
      q.reload()
      showToast(
        on
          ? `Drew the route on ${route.name}’s map, ${num(r.lines)} lines and labels: pick the LegendsTracker map set in the game’s map window (layer 2 holds the route).`
          : `Took the route off ${route.name}’s map in the LegendsTracker map set.`
      )
    } catch (e) {
      showToast(`Could not write the game’s map: ${e instanceof Error ? e.message : String(e)}`, { tone: 'bad' })
    }
  }
  const tabs: [Show, string][] = [['all', 'Every floor'], ...route.floors.map((f, i): [Show, string] => [`f${i}`, f.name]), ['side', 'From the side']]
  return (
    <>
      <div className="page-head">
        <p>
          The shortest way past every rare of a zone, for a Dungeon Crawl: the stops in order, floor by floor, along the zone’s real tunnels.{' '}
          <Info label="How it is worked out" text={HOW} />
        </p>
      </div>
      <div className="card row mb-16">
        {data.zones.length > 1 ? (
          <label className="row tight">
            Zone
            <select value={route.name} onChange={(e) => setZone(e.target.value)}>
              {data.zones.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
        ) : (
          <b>{route.name}</b>
        )}
        <span>
          <b>{route.stops.length}</b> stops, <b>{rares}</b> rares, about <b>{num(total)}</b> units of swimming
        </span>
        {run && (
          <span className="chip">
            {data.here ? 'Run in hand' : 'Last run'}: {states.visitedAt.filter(Boolean).length} of {route.stops.length} stops
            {run.doneAt ? ' · completed' : ''}
          </span>
        )}
        <span className="spacer" />
        {achOverlay && (
          <label
            className="row tight small"
            title="In an instance of the zone, the achievements overlay shows the stop to go to next and the rares left (the switch under Settings › Overlays)"
          >
            <Switch on={onOverlay} onChange={setOnOverlay} />
            On the overlay
          </label>
        )}
        <Tip text="Draws the way and the numbered stops on the game’s own map, each floor in its colour: in the LegendsTracker map set (a copy of the game’s maps, so its own stay as they are), on layer 2, which the map window can switch off on its own.">
          <button className="btn small" onClick={() => void mark(!data.marked)}>
            {data.marked ? 'Take it off the game’s map' : 'Draw it on the game’s map'}
          </button>
        </Tip>
      </div>
      <div className="card mb-16">
        <div className="row mb-8">
          <Tabs label="Depth shown" value={show} onChange={setShow} tabs={tabs} />
        </div>
        <div className="row tight small mb-8 cr-legend">
          {route.floors.map((f, i) => (
            <span key={f.name} className="row tight">
              <span className="cr-swatch" style={{ background: rgb(i) }} />
              {f.name}
              <span className="faint">
                {f.from === null ? `below ${route.floors[i - 1]?.from ?? 0}` : i === 0 ? `${f.from} and up` : `${f.from} to ${route.floors[i - 1].from}`}
              </span>
            </span>
          ))}
        </div>
        <CrawlMap data={data} route={route} show={show} you={you} states={states} />
        <div className="faint small">
          Floors by height (the third number of /loc)
          {you ? ` · ${youText(you, Date.now())}, the ${route.floors[floorOf(route, you.z)].name} floor` : ' · type /loc in game to see where you are on it'}
          {!data.lines.length && ' · the game’s map for this zone was not found'}
        </div>
      </div>
      <div className="card mb-16">
        <ol className="fp-steps">
          {route.stops.map((s, i) => {
            const f = floorOf(route, s.at[2])
            const through = legFloors(route, i)
            const done = !!states.visitedAt[i]
            return (
              <li key={i} className={`fp-step${i === states.next && data.here ? ' now' : ''}`}>
                <span className="fp-num" style={{ background: rgb(f), color: '#111' }}>
                  {done ? '✓' : i + 1}
                </span>
                <div className="fp-body">
                  <div className="fp-head">
                    <span className="fp-zone">
                      <Rares rares={s.rares.filter((x) => !x.far)} run={run} />
                    </span>
                    <span className="chip" style={{ borderColor: rgb(f) }}>
                      {route.floors[f].name} floor
                    </span>
                    <span className="spacer" />
                    <Tip className="mono small" text={`The way from ${i ? `stop ${i}` : 'the zone-in'}, through the open tunnels, in the game’s units`}>
                      {num(s.length)} from {i ? `stop ${i}` : 'the zone-in'}
                    </Tip>
                  </div>
                  <div className="small">
                    {through.length > 1 ? (
                      <>The way: {through.map((t, j) => `${j ? (t > through[j - 1] ? ' ↓ ' : ' ↑ ') : ''}${route.floors[t].name}`).join('')} · </>
                    ) : (
                      <>Stays on the {route.floors[f].name} floor · </>
                    )}
                    <GameCommand cmd={waypoint(s.at)} />
                  </div>
                  {s.rares.some((x) => x.far) && (
                    <div className="small faint">
                      May be near: <Rares rares={s.rares.filter((x) => x.far)} run={run} />
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </>
  )
}
