import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, ago, clock, errorMessage } from '../api'
import { useApp } from '../state'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { useNow } from '../components/TimerBars'
import { act } from '../toast'
import { ConfirmButton, Field, Info, NumberInput, Pending, Switch } from '../components/ui'
import { SHARED_SEC, type RespawnRow, type RespawnTimerSpec, type RespawnView } from '../../../core/respawns'

// How long mobs take to come back, measured from the log, and a timer on an overlay for any of them.
// A timer is an ordinary trigger in the Respawns folder, so the Triggers page can change it too.

function useRespawns() {
  const q = useInvoke<RespawnView>('respawns:get')
  const setData = q.setData
  useEffect(() => api.on('state:respawns', (v: RespawnView) => setData(v)), [setData])
  return q
}

/** "18:47", "1:02:03" or plain seconds; null for anything else. */
export function parseClock(text: string): number | null {
  const t = text.trim()
  if (!/^\d+(?::\d{1,2}){0,2}$/.test(t)) return null
  const n = t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0)
  return n > 0 ? n : null
}

const HOW =
  'A kill starts a watch on that mob. The first line that names it again ends the watch: it hits or is hit, casts, ' +
  'speaks, is considered, or is killed again. A mob is only seen once it is back, so each gap is at least its ' +
  'respawn time and the shortest gap is the closest. Leaving the zone ends every watch. A gap under ' +
  `${SHARED_SEC} seconds means two mobs share the name; those names are hidden unless you show them.`

export function Respawns() {
  const { state } = useApp()
  const q = useRespawns()
  const view = q.data
  const [filter, setFilter] = useState('')
  const [hereOnly, setHereOnly] = useRemembered('respawns.hereOnly', true)
  const [showShared, setShowShared] = useRemembered('respawns.shared', false)
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
  }, [view, filter, hereOnly, showShared, zone])
  const hiddenShared = (view?.rows ?? []).filter((r) => r.shared && !r.timer).length

  const saved = (v: RespawnView | undefined) => {
    if (v) q.setData(v)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Respawns</h1>
          <p>
            How long each mob you kill takes to come back, measured from the log. Once you know, add a timer: it starts at every kill of
            that mob and counts down on an overlay. <Info label="How it is measured" text={HOW} />
          </p>
        </div>
      </div>

      <div className="card row mb-16">
        <input placeholder="Filter by mob or zone…" aria-label="Filter mobs" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 240 }} />
        <Switch on={hereOnly} onChange={setHereOnly} label={zone ? `Only ${zone}` : 'Only this zone'} />
        <span className="small muted">{zone ? `Only ${zone}` : 'Only this zone'}</span>
        <Switch on={showShared} onChange={setShowShared} label="Show names several mobs share" />
        <span className="small muted">
          Shared names{hiddenShared && !showShared ? ` (${hiddenShared} hidden)` : ''}
        </span>
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
        <div className="card empty">
          {view.rows.length ? 'Nothing matches. Try the switches above.' : 'No kills yet. Kill something while watching and it appears here; the gap shows once it is back.'}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Mob</th>
                <th title="Kills on record">Kills</th>
                <th title="The shortest gap between a death and the mob being seen again: the respawn is this or less">Respawn</th>
                <th title="The most recent gap">Last gap</th>
                <th>Last killed</th>
                <th title="The timer's length, or the shortest gap, from the last kill">Back in</th>
                <th>Timer</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.key}>
                  <Row r={r} now={now} zone={zone} open={open === r.key} toggle={() => setOpen(open === r.key ? null : r.key)} overlays={state.settings.overlays} onSaved={saved} />
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
      )}
    </>
  )
}

function Row({
  r, now, zone, open, toggle, overlays, onSaved
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
  const overlayName = r.timer ? overlays.find((o) => o.id === r.timer!.overlay)?.name ?? r.timer.overlay : ''
  return (
    <tr className={`clickable${open ? ' selected' : ''}`} onClick={toggle}>
      <td>
        <button className="link-button" aria-expanded={open} onClick={(e) => (e.stopPropagation(), toggle())}>
          {r.name}
        </button>
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
      <td className="mono nowrap">{last !== undefined ? clock(last) : '—'}</td>
      <td className="faint small nowrap">{r.lastDeath ? ago(r.lastDeath, now) : '—'}</td>
      <td className="mono nowrap">
        {backIn === null ? <span className="faint">—</span> : backIn > 0 ? clock(backIn / 1000) : <span className="chip ok">up</span>}
      </td>
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
          <ConfirmButton className="btn small ghost" question="Forget it?" label={`Forget ${r.name}`} title="Forget this mob's kills and gaps (a timer stays)" onConfirm={() => void forget(r.key).then(onSaved)}>
            ×
          </ConfirmButton>
        )}
      </td>
    </tr>
  )
}

const forget = (key: string) => act<RespawnView>('respawns:forget', key)

function TimerEditor({
  initialName, initialSeconds, measured, timer, overlays, onDone, onCancel
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
  const [overlay, setOverlay] = useState(timer?.overlay ?? (timerOverlays.some((o) => o.id === 'respawns') ? 'respawns' : timerOverlays[0]?.id ?? 'targets'))
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
      onDone(await api.invoke<RespawnView>('respawns:setTimer', spec))
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const remove = async () => {
    try {
      onDone(await api.invoke<RespawnView>('respawns:removeTimer', name))
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
          <button className="btn" onClick={() => void remove()}>
            Remove timer
          </button>
        )}
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <span className="faint small">It starts at each kill of {name.trim() || 'the mob'}, anywhere, and can be edited further on the Triggers page (Respawns folder).</span>
      </div>
    </div>
  )
}
