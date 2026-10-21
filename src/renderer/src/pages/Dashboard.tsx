import type { FeedItem, TimerView } from '../../../shared/types'
import { useContext, useMemo } from 'react'
import { timeOfDay, who } from '../../../core/format'
import { useRemembered } from '../remember'
import { useActions, useLive, useSettled } from '../state'
import { ago, mb } from '../api'
import { act, actDone } from '../toast'
import { OVERLAY_BUFFS } from '../constants'
import { TimerBars, useNow } from '../components/TimerBars'
import { Icon, ToggleChip } from '../components/ui'
import { GameFolderPrompt } from '../components/GameFolder'
import { FactionNowCard, FightSummary, QuietLogNotice, SetupChecklist } from '../components/LiveSummary'
import { TryLogLineLink } from '../components/TryLogLine'
import { HuntCards } from '../components/LiveHunt'
import { GoContext, type Go } from '../nav'
import { perHour, useMotes } from './MoteRuns'
import { localDay, sessionHours, totalMotes } from '../../../core/motes'
import { characterKey } from '../../../core/validate'
import { handOff } from '../handoff'

/** Feed items drawn on Live, newest first. */
const FEED_SHOWN = 100

/**
 * The page selects only what its head and notices read; the stat cards, the timers and the activity
 * each select their own, so a status tick or a feed line draws only the part it changes (LT-403).
 */
export function Dashboard({ go }: { go: Go }) {
  const { patchSettings } = useActions()
  const arranging = useSettled((s) => s.arranging)
  const muted = useSettled((s) => s.settings.audio.muted)
  const logFile = useSettled((s) => s.settings.logFile)
  const watching = useLive((l) => l.status.watching)
  const character = useLive((l) => l.status.character)
  const elsewherePath = useLive((l) => l.status.elsewhere?.path ?? '')
  const elsewhereCharacter = useLive((l) => l.status.elsewhere?.character ?? '')
  const remote = useLive((l) => l.status.remote ?? null)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Live</h1>
          <p>Every timer the tracker is running, as the overlays show them, what your hunt is doing, and what has happened recently.</p>
        </div>
        <div className="actions">
          {watching ? (
            <button className="btn" onClick={() => void act('watch:stop')}>
              <Icon name="stop" /> Stop watching
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={() => void act('watch:start')}
              disabled={!logFile}
              title={logFile ? undefined : 'Follow a character log on Settings › Log files first'}
            >
              <Icon name="play" /> Start watching
            </button>
          )}
          {!watching && !logFile && (
            <span className="faint small">
              Follow a character log on{' '}
              <button className="link-button inline" onClick={() => go('settings', 'logs')}>
                Settings › Log files
              </button>{' '}
              first.
            </span>
          )}
          <button className={`btn${arranging ? ' on' : ''}`} aria-pressed={arranging} onClick={() => void act('overlays:arrange', !arranging)}>
            <Icon name="move" /> {arranging ? 'Lock overlays' : 'Arrange overlays'}
          </button>
          <button className={`btn${muted ? ' on' : ''}`} aria-pressed={muted} onClick={() => patchSettings((s) => ({ ...s, audio: { ...s.audio, muted: !s.audio.muted } }))}>
            <Icon name="mute" /> {muted ? 'Unmute' : 'Mute'}
          </button>
        </div>
      </div>

      <GameFolderPrompt />
      <SetupChecklist go={go} />
      <QuietLogNotice go={go} />
      {remote && (
        <div className="notice info mb-16">
          Following <b>{remote.character}</b> on another PC ({remote.folder}): this PC&apos;s game is closed. The timers, the meter and the overlays follow that log, and this
          PC&apos;s log is followed again as soon as its game starts.{' '}
          <button
            className="btn small"
            onClick={async () => {
              await patchSettings((s) => ({ ...s, followOtherPcs: false }))
              void act('watch:start')
            }}
            title="Settings › Log files turns it back on"
          >
            Stop following other PCs
          </button>
          <OtherLogPicker />
        </div>
      )}
      {elsewherePath && (
        <div className="notice mb-16">
          {elsewhereCharacter}&apos;s log is being written while {character || 'this character'}&apos;s is quiet.{' '}
          <button className="btn small primary" onClick={() => patchSettings((s) => ({ ...s, logFile: elsewherePath }))}>
            Follow {elsewhereCharacter}
          </button>
        </div>
      )}

      <StatCards go={go} />

      {/* What a hunt is doing, here or on another PC's log: the named left and down, the Slayer counts moving. */}
      <HuntCards go={go} />

      <FightSummary go={go} />
      <FactionNowCard go={go} />

      <LiveTimers />

      <Activity />
    </>
  )
}

