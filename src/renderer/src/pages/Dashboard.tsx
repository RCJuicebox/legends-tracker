import { useMemo, useState } from 'react'
import { timeOfDay } from '../../../core/format'
import { useRemembered } from '../remember'
import { useApp, useLive } from '../state'
import { ago, mb } from '../api'
import { act } from '../toast'
import { OVERLAY_BUFFS, TRY_LINES } from '../constants'
import { TimerBars, useNow } from '../components/TimerBars'
import { Icon } from '../components/ui'
import { GameFolderPrompt } from '../components/GameFolder'
import { FactionNowCard, FightSummary, QuietLogNotice, SetupChecklist } from '../components/LiveSummary'
import type { PageId } from '../main'
import { perHour, useMotes } from './Motes'
import { localDay, sessionHours, totalMotes } from '../../../core/motes'

const SAMPLE = `[Tue Sep 01 12:15:08 2026] You begin casting Envenomed Bolt X.
[Tue Sep 01 12:15:09 2026] A ratman warrior has been poisoned.
[Tue Sep 01 12:15:10 2026] You begin casting Spirit of the Puma X.
[Tue Sep 01 12:15:11 2026] You begin to snarl as your features become feline.`

/** Feed items drawn on Live, newest first. */
const FEED_SHOWN = 100

/**
 * The page selects only what its head and notices read; the stat cards, the timers and the activity
 * each select their own, so a status tick or a feed line draws only the part it changes (LT-403).
 */
export function Dashboard({ go }: { go: (p: PageId) => void }) {
  const { state, patchSettings } = useApp()
  const { settings } = state
  const watching = useLive((l) => l.status.watching)
  const character = useLive((l) => l.status.character)
  const elsewherePath = useLive((l) => l.status.elsewhere?.path ?? '')
  const elsewhereCharacter = useLive((l) => l.status.elsewhere?.character ?? '')
  const spellError = useLive((l) => l.status.spellError)
  // Shared with the Triggers page's Test panel: lines pasted in either are waiting in the other.
  const [sim, setSim] = useRemembered<string>(TRY_LINES, '')
  const [simOpen, setSimOpen] = useState(() => !!sim)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Live</h1>
          <p>Every timer the tracker is running, as the overlays show them, plus what has happened recently.</p>
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
              disabled={!settings.logFile}
              title={settings.logFile ? undefined : 'Choose a character log on Log Files first'}
            >
              <Icon name="play" /> Start watching
            </button>
          )}
          {!watching && !settings.logFile && (
            <span className="faint small">
              Choose a character log on{' '}
              <button className="link-button inline" onClick={() => go('logs')}>
                Log Files
              </button>{' '}
              first.
            </span>
          )}
          <button className={`btn${state.arranging ? ' on' : ''}`} aria-pressed={state.arranging} onClick={() => void act('overlays:arrange', !state.arranging)}>
            <Icon name="move" /> {state.arranging ? 'Lock overlays' : 'Arrange overlays'}
          </button>
          <button
            className={`btn${settings.audio.muted ? ' on' : ''}`}
            aria-pressed={settings.audio.muted}
            onClick={() => patchSettings((s) => ({ ...s, audio: { ...s.audio, muted: !s.audio.muted } }))}
          >
            <Icon name="mute" /> {settings.audio.muted ? 'Unmute' : 'Mute'}
          </button>
        </div>
      </div>

      <GameFolderPrompt />
      <SetupChecklist go={go} />
      <QuietLogNotice go={go} />
      {elsewherePath && (
        <div className="notice mb-16">
          {elsewhereCharacter}&apos;s log is being written while {character || 'this character'}&apos;s is quiet.{' '}
          <button className="btn small primary" onClick={() => patchSettings((s) => ({ ...s, logFile: elsewherePath }))}>
            Follow {elsewhereCharacter}
          </button>
        </div>
      )}
      {settings.installDir && !spellError && !settings.logFile && (
        <div className="notice mb-16">
          No character log selected.{' '}
          <button className="btn small" onClick={() => go('logs')}>
            Choose one
          </button>
        </div>
      )}

      <StatCards go={go} />

      <FightSummary go={go} />
      <FactionNowCard go={go} />

      <LiveTimers />

      <div className="grid two">
        <Activity />
        <div className="card">
          <h2>
            Try log lines <span className="spacer" />
            <button className="btn small" onClick={() => void act('overlays:demo')}>
              <Icon name="sparkle" /> Show demo timers
            </button>
          </h2>
          <p className="muted small mt-0">
            Paste log lines to run them through the live tracker and triggers, with their times moved to now. To see which trigger a line matches and what it would say, without
            running it, use{' '}
            <button className="link-button inline" onClick={() => go('triggers')}>
              Test on the Triggers page
            </button>
            .
          </p>
          {simOpen ? (
            <div className="stack gap-8">
              <textarea className="mono" rows={7} value={sim} aria-label="Log lines to run" onChange={(e) => setSim(e.target.value)} placeholder={SAMPLE} />
              <div className="row">
                <button className="btn primary" onClick={() => void act('simulate', sim || SAMPLE)}>
                  Run lines
                </button>
                <button className="btn ghost" onClick={() => setSim(SAMPLE)}>
                  Use example
                </button>
              </div>
            </div>
          ) : (
            <button className="btn" onClick={() => setSimOpen(true)}>
              Paste log lines…
            </button>
          )}
        </div>
      </div>
    </>
  )
}

