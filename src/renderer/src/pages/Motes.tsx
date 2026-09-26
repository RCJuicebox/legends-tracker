import { useEffect, useState } from 'react'
import { api, clock } from '../api'
import { useInvoke } from '../hooks'
import { act } from '../toast'
import { useNow } from '../components/TimerBars'
import { ConfirmButton, Icon, Info, Pending } from '../components/ui'
import { MotePlanner } from './MotePlanner'
import { MoteSpells } from './MoteSpells'
import { useRemembered } from '../remember'
import { MOTE_RANKS, localDay, moteValue, moteWorth, pausedHours, sessionHours, totalMotes, type MoteCounts, type MoteSession, type MoteState } from '../../../core/motes'

type Scan = { scanning: string; scanProgress: number }
type View = MoteState & Scan

/**
 * The mote history. While it is being rebuilt from the logs only the progress is pushed; the whole
 * state follows once the rebuild is done.
 */
export function useMotesQuery() {
  const q = useInvoke<View>('motes:get')
  const setData = q.setData
  useEffect(() => {
    const offs = [
      api.on('state:motes', (v: View) => setData(v)),
      api.on('state:moteScan', (p: Scan) => setData((v) => (v ? { ...v, scanning: p.scanning, scanProgress: p.scanProgress } : v)))
    ]
    return () => offs.forEach((off) => off())
  }, [setData])
  return q
}

export function useMotes(): View | null {
  return useMotesQuery().data
}

const VALUE_HINT =
  'Counted in Infinitesimal motes. Two of a rank combine into one of the next, so each rank is worth double the one below: Minor 2, Lesser 4, Potential 8, Major 16, Greater 32, Superior 64, Grand 128.'

export function perHour(n: number, hours: number): string {
  return hours >= 1 / 60 ? (n / hours).toFixed(1) : '—'
}

function RankChips({ counts }: { counts: MoteCounts }) {
  const ranks = MOTE_RANKS.filter((r) => counts[r.key])
  if (!ranks.length) return <span className="faint">none yet</span>
  return (
    <span className="row tight">
      {ranks.map((r) => (
        <span key={r.key} className="chip" title={`Worth ${moteWorth(MOTE_RANKS.indexOf(r))} Infinitesimal each`} aria-label={`${counts[r.key]} ${r.name || 'Potential'}, worth ${moteWorth(MOTE_RANKS.indexOf(r))} Infinitesimal each`}>
          {counts[r.key]} {r.name || 'Potential'}
        </span>
      ))}
    </span>
  )
}

/** "13:05" on the session's day → a timestamp. */
function timeOnDay(day: number, hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmm.trim())
  if (!m) return null
  const d = new Date(day)
  d.setHours(+m[1], +m[2], +(m[3] ?? 0), 0)
  return d.getTime()
}

function hhmm(t: number): string {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function PauseControl({ s, now }: { s: MoteSession; now: number }) {
  const [since, setSince] = useState('')
  useEffect(() => setSince(s.pausedSince ? hhmm(s.pausedSince) : ''), [s.pausedSince])
  const apply = () => {
    const t = timeOnDay(s.startedAt, since)
    if (t !== null) void act('motes:pause', t)
  }
  if (!s.pausedSince) {
    return (
      <div className="row">
        <button className="btn" onClick={() => void act('motes:pause')}>
          <Icon name="stop" /> Pause
        </button>
        <span className="faint small">Stepped away already? Pause, then set the time you left.</span>
      </div>
    )
  }
  return (
    <div className="notice row">
      <b>Paused</b>
      <span>since</span>
      <input value={since} aria-label="Paused since (hh:mm:ss)" onChange={(e) => setSince(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} style={{ width: 96 }} className="mono" />
      <span className="muted">({clock((now - s.pausedSince) / 1000)} so far; not counted)</span>
      <span className="grow" />
      <button className="btn primary" onClick={() => void act('motes:resume')}>
        <Icon name="play" /> Resume
      </button>
    </div>
  )
}

export function Motes() {
  const [tab, setTab] = useRemembered<'tracking' | 'planner' | 'spells'>('motes.tab', 'tracking')
  return (
    <>
      <div className="row gap-6 mb-14" role="group" aria-label="Motes view">
        <button className={`btn${tab === 'tracking' ? ' on' : ' ghost'}`} aria-pressed={tab === 'tracking'} onClick={() => setTab('tracking')}>
          Tracking
        </button>
        <button className={`btn${tab === 'planner' ? ' on' : ' ghost'}`} aria-pressed={tab === 'planner'} onClick={() => setTab('planner')}>
          Upgrade planner
        </button>
        <button className={`btn${tab === 'spells' ? ' on' : ' ghost'}`} aria-pressed={tab === 'spells'} onClick={() => setTab('spells')}>
          Spell upgrades
        </button>
      </div>
      {tab === 'tracking' ? <MoteTracking /> : tab === 'planner' ? <MotePlannerPage /> : <MoteSpellsPage />}
    </>
  )
}

function MoteSpellsPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Spell upgrades</h1>
          <p>Which of the spells and songs you cast to put motes into next: the most gained per xp, by the guide's categories.</p>
        </div>
      </div>
      <MoteSpells />
    </>
  )
}

function MotePlannerPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Upgrade planner</h1>
          <p>Which motes an item needs to reach the level you want, and how to get them from your stock.</p>
        </div>
      </div>
      <MotePlanner />
    </>
  )
}

/** Worth a check once a minute: today's totals roll over at midnight. Completed runs do not move. */
const TOTALS_TICK_MS = 60_000

function MoteTracking() {
  const q = useMotesQuery()
  const view = q.data
  const now = useNow(TOTALS_TICK_MS)
  if (!view) return <Pending what="your motes" error={q.error} retry={q.reload} />
  const a = view.active
  const today = view.daily[localDay(now)] ?? {}
  const crawls = view.sessions.filter((s) => s.kind === 'crawl' && s.outcome === 'completed')
  const crawlHours = crawls.reduce((n, s) => n + sessionHours(s, now), 0)
  const crawlMotes = crawls.reduce((n, s) => n + totalMotes(s.motes), 0)
  const crawlValue = crawls.reduce((n, s) => n + moteValue(s.motes), 0)
  const allTime: MoteCounts = {}
  for (const day of Object.values(view.daily)) for (const r of MOTE_RANKS) if (day[r.key]) allTime[r.key] = (allTime[r.key] ?? 0) + day[r.key]!
  const scanPct = Math.round((view.scanProgress ?? 0) * 100)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Motes</h1>
          <p>
            Every mote you loot, counted from the log. Every instance run is timed from when you enter; the log cannot tell
            a Dungeon Crawl from a normal instance, so a run becomes a crawl when the game says it is complete (reward chest
            included). Only the instance owner gets that line, so click a run's type to mark it a crawl yourself. Use a manual
            session for anything else.
          </p>
        </div>
        <div className="actions">
          {a ? (
            <button className="btn" onClick={() => void act('motes:stop')}>
              <Icon name="stop" /> Stop {a.kind === 'manual' ? 'session' : 'run'}
            </button>
          ) : (
            <button className="btn primary" onClick={() => void act('motes:start')}>
              <Icon name="play" /> Start a session
            </button>
          )}
          <button className="btn" disabled={!!view.scanning} onClick={() => void act('motes:rescan')}>
            {view.scanning ? 'Reading logs…' : 'Rebuild from logs'}
          </button>
        </div>
      </div>

      {view.scanning && (
        <div className="notice stack gap-8 mb-16">
          <div className="row">
            <span className="grow" role="status">
              {view.scanning}
            </span>
            <b>{scanPct}%</b>
          </div>
          <div className="bar-meter" role="progressbar" aria-label="Rebuilding from logs" aria-valuemin={0} aria-valuemax={100} aria-valuenow={scanPct}>
            <div style={{ width: `${scanPct}%` }} />
          </div>
        </div>
      )}

      <div className="grid two mb-16" style={{ alignItems: 'start' }}>
        <ActiveSession a={a} />

        <div className="card">
          <h2>
            Totals <Info label="What value means" text={VALUE_HINT} />
          </h2>
          <div className="grid three mb-12">
            <div className="stat">
              <span className="label">Today</span>
              <span className="value">{totalMotes(today)}</span>
              <span className="sub" title={VALUE_HINT}>{moteValue(today)} value</span>
            </div>
            <div className="stat">
              <span className="label">Completed crawls</span>
              <span className="value">{crawls.length}</span>
              <span className="sub">{clock(crawlHours * 3600)} in all</span>
            </div>
            <div className="stat">
              <span className="label">Crawl average</span>
              <span className="value">{perHour(crawlMotes, crawlHours)}/h</span>
              <span className="sub" title={VALUE_HINT}>{perHour(crawlValue, crawlHours)} value/hour</span>
            </div>
          </div>
          <div className="small muted mb-6">Today</div>
          <RankChips counts={today} />
          <div className="small muted" style={{ margin: '12px 0 6px' }}>Everything in your logs</div>
          <RankChips counts={allTime} />
        </div>
      </div>

      <SessionTable sessions={view.sessions} now={now} />
    </>
  )
}

