import { useEffect, useMemo, useState } from 'react'
import { ago, clock } from '../api'
import { useApp } from '../state'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { usePickedCharacter } from '../character'
import { useNow } from '../components/TimerBars'
import { FilterBox, Info, Pending, SortTh, Switch, type Sort } from '../components/ui'
import { who } from '../../../core/format'
import { RATE_MIN_MS, SESSION_GAP_MS, type AaPurchase, type ProgressionView, type SessionRow, type SkillTally } from '../../../core/progression'

// What the log recorded of a character's progress, from its log and its archives: levels, skill-ups,
// AA points and purchases, and each session's experience. EQL prints no experience amounts, so
// experience is counted in messages and nothing here is worked out beyond what the lines say.

const HOW =
  'EQL prints no experience amounts: a kill that gives some says "You gain experience!" (or party experience), and ' +
  'a Dungeon Crawl reward says so too. So experience is counted in those messages, about one per kill that gave ' +
  'some. Some of the lines end with a percentage of a level; Level % adds up only the ones printed, so it falls short ' +
  'whenever lines come without one. AA points are the "You have gained … ability point" lines. A session is play ' +
  `with no gap of ${SESSION_GAP_MS / 60_000} minutes or more between log lines; the per-hour rates are for sessions of ` +
  `${RATE_MIN_MS / 60_000} minutes or more. Only what the log recorded counts: nothing from before your oldest log ` +
  'or archive, or with logging off.'

const LEVELS_HOW =
  'EQL levels each class on its own, and "You have gained a level! Welcome to level N!" never says which class. ' +
  'Level-ups that follow on from one another (11, 12, 13 …) are grouped into a run, most likely one class each; ' +
  'a level gained with logging off breaks a run in two.'

const POINTS_HOW =
  'The last "You now have N ability points" the game printed, less what purchases since then cost. Points given ' +
  'without such a line are not seen until the next one.'

/** Rows shown in a list before "Show all". */
const FIRST_ROWS = 25

type SessionKey = 'start' | 'length' | 'xp' | 'xpRate' | 'pct' | 'aa' | 'aaRate' | 'levels' | 'skills'

const SESSION_VALUE: Record<SessionKey, (r: SessionRow) => number | null> = {
  start: (r) => r.start,
  length: (r) => r.end - r.start,
  xp: (r) => r.xp,
  xpRate: (r) => r.xpPerHour,
  pct: (r) => (r.pctLines ? r.pct : null),
  aa: (r) => r.aaPoints,
  aaRate: (r) => r.aaPerHour,
  levels: (r) => r.levels,
  skills: (r) => r.skillUps
}

/** Rows in the chosen order; a row with nothing to sort by goes last either way. */
function bySession(sort: Sort<SessionKey>) {
  const value = SESSION_VALUE[sort.key] ?? SESSION_VALUE.start
  return (a: SessionRow, b: SessionRow) => {
    const x = value(a)
    const y = value(b)
    if (x === null || y === null) return x === y ? b.start - a.start : x === null ? 1 : -1
    return (x - y) * sort.dir || b.start - a.start
  }
}

type SkillKey = 'name' | 'value' | 'ups' | 'last'

const SKILL_VALUE: Record<SkillKey, (r: SkillTally) => string | number> = {
  name: (r) => r.name.toLowerCase(),
  value: (r) => r.value,
  ups: (r) => r.ups,
  last: (r) => r.last
}

function bySkill(sort: Sort<SkillKey>) {
  const value = SKILL_VALUE[sort.key] ?? SKILL_VALUE.last
  return (a: SkillTally, b: SkillTally) => {
    const x = value(a)
    const y = value(b)
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.name.localeCompare(b.name)
  }
}

const stamp = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const day = (t: number) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const rate = (n: number | null) => (n === null ? '—' : n < 10 ? n.toFixed(1) : String(Math.round(n)))
const pctOf = (n: number) => `${n < 10 ? n.toFixed(2) : n.toFixed(1)}%`
const dash = (n: number) => (n ? n.toLocaleString() : '—')
const progressed = (s: SessionRow) => s.xp + s.aaPoints + s.levels + s.skillUps + s.aaBought + s.noXp > 0

