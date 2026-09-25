import { useApp } from '../state'
import { mb, ago } from '../api'
import { useInvoke } from '../hooks'
import { act } from '../toast'
import { who } from '../format'
import { useUpdate, type UpdateState } from '../update'
import { Field, LoadError, NumberInput, Switch } from '../components/ui'
import { GameFolderCard } from '../components/GameFolder'
import type { LogFileInfo, TrackingSettings } from '../../../shared/types'

/** One line on where updates stand. */
function updateText(u: UpdateState | null): string {
  if (!u) return 'Running from source: updates apply to the installed app only.'
  switch (u.state) {
    case 'dev':
      return 'Running from source: updates apply to the installed app only.'
    case 'checking':
      return 'Checking for updates…'
    case 'downloading':
      return `Downloading ${u.version}… ${u.percent}%`
    case 'ready':
      return `Version ${u.version} is downloaded and installs when you restart.`
    case 'error':
      return `Could not check for updates: ${u.message}`
    default:
      return `Up to date${u.checkedAt ? `, checked ${ago(u.checkedAt)}` : ''}. Checks automatically every few hours.`
  }
}

/** Why "Check for updates" is greyed out, when it is. */
function noCheckReason(u: UpdateState | null): string | undefined {
  if (!u || u.state === 'dev') return 'This copy runs from source; only the installed app updates'
  if (u.state === 'checking') return 'Already checking'
  if (u.state === 'downloading') return 'An update is downloading'
  return undefined
}

