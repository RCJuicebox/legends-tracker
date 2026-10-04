import { useActions, useSettled } from '../state'
import { api } from '../api'
import { act, showError, showToast } from '../toast'
import { useUpdate, type UpdateState } from '../update'
import { Ago, Field, Segmented, Switch, Tabs } from '../components/ui'
import type { ReactNode } from 'react'
import { GameFolderCard } from '../components/GameFolder'
import { TAB_KEY, type SettingsTab } from '../nav'
import { useRemembered } from '../remember'
import { HOTKEYS, hotkeyLabel } from '../../../shared/hotkeys'
import { Overlays } from './Overlays'
import { Audio } from './Audio'
import { Logs } from './Logs'
import { DataSources } from './DataSources'

/** One line on where updates stand. */
function updateText(u: UpdateState | null): ReactNode {
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
      return (
        <>
          Up to date
          {u.checkedAt ? (
            <>
              , checked <Ago t={u.checkedAt} />
            </>
          ) : (
            ''
          )}
          . Checks again every hour, and a new version is announced with a notification.
        </>
      )
  }
}

/** Why "Check for updates" is greyed out, when it is. */
function noCheckReason(u: UpdateState | null): string | undefined {
  if (!u || u.state === 'dev') return 'This copy runs from source; only the installed app updates'
  if (u.state === 'checking') return 'Already checking'
  if (u.state === 'downloading') return 'An update is downloading'
  return undefined
}

const TABS: [SettingsTab, string][] = [
  ['general', 'General'],
  ['overlays', 'Overlays'],
  ['audio', 'Audio'],
  ['logs', 'Log files'],
  ['sources', 'Data sources']
]

/**
 * What is set once: the app's own settings, and the overlays, audio, log files and data sources,
 * each a tab. What a page alone uses is set on that page (the damage meter's fights, Spell Timers'
 * defaults).
 */
export function Settings() {
  const [saved, setTab] = useRemembered<SettingsTab>(TAB_KEY.settings, 'general')
  const tab = TABS.some(([id]) => id === saved) ? saved : 'general'
  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <Tabs className="mb-14" label="Settings view" value={tab} onChange={setTab} tabs={TABS} />
      {tab === 'overlays' ? (
        <Overlays />
      ) : tab === 'audio' ? (
        <Audio />
      ) : tab === 'logs' ? (
        <Logs />
      ) : tab === 'sources' ? (
        <DataSources />
      ) : (
        <General openLogs={() => setTab('logs')} />
      )}
    </>
  )
}

function General({ openLogs }: { openLogs: () => void }) {
  const { patchSettings } = useActions()
  const settings = useSettled((s) => s.settings)
  const hotkeysTaken = useSettled((s) => s.hotkeysTaken)
  const s = settings
  const update = useUpdate()
  const u = update.status
  const noCheck = noCheckReason(u)

  return (
    <>
      <div className="page-head">
        <p>The app itself: its version and updates, where the game is, and how this window looks.</p>
      </div>

      <div className="stack">
        <div className="card stack gap-12">
          <h2>About</h2>
          <div className="row">
            <div className="grow">
              <div style={{ fontWeight: 650 }}>Legends Tracker {update.version}</div>
              <div className="muted small">{updateText(u)}</div>
              {(u?.state === 'ready' || u?.state === 'downloading') && u.notes && (
                <details className="small">
                  <summary>What&apos;s new in {u.version}</summary>
                  <div className="notes">{u.notes}</div>
                </details>
              )}
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
          <label className="row">
            <Switch on={s.autoRestartUpdates} onChange={(v) => patchSettings((x) => ({ ...x, autoRestartUpdates: v }))} />
            Restart into updates by itself
            <span className="faint small">
              once one has downloaded, without asking, at the first lull in play (out of combat, or the game not in front): the overlays blink and come back, and the window stays
              in the tray unless you were using it. Timers running then do not survive it. Off, an update installs when the app closes, or when you choose Restart and update.
            </span>
          </label>
          <div className="row">
            <button className="btn" onClick={() => void act('app:openLogs')}>
              Open log folder
            </button>
            <span className="faint small">What the app wrote while it ran. Attach the newest file to a bug report.</span>
          </div>
          <div className="row">
            <button className="btn" onClick={() => void copyDiagnostics()}>
              Copy diagnostics
            </button>
            <span className="faint small">
              The version, your PC, the settings that matter and the end of the log, ready to paste into a bug report. No keys, and no Windows user name.
            </span>
          </div>
        </div>

        <div className="card stack gap-14">
          <h2>Game</h2>
          <GameFolderCard />
          <p className="hint">
            Which character&apos;s log is followed is chosen on{' '}
            <button className="link-button inline" onClick={openLogs}>
              Log files
            </button>
            .
          </p>
          <label className="row">
            <Switch on={s.yieldToGame} onChange={(v) => patchSettings((x) => ({ ...x, yieldToGame: v }))} />
            Yield CPU to EverQuest
            <span className="faint small">runs this app below normal priority, so the game wins every tie for a frame; sound stays normal</span>
          </label>
        </div>

        {/* This window's own look and keys, under a heading of their own (LT-457). */}
        <div className="card stack gap-14">
          <h2>This window</h2>
          <p className="hint">
            Closing this window keeps Legends Tracker running in the tray, so timers, overlays and speech carry on. To end it, use Quit on the tray icon&apos;s menu.
          </p>
          <Field label="Appearance" hint="Light or dark, or as Windows is set. Overlays stay dark over the game either way.">
            <div>
              <Segmented
                value={s.theme}
                options={[
                  ['system', 'System'],
                  ['light', 'Light'],
                  ['dark', 'Dark']
                ]}
                onChange={(v) => patchSettings((x) => ({ ...x, theme: v }))}
                label="Appearance"
              />
            </div>
          </Field>
          <Field
            label="UI size"
            hint="The size of everything in this window; Ctrl and + or − change it, Ctrl+0 puts it back. Overlays have their own text sizes, on the Overlays tab."
          >
            <select value={s.uiScale} onChange={(e) => patchSettings((x) => ({ ...x, uiScale: Number(e.target.value) }))}>
              {[0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map((f) => (
                <option key={f} value={f}>
                  {Math.round(f * 100)}%
                </option>
              ))}
            </select>
          </Field>
          <label className="row">
            <Switch on={s.hotkeys} onChange={(v) => patchSettings((x) => ({ ...x, hotkeys: v }))} />
            Hotkeys, even with the game in front
          </label>
          {s.hotkeys && (
            <div className="small stack gap-6" style={{ marginLeft: 48 }}>
              {(
                [
                  [HOTKEYS.mute, 'Mute or unmute'],
                  [HOTKEYS.newSession, 'New damage meter session'],
                  [HOTKEYS.arrange, 'Arrange or lock the overlays']
                ] as const
              ).map(([k, what]) => (
                <div key={k}>
                  <span className="mono">{hotkeyLabel(k)}</span> {what}
                  {hotkeysTaken.includes(k) && <span className="chip warn"> another program holds this key</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/** Copies the diagnostics text for a bug report. */
async function copyDiagnostics(): Promise<void> {
  try {
    await navigator.clipboard.writeText(await api.invoke('app:diagnostics'))
    showToast('Diagnostics copied. Paste them into your bug report.')
  } catch (e) {
    showError('Could not copy the diagnostics', e)
  }
}
