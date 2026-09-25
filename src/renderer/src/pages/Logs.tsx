import { useState } from 'react'
import { useApp } from '../state'
import { api, mb, ago, errorMessage } from '../api'
import { useInvoke } from '../hooks'
import { act, showError } from '../toast'
import { who } from '../format'
import { Field, LoadError, NumberInput, Switch } from '../components/ui'
import type { ArchiveInfo, ArchiveStatus, LogFileInfo } from '../../../shared/types'

interface Overview {
  logs: LogFileInfo[]
  archives: ArchiveInfo[]
  archiveDir: string
  status: ArchiveStatus
}

export function Logs() {
  const { state, patchSettings } = useApp()
  const q = useInvoke<Overview>('logs:overview', [], [state.archive.busy, state.settings.archive.archiveDir])
  const view = q.data
  const refresh = q.reload
  const [zipping, setZipping] = useState(false)
  const [zipErrors, setZipErrors] = useState<string[]>([])
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
          <button className="btn" onClick={() => void act('logs:reveal', view?.archiveDir ?? '')}>Open archive folder</button>
        </div>
      </div>

      {q.error && <LoadError what="your log files" error={q.error} retry={refresh} />}
      <div role="status">
        {(status.busy || status.message) && (
          <div className={`notice${status.busy ? '' : ' info'} mb-16`}>
            {status.busy && <b>Working: </b>}
            {status.message}
          </div>
        )}
      </div>

      <div className="grid two mb-16" style={{ alignItems: 'start' }}>
        <div className="card stack gap-14">
          <h2>Automatic archiving</h2>
          <div className="row">
            <Switch on={a.autoEnabled} label="Archive logs automatically" onChange={(v) => setA({ autoEnabled: v })} />
            <span>Archive a character log once it passes</span>
            <NumberInput value={a.thresholdMB} min={10} max={10000} step={10} width={90} label="Archive threshold in MB" onChange={(v) => setA({ thresholdMB: v ?? 150 })} />
            <span>MB</span>
          </div>
          <Field
            label="Archive folder"
            hint={a.archiveDir ? undefined : `Default: ${view?.archiveDir ?? 'Logs\\archive'}`}
          >
            <div className="row">
              <input className="grow" value={a.archiveDir} placeholder="Logs\archive (default)" onChange={(e) => setA({ archiveDir: e.target.value })} />
              <button className="btn" onClick={async () => {
                const dir = await act<string | null>('dialog:folder')
                if (dir) void setA({ archiveDir: dir })
              }}>Browse…</button>
            </div>
          </Field>
        </div>
        <div className="card stack gap-10">
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

      <div className="card mb-16">
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
                    <div style={{ fontWeight: 600 }}>{who(l.character)}</div>
                    <div className="faint small">{l.name}</div>
                  </td>
                  <td>
                    <div className="row tight mb-4">
                      <b>{mb(l.size)}</b>
                      <span className="faint small">of {a.thresholdMB} MB</span>
                    </div>
                    <div className={`bar-meter${l.size >= threshold ? ' over' : ''}`}>
                      <div style={{ width: `${Math.min(100, (l.size / threshold) * 100)}%` }} />
                    </div>
                  </td>
                  <td className="muted small">{ago(l.modified)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn small"
                      disabled={status.busy || l.size === 0}
                      title={status.busy ? 'Waiting for the current job to finish' : l.size === 0 ? 'Nothing in it yet' : undefined}
                      onClick={() =>
                        api
                          .invoke('logs:archive', l.path)
                          .catch((e) => showError(`Could not archive ${l.name}`, e))
                          .finally(refresh)
                      }
                    >
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
          <div className="notice row mb-10">
            <span className="grow">
              {loose.length} uncompressed log{loose.length === 1 ? '' : 's'} in the archive folder ({mb(loose.reduce((n, x) => n + x.size, 0))}).
            </span>
            <button
              className="btn small"
              disabled={status.busy || zipping}
              onClick={async () => {
                // One that fails is reported; the rest are still zipped.
                setZipping(true)
                const failed: string[] = []
                for (const l of loose) {
                  try {
                    await api.invoke('logs:compress', l.path)
                  } catch (e) {
                    failed.push(`${l.name}: ${errorMessage(e)}`)
                  }
                }
                setZipErrors(failed)
                setZipping(false)
                refresh()
              }}
            >
              {zipping ? 'Zipping…' : `Zip ${loose.length === 1 ? 'it' : 'them'}`}
            </button>
          </div>
        )}
        {zipErrors.length > 0 && (
          <div className="notice bad mb-10" role="alert">
            Could not zip {zipErrors.length === 1 ? 'one log' : `${zipErrors.length} logs`}:
            {zipErrors.map((x) => (
              <div key={x} className="small">
                {x}
              </div>
            ))}
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
                    <button className="btn ghost small" onClick={() => void act('logs:reveal', x.path)}>Show</button>
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
