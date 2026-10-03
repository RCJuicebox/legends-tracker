import { useState } from 'react'
import { day } from '../../../core/format'
import { useApp, useLive } from '../state'
import { api, mb, errorMessage } from '../api'
import { useInvoke } from '../hooks'
import { act, showError, showToast } from '../toast'
import { who } from '../../../core/format'
import { Ago, ConfirmButton, Field, LoadError, NumberInput, SortTh, sortRows, Switch, Pending, type Sort } from '../components/ui'
import { useRemembered } from '../remember'

export function Logs() {
  const [sort, setSort] = useRemembered<Sort<'log' | 'size' | 'written'>>('logs.sort', { key: 'written', dir: -1 })
  const { state, patchSettings } = useApp()
  const status = useLive((l) => l.archive)
  const watching = useLive((l) => l.status.watching)
  const q = useInvoke('logs:overview', [], [status.busy, state.settings.archive.archiveDir, state.settings.installDir])
  const view = q.data
  const refresh = q.reload
  const [zipping, setZipping] = useState(false)
  const [zipErrors, setZipErrors] = useState<string[]>([])
  const a = state.settings.archive
  const threshold = a.thresholdMB * 1048576
  const setA = (patch: Partial<typeof a>, debounceMs?: number) => patchSettings((s) => ({ ...s, archive: { ...s.archive, ...patch } }), { debounceMs })
  const totalZip = view?.archives.filter((x) => !x.loose).reduce((n, x) => n + x.size, 0) ?? 0
  const loose = view?.archives.filter((x) => x.loose) ?? []
  const followed = state.settings.logFile
  const follow = (path: string, character: string) => {
    void patchSettings((x) => ({ ...x, logFile: path }))
    // While watching, the watch follows the new log at once: said, since nothing else here shows it.
    if (watching) showToast(`Now watching ${who(character)}'s log.`)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Log Files</h1>
          <p>
            Which character&apos;s log is followed, and keeping the logs small. An archived log is zipped, named by the dates it covers, read back and checked byte-for-byte, and
            only then removed. The game starts a fresh log on its next line.
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={refresh}>
            Refresh
          </button>
          <button className="btn" onClick={() => void act('logs:reveal', view?.archiveDir ?? '')}>
            Open archive folder
          </button>
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
          {/* One sentence, read as one: the switch and the size belong to it. */}
          <div className="row" role="group" aria-labelledby="archive-when archive-unit">
            <Switch on={a.autoEnabled} label="Archive logs automatically" onChange={(v) => setA({ autoEnabled: v })} />
            <span id="archive-when">Archive a character log once it passes</span>
            <NumberInput value={a.thresholdMB} min={10} max={10000} step={10} width={90} label="Archive threshold in MB" onChange={(v) => setA({ thresholdMB: v ?? 150 })} />
            <span id="archive-unit">MB</span>
          </div>
          <Field label="Archive folder" hint={a.archiveDir ? undefined : `Default: ${view?.archiveDir ?? 'Logs\\archive'}`}>
            <div className="row">
              <input className="grow" value={a.archiveDir} placeholder="Logs\archive (default)" onChange={(e) => setA({ archiveDir: e.target.value }, 400)} />
              <button
                className="btn"
                onClick={async () => {
                  const dir = await act('dialog:folder')
                  if (dir) void setA({ archiveDir: dir })
                }}
              >
                Browse…
              </button>
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
        {view && view.logs.length > 0 && !followed && <div className="notice mb-10">No log is followed yet: pick the character you play with Follow.</div>}
        {view && followed && !view.logs.some((l) => l.path === followed) && (
          <div className="notice mb-10">The log being followed ({followed.split('\\').pop()}) is not in the game&apos;s Logs folder any more: pick another with Follow.</div>
        )}
        {!view ? (
          <Pending what="the character logs" />
        ) : view.logs.length === 0 ? (
          <div className="empty">No logs found. Turn logging on in game with /log on.</div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <SortTh k="log" sort={sort} onSort={setSort}>
                    Log
                  </SortTh>
                  <SortTh k="size" sort={sort} onSort={setSort}>
                    Size
                  </SortTh>
                  <SortTh k="written" sort={sort} onSort={setSort}>
                    Last written
                  </SortTh>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortRows(view.logs, sort, { log: (l) => who(l.character), size: (l) => l.size, written: (l) => l.modified }).map((l) => (
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
                    <td className="muted small">
                      <Ago t={l.modified} />
                    </td>
                    <td className="nowrap" style={{ textAlign: 'right' }}>
                      {l.path === followed ? (
                        <span className="chip ok" title="Timers, the meter, the overlays and the character pages follow this log">
                          Followed
                        </span>
                      ) : (
                        <button
                          className="btn small"
                          title={`Follow ${who(l.character)}: timers, the meter, the overlays and the character pages`}
                          onClick={() => follow(l.path, l.character)}
                        >
                          Follow
                        </button>
                      )}{' '}
                      <ConfirmButton
                        className="btn small"
                        disabled={status.busy || l.size === 0}
                        title={status.busy ? 'Waiting for the current job to finish' : l.size === 0 ? 'Nothing in it yet' : undefined}
                        question={`Archive ${l.name} now? It is zipped, checked and then removed; the game starts a fresh log.`}
                        onConfirm={() =>
                          void api
                            .invoke('logs:archive', l.path)
                            .catch((e) => showError(`Could not archive ${l.name}`, e))
                            .finally(refresh)
                        }
                      >
                        Archive now
                      </ConfirmButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <label className="row mt-10">
          <Switch on={state.settings.autoStart} onChange={(v) => patchSettings((x) => ({ ...x, autoStart: v }))} />
          Start watching the followed log as soon as the app opens
        </label>
      </div>

      <div className="card">
        <h2>
          Archives <span className="chip">{view?.archives.length ?? 0}</span>
          <span className="spacer" />
          <span className="faint small" style={{ textTransform: 'none', letterSpacing: 0 }}>
            {mb(totalZip)} zipped
          </span>
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
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Archive</th>
                  <th>Size</th>
                  <th>Written</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {view?.archives.map((x) => (
                  <tr key={x.path}>
                    <td>
                      <span className="mono">{x.name}</span> {x.loose && <span className="chip warn">not zipped</span>}
                    </td>
                    <td className="muted nowrap">{mb(x.size)}</td>
                    <td className="faint small nowrap">{day(x.modified)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn ghost small" onClick={() => void act('logs:reveal', x.path)}>
                        Show
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