/** The run in progress: the only part of the page that ticks every second. */
function ActiveSession({ a }: { a: MoteSession | null | undefined }) {
  const now = useNow(1000, !!a)
  return (
    <div className="card">
      <h2>
        {a ? (a.kind === 'manual' ? 'Session in progress' : 'Instance run in progress') : 'No session running'}
        <span className="spacer" />
        {a && <span className={`chip ${a.outsideSince ? 'warn' : 'ok'}`}>{a.kind === 'manual' ? 'manual' : a.outsideSince ? 'outside the instance' : 'in the instance'}</span>}
      </h2>
      {a ? (
        <div className="stack gap-12">
          <div>
            <div style={{ fontWeight: 650, fontSize: 16 }}>{a.name}</div>
            {a.kind === 'instance' && <div className="faint small">Becomes a dungeon crawl when the game says you completed it.</div>}
          </div>
          <div className="grid three">
            <div className="stat">
              <span className="label">Active time</span>
              <span className="value">{clock(sessionHours(a, now) * 3600)}</span>
              {pausedHours(a, now) > 0 && <span className="sub">{clock(pausedHours(a, now) * 3600)} paused</span>}
            </div>
            <div className="stat">
              <span className="label">Motes</span>
              <span className="value">{totalMotes(a.motes)}</span>
              <span className="sub" title={VALUE_HINT}>{moteValue(a.motes)} value</span>
            </div>
            <div className="stat">
              <span className="label">Per hour</span>
              <span className="value">{perHour(totalMotes(a.motes), sessionHours(a, now))}</span>
              <span className="sub" title={VALUE_HINT}>{perHour(moteValue(a.motes), sessionHours(a, now))} value/hour</span>
            </div>
          </div>
          <RankChips counts={a.motes} />
          <PauseControl s={a} now={now} />
        </div>
      ) : (
        <div className="empty">Enter a dungeon crawl, or start a session yourself.</div>
      )}
    </div>
  )
}

function SessionTable({ sessions, now }: { sessions: MoteSession[]; now: number }) {
  return (
    <div className="card">
      <h2>
        Sessions <span className="chip">{sessions.length}</span>
      </h2>
      {sessions.length === 0 ? (
        <div className="empty">None yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Where</th>
              <th>Type</th>
              <th>Time</th>
              <th>Motes</th>
              <th>Per hour</th>
              <th title={VALUE_HINT}>Value / hour</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.slice(0, 100).map((s) => {
              const h = sessionHours(s, now)
              return (
                <tr key={s.id}>
                  <td className="nowrap small">{new Date(s.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{s.name}</div>
                    <div className="small">
                      <RankChips counts={s.motes} />
                    </div>
                  </td>
                  <td>
                    {s.kind === 'manual' ? (
                      <span className="chip">manual</span>
                    ) : (
                      <button
                        className={`chip chip-btn ${s.kind === 'crawl' ? 'ok' : ''}`}
                        onClick={() => void act('motes:setKind', s.id, s.kind === 'crawl' ? 'instance' : 'crawl')}
                        title={
                          s.kind === 'crawl'
                            ? `${s.byHand ? 'Marked a crawl by you' : 'The game said this crawl was completed'}. Click to make it a normal instance.`
                            : 'Click to mark this run as a dungeon crawl: the game only tells the instance owner when one is completed.'
                        }
                      >
                        {s.kind === 'crawl' ? 'dungeon crawl' : 'normal'}
                        {s.byHand && <span className="faint"> ✎</span>}
                      </button>
                    )}
                  </td>
                  <td
                    className="mono nowrap"
                    title={[s.pausedMs ? `${clock(s.pausedMs / 1000)} paused, not counted` : '', s.outsideMs ? `${clock(s.outsideMs / 1000)} outside the instance` : '']
                      .filter(Boolean)
                      .join('; ')}
                  >
                    {clock(h * 3600)}
                  </td>
                  <td className="mono">{totalMotes(s.motes)}</td>
                  <td className="mono">{perHour(totalMotes(s.motes), h)}</td>
                  <td className="mono">{perHour(moteValue(s.motes), h)}</td>
                  <td>
                    <ConfirmButton className="btn ghost small x-btn" title="Remove from the list" label={`Remove ${s.name} from the list`} question="Remove it?" onConfirm={() => void act('motes:forget', s.id)}>
                      ×
                    </ConfirmButton>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
