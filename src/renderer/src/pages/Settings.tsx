import { useEffect, useState } from 'react'
import { useApp } from '../state'
import { api, mb, ago } from '../api'
import { useUpdate } from '../update'
import { Field, NumberInput, Switch } from '../components/ui'
import type { LogFileInfo, TrackingSettings } from '../../../shared/types'

export function Settings() {
  const { state, patchSettings } = useApp()
  const s = state.settings
  const t = s.tracking
  const [logs, setLogs] = useState<LogFileInfo[]>([])
  useEffect(() => void api.invoke<LogFileInfo[]>('logs:list').then(setLogs), [s.installDir])
  const setT = (patch: Partial<TrackingSettings>) => patchSettings((x) => ({ ...x, tracking: { ...x.tracking, ...patch } }))
  const update = useUpdate()
  const u = update.status

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Where the game is, which character to follow, and what the spell tracker does by default.</p>
        </div>
      </div>

      <div className="stack">
        <div className="card row">
          <div className="grow">
            <div style={{ fontWeight: 650 }}>Legends Tracker {update.version}</div>
            <div className="muted small">
              {!u || u.state === 'dev'
                ? 'Running from source: updates apply to the installed app only.'
                : u.state === 'checking'
                  ? 'Checking for updates…'
                  : u.state === 'downloading'
                    ? `Downloading ${u.version}… ${u.percent}%`
                    : u.state === 'ready'
                      ? `Version ${u.version} is downloaded and installs when you restart.`
                      : u.state === 'error'
                        ? `Could not check for updates: ${u.message}`
                        : `Up to date${u.checkedAt ? `, checked ${ago(u.checkedAt)}` : ''}. Checks automatically every few hours.`}
            </div>
          </div>
          {u?.state === 'ready' ? (
            <button className="btn primary" onClick={() => api.invoke('update:install')}>
              Restart and update
            </button>
          ) : (
            <button className="btn" disabled={!u || u.state === 'dev' || u.state === 'checking' || u.state === 'downloading'} onClick={() => api.invoke('update:check')}>
              Check for updates
            </button>
          )}
        </div>

        <div className="card stack" style={{ gap: 14 }}>
          <h2>Game</h2>
          <Field label="EverQuest Legends folder" hint={state.status.spellsLoaded ? `${state.status.spellsLoaded.toLocaleString()} spells loaded from spells_us.txt` : state.status.spellError || 'Not found'}>
            <div className="row">
              <input className="grow" value={s.installDir} onChange={(e) => patchSettings((x) => ({ ...x, installDir: e.target.value }))} />
              <button className="btn" onClick={async () => {
                const dir = await api.invoke<string | null>('dialog:folder')
                if (dir) void patchSettings((x) => ({ ...x, installDir: dir }))
              }}>Browse…</button>
            </div>
          </Field>
          <Field label="Character log">
            <select value={s.logFile} onChange={(e) => patchSettings((x) => ({ ...x, logFile: e.target.value }))}>
              <option value="">Choose…</option>
              {logs.map((l) => (
                <option key={l.path} value={l.path}>
                  {l.character.replace('_', ' · ')} — {mb(l.size)}, written {ago(l.modified)}
                </option>
              ))}
            </select>
          </Field>
          <label className="row">
            <Switch on={s.autoStart} onChange={(v) => patchSettings((x) => ({ ...x, autoStart: v }))} />
            Start watching as soon as the app opens
          </label>
        </div>

        <div className="card stack" style={{ gap: 14 }}>
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
          <p className="muted small" style={{ margin: 0 }}>These are the defaults. Any spell can override them on the Spell Timers page: with buffs off, set a buff you want to "Always track".</p>
        </div>

        <div className="grid two">
          <div className="card stack" style={{ gap: 12 }}>
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
          <div className="card stack" style={{ gap: 12 }}>
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
