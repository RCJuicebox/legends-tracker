import { Fragment, useMemo, useState } from 'react'
import { day, when } from '../../../core/format'
import { ago } from '../api'
import { useRemembered } from '../remember'
import { useNow } from '../components/TimerBars'
import { FilterBox, GameCommand, Info, LoadError, Pending, SortTh, ToggleChip, type Sort } from '../components/ui'
import { AA_USES, type AaEffect, type AaSummary } from '../../../core/aa'
import { withAaList, type AaAbility, type AaHistoryView } from '../../../core/aaHistory'

// Stats › AAs: every ability the log saw bought, rank by rank, what is left to spend, and the
// /alternateadv list the AC and Combat tabs take their AA figures from.

type Key = 'name' | 'rank' | 'spent' | 'last'

const ORDER: Record<Key, (a: AaAbility, b: AaAbility) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  rank: (a, b) => a.rank - b.rank,
  spent: (a, b) => a.spent - b.spent,
  last: (a, b) => a.last - b.last
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

const UNSPENT_HOW =
  'The last "You now have N ability points" the game printed, less what was bought since. The game prints it only when points come in, so points given some other way show at the next one.'
const SPENT_HOW = 'What the log shows paid for each rank, less what refunds gave back. Ranks bought before your log begins, or with logging off, are not in it.'

export function AasTab({
  aa,
  status,
  onRead,
  history,
  error,
  retry
}: {
  aa: AaSummary | null
  status: string
  onRead: () => void
  history: AaHistoryView | null
  error: string
  retry: () => void
}) {
  const now = useNow(60_000)
  const view = useMemo(() => (history ? withAaList(history, aa) : null), [history, aa])
  return (
    <div className="stack gap-14">
      {view && view.capAt > 0 && (
        <div className="notice bad">
          Your pool of AA points is full: the game said so {ago(view.capAt, now)} and nothing has been bought since. It gives no more until you spend some.
        </div>
      )}
      {view ? <Summary view={view} now={now} /> : error ? <LoadError error={error} retry={retry} what="your AA history" /> : null}
      <Bought view={view} list={aa} />
      <AbilityList aa={aa} status={status} onRead={onRead} />
    </div>
  )
}

function Summary({ view, now }: { view: AaHistoryView; now: number }) {
  const p = view.points
  const logged = view.bought.filter((a) => !a.listOnly && !a.refundedAt)
  const listOnly = view.bought.filter((a) => a.listOnly).length
  const ranks = logged.reduce((n, a) => n + a.ranks.filter((r) => r.cost > 0 && !r.refunded).length, 0)
  return (
    <div className="grid three">
      <div className="card stat">
        <span className="label">
          Unspent AA points <Info label="Where this comes from" text={UNSPENT_HOW} />
        </span>
        <span className="value" title={p?.refundSince ? 'A refund since then gave points back that no line counts' : undefined}>
          {p ? `${p.unspent}${p.refundSince ? '+' : ''}` : '—'}
        </span>
        <span className="sub" title={p ? `The game said ${p.total} on ${when(p.at)}` : undefined}>
          {!p ? 'not reported in your log yet' : p.spentSince ? `${p.total} reported ${ago(p.at, now)}, ${p.spentSince} spent since` : `as of ${ago(p.at, now)}`}
        </span>
      </div>
      <div className="card stat">
        <span className="label">
          Points spent <Info label="Where this comes from" text={SPENT_HOW} />
        </span>
        <span className="value">{view.spent.toLocaleString()}</span>
        <span className="sub">{view.from ? `since your log begins, ${day(view.from)}` : 'no log read yet'}</span>
      </div>
      <div className="card stat">
        <span className="label">Abilities bought</span>
        <span className="value">{(logged.length + listOnly).toLocaleString()}</span>
        <span className="sub">
          {plural(ranks, 'rank')} in your log{listOnly ? `, ${listOnly} more in your list only` : ''}
        </span>
      </div>
    </div>
  )
}