/**
 * Which other PC's log to follow, when more than one is being written (two PCs playing at once): the
 * automatic pick, or one chosen here until it goes quiet. This PC's log still comes first while its
 * game is played.
 */
function OtherLogPicker() {
  const others = useLive((l) => l.status.others ?? [])
  const chosen = useLive((l) => l.status.chosenOther ?? null)
  if (others.length < 2 && !chosen) return null
  return (
    <label className="row mt-12">
      Follow
      <select aria-label="Other PC's log to follow" value={chosen ?? ''} onChange={(e) => void act('logs:followOther', e.target.value || null)}>
        <option value="">Automatic: the newest, this PC&apos;s character first</option>
        {others.map((o) => (
          <option key={o.path} value={o.path}>
            {o.character} on {o.folder}, written {ago(o.modified)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Status, character, motes and log size: what a status tick changes. */
function StatCards({ go }: { go: Go }) {
  const archive = useSettled((s) => s.settings.archive)
  const watching = useLive((l) => l.status.watching)
  const lastLineAt = useLive((l) => l.status.lastLineAt)
  const character = useLive((l) => l.status.character)
  const zone = useLive((l) => l.status.zone)
  const logSize = useLive((l) => l.status.logSize)
  const status = { watching, lastLineAt, character, zone, logSize }
  const logFile = useSettled((s) => s.settings.logFile)
  const followed = logFile ? who(characterKey(logFile)) : ''
  useNow(5000)
  const motes = useMotes()
  const crawl = motes?.active
  const now = Date.now()
  return (
    <div className="grid four mb-16">
      <div className="card stat">
        <span className="label">Status</span>
        <span className="value row tight">
          <span className={`status-dot${status.watching ? ' live' : ''}`} />
          {status.watching ? 'Watching' : 'Stopped'}
        </span>
        <span className="sub">{status.watching ? (status.lastLineAt ? `last line ${ago(status.lastLineAt)}` : 'no line yet') : 'Start watching to track'}</span>
      </div>
      <div className="card stat">
        <span className="label">Character</span>
        <span className="value">{status.character || followed || '—'}</span>
        <span className="sub">{status.zone || 'zone unknown'}</span>
      </div>
      <button className="card stat card-button" onClick={() => go('motes', 'runs')}>
        <span className="label">{crawl ? (crawl.kind === 'manual' ? 'Run motes' : 'Instance run motes') : 'Motes today'}</span>
        <span className="value">
          {crawl ? `${totalMotes(crawl.motes)} · ${perHour(totalMotes(crawl.motes), sessionHours(crawl, now))}/h` : totalMotes(motes?.daily[localDay(now)] ?? {})}
        </span>
        <span className="sub">{crawl ? `${crawl.pausedSince ? 'Paused · ' : ''}${crawl.name}` : 'no run in progress'}</span>
      </button>
      <button className="card stat card-button" onClick={() => go('settings', 'logs')}>
        <span className="label">Log size</span>
        <span className="value">{status.logSize ? mb(status.logSize) : '—'}</span>
        <span className="sub">{archive.autoEnabled ? `archives at ${archive.thresholdMB} MB` : 'auto-archive off'}</span>
      </button>
    </div>
  )
}

/** The buffs and the other timers, as the overlays show them. */
function LiveTimers() {
  const go = useContext(GoContext)
  // A bar's name opens what sets it: its spell's row, or its trigger (LT-691).
  const openRule = (t: TimerView) => {
    if (!go || !t.rule) return
    handOff(t.source === 'spell' ? 'spells' : 'triggers', t.rule)
    go(t.source === 'spell' ? 'spells' : 'triggers')
  }
  const timers = useLive((l) => l.timers)
  const buffs = useMemo(() => timers.filter((t) => t.overlay === OVERLAY_BUFFS), [timers])
  const others = useMemo(() => timers.filter((t) => t.overlay !== OVERLAY_BUFFS), [timers])
  return (
    <div className="grid two mb-16">
      <div className="card">
        <h2>
          Buffs <span className="chip">{buffs.length}</span>
        </h2>
        <TimerBars
          timers={buffs}
          grouped
          fontSize={15}
          onOpen={openRule}
          empty={<div className="empty">No buff timers running. Cast one and it appears here; the Buffs page lists every buff on you.</div>}
        />
      </div>
      <div className="card">
        {/* Seeing timers without casting: the Triggers page's Test card runs pasted lines, and the demo puts made-up ones on the overlays. */}
        <div className="card-head">
          <h2>
            DoTs &amp; timers <span className="chip">{others.length}</span>
          </h2>
          <span className="spacer" />
          <TryLogLineLink className="link-button inline small" />
          <button className="btn small" onClick={() => void actDone('Demo timers are up on the overlays', 'overlays:demo')}>
            <Icon name="sparkle" /> Show demo timers
          </button>
        </div>
        <TimerBars timers={others} grouped fontSize={15} onOpen={openRule} empty={<div className="empty">No DoTs or debuffs running.</div>} />
      </div>
    </div>
  )
}

/** What has happened lately: a feed line draws this card alone. */
/** The kinds of line the activity feed has, in the order their chips show. */
const FEED_KINDS: { kind: FeedItem['kind']; label: string }[] = [
  { kind: 'timer', label: 'Timers' },
  { kind: 'fade', label: 'Fades' },
  { kind: 'trigger', label: 'Triggers' },
  { kind: 'fight', label: 'Fights' },
  { kind: 'loot', label: 'Loot' },
  { kind: 'archive', label: 'Archive' },
  { kind: 'info', label: 'Info' },
  { kind: 'warn', label: 'Warnings' }
]

function Activity() {
  const feed = useLive((l) => l.feed)
  // The kinds turned off, remembered, as Loot's outcomes are (LT-690).
  const [hidden, setHidden] = useRemembered<FeedItem['kind'][]>('live.feed.hidden', [])
  const toggle = (k: FeedItem['kind']) => setHidden(hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k])
  // Newest first, and no more than a page shows: the feed keeps 300.
  const recent = useMemo(
    () =>
      feed
        .filter((f) => !hidden.includes(f.kind))
        .slice(-FEED_SHOWN)
        .reverse(),
    [feed, hidden]
  )
  return (
    <div className="card">
      <h2>Activity</h2>
      <div className="row tight wrap mb-8" role="group" aria-label="Kinds of line shown">
        {FEED_KINDS.map((k) => (
          <ToggleChip key={k.kind} className={`k-${k.kind}`} on={!hidden.includes(k.kind)} onChange={() => toggle(k.kind)}>
            {k.label}
          </ToggleChip>
        ))}
      </div>
      <div className="feed">
        {feed.length === 0 && <div className="empty">Nothing yet.</div>}
        {feed.length > 0 && !recent.length && <div className="empty">Every line shown is of a kind turned off above.</div>}
        {recent.map((f) => (
          <div className="feed-item" key={f.id}>
            <span className="t">{timeOfDay(f.at, true)}</span>
            <span className={`k k-${f.kind}`}>{f.kind}</span>
            <span>{f.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
