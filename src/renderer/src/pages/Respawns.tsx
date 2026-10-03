import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, clock, errorMessage } from '../api'
import { useSettled } from '../state'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { act } from '../toast'
import {
  Ago,
  ConfirmButton,
  Countdown,
  Disclosure,
  ErrorText,
  Field,
  FilterBox,
  Info,
  NumberInput,
  Pending,
  SortTh,
  Sparkline,
  Switch,
  ToggleChip,
  type Sort
} from '../components/ui'
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
  `${SHARED_SEC} seconds means two mobs share the name; those names are hidden unless you show them. ` +
  'A spawn point that pops one of several mobs, such as a placeholder and its named, can be made one row: a death of any of them starts its watch and its timer, and any of them seen ends the watch.'

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
  const overlays = useSettled((s) => s.settings.overlays)
  const q = useRespawns()
  const view = q.data
  const [filter, setFilter] = useState('')
  const [hereOnly, setHereOnly] = useRemembered('respawns.hereOnly', true)
  const [showShared, setShowShared] = useRemembered('respawns.shared', false)
  const [sort, setSort] = useRemembered<Sort<SortKey>>('respawns.sort', { key: 'last', dir: -1 })
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const zone = view?.zone ?? ''
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (view?.rows ?? [])
      .filter((r) => !hereOnly || !zone || !r.zone || r.zone === zone || !!r.timer)
      .filter((r) => showShared || !r.shared || !!r.timer || !!r.names)
      .filter((r) => !f || [r.name, r.zone, ...(r.names ?? [])].some((x) => x.toLowerCase().includes(f)))
      .sort(bySort(sort))
  }, [view, filter, hereOnly, showShared, zone, sort])
  const hiddenShared = (view?.rows ?? []).filter((r) => r.shared && !r.timer && !r.names).length
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
          <div className="lead">
            How long each mob you kill takes to come back, measured from the log. Once you know, add a timer: it starts at every kill of that mob and counts down on an overlay.{' '}
            <Info label="How it is measured" text={HOW} />
          </div>
        </div>
      </div>

      <div className="card row mb-16">
        <FilterBox placeholder="Filter by mob or zone…" label="Filter mobs" value={filter} onChange={setFilter} width={240} />
        {/* The words beside a switch are part of it: clicking them flips it too (LT-462). */}
        <label className="row tight">
          <Switch on={hereOnly} onChange={setHereOnly} label={zone ? `Only ${zone}` : 'Only this zone'} />
          <span className="small muted">{zone ? `Only ${zone}` : 'Only this zone'}</span>
        </label>
        <label className="row tight">
          <Switch on={showShared} onChange={setShowShared} label="Show names several mobs share" />
          <span className="small muted">Shared names{hiddenShared && !showShared ? ` (${hiddenShared} hidden)` : ''}</span>
        </label>
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
            overlays={overlays}
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
                    <Row r={r} zone={zone} open={open === r.key} toggle={() => setOpen(open === r.key ? null : r.key)} overlays={overlays} onSaved={saved} />
                    {open === r.key && (
                      <tr>
                        <td colSpan={8} style={{ background: 'var(--bg-2)' }}>
                          <TimerEditor
                            initialName={r.name}
                            initialSeconds={r.timer?.seconds ?? r.estimate ?? r.gaps[r.gaps.length - 1] ?? null}
                            measured={r.estimate ?? r.gaps[r.gaps.length - 1] ?? null}
                            timer={r.timer}
                            names={r.names}
                            overlays={overlays}
                            onDone={(v) => {
                              saved(v)
                              if (v) setOpen(null)
                            }}
                            onCancel={() => setOpen(null)}
                          />
                          {r.zone && (
                            <SpawnEditor
                              key={r.key}
                              r={r}
                              zoneMobs={(view?.rows ?? []).filter((x) => x.zone === r.zone && !x.names && x.key !== r.key).map((x) => x.name)}
                              onDone={(v) => {
                                saved(v)
                                if (v) setOpen(null)
                              }}
                            />
                          )}
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
  zone,
  open,
  toggle,
  overlays,
  onSaved
}: {
  r: RespawnRow
  zone: string
  open: boolean
  toggle: () => void
  overlays: { id: string; name: string }[]
  onSaved: (v: RespawnView | undefined) => void
}) {
  const last = r.gaps[r.gaps.length - 1]
  const length = r.timer?.seconds ?? r.estimate
  const backAt = r.pendingSince && length ? r.pendingSince + length * 1000 : null
  const overlayName = r.timer ? (overlays.find((o) => o.id === r.timer!.overlay)?.name ?? r.timer.overlay) : ''
  return (
    <tr className={`clickable${open ? ' selected' : ''}`} onClick={toggle}>
      <td>
        <Disclosure open={open} onToggle={toggle} stop>
          {r.name}
        </Disclosure>
        {r.names && (
          <span className="chip" title="One spawn point that pops any of these mobs">
            spawn
          </span>
        )}
        {r.names && <div className="faint small">{r.names.join(' · ')}</div>}
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
      <td className="faint small nowrap">
        <Ago t={r.lastDeath} never="—" />
      </td>
      <td className="mono nowrap">{backAt === null ? <span className="faint">—</span> : <Countdown until={backAt} done={<span className="chip ok">up</span>} />}</td>
      <td onClick={(e) => e.stopPropagation()}>
        {r.timer ? (
          <button className="chip ok" onClick={toggle} title={`On the ${overlayName} overlay. Click to change it.`}>
            {clock(r.timer.seconds)} · {overlayName}
          </button>
        ) : (
          <button className="btn small" onClick={toggle}>
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
            title={r.names ? "Forget the spawn's kills and gaps (its mobs and timer stay)" : "Forget this mob's kills and gaps (a timer stays)"}
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
  names,
  overlays,
  onDone,
  onCancel
}: {
  initialName: string
  initialSeconds: number | null
  /** The shortest gap seen (or the only one, when two mobs share the name). */
  measured: number | null
  timer: RespawnRow['timer']
  /** A spawn point's mobs. */
  names?: string[]
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
  // Each field says what is wrong with it, under it (LT-484).
  const [nameError, setNameError] = useState('')
  const [lengthError, setLengthError] = useState('')
  const seconds = parseClock(length)

  const save = async () => {
    setError('')
    setNameError(name.trim() ? '' : 'Give the mob’s name as the log prints it.')
    setLengthError(seconds ? '' : 'Give the length as minutes:seconds, e.g. 18:30.')
    if (!name.trim() || !seconds) return
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
    // Enter saves, Escape cancels, as in the other editors (LT-483).
    <form
      className="stack gap-12"
      style={{ padding: '8px 4px' }}
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        onCancel()
      }}
    >
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {!initialName && (
          <Field label="Mob" hint="As the log prints it, e.g. Coercer T`vala or a shiverback.">
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 240 }} autoFocus aria-invalid={!!nameError} />
            {nameError && <ErrorText block>{nameError}</ErrorText>}
          </Field>
        )}
        <Field label="Respawn" hint={measured ? `Measured: ${clock(measured)}` : 'minutes:seconds'}>
          <input
            className="mono"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            placeholder="18:30"
            style={{ width: 100 }}
            aria-invalid={!!lengthError || (!!length && !seconds)}
          />
          {lengthError && <ErrorText block>{lengthError}</ErrorText>}
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
        <button type="submit" className="btn primary">
          {timer ? 'Save timer' : 'Add timer'}
        </button>
        {timer && (
          <ConfirmButton className="btn" question="Remove this timer? Its trigger on the Triggers page goes too." onConfirm={() => void remove()}>
            Remove timer
          </ConfirmButton>
        )}
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <span className="faint small">
          It starts at each kill of {names ? `any of ${names.join(', ')}` : name.trim() || 'the mob'}, anywhere, and can be edited further on the Triggers page (Respawns folder).
        </span>
      </div>
    </form>
  )
}