/** Status, character, motes and log size: what a status tick changes. */
function StatCards({ go }: { go: (p: PageId) => void }) {
  const { state } = useApp()
  const { settings } = state
  const watching = useLive((l) => l.status.watching)
  const lastLineAt = useLive((l) => l.status.lastLineAt)
  const character = useLive((l) => l.status.character)
  const zone = useLive((l) => l.status.zone)
  const logSize = useLive((l) => l.status.logSize)
  const status = { watching, lastLineAt, character, zone, logSize }
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
        <span className="value">{status.character || '—'}</span>
        <span className="sub">{status.zone || 'zone unknown'}</span>
      </div>
      <button className="card stat card-button" onClick={() => go('motes')}>
        <span className="label">{crawl ? (crawl.kind === 'manual' ? 'Session motes' : 'Instance run motes') : 'Motes today'}</span>
        <span className="value">
          {crawl ? `${totalMotes(crawl.motes)} · ${perHour(totalMotes(crawl.motes), sessionHours(crawl, now))}/h` : totalMotes(motes?.daily[localDay(now)] ?? {})}
        </span>
        <span className="sub">{crawl ? `${crawl.pausedSince ? 'Paused · ' : ''}${crawl.name}` : 'no run in progress'}</span>
      </button>
      <button className="card stat card-button" onClick={() => go('logs')}>
        <span className="label">Log size</span>
        <span className="value">{status.logSize ? mb(status.logSize) : '—'}</span>
        <span className="sub">{settings.archive.autoEnabled ? `archives at ${settings.archive.thresholdMB} MB` : 'auto-archive off'}</span>
      </button>
    </div>
  )
}

/** The buffs and the other timers, as the overlays show them. */
function LiveTimers() {
  const timers = useLive((l) => l.timers)
  const buffs = useMemo(() => timers.filter((t) => t.overlay === OVERLAY_BUFFS), [timers])
  const others = useMemo(() => timers.filter((t) => t.overlay !== OVERLAY_BUFFS), [timers])
  return (
    <div className="grid two mb-16">
      <div className="card">
        <h2>
          Buffs <span className="chip">{buffs.length}</span>
        </h2>
        <TimerBars timers={buffs} grouped fontSize={15} empty={<div className="empty">No buffs running. Cast one and it appears here.</div>} />
      </div>
      <div className="card">
        <h2>
          DoTs &amp; timers <span className="chip">{others.length}</span>
        </h2>
        <TimerBars timers={others} grouped fontSize={15} empty={<div className="empty">No DoTs or debuffs running.</div>} />
      </div>
    </div>
  )
}

/** What has happened lately: a feed line draws this card alone. */
function Activity() {
  const feed = useLive((l) => l.feed)
  // Newest first, and no more than a page shows: the feed keeps 300.
  const recent = useMemo(() => feed.slice(-FEED_SHOWN).reverse(), [feed])
  return (
    <div className="card">
      <h2>
        Activity <span className="spacer" />
      </h2>
      <div className="feed">
        {feed.length === 0 && <div className="empty">Nothing yet.</div>}
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
