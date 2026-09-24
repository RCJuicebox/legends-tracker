import { useEffect, useState } from 'react'
import { useApp } from '../state'
import { api, mb, ago } from '../api'
import { Field, NumberInput, Switch } from '../components/ui'
import type { ArchiveInfo, ArchiveStatus, LogFileInfo } from '../../../shared/types'

interface Overview {
  logs: LogFileInfo[]
  archives: ArchiveInfo[]
  archiveDir: string
  status: ArchiveStatus
}

export function Logs() {
  const { state, patchSettings } = useApp()
  const [view, setView] = useState<Overview | null>(null)
  const refresh = () => void api.invoke<Overview>('logs:overview').then(setView)
  useEffect(refresh, [state.archive.busy, state.settings.archive.archiveDir])
  const a = state.settings.archive
  const status = state.archive
  const threshold = a.thresholdMB * 1048576
  const setA = (patch: Partial<typeof a>) => patchSettings((s) => ({ ...s, archive: { ...s.archive, ...patch } }))
  const totalZip = view?.archives.filter((x) => !x.loose).reduce((n, x) => n + x.size, 0) ?? 0
  const loose = view?.archives.filter((x) => x.loose) ?? []

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Log Files</h1>
          <p>
            Keeps character logs small. An archived log is zipped, named by the dates it covers, read back and checked
            byte-for-byte, and only then removed. The game starts a fresh log on its next line.
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={refresh}>Refresh</button>
          <button className="btn" onClick={() => api.invoke('logs:reveal', view?.archiveDir ?? '')}>Open archive folder</button>
        </div>
      </div>

      {(status.busy || status.message) && (
        <div className={`notice${status.busy ? '' : ' info'}`} style={{ marginBottom: 16 }}>
          {status.busy && <b>Working: </b>}
          {status.message}
        </div>
      )}

      <div className="grid two" style={{ alignItems: 'start', marginBottom: 16 }}>
        <div className="card stack" style={{ gap: 14 }}>
          <h2>Automatic archiving</h2>
          <div className="row">
            <Switch on={a.autoEnabled} onChange={(v) => setA({ autoEnabled: v })} />
            <span>Archive a character log once it passes</span>
            <NumberInput value={a.thresholdMB} min={10} max={10000} step={10} width={90} onChange={(v) => setA({ thresholdMB: v ?? 150 })} />
            <span>MB</span>
          </div>
          <Field
            label="Archive folder"
            hint={a.archiveDir ? undefined : `Default: ${view?.archiveDir ?? 'Logs\\archive'}`}
          >
            <div className="row">
              <input className="grow" value={a.archiveDir} placeholder="Logs\archive (default)" onChange={(e) => setA({ archiveDir: e.target.value })} />
              <button className="btn" onClick={async () => {
                const dir = await api.invoke<string | null>('dialog:folder')
                if (dir) void setA({ archiveDir: dir })
              }}>Browse…</button>
            </div>
          </Field>
        </div>
        <div className="card stack" style={{ gap: 10 }}>
          <h2>While the game is running</h2>
          <div className="row">
            <span className={`status-dot${status.gameRunning ? ' live' : ''}`} />
            {status.gameRunning ? 'EverQuest Legends is running' : 'EverQuest Legends is not running'}
          </div>
          <div className="muted small" style={{ lineHeight: 1.5 }}>
            {status.liveRotation === 'supported' && 'Confirmed: the game starts a new log file after one is archived mid-session, so archiving happens right away.'}
            {status.liveRotation === 'unsupported' && 'This game keeps its log open while running, so logs over the limit are archived as soon as it closes.'}
            {status.liveRotation === 'unknown' &&
              "Mid-session archiving is checked as it happens: the log is moved aside, and if the game starts a new file it's zipped; if the game carries on writing to the old one, it's put straight back and archived after the game closes. No lines are lost either way."}
          </div>
          {status.pendingUntilGameExits.length > 0 && (
            <div className="notice small">Waiting for the game to close: {status.pendingUntilGameExits.map((p) => p.split('\\').pop()).join(', ')}</div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Character logs</h2>
        {!view ? (
          <div className="empty">Reading…</div>
        ) : view.logs.length === 0 ? (
          <div className="empty">No logs found. Turn logging on in game with /log on.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Log</th>
                <th style={{ width: '32%' }}>Size</th>
                <th>Last written</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.logs.map((l) => (
                <tr key={l.path}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.character.replace('_', ' · ')}</div>
                    <div className="faint small">{l.name}</div>
                  </td>
                  <td>
                    <div className="row tight" style={{ marginBottom: 4 }}>
                      <b>{mb(l.size)}</b>
                      <span className="faint small">of {a.thresholdMB} MB</span>
                    </div>
                    <div className={`bar-meter${l.size >= threshold ? ' over' : ''}`}>
                      <div style={{ width: `${Math.min(100, (l.size / threshold) * 100)}%` }} />
                    </div>
                  </td>
                  <td className="muted small">{ago(l.modified)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn small" disabled={status.busy || l.size === 0} onClick={() => api.invoke('logs:archive', l.path).then(refresh)}>
                      Archive now
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>
          Archives <span className="chip">{view?.archives.length ?? 0}</span>
          <span className="spacer" />
          <span className="faint small" style={{ textTransform: 'none', letterSpacing: 0 }}>{mb(totalZip)} zipped</span>
        </h2>
        {loose.length > 0 && (
          <div className="notice row" style={{ marginBottom: 10 }}>
            <span className="grow">
              {loose.length} uncompressed log{loose.length === 1 ? '' : 's'} in the archive folder ({mb(loose.reduce((n, x) => n + x.size, 0))}).
            </span>
            <button className="btn small" disabled={status.busy} onClick={async () => {
              for (const l of loose) await api.invoke('logs:compress', l.path)
              refresh()
            }}>
              Zip {loose.length === 1 ? 'it' : 'them'}
            </button>
          </div>
        )}
        {view && view.archives.length === 0 ? (
          <div className="empty">No archives yet.</div>
        ) : (
          <table className="table">
            <tbody>
              {view?.archives.map((x) => (
                <tr key={x.path}>
                  <td>
                    <span className="mono">{x.name}</span> {x.loose && <span className="chip warn">not zipped</span>}
                  </td>
                  <td className="muted nowrap">{mb(x.size)}</td>
                  <td className="faint small nowrap">{new Date(x.modified).toLocaleDateString()}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn ghost small" onClick={() => api.invoke('logs:reveal', x.path)}>Show</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
