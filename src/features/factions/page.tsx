import { Fragment, useEffect, useMemo, useState } from 'react'
import { ago } from '../../renderer/src/api'
import { useApp } from '../../renderer/src/state'
import { useInvoke } from '../../renderer/src/hooks'
import { useRemembered } from '../../renderer/src/remember'
import { usePickedCharacter } from '../../renderer/src/character'
import { useNow } from '../../renderer/src/components/TimerBars'
import { FilterBox, Info, Pending, SortTh, type Sort } from '../../renderer/src/components/ui'
import { who } from '../../core/format'
import type { FactionRow } from './core'

// Faction changes the log recorded, from the character's log and its archives. The game never
// prints a standing, only each change and when one can go no further, so this is the net of those.

const HOW =
  'Each "Your faction standing with … has been adjusted by N" line adds N to that faction. When the game says it ' +
  '"could not possibly get any better" (or worse), the faction is marked maxed (or bottomed) until a change the ' +
  'other way. Only what the log recorded counts: changes from before your oldest log or archive, or with logging ' +
  'off, are not in it, so the net is what changed, not where you stand.'

type SortKey = 'name' | 'net' | 'changes' | 'cap' | 'last'

const CAP_ORDER = { top: 2, bottom: 0 }

const SORT_VALUE: Record<SortKey, (r: FactionRow) => string | number> = {
  name: (r) => r.name.toLowerCase(),
  net: (r) => r.net,
  changes: (r) => r.changes,
  cap: (r) => (r.cap ? CAP_ORDER[r.cap] : 1),
  last: (r) => r.last
}

function bySort(sort: Sort<SortKey>) {
  const value = SORT_VALUE[sort.key] ?? SORT_VALUE.last
  return (a: FactionRow, b: FactionRow) => {
    const x = value(a)
    const y = value(b)
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.name.localeCompare(b.name)
  }
}

/** +3, −2 (a true minus), 0: the sign says the direction as well as the colour. */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')
const tone = (n: number) => (n > 0 ? 'ok-text' : n < 0 ? 'bad-text' : 'faint')
const stamp = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Characters with a log in the game's Logs folder, and the one picked on the character pages. */
function useFactionCharacter() {
  const { state } = useApp()
  const logsQ = useInvoke('logs:list', [], [state.settings.installDir, state.settings.logFile])
  const [picked, setPicked] = usePickedCharacter()
  const available = useMemo(() => [...new Set((logsQ.data ?? []).map((l) => l.character))].sort(), [logsQ.data])
  const character = picked && available.includes(picked) ? picked : state.characterKey || available[0] || ''
  return { available, character, setCharacter: setPicked, ready: !!logsQ.data, error: logsQ.error, reload: logsQ.reload }
}

export function Factions() {
  const chars = useFactionCharacter()
  const character = chars.character
  const q = useInvoke(character ? 'factions:get' : null, [character])
  const view = q.data
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useRemembered<Sort<SortKey>>('factions.sort', { key: 'last', dir: -1 })
  const [open, setOpen] = useState<string | null>(null)
  const now = useNow(30_000)

  // New changes show up as they happen: the log is read on from where it stopped.
  const reload = q.reload
  useEffect(() => {
    const t = setInterval(reload, 30_000)
    return () => clearInterval(t)
  }, [reload])

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (view?.factions ?? []).filter((r) => !f || r.name.toLowerCase().includes(f)).sort(bySort(sort))
  }, [view, filter, sort])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Factions</h1>
          <p>
            Faction changes the log recorded for {who(character) || 'your character'}, from its log and its archives. The game does not print your standing itself, so this is the
            net of what the log saw. <Info label="How it is counted" text={HOW} />
          </p>
        </div>
        {chars.available.length > 1 && (
          <div className="actions">
            <select aria-label="Character" value={character} onChange={(e) => chars.setCharacter(e.target.value)}>
              {chars.available.map((c) => (
                <option key={c} value={c}>
                  {who(c)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="card row mb-16">
        <FilterBox placeholder="Filter by faction…" label="Filter factions" value={filter} onChange={setFilter} width={260} />
        <span className="spacer" />
        <span className="faint small">{view ? `${view.factions.length} faction${view.factions.length === 1 ? '' : 's'} on record` : ''}</span>
      </div>

      {!chars.ready ? (
        <Pending error={chars.error} retry={chars.reload} what="your characters" />
      ) : !character ? (
        <div className="card empty">No character log yet. Choose the game folder on the Settings page and play with logging on (/log on).</div>
      ) : !view ? (
        <Pending error={q.error} retry={q.reload} what="the faction changes" hint="The first look reads the whole log and its archives." />
      ) : !rows.length ? (
        <div className="card empty">
          {view.factions.length ? 'Nothing matches the filter.' : 'No faction changes in this log or its archives yet. Kill something with a faction and it appears here.'}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <SortTh k="name" sort={sort} onSort={setSort}>
                  Faction
                </SortTh>
                <SortTh k="net" sort={sort} onSort={setSort} num title="Every change the log recorded, added up">
                  Net change
                </SortTh>
                <SortTh k="changes" sort={sort} onSort={setSort} num title="How many changes the log recorded">
                  Changes
                </SortTh>
                <SortTh k="cap" sort={sort} onSort={setSort} title="Whether the game last said it could get no better, or no worse">
                  At the cap
                </SortTh>
                <SortTh k="last" sort={sort} onSort={setSort}>
                  Last changed
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = r.name.toLowerCase()
                const isOpen = open === key
                const toggle = () => setOpen(isOpen ? null : key)
                return (
                  <Fragment key={key}>
                    <tr className={`clickable${isOpen ? ' selected' : ''}`} onClick={toggle}>
                      <td>
                        <button className="link-button" aria-expanded={isOpen} onClick={(e) => (e.stopPropagation(), toggle())}>
                          {r.name}
                        </button>
                      </td>
                      <td className={`num mono ${tone(r.net)}`}>{signed(r.net)}</td>
                      <td className="num mono">{r.changes || '—'}</td>
                      <td>
                        {r.cap === 'top' ? (
                          <span className="chip ok" title="The game last said this could not possibly get any better">
                            maxed
                          </span>
                        ) : r.cap === 'bottom' ? (
                          <span className="chip bad" title="The game last said this could not possibly get any worse">
                            bottomed
                          </span>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td className="faint small nowrap" title={stamp(r.last)}>
                        {ago(r.last, now)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--bg-2)' }}>
                          <History r={r} />
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
    </>
  )
}

function History({ r }: { r: FactionRow }) {
  return (
    <div className="stack gap-6 small" style={{ padding: '6px 4px' }}>
      <span className="faint">
        First seen {stamp(r.first)}.{' '}
        {r.recent.length
          ? r.changes > r.recent.length
            ? `The last ${r.recent.length} of ${r.changes} changes, newest first:`
            : 'Every change, newest first:'
          : 'No changes recorded, only the cap.'}
      </span>
      {r.recent.length > 0 && (
        <div className="row tight">
          {r.recent.map((c, i) => (
            <span key={i} className="chip" title={stamp(c.at)}>
              <span className={`mono ${tone(c.amount)}`}>{signed(c.amount)}</span> <span className="faint">{stamp(c.at)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
