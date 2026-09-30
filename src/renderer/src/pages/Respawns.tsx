import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, ago, clock, errorMessage } from '../api'
import { useApp } from '../state'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { useNow } from '../components/TimerBars'
import { act } from '../toast'
import { ConfirmButton, Disclosure, Field, FilterBox, Info, NumberInput, Pending, SortTh, Sparkline, Switch, type Sort } from '../components/ui'
import { parseClock, SHARED_SEC, type RespawnRow, type RespawnTimerSpec, type RespawnView } from '../../../core/respawns'

// How long mobs take to come back, measured from the log, and a timer on an overlay for any of them.
// A timer is an ordinary trigger in the Respawns folder, so the Triggers page can change it too.

function useRespawns() {
  const q = useInvoke('respawns:get')
  const setData = q.setData
  useEffect(() => api.on('state:respawns', (v: RespawnView) => setData(v)), [setData])
  return q
}

const HOW =
  'A kill starts a watch on that mob. The first line that names it again ends the watch: it hits or is hit, casts, ' +
  'speaks, is considered, or is killed again. A mob is only seen once it is back, so each gap is at least its ' +
  'respawn time and the shortest gap is the closest. Leaving the zone ends every watch. A gap under ' +
  `${SHARED_SEC} seconds means two mobs share the name; those names are hidden unless you show them.`

type SortKey = 'name' | 'kills' | 'respawn' | 'gap' | 'last'

const SORT_VALUE: Record<SortKey, (r: RespawnRow) => string | number | null> = {
  name: (r) => r.name.toLowerCase(),
  kills: (r) => r.kills,
  respawn: (r) => r.estimate,
  gap: (r) => r.gaps[r.gaps.length - 1] ?? null,
  last: (r) => r.lastDeath || null
}

/** Rows in the chosen order; a row with nothing to sort by goes last either way. */
function bySort(sort: Sort<SortKey>) {
  const value = SORT_VALUE[sort.key] ?? SORT_VALUE.last
  return (a: RespawnRow, b: RespawnRow) => {
    const x = value(a)
    const y = value(b)
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
  }
}

