import { useMemo, useState } from 'react'
import { useInvoke, useVisibleInterval } from '../../renderer/src/hooks'
import { useCharacterChoice } from '../../renderer/src/character'
import { CharacterPicker } from '../../renderer/src/components/CharacterPicker'
import { FilterBox, Info, Pending, ShowingSome, type Sort, sortRows, SortTh, ToggleChip } from '../../renderer/src/components/ui'
import { useRemembered } from '../../renderer/src/remember'
import { clock, levelPct, num1, when, who } from '../../core/format'
import { CRAWL_REWARD_SHARE, TIER_STEP, runPerHour, runReward, runTime, type XpRun, type XpValues } from './xp'

// Motes › Crawl XP: what each run in an instance brought, from the experience lines of the log (xp.ts),
// with the completion's reward worked out; and what a kill of each level is worth at the player's
// level, from the kills /con'd just before.

const HOW = (
  <>
    <div>
      <b>A run</b> is your time in one instance, from entering it until you make a new one: stepping out and back in goes on with it. Every kill that gives experience says how much
      of a level it was, and those are added up.
    </div>
    <div>
      <b>The reward</b> for completing a crawl is never shown in the log. Read from the experience bar on three crawls, it is a fifth of what the run’s kills had given (difficulty
      included), so it is worked out here.
    </div>
    <div>
      <b>Difficulty</b> adds a tenth to every kill per step: D1 ×1.1, D4 ×1.4. A run across a level gained adds percentages of two levels, so its total is a little off.
    </div>
  </>
)

const VALUES_HOW = (
  <>
    <div>
      From every kill you /con’d in the minute before it: what it gave, taken back to difficulty 0, at the level you were then (the last “Welcome to level” the log saw). The newest
      kill of each level counts, so a reincarnation since moves them.
    </div>
    <div>Mobs of one level are all worth the same: rare, named or not, whatever they are.</div>
  </>
)

type RunKey = 'when' | 'where' | 'time' | 'kills' | 'xp' | 'total' | 'perHour'
const RUNS_SHOWN = 50
const tierText = (tier: number) => `D${tier}`
const total = (r: XpRun) => r.xp + runReward(r)

function CurrentRun({ run }: { run: XpRun }) {
  const h = runPerHour(run)
  return (
    <div className="card mb-16">
      <div className="row">
        <b>Run in hand</b>
        <span>{run.zone}</span>
        <span className="chip">{tierText(run.tier)}</span>
        {run.doneAt && <span className="chip ok">completed</span>}
        <span className="spacer" />
        <span>
          <b className="mono">{num1(run.kills)}</b> kills · <b className="mono">{levelPct(run.xp)}</b>
          {run.doneAt ? (
            <>
              {' '}
              + reward <b className="mono">{levelPct(runReward(run))}</b>
            </>
          ) : (
            <span className="faint"> (+ a fifth on completing)</span>
          )}{' '}
          in <span className="mono">{clock(runTime(run) / 1000)}</span>
          {h !== null && (
            <>
              {' '}
              · <b className="mono">{num1(h)}%</b> an hour
            </>
          )}
        </span>
      </div>
    </div>
  )
}

