import { clock, num, pct } from '../../../core/format'
import { useMemo } from 'react'
import { useInvoke } from '../hooks'
import { Pending } from './ui'
import { attackerRows, damageRows, durationSec, fmtRate, healerRows } from '../../../core/combatView'
import type { MeterMode, MeterScope, Segment } from '../../../shared/types'

// The damage meter's comparison of two segments, entity by entity.

/** Two fights side by side: everyone in either, their rate and total in each, and the change. */
export function ComparePane({
  seg,
  name,
  otherId,
  mode,
  scope,
  combinePet,
  active,
  close
}: {
  seg: Segment
  name: string
  otherId: string
  mode: MeterMode
  scope: MeterScope
  combinePet: boolean
  active: boolean
  close: () => void
}) {
  const other = useInvoke('combat:segment', [otherId], [otherId]).data
  const rows = useMemo(() => {
    if (!other) return []
    const a = comparable(seg, mode, scope, combinePet, active)
    const b = new Map(comparable(other, mode, scope, combinePet, active).map((r) => [r.key, r]))
    const keys = [...new Set([...a.map((r) => r.key), ...b.keys()])]
    const byKey = new Map(a.map((r) => [r.key, r]))
    return keys
      .map((k) => ({ key: k, name: byKey.get(k)?.name ?? b.get(k)!.name, now: byKey.get(k), then: b.get(k) }))
      .sort((x, y) => (y.now?.total ?? 0) + (y.then?.total ?? 0) - ((x.now?.total ?? 0) + (x.then?.total ?? 0)))
      .slice(0, 20)
  }, [seg, other, mode, scope, combinePet, active])
  const unit = mode === 'healing' ? 'HPS' : 'DPS'
  const change = (now?: { rate: number }, then?: { rate: number }) => {
    if (!now || !then || !then.rate) return now && !then ? 'new' : then && !now ? 'gone' : '—'
    const change = (now.rate - then.rate) / then.rate
    return `${change >= 0 ? '+' : '−'}${pct(Math.abs(change))}`
  }
  if (!other) return <Pending doing="Reading the other fight" />
  return (
    <div className="dm-compare">
      <div className="row">
        <span className="small muted">
          <b>{name}</b> ({clock(durationSec(seg))}, {seg.kills} kill{seg.kills === 1 ? '' : 's'}) against <b>{other.name}</b> ({clock(durationSec(other))}, {other.kills} kill
          {other.kills === 1 ? '' : 's'}), {mode === 'incoming' ? 'damage taken' : mode === 'healing' ? 'healing' : 'damage dealt'}
          {active && mode !== 'healing' ? ', active' : ''}
        </span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={close}>
          Stop comparing
        </button>
      </div>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Who</th>
              <th className="num">This fight</th>
              <th className="num">The other</th>
              <th className="num" title={`The change in ${unit} from the other fight to this one`}>
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.name}</td>
                <td className="num mono">{r.now ? `${fmtRate(r.now.rate)} ${unit} · ${num(r.now.total)}` : '—'}</td>
                <td className="num mono">{r.then ? `${fmtRate(r.then.rate)} ${unit} · ${num(r.then.total)}` : '—'}</td>
                <td className="num mono">{change(r.now, r.then)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The rows a mode lists, in one shape for comparing: a name, its rate and its total. */
function comparable(seg: Segment, mode: MeterMode, scope: MeterScope, combinePet: boolean, active: boolean) {
  if (mode === 'healing') return healerRows(seg, scope).map((h) => ({ key: h.key, name: h.name, rate: h.hps, total: h.total }))
  const rows = mode === 'incoming' ? attackerRows(seg, scope) : damageRows(seg, scope, combinePet)
  return rows.map((r) => ({ key: r.key, name: r.name, rate: active ? r.activeDps : r.dps, total: r.total }))
}