export function Respawns() {
  const { state } = useApp()
  const q = useRespawns()
  const view = q.data
  const [filter, setFilter] = useState('')
  const [hereOnly, setHereOnly] = useRemembered('respawns.hereOnly', true)
  const [showShared, setShowShared] = useRemembered('respawns.shared', false)
  const [sort, setSort] = useRemembered<Sort<SortKey>>('respawns.sort', { key: 'last', dir: -1 })
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const now = useNow(1000, !!view?.rows.some((r) => r.pendingSince))

  const zone = view?.zone ?? ''
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (view?.rows ?? [])
      .filter((r) => !hereOnly || !zone || !r.zone || r.zone === zone || !!r.timer)
      .filter((r) => showShared || !r.shared || !!r.timer)
      .filter((r) => !f || r.name.toLowerCase().includes(f) || r.zone.toLowerCase().includes(f))
      .sort(bySort(sort))
  }, [view, filter, hereOnly, showShared, zone, sort])
  const hiddenShared = (view?.rows ?? []).filter((r) => r.shared && !r.timer).length
  // What the zone switch hides: kills elsewhere, which after zoning is every one on record.
  const elsewhere = hereOnly && zone ? (view?.rows ?? []).filter((r) => r.zone && r.zone !== zone && !r.timer).length : 0

  const saved = (v: RespawnView | undefined) => {
    if (v) q.setData(v)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Respawns</h1>
          <p>
            How long each mob you kill takes to come back, measured from the log. Once you know, add a timer: it starts at every kill of that mob and counts down on an overlay.{' '}
            <Info label="How it is measured" text={HOW} />
          </p>
        </div>
      </div>

      <div className="card row mb-16">
        <FilterBox placeholder="Filter by mob or zone…" label="Filter mobs" value={filter} onChange={setFilter} width={240} />
        <Switch on={hereOnly} onChange={setHereOnly} label={zone ? `Only ${zone}` : 'Only this zone'} />
        <span className="small muted">{zone ? `Only ${zone}` : 'Only this zone'}</span>
        <Switch on={showShared} onChange={setShowShared} label="Show names several mobs share" />
        <span className="small muted">Shared names{hiddenShared && !showShared ? ` (${hiddenShared} hidden)` : ''}</span>
        <span className="spacer" />
        <button className="btn" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          Add a timer by name
        </button>
      </div>

      {adding && (
        <div className="card mb-16">
          <TimerEditor
            initialName=""
            initialSeconds={null}
            measured={null}
            timer={null}
            overlays={state.settings.overlays}
            onDone={(v) => {
              saved(v)
              if (v) setAdding(false)
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {!view ? (
        <Pending error={q.error} retry={q.reload} what="the respawn times" />
      ) : !rows.length ? (
        <div className="card empty stack gap-8" style={{ alignItems: 'center' }}>
          {!view.rows.length ? (
            'No kills yet. Kill something while watching and it appears here; the gap shows once it is back.'
          ) : (
            <>
              <span>
                Nothing here{filter.trim() ? ` matches "${filter.trim()}"` : ''}
                {elsewhere ? `: ${elsewhere} mob${elsewhere === 1 ? ' was' : 's were'} killed in other zones than ${zone}` : ''}
                {hiddenShared && !showShared ? `${elsewhere ? ', and' : ':'} ${hiddenShared} share${hiddenShared === 1 ? 's' : ''} a name with other mobs` : ''}.
              </span>
              <span className="row tight">
                {elsewhere > 0 && (
                  <button className="btn small" onClick={() => setHereOnly(false)}>
                    Show every zone
                  </button>
                )}
                {hiddenShared > 0 && !showShared && (
                  <button className="btn small" onClick={() => setShowShared(true)}>
                    Show shared names
                  </button>
                )}
                {filter.trim() && (
                  <button className="btn small" onClick={() => setFilter('')}>
                    Clear the filter
                  </button>
                )}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <SortTh k="name" sort={sort} onSort={setSort}>
                    Mob
                  </SortTh>
                  <SortTh k="kills" sort={sort} onSort={setSort} title="Kills on record">
                    Kills
                  </SortTh>
                  <SortTh k="respawn" sort={sort} onSort={setSort} title="The shortest gap between a death and the mob being seen again: the respawn is this or less">
                    Respawn
                  </SortTh>
                  <SortTh k="gap" sort={sort} onSort={setSort} title="The most recent gap">
                    Last gap
                  </SortTh>
                  <SortTh k="last" sort={sort} onSort={setSort}>
                    Last killed
                  </SortTh>
                  <th title="The timer's length, or the shortest gap, from the last kill">Back in</th>
                  <th>Timer</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.key}>
                    <Row
                      r={r}
                      now={now}
                      zone={zone}
                      open={open === r.key}
                      toggle={() => setOpen(open === r.key ? null : r.key)}
                      overlays={state.settings.overlays}
                      onSaved={saved}
                    />
                    {open === r.key && (
                      <tr>
                        <td colSpan={8} style={{ background: 'var(--bg-2)' }}>
                          <TimerEditor
                            initialName={r.name}
                            initialSeconds={r.timer?.seconds ?? r.estimate ?? r.gaps[r.gaps.length - 1] ?? null}
                            measured={r.estimate ?? r.gaps[r.gaps.length - 1] ?? null}
                            timer={r.timer}
                            overlays={state.settings.overlays}
                            onDone={(v) => {
                              saved(v)
                              if (v) setOpen(null)
                            }}
                            onCancel={() => setOpen(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

function Row({
  r,
  now,
  zone,
  open,
  toggle,
  overlays,
  onSaved
}: {
  r: RespawnRow
  now: number
  zone: string
  open: boolean
  toggle: () => void
  overlays: { id: string; name: string }[]
  onSaved: (v: RespawnView | undefined) => void
}) {
  const last = r.gaps[r.gaps.length - 1]
  const length = r.timer?.seconds ?? r.estimate
  const backIn = r.pendingSince && length ? r.pendingSince + length * 1000 - now : null
  const overlayName = r.timer ? (overlays.find((o) => o.id === r.timer!.overlay)?.name ?? r.timer.overlay) : ''
  return (
    <tr className={`clickable${open ? ' selected' : ''}`} onClick={toggle}>
      <td>
        <Disclosure open={open} onToggle={toggle} stop>
          {r.name}
        </Disclosure>
        {r.zone && r.zone !== zone && <div className="faint small">{r.zone}</div>}
        {r.shared && (
          <span className="chip warn" title={`A gap under ${SHARED_SEC} seconds: more than one mob has this name, so its gaps may be any of them.`}>
            shared name
          </span>
        )}
      </td>
      <td className="mono">{r.kills || '—'}</td>
      <td className="mono nowrap" title={r.gaps.length ? `Gaps seen: ${r.gaps.map(clock).join(', ')}` : 'Not seen back yet'}>
        {r.estimate !== null ? `≤ ${clock(r.estimate)}` : <span className="faint">{r.pendingSince ? 'watching…' : '—'}</span>}
        {r.gaps.length > 1 && <span className="faint small"> ({r.gaps.length})</span>}
      </td>
      <td className="mono nowrap">
        {last !== undefined ? clock(last) : '—'}
        {r.gaps.length > 1 && <Sparkline values={r.gaps} title={`Every gap seen, oldest first: ${r.gaps.map(clock).join(', ')}`} />}
      </td>
      <td className="faint small nowrap">{r.lastDeath ? ago(r.lastDeath, now) : '—'}</td>
      <td className="mono nowrap">{backIn === null ? <span className="faint">—</span> : backIn > 0 ? clock(backIn / 1000) : <span className="chip ok">up</span>}</td>
      <td onClick={(e) => e.stopPropagation()}>
        {r.timer ? (
          <button className="chip ok" onClick={toggle} title={`On the ${overlayName} overlay. Click to change it.`}>
            {clock(r.timer.seconds)} · {overlayName}
          </button>
        ) : (
          <button className="btn small primary" onClick={toggle}>
            Add timer
          </button>
        )}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        {r.lastDeath > 0 && (
          <ConfirmButton
            className="btn small ghost"
            question="Forget it?"
            label={`Forget ${r.name}`}
            title="Forget this mob's kills and gaps (a timer stays)"
            onConfirm={() => void forget(r.key).then(onSaved)}
          >
            ×
          </ConfirmButton>
        )}
      </td>
    </tr>
  )
}

const forget = (key: string) => act('respawns:forget', key)

function TimerEditor({
  initialName,
  initialSeconds,
  measured,
  timer,
  overlays,
  onDone,
  onCancel
}: {
  initialName: string
  initialSeconds: number | null
  /** The shortest gap seen (or the only one, when two mobs share the name). */
  measured: number | null
  timer: RespawnRow['timer']
  overlays: { id: string; name: string; kind: string }[]
  onDone: (v: RespawnView | undefined) => void
  onCancel: () => void
}) {
  const timerOverlays = overlays.filter((o) => o.kind === 'timers')
  const [name, setName] = useState(initialName)
  const [length, setLength] = useState(initialSeconds ? clock(initialSeconds) : '')
  const [overlay, setOverlay] = useState(timer?.overlay ?? (timerOverlays.some((o) => o.id === 'respawns') ? 'respawns' : (timerOverlays[0]?.id ?? 'targets')))
  const [warnSec, setWarnSec] = useState(timer?.warnSec ?? 30)
  const [announce, setAnnounce] = useState(timer?.announce ?? true)
  const [error, setError] = useState('')
  const seconds = parseClock(length)

  const save = async () => {
    setError('')
    if (!name.trim()) return setError('Give the mob’s name as the log prints it.')
    if (!seconds) return setError('Give the length as minutes:seconds, e.g. 18:30.')
    const spec: RespawnTimerSpec = { name: name.trim(), seconds, overlay, warnSec, announce }
    try {
      onDone(await api.invoke('respawns:setTimer', spec))
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const remove = async () => {
    try {
      onDone(await api.invoke('respawns:removeTimer', name))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="stack gap-12" style={{ padding: '8px 4px' }}>
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {!initialName && (
          <Field label="Mob" hint="As the log prints it, e.g. Coercer T`vala or a shiverback.">
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 240 }} autoFocus />
          </Field>
        )}
        <Field label="Respawn" hint={measured ? `Measured: ${clock(measured)}` : 'minutes:seconds'}>
          <input className="mono" value={length} onChange={(e) => setLength(e.target.value)} placeholder="18:30" style={{ width: 100 }} aria-invalid={!!length && !seconds} />
        </Field>
        <Field label="Overlay">
          <select value={overlay} onChange={(e) => setOverlay(e.target.value)}>
            {timerOverlays.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Warn" hint="Seconds before; 0 = none">
          <NumberInput value={warnSec} min={0} max={3600} onChange={(v) => setWarnSec(v ?? 0)} width={80} />
        </Field>
        <Field label="Say when it’s up">
          <Switch on={announce} onChange={setAnnounce} label="Say when it is up" />
        </Field>
      </div>
      {error && <div className="notice bad">{error}</div>}
      <div className="row">
        <button className="btn primary" onClick={() => void save()}>
          {timer ? 'Save timer' : 'Add timer'}
        </button>
        {timer && (
          <ConfirmButton className="btn" question="Remove this timer? Its trigger on the Triggers page goes too." onConfirm={() => void remove()}>
            Remove timer
          </ConfirmButton>
        )}
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <span className="faint small">It starts at each kill of {name.trim() || 'the mob'}, anywhere, and can be edited further on the Triggers page (Respawns folder).</span>
      </div>
    </div>
  )
}