function RunTable({ runs }: { runs: XpRun[] }) {
  const [sort, setSort] = useRemembered<Sort<RunKey>>('crawl.xp.sort', { key: 'when', dir: -1 })
  const [filter, setFilter] = useState('')
  const [all, setAll] = useState(false)
  const [doneOnly, setDoneOnly] = useRemembered('crawl.xp.doneOnly', true)
  const words = filter.trim().toLowerCase()
  const found = runs.filter((r) => (!doneOnly || r.doneAt) && (!words || r.zone.toLowerCase().includes(words) || tierText(r.tier).toLowerCase() === words))
  const rows = sortRows(found, sort, {
    when: (r) => r.startedAt,
    where: (r) => `${r.zone} ${r.tier}`,
    time: runTime,
    kills: (r) => r.kills,
    xp: (r) => r.xp,
    total,
    perHour: (r) => runPerHour(r) ?? -1
  })
  return (
    <div className="card mb-16">
      <h2>
        Runs <span className="chip">{runs.length}</span>
      </h2>
      {runs.length > 0 && (
        <div className="row mb-8">
          <FilterBox placeholder="Find a zone, or D1…" label="Find runs by zone or difficulty" value={filter} onChange={setFilter} width={220} />
          <ToggleChip
            on={doneOnly}
            onChange={setDoneOnly}
            title="Only runs the game said were completed crawls; off shows every stay in an instance, an evening sitting in one too"
          >
            Completed crawls only
          </ToggleChip>
        </div>
      )}
      {!runs.length ? (
        <div className="empty">No run in an instance in your logs yet.</div>
      ) : !rows.length ? (
        <div className="empty">
          {words
            ? `No run matching “${filter.trim()}”${doneOnly ? ' among the completed crawls' : ''}.`
            : 'No completed crawl yet: switch off “Completed crawls only” to see every run.'}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <SortTh k="when" sort={sort} onSort={setSort}>
                  When
                </SortTh>
                <SortTh k="where" sort={sort} onSort={setSort}>
                  Where
                </SortTh>
                <th>Level</th>
                <SortTh k="time" sort={sort} onSort={setSort} title="Entering the instance to completing the crawl (else to the last kill)">
                  Time
                </SortTh>
                <SortTh k="kills" sort={sort} onSort={setSort} title="Kills that gave experience">
                  Kills
                </SortTh>
                <SortTh k="xp" sort={sort} onSort={setSort} title="What the kills gave, in percent of a level">
                  From kills
                </SortTh>
                <th title={`Worked out: ${num1(CRAWL_REWARD_SHARE * 100)}% of what the kills had given when the crawl was completed (the log does not say it)`}>Reward</th>
                <SortTh k="total" sort={sort} onSort={setSort}>
                  Total
                </SortTh>
                <SortTh k="perHour" sort={sort} onSort={setSort} title="Total per hour of the run's time">
                  Per hour
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {(all ? rows : rows.slice(0, RUNS_SHOWN)).map((r) => {
                const h = runPerHour(r)
                return (
                  <tr key={`${r.zone}|${r.startedAt}`}>
                    <td className="nowrap small">{when(r.startedAt)}</td>
                    <td>
                      {r.zone} <span className="chip">{tierText(r.tier)}</span> {r.doneAt ? <span className="chip ok">completed</span> : null}
                    </td>
                    <td className="mono nowrap">{r.level ? (r.levels ? `${r.level}→${r.level + r.levels}` : r.level) : r.levels ? `+${r.levels}` : '–'}</td>
                    <td className="mono nowrap">{clock(runTime(r) / 1000)}</td>
                    <td className="mono">{num1(r.kills)}</td>
                    <td className="mono">{levelPct(r.xp)}</td>
                    <td className="mono">{r.doneAt ? levelPct(runReward(r)) : '–'}</td>
                    <td className="mono">{levelPct(total(r))}</td>
                    <td className="mono">{h === null ? '–' : `${num1(h)}%`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <ShowingSome shown={all ? rows.length : Math.min(rows.length, RUNS_SHOWN)} total={rows.length} onAll={() => setAll(true)} />
        </div>
      )}
    </div>
  )
}

function KillValues({ values, level }: { values: XpValues; level: number | null }) {
  const levels = useMemo(
    () =>
      Object.keys(values)
        .map(Number)
        .sort((a, b) => b - a),
    [values]
  )
  const [picked, setPicked] = useState<number | null>(null)
  const at = picked !== null && levels.includes(picked) ? picked : level !== null && levels.includes(level) ? level : (levels[0] ?? null)
  const rows =
    at === null
      ? []
      : Object.entries(values[at])
          .map(([ml, v]) => [Number(ml), v] as const)
          .sort((a, b) => b[0] - a[0])
  return (
    <div className="card mb-16">
      <div className="row mb-8">
        <h2 className="m-0">What a kill is worth</h2>
        <Info label="How it is worked out" text={VALUES_HOW} />
        <span className="spacer" />
        {levels.length > 0 && (
          <label className="row tight">
            At your level
            <select value={at ?? ''} onChange={(e) => setPicked(Number(e.target.value))}>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!rows.length ? (
        <div className="empty">/con a mob just before you kill it, and what it gave shows here by its level.</div>
      ) : (
        <div className="table-scroll">
          <table className="table small">
            <thead>
              <tr>
                <th>Mob level</th>
                <th title="At difficulty 0">Per kill</th>
                <th title={`Each step of difficulty adds ${num1(TIER_STEP * 100)}%`}>At D1</th>
                <th>At D4</th>
                <th title="Kills of this level for a whole level, at difficulty 0">Kills a level</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([ml, v]) => (
                <tr key={ml}>
                  <td className="mono">{ml}</td>
                  <td className="mono">{levelPct(v)}</td>
                  <td className="mono">{levelPct(v * (1 + TIER_STEP))}</td>
                  <td className="mono">{levelPct(v * (1 + 4 * TIER_STEP))}</td>
                  <td className="mono">{v > 0 ? num1(Math.ceil(100 / v)) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function CrawlXpPage() {
  const chars = useCharacterChoice('inventory', { withLogs: true })
  const character = chars.character
  const q = useInvoke(character ? 'crawl:xp' : null, [character], [character])
  // The run in hand moves with the log.
  useVisibleInterval(q.reload, q.data?.current ? 10_000 : 60_000)
  const d = q.data
  return (
    <>
      <div className="page-head">
        <p>
          The experience each run in an instance brought, from your log: every kill’s share of a level added up, and the crawl’s completion reward worked out (the game never shows
          it). <Info label="How it is worked out" text={HOW} />
        </p>
        <div className="actions">
          <CharacterPicker character={character} available={chars.available} onPick={chars.setCharacter} />
        </div>
      </div>
      {!chars.ready ? (
        <Pending error={chars.error} retry={chars.reload} what="your characters" />
      ) : !character ? (
        <div className="card empty">No character yet: play with logging on (/log on).</div>
      ) : !d ? (
        <Pending error={q.error} retry={q.reload} doing={`Reading ${who(character)}’s log`} />
      ) : (
        <>
          {d.current && <CurrentRun run={d.current} />}
          <RunTable runs={d.runs} />
          <KillValues values={d.values} level={d.level} />
        </>
      )}
    </>
  )
}