export function Settings() {
  const { state, patchSettings } = useApp()
  const s = state.settings
  const t = s.tracking
  const logsQ = useInvoke<LogFileInfo[]>('logs:list', [], [s.installDir, s.logFile])
  const logs = logsQ.data ?? []
  const setT = (patch: Partial<TrackingSettings>) => patchSettings((x) => ({ ...x, tracking: { ...x.tracking, ...patch } }))
  const update = useUpdate()
  const u = update.status
  const noCheck = noCheckReason(u)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Where the game is, which character to follow, and what the spell tracker does by default.</p>
        </div>
      </div>

      <div className="stack">
        <div className="card stack gap-12">
          <div className="row">
            <div className="grow">
              <div style={{ fontWeight: 650 }}>Legends Tracker {update.version}</div>
              <div className="muted small">{updateText(u)}</div>
            </div>
            {u?.state === 'ready' ? (
              <button className="btn primary" onClick={() => void act('update:install')}>
                Restart and update
              </button>
            ) : (
              <button className="btn" disabled={!!noCheck} title={noCheck} onClick={() => void act('update:check')}>
                Check for updates
              </button>
            )}
          </div>
          <div className="row">
            <button className="btn" onClick={() => void act('app:openLogs')}>
              Open log folder
            </button>
            <span className="faint small">What the app wrote while it ran. Attach the newest file to a bug report.</span>
          </div>
        </div>

        <div className="card stack gap-14">
          <h2>Game</h2>
          <GameFolderCard />
          {logsQ.error && <LoadError what="the character logs" error={logsQ.error} retry={logsQ.reload} />}
          <Field label="Character log">
            <select value={s.logFile} onChange={(e) => patchSettings((x) => ({ ...x, logFile: e.target.value }))}>
              <option value="">Choose…</option>
              {logs.map((l) => (
                <option key={l.path} value={l.path}>
                  {who(l.character)} — {mb(l.size)}, written {ago(l.modified)}
                </option>
              ))}
            </select>
          </Field>
          <label className="row">
            <Switch on={s.autoStart} onChange={(v) => patchSettings((x) => ({ ...x, autoStart: v }))} />
            Start watching as soon as the app opens
          </label>
          <label className="row">
            <Switch on={s.yieldToGame} onChange={(v) => patchSettings((x) => ({ ...x, yieldToGame: v }))} />
            Yield CPU to EverQuest
            <span className="faint small">runs this app below normal priority, so the game wins every tie for a frame; sound stays normal</span>
          </label>
        </div>

        <div className="card stack gap-14">
          <h2>Damage meter</h2>
          <div className="grid three">
            <Field label="A fight ends after" hint="Seconds without a blow between your side and an enemy. A fight also ends when the last enemy it engaged dies.">
              <NumberInput value={s.combat.fightGapSec} min={2} max={600} onChange={(v) => patchSettings((x) => ({ ...x, combat: { ...x.combat, fightGapSec: v ?? 10 } }))} />
            </Field>
            <Field label="Read back on start" hint="Minutes of the log read into the meter when watching starts, so the fights before the app opened are there. 0 reads nothing.">
              <NumberInput value={s.combat.historyMinutes} min={0} max={1440} onChange={(v) => patchSettings((x) => ({ ...x, combat: { ...x.combat, historyMinutes: v ?? 0 } }))} />
            </Field>
            <Field label="Rebuild" hint="Forgets every fight and reads that much of the log again.">
              <div>
                <button className="btn" onClick={() => void act('combat:rebuild', s.combat.historyMinutes || 60)} disabled={!state.status.watching} title={state.status.watching ? 'Forget every fight and read the log again' : 'Start watching first'}>
                  Read the log again
                </button>
              </div>
            </Field>
          </div>
          <label className="row">
            <Switch on={s.combat.newSessionOnZone} onChange={(v) => patchSettings((x) => ({ ...x, combat: { ...x.combat, newSessionOnZone: v } }))} />
            Entering a zone starts a new session
            <span className="faint small">the Overall figures then cover one zone or instance at a time; New session on the Live page splits by hand</span>
          </label>
        </div>

        <div className="card stack gap-14">
          <h2>Spell tracking</h2>
          <div className="grid two">
            <label className="row">
              <Switch on={t.enabled} onChange={(v) => setT({ enabled: v })} /> Track spells I cast
            </label>
            <span />
            <label className="row">
              <Switch on={t.selfBuffs} onChange={(v) => setT({ selfBuffs: v })} /> Buffs on me
            </label>
            <label className="row">
              <Switch on={t.otherBuffs} onChange={(v) => setT({ otherBuffs: v })} /> Buffs I cast on others
            </label>
            <label className="row">
              <Switch on={t.dots} onChange={(v) => setT({ dots: v })} /> DoTs
            </label>
            <label className="row">
              <Switch on={t.debuffs} onChange={(v) => setT({ debuffs: v })} /> Debuffs, mez and charm
            </label>
          </div>
          <p className="muted small m-0">These are the defaults. Any spell can override them on the Spell Timers page: with buffs off, set a buff you want to "Always track".</p>
        </div>

        <div className="grid two">
          <div className="card stack gap-12">
            <h2>Buff announcements</h2>
            <Field label="Warn before a buff on me ends" hint="Seconds; 0 turns it off. Buff ends are known to within one 6-second tick, so this counts from the earliest they could end.">
              <NumberInput value={t.buffWarnSec} min={0} onChange={(v) => setT({ buffWarnSec: v ?? 0 })} />
            </Field>
            <Field label="Warning" hint="{spell} and {target} are filled in.">
              <input value={t.buffWarnSpeech} onChange={(e) => setT({ buffWarnSpeech: e.target.value })} />
            </Field>
            <Field label="When it fades" hint="Blank for silence.">
              <input value={t.buffFadeSpeech} onChange={(e) => setT({ buffFadeSpeech: e.target.value })} />
            </Field>
            <label className="row">
              <Switch on={t.announceOtherBuffFades} onChange={(v) => setT({ announceOtherBuffFades: v })} />
              Also announce buffs fading from other players
            </label>
          </div>
          <div className="card stack gap-12">
            <h2>DoT announcements</h2>
            <Field label="Warn before a DoT ends" hint="Seconds; 0 turns it off. Exact to the second once the DoT has ticked.">
              <NumberInput value={t.dotWarnSec} min={0} onChange={(v) => setT({ dotWarnSec: v ?? 0 })} />
            </Field>
            <Field label="Warning">
              <input value={t.dotWarnSpeech} onChange={(e) => setT({ dotWarnSpeech: e.target.value })} />
            </Field>
            <Field label="When it wears off" hint="Blank for silence.">
              <input value={t.dotFadeSpeech} onChange={(e) => setT({ dotFadeSpeech: e.target.value })} />
            </Field>
          </div>
        </div>
      </div>
    </>
  )
}