/** Characters with a log in the game's Logs folder, and the one picked on the character pages. */
function useProgressionCharacter() {
  const { state } = useApp()
  const logsQ = useInvoke('logs:list', [], [state.settings.installDir, state.settings.logFile])
  const [picked, setPicked] = usePickedCharacter()
  const available = useMemo(() => [...new Set((logsQ.data ?? []).map((l) => l.character))].sort(), [logsQ.data])
  const character = picked && available.includes(picked) ? picked : state.characterKey || available[0] || ''
  return { available, character, setCharacter: setPicked, ready: !!logsQ.data, error: logsQ.error, reload: logsQ.reload }
}

export function Progression() {
  const chars = useProgressionCharacter()
  const character = chars.character
  const q = useInvoke(character ? 'progression:get' : null, [character])
  const view = q.data
  const now = useNow(30_000)

  // New lines show up as they happen: the log is read on from where it stopped.
  const reload = q.reload
  useEffect(() => {
    const t = setInterval(reload, 30_000)
    return () => clearInterval(t)
  }, [reload])

  const empty = view && !view.sessions.length && !view.levels.length && !view.skills.length && !view.purchases.length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Progression</h1>
          <p>
            Levels, skill-ups, AA points and purchases the log recorded for {who(character) || 'your character'}, from its log and its archives, and
            what each session of play brought. The game prints no experience amounts, so experience is counted in messages.{' '}
            <Info label="How it is counted" text={HOW} />
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

      {!chars.ready ? (
        <Pending error={chars.error} retry={chars.reload} what="your characters" />
      ) : !character ? (
        <div className="card empty">No character log yet. Choose the game folder on the Settings page and play with logging on (/log on).</div>
      ) : !view ? (
        <Pending error={q.error} retry={q.reload} what="your progression" hint="The first look reads the whole log and its archives." />
      ) : empty ? (
        <div className="card empty">Nothing in this log or its archives yet. Play with logging on (/log on) and levels, skill-ups and experience appear here.</div>
      ) : (
        <>
          <Summary view={view} now={now} />
          <Sessions view={view} />
          <div className="grid two mb-16" style={{ alignItems: 'start' }}>
            <Levels view={view} now={now} />
            <Purchases view={view} now={now} />
          </div>
          <Skills view={view} now={now} />
        </>
      )}
    </>
  )
}

function Summary({ view, now }: { view: ProgressionView; now: number }) {
  const lastUp = view.levels.find((l) => !l.lost)
  const p = view.points
  const w = view.week
  return (
    <div className="grid four mb-16">
      <div className="card stat">
        <span className="label">Highest level</span>
        <span className="value">{view.highest ?? '—'}</span>
        <span className="sub" title={lastUp ? stamp(lastUp.at) : undefined}>
          {lastUp ? `latest level gained: ${lastUp.level} (whichever class), ${ago(lastUp.at, now)}` : 'no level-up on record'}
        </span>
      </div>
      <div className="card stat">
        <span className="label">
          Unspent AA points <Info label="Where this comes from" text={POINTS_HOW} />
        </span>
        <span className="value">{p ? p.unspent : '—'}</span>
        <span className="sub" title={p ? `The game said ${p.total} at ${stamp(p.at)}` : undefined}>
          {!p ? 'not reported yet' : p.atCap ? 'at the AA point cap' : p.spentSince ? `${p.total} reported, ${p.spentSince} spent since` : `as of ${ago(p.at, now)}`}
        </span>
      </div>
      <div className="card stat">
        <span className="label">Skill-ups, last 7 days</span>
        <span className="value">{w.skillUps.toLocaleString()}</span>
        <span className="sub">
          {plural(w.sessions, 'session')}, {plural(w.levels, 'level')}
        </span>
      </div>
      <div className="card stat">
        <span className="label">Experience, last 7 days</span>
        <span className="value" title="Experience messages: about one per kill that gave some">
          {plural(w.xp, 'message')}
        </span>
        <span className="sub">{plural(w.aaPoints, 'AA point')} gained</span>
      </div>
    </div>
  )
}