function Bought({ view, list }: { view: AaHistoryView | null; list: AaSummary | null }) {
  const [filter, setFilter] = useState('')
  const [granted, setGranted] = useRemembered('stats.aas.granted', false)
  const [sort, setSort] = useRemembered<Sort<Key>>('stats.aas.sort', { key: 'last', dir: -1 })
  const [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() => {
    if (!view) return []
    const f = filter.trim().toLowerCase()
    return [...view.bought, ...(granted ? view.granted : [])]
      .filter((a) => !f || a.name.toLowerCase().includes(f))
      .sort((a, b) => ORDER[sort.key](a, b) * sort.dir || a.name.localeCompare(b.name))
  }, [view, filter, granted, sort])

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="row" style={{ padding: '12px 14px' }}>
        <h2 style={{ margin: 0 }}>Bought</h2>
        {view && <span className="chip">{view.bought.length}</span>}
        <span className="grow" />
        {view && view.granted.length > 0 && (
          <ToggleChip on={granted} onChange={setGranted} title="Abilities whose every rank cost nothing: the game gives them (a class's own come that way)">
            Granted ({view.granted.length})
          </ToggleChip>
        )}
        <FilterBox placeholder="Filter by ability…" label="Filter abilities" value={filter} onChange={setFilter} width={200} />
      </div>
      {!view ? (
        <Pending doing="Reading your log and its archives" />
      ) : !view.bought.length && !(granted && view.granted.length) ? (
        <div className="empty">No AA bought on record yet. Play with logging on (/log on) and every rank you buy shows up here.</div>
      ) : !rows.length ? (
        <div className="empty">Nothing matches the filter.</div>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <SortTh k="name" sort={sort} onSort={setSort}>
                  Ability
                </SortTh>
                <SortTh k="rank" sort={sort} onSort={setSort} num title="The rank the log last gave it">
                  Rank
                </SortTh>
                <SortTh k="spent" sort={sort} onSort={setSort} num title="Points the log shows paid for it, less any refunded">
                  Points
                </SortTh>
                <SortTh k="last" sort={sort} onSort={setSort}>
                  Last bought
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const k = a.name.toLowerCase()
                const isOpen = open === k
                const toggle = () => setOpen(isOpen ? null : k)
                return (
                  <Fragment key={k}>
                    <tr className={`clickable${isOpen ? ' selected' : ''}`} onClick={toggle}>
                      <td className="aa-name">
                        <button className="link-button" aria-expanded={isOpen} onClick={(e) => (e.stopPropagation(), toggle())}>
                          {a.name}
                        </button>
                        {a.granted && <span className="chip">granted</span>}
                        {a.refundedAt > 0 && (
                          <span className="chip warn" title={`Refunded ${when(a.refundedAt)}, and not bought again since`}>
                            refunded
                          </span>
                        )}
                        {a.listOnly && (
                          <span className="faint small" title="In your /alternateadv list, with no purchase in the log">
                            list only
                          </span>
                        )}
                      </td>
                      <td className="num mono">{a.rank || '—'}</td>
                      <td className="num mono">{a.listOnly ? '—' : a.spent}</td>
                      <td className="faint small nowrap" title={a.last ? when(a.last) : undefined}>
                        {a.last ? day(a.last) : '—'}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={4} style={{ background: 'var(--bg-2)' }}>
                          <Ranks a={a} list={list} from={view.from} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {view && view.from > 0 && (
        <p className="faint small" style={{ margin: 0, padding: '10px 14px 12px' }}>
          From your log and its archives, which begin {day(view.from)}. A rank bought before then, or with logging off, is not in them, so a rank can be higher and points spent
          more than shown. <i>List only</i> means your /alternateadv list has the ability but the log never saw it bought.
        </p>
      )}
    </div>
  )
}

/** One ability's ranks as the log recorded them, newest first, with any refund where it came. */
function Ranks({ a, list, from }: { a: AaAbility; list: AaSummary | null; from: number }) {
  if (a.listOnly)
    return (
      <span className="small muted">
        Your /alternateadv list of {list?.when ?? 'late'} holds it, but the log has no purchase of it: bought before your log begins ({day(from)}) or with logging off.
      </span>
    )
  const lines = [
    ...a.ranks.map((r) => ({ at: r.at, text: `Rank ${r.rank}`, cost: r.cost === 0 ? 'granted' : plural(r.cost, 'point'), refunded: r.refunded })),
    ...a.refunds.map((at) => ({ at, text: 'Refunded', cost: '', refunded: false }))
  ].sort((x, y) => y.at - x.at)
  return (
    <div className="aa-ranks small">
      {lines.map((l, i) => (
        <div key={i} className={l.refunded ? 'refunded' : undefined}>
          <span title={l.refunded ? 'Given back by a refund since' : undefined}>{l.text}</span>
          <span className="mono">{l.cost}</span>
          <span className="faint">{when(l.at)}</span>
        </div>
      ))}
    </div>
  )
}

/** The newest /alternateadv list: what the AC and Combat tabs fill their AA figures from. */
function AbilityList({ aa, status, onRead }: { aa: AaSummary | null; status: string; onRead: () => void }) {
  const [open, setOpen] = useState(false)
  const applied = (Object.keys(AA_USES) as AaEffect[]).filter((k) => aa?.totals[k])
  return (
    <div className="card stack gap-8">
      <div className="row small gap-10">
        <h2 style={{ margin: 0 }}>Your ability list</h2>
        <span className="muted">{aa ? `${aa.count} abilities, from your /alternateadv list of ${aa.when}.` : 'None read yet.'}</span>
        {status && <span className="faint">{status}</span>}
        <span className="grow" />
        {aa && (
          <button className="btn ghost small" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'} details
          </button>
        )}
        <button className="btn small" onClick={onRead}>
          Read the log again
        </button>
      </div>
      <p className="faint small" style={{ margin: 0 }}>
        The AC and Combat tabs take their AA figures from it. Type <GameCommand cmd="/alternateadv list" /> in game after buying; the tracker reads the newest list from your log.
      </p>
      {aa && (
        <div className="row tight" style={{ flexWrap: 'wrap', gap: 6 }}>
          {applied.map((k) => (
            <span key={k} className={`chip${AA_USES[k].applied ? ' ok' : ''}`} title={`${AA_USES[k].feeds}. From ${aa.totals[k]!.from.map(([n, v]) => `${n} ${v}`).join(', ')}`}>
              {AA_USES[k].label} +{aa.totals[k]!.sum}
              {AA_USES[k].unit}
            </span>
          ))}
        </div>
      )}
      {open && aa && (
        <div className="small stats-aalist">
          {aa.abilities.map((a) => (
            <div key={`${a.id}-${a.name}`}>
              <b>{a.name}</b>
              {a.cost !== null && <span className="faint"> · cost {a.cost}</span>}
              {Object.keys(a.effects).length > 0 && (
                <span className="muted"> · {(Object.entries(a.effects) as [AaEffect, number][]).map(([k, v]) => `${AA_USES[k].label} ${v}${AA_USES[k].unit}`).join(', ')}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
