import type { HunterTrackView, SlayerRow } from '../../../shared/tracking'
import { num, timeOfDay } from '../../../core/format'
import { useAchievementTrack } from '../hooks'
import { useActions, useLive, useSettled } from '../state'
import { ToggleChip } from './ui'
import { ago } from '../api'
import { useNow } from './TimerBars'
import type { Go } from '../nav'

// Live's hunting row: the Hunter named the zone still wants, and the Slayer counts the kills since the
// export moved, as the achievements overlay has them. Made for a hunt left running where nobody looks
// (another PC's log followed while this PC's game is closed): a named killed shows here at once.

/** How long a named killed stays called out at the top of the Hunter card. */
const DOWN_MS = 30 * 60_000
/** Slayer counts shown at most, the latest kill first. */
const SLAYER_ROWS = 6

/** The Hunter and Slayer cards, while the log is watched and either has something to say. */
export function HuntCards({ go }: { go: Go }) {
  const track = useAchievementTrack()
  const watching = useLive((l) => l.status.watching)
  const zone = useLive((l) => l.status.zone)
  const now = useNow(15_000)
  const hunter = track?.hunter ?? null
  const slayer = (track?.slayer?.rows ?? []).filter((r) => r.since > 0 && r.last > 0).sort((a, b) => b.last - a.last)
  if (!watching || !track || (!hunter && !slayer.length)) return null
  return (
    <div className="grid two mb-16">
      <HunterCard hunter={hunter} zone={zone} now={now} go={go} />
      <SlayerCard rows={slayer} now={now} go={go} />
    </div>
  )
}

function HunterCard({ hunter, zone, now, go }: { hunter: HunterTrackView | null; zone: string; now: number; go: Go }) {
  const { patchSettings } = useActions()
  const toasts = useSettled((s) => s.settings.hunterToasts)
  const rows = hunter?.rows ?? []
  // The named killed lately, newest first: what a hunt left running wants to hear.
  const down = rows
    .flatMap((r) => r.since.map((name) => ({ name, at: r.killed?.[name] ?? 0, achievement: r.achievement, left: r.left.length })))
    .filter((d) => d.at > 0 && now - d.at < DOWN_MS)
    .sort((a, b) => b.at - a.at)
  return (
    <div className="card">
      <div className="card-head">
        <h2>Hunter {zone && <span className="chip">{zone}</span>}</h2>
        <span className="spacer" />
        <ToggleChip
          on={toasts}
          onChange={(on) => void patchSettings((s) => ({ ...s, hunterToasts: on }))}
          title="A Windows notification when a named a Hunter achievement still wants dies, on this PC's log or another's"
        >
          Notify me
        </ToggleChip>
        <button className="link-button inline small" onClick={() => go('hunter')}>
          Plan › Hunter
        </button>
      </div>
      {down.map((d) => (
        <div key={`${d.name}|${d.at}`} className="hunt-down" role="status">
          ✓ <b>{d.name}</b> killed at {timeOfDay(d.at)}
          <span className="faint small">
            {' '}
            · {ago(d.at, now)} · {d.left ? `${d.left} left for ${d.achievement}` : `${d.achievement}: none left`}
          </span>
        </div>
      ))}
      {rows.map((r) => (
        <div key={r.achievement} className="hunt-ach">
          <div className="hunt-row">
            <b>{r.achievement}</b>
            <span className="mono small">
              {r.total - r.left.length} / {r.total}
            </span>
          </div>
          <span className="bar thin" aria-hidden="true">
            <i style={{ width: `${Math.round(((r.total - r.left.length) / Math.max(1, r.total)) * 100)}%` }} />
          </span>
          <ul className="hunt-list">
            {r.left.map((n) => (
              <li key={n}>
                {n}
                {r.seen?.[n] && <span className="faint small"> · {r.seen[n]}</span>}
                {r.near?.[n] && <span className="faint small"> · {r.near[n]}</span>}
              </li>
            ))}
            {r.since.map((n) => (
              <li key={n} className="done" title="Killed since your achievements export: your next export settles it">
                ✓ {n}
                {r.killed?.[n] ? <span className="faint small"> · killed {timeOfDay(r.killed[n])}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!rows.length && <div className="empty">{zone ? `No Hunter achievement wants anything in ${zone}.` : 'The zone is not known yet.'}</div>}
    </div>
  )
}

function SlayerCard({ rows, now, go }: { rows: SlayerRow[]; now: number; go: Go }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          Slayer <span className="chip">since your export</span>
        </h2>
        <span className="spacer" />
        <button className="link-button inline small" onClick={() => go('slayer')}>
          Plan › Slayer
        </button>
      </div>
      {rows.slice(0, SLAYER_ROWS).map((r) => {
        const n = Math.min(r.max, r.count + r.since)
        return (
          <div
            key={r.name}
            className="hunt-count"
            title={`${r.races}: ${num(r.count)} at your achievements export, +${num(r.since)} since${
              r.guessed ? ` (${num(r.guessed)} placed by the mob's name alone; your next export settles them)` : ''
            }`}
          >
            <div className="hunt-row">
              <span>
                {r.done || n >= r.max ? '✓ ' : ''}
                {r.name}
              </span>
              <span className="mono small">
                {num(n)} / {num(r.max)}{' '}
                <span className="hunt-plus">
                  +{r.guessed ? '~' : ''}
                  {num(r.since)}
                </span>
                <span className="faint" title="The last kill it counted">
                  {' '}
                  · {ago(r.last, now)}
                </span>
              </span>
            </div>
            <span className="bar thin" aria-hidden="true">
              <i style={{ width: `${Math.round((n / Math.max(1, r.max)) * 100)}%` }} />
            </span>
          </div>
        )
      })}
      {rows.length > SLAYER_ROWS && <div className="faint small">+{rows.length - SLAYER_ROWS} more moved since your export</div>}
      {!rows.length && <div className="empty">No Slayer count has moved since your achievements export.</div>}
    </div>
  )
}