function Sessions({ view }: { view: ProgressionView }) {
  const [sort, setSort] = useRemembered<Sort<SessionKey>>('progression.sessions.sort', { key: 'start', dir: -1 })
  const [onlyProgress, setOnlyProgress] = useRemembered('progression.onlyProgress', true)
  const [all, setAll] = useState(false)
  const rows = useMemo(() => view.sessions.filter((s) => !onlyProgress || progressed(s)).sort(bySession(sort)), [view, onlyProgress, sort])
  const shown = all ? rows : rows.slice(0, FIRST_ROWS)
  return (
    <div className="card mb-16" style={{ padding: 0 }}>
      <div className="row" style={{ padding: '12px 14px' }}>
        <h2 style={{ margin: 0 }}>Sessions</h2>
        <span className="spacer" />
        <Switch on={onlyProgress} onChange={setOnlyProgress} label="Only sessions with progress" />
        <span className="small muted">Only sessions with progress</span>
        <span className="faint small">{plural(rows.length, 'session')}</span>
      </div>
      {!rows.length ? (
        <div className="empty">No sessions with experience, AA points, levels or skill-ups yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <SortTh k="start" sort={sort} onSort={setSort}>Started</SortTh>
              <SortTh k="length" sort={sort} onSort={setSort} num title="From the session's first log line to its last">Length</SortTh>
              <SortTh k="xp" sort={sort} onSort={setSort} num title="Experience messages: yours, a group's and rewards">Experience</SortTh>
              <SortTh k="xpRate" sort={sort} onSort={setSort} num title="Experience messages an hour">Exp/hour</SortTh>
              <SortTh k="pct" sort={sort} onSort={setSort} num title="The percentages of a level the experience lines printed, added up. Lines without one are not in it.">Level %</SortTh>
              <SortTh k="aa" sort={sort} onSort={setSort} num title="Ability points the game said you gained">AA points</SortTh>
              <SortTh k="aaRate" sort={sort} onSort={setSort} num title="Ability points an hour">AA/hour</SortTh>
              <SortTh k="levels" sort={sort} onSort={setSort} num>Levels</SortTh>
              <SortTh k="skills" sort={sort} onSort={setSort} num>Skill-ups</SortTh>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.start}>
                <td className="nowrap" title={`${stamp(s.start)} to ${stamp(s.end)}`}>
                  {stamp(s.start)}
                </td>
                <td className="num mono">{clock((s.end - s.start) / 1000)}</td>
                <td
                  className="num mono"
                  title={`Yours ${s.solo}, group ${s.party}, reward ${s.reward}${s.noXp ? `; ${s.noXp} kill${s.noXp === 1 ? '' : 's'} gave none (raid)` : ''}`}
                >
                  {dash(s.xp)}
                </td>
                <td className="num mono">{s.xp ? rate(s.xpPerHour) : '—'}</td>
                <td className="num mono" title={s.pctLines ? `${s.pctLines} of ${s.solo + s.party} experience lines printed a percentage` : 'No line printed a percentage'}>
                  {s.pctLines ? pctOf(s.pct) : '—'}
                </td>
                <td className="num mono" title={s.aaBought ? `${plural(s.aaBought, 'purchase')} for ${plural(s.aaSpent, 'point')}` : undefined}>
                  {dash(s.aaPoints)}
                </td>
                <td className="num mono">{s.aaPoints ? rate(s.aaPerHour) : '—'}</td>
                <td className="num mono">{dash(s.levels)}</td>
                <td className="num mono">{dash(s.skillUps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > FIRST_ROWS && (
        <div className="row" style={{ padding: '8px 14px' }}>
          <button className="btn small ghost" onClick={() => setAll(!all)}>
            {all ? `Show the first ${FIRST_ROWS}` : `Show all ${rows.length}`}
          </button>
        </div>
      )}
    </div>
  )
}

function Levels({ view, now }: { view: ProgressionView; now: number }) {
  const [all, setAll] = useState(false)
  const shown = all ? view.levels : view.levels.slice(0, FIRST_ROWS)
  return (
    <div className="card">
      <h2>
        Levels <Info label="Why runs" text={LEVELS_HOW} />
        <span className="spacer" />
        <span className="chip">{view.levels.filter((l) => !l.lost).length}</span>
      </h2>
      {!view.levels.length ? (
        <div className="empty">No level-up on record yet.</div>
      ) : (
        <div className="stack gap-6">
          <div className="row tight">
            {view.runs.map((r, i) => (
              <span key={i} className="chip" title={`${plural(r.count, 'level-up')}, ${stamp(r.first)} to ${stamp(r.last)}`}>
                <span className="mono">{r.from === r.to ? r.to : `${r.from}–${r.to}`}</span>{' '}
                <span className="faint">{r.first === r.last || day(r.first) === day(r.last) ? day(r.last) : `${day(r.first)} – ${day(r.last)}`}</span>
              </span>
            ))}
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Level</th>
                <th>When</th>
                <th title="The run of level-ups it follows on from, as above">Run</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l, i) => {
                const r = view.runs[l.run]
                return (
                  <tr key={i}>
                    <td className="mono">{l.lost ? <span className="bad-text">lost, back to {l.level}</span> : l.level}</td>
                    <td className="faint small nowrap" title={stamp(l.at)}>
                      {ago(l.at, now)}
                    </td>
                    <td className="faint small mono">{r ? (r.from === r.to ? r.to : `${r.from}–${r.to}`) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {view.levels.length > FIRST_ROWS && (
            <button className="btn small ghost" onClick={() => setAll(!all)}>
              {all ? `Show the last ${FIRST_ROWS}` : `Show all ${view.levels.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const aaLabel = (p: AaPurchase) => (p.rank === null ? p.name : `${p.name} ${p.rank}`)

function Purchases({ view, now }: { view: ProgressionView; now: number }) {
  const [all, setAll] = useState(false)
  const shown = all ? view.purchases : view.purchases.slice(0, FIRST_ROWS)
  const spent = view.purchases.reduce((n, p) => n + p.cost, 0)
  return (
    <div className="card">
      <h2>
        AA purchases
        <span className="spacer" />
        <span className="chip" title={`${plural(spent, 'point')} spent in all`}>
          {view.purchases.length}
        </span>
      </h2>
      {!view.purchases.length ? (
        <div className="empty">No AA bought on record yet.</div>
      ) : (
        <div className="stack gap-6">
          <table className="table">
            <thead>
              <tr>
                <th>Ability</th>
                <th className="num">Cost</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p, i) => (
                <tr key={i}>
                  <td title={p.rank === null ? 'Its first rank' : `Rank ${p.rank}`}>{aaLabel(p)}</td>
                  <td className="num mono">{p.cost}</td>
                  <td className="faint small nowrap" title={stamp(p.at)}>
                    {ago(p.at, now)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.purchases.length > FIRST_ROWS && (
            <button className="btn small ghost" onClick={() => setAll(!all)}>
              {all ? `Show the last ${FIRST_ROWS}` : `Show all ${view.purchases.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Skills({ view, now }: { view: ProgressionView; now: number }) {
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useRemembered<Sort<SkillKey>>('progression.skills.sort', { key: 'last', dir: -1 })
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return view.skills.filter((r) => !f || r.name.toLowerCase().includes(f)).sort(bySkill(sort))
  }, [view, filter, sort])
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="row" style={{ padding: '12px 14px' }}>
        <h2 style={{ margin: 0 }}>Skills</h2>
        <span className="spacer" />
        <FilterBox placeholder="Filter by skill…" label="Filter skills" value={filter} onChange={setFilter} width={220} />
        <span className="faint small">{plural(view.skills.length, 'skill')} raised</span>
      </div>
      {!view.skills.length ? (
        <div className="empty">No skill-ups on record yet.</div>
      ) : !rows.length ? (
        <div className="empty">Nothing matches the filter.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <SortTh k="name" sort={sort} onSort={setSort}>Skill</SortTh>
              <SortTh k="value" sort={sort} onSort={setSort} num title="The value the last skill-up gave">Value</SortTh>
              <SortTh k="ups" sort={sort} onSort={setSort} num title="Skill-ups the log recorded">Ups</SortTh>
              <SortTh k="last" sort={sort} onSort={setSort}>Last up</SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name.toLowerCase()}>
                <td>{r.name}</td>
                <td className="num mono">{r.value}</td>
                <td className="num mono" title={`First on record ${stamp(r.first)}`}>
                  {r.ups.toLocaleString()}
                </td>
                <td className="faint small nowrap" title={stamp(r.last)}>
                  {ago(r.last, now)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