/** "Boog Mudtoe's spawn": named after the first of its mobs without "a", "an" or "the", else the first. */
function spawnName(names: string[]): string {
  const named = names.find((n) => !/^(?:a|an|the) /i.test(n)) ?? names[0] ?? ''
  return named ? `${named}'s spawn` : ''
}

/** Which mobs pop at one spawn point: picked from the zone's mobs on record, or typed. */
function SpawnEditor({ r, zoneMobs, onDone }: { r: RespawnRow; zoneMobs: string[]; onDone: (v: RespawnView | undefined) => void }) {
  const isSpawn = !!r.names
  const [editing, setEditing] = useState(isSpawn)
  const [names, setNames] = useState<string[]>(r.names ?? [r.name])
  const [label, setLabel] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const has = (n: string) => names.some((x) => x.toLowerCase() === n.toLowerCase())
  const choices = [...new Map([...names, ...zoneMobs].map((n) => [n.toLowerCase(), n])).values()]
  const shownLabel = isSpawn ? r.name : (label ?? spawnName(names))

  if (!editing) {
    return (
      <div className="row" style={{ padding: '0 4px 8px' }}>
        <button className="btn small" onClick={() => setEditing(true)}>
          Same spawn as other mobs…
        </button>
        <span className="faint small">For a placeholder and the named it pops: one row and one timer for the spot.</span>
      </div>
    )
  }

  const toggle = (n: string, on: boolean) => setNames(on ? [...names, n] : names.filter((x) => x.toLowerCase() !== n.toLowerCase()))
  const add = () => {
    const n = typed.trim()
    if (n && !has(n)) setNames([...names, n])
    setTyped('')
  }
  const save = async () => {
    setError('')
    if (names.length < 2) return setError('Pick at least two mobs that pop there.')
    if (!shownLabel.trim()) return setError('Give the spawn point a name.')
    try {
      onDone(await api.invoke('respawns:link', { zone: r.zone, name: shownLabel.trim(), names }))
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const unlink = async () => {
    try {
      onDone(await api.invoke('respawns:unlink', r.key))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="stack gap-12" style={{ padding: '8px 4px', borderTop: '1px solid var(--line)' }}>
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {!isSpawn && (
          <Field label="Spawn point" hint="What the row, the timer and the voice call it">
            <input value={shownLabel} onChange={(e) => setLabel(e.target.value)} style={{ width: 240 }} />
          </Field>
        )}
        <Field label="Mobs that pop there" hint={`Killed in ${r.zone}, or add one by name as the log prints it`}>
          <div className="row tight wrap">
            {choices.map((n) => (
              <ToggleChip key={n} on={has(n)} onChange={(on) => toggle(n, on)}>
                {n}
              </ToggleChip>
            ))}
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="a mob's name"
              aria-label="Add a mob by name"
              style={{ width: 180 }}
            />
            <button className="btn small" onClick={add} disabled={!typed.trim()}>
              Add
            </button>
          </div>
        </Field>
      </div>
      {error && <div className="notice bad">{error}</div>}
      <div className="row">
        <button className="btn primary" onClick={() => void save()}>
          {isSpawn ? 'Save mobs' : 'Make one spawn'}
        </button>
        {isSpawn ? (
          <ConfirmButton className="btn" question="Split it up? Each mob starts afresh, and the spawn's timer goes too." onConfirm={() => void unlink()}>
            Split up
          </ConfirmButton>
        ) : (
          <button className="btn ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
        <span className="faint small">
          {isSpawn
            ? 'A death of any of them starts the watch and the timer.'
            : 'Their kills go into the spawn. Their gaps do not: each measured one name, not the spot, so the spawn measures afresh.'}
        </span>
      </div>
    </div>
  )
}
