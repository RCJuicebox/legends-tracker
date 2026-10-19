import { useEffect, useState } from 'react'
import { api } from '../api'
import { useInvoke } from '../hooks'
import { act, showError, showToast } from '../toast'
import { Ago, ErrorText, Pending, WithCommands } from '../components/ui'
import type { SourceView } from '../../../shared/ipc'

// Where everything the app shows comes from, and how each source last fared: the place to look when a
// page is empty or out of date.

const STATUS: Record<SourceView['status'], { chip: string; word: string }> = {
  ok: { chip: 'ok', word: 'OK' },
  stale: { chip: 'warn', word: 'Due a refresh' },
  error: { chip: 'bad', word: 'Failed' },
  missing: { chip: '', word: 'Not there' },
  reading: { chip: '', word: 'Reading…' },
  waiting: { chip: '', word: 'Not read yet' },
  idle: { chip: '', word: 'Not watched' }
}

/** A row's button, by what it does: the log is watched, a file is read again, the web refreshed (LT-570). */
function verb(r: SourceView): [string, string] {
  if (r.id === 'log' && r.status === 'idle') return ['Start watching', 'Starting…']
  return r.kind === 'wiki' ? ['Refresh', 'Refreshing…'] : ['Read again', 'Reading…']
}

const KINDS: SourceView['kind'][] = ['log', 'game file', 'wiki', 'screen', 'app']
const KIND_TITLE: Record<SourceView['kind'], string> = {
  log: 'Your logs',
  'game file': "The game's files",
  wiki: 'eqlwiki.com',
  screen: 'The screen',
  app: 'The app'
}

/** A row's longer report (the log's unread lines, what a patch changed), opened on a click, with Copy. */
function SourceReport({ report }: { report: NonNullable<SourceView['report']> }) {
  const copy = () =>
    navigator.clipboard.writeText(report.text).then(
      () => showToast('Copied to the clipboard'),
      (e: unknown) => showError('Could not copy it', e)
    )
  return (
    <details className="source-report small">
      <summary>{report.title}</summary>
      <pre>{report.text}</pre>
      <button type="button" className="btn small" onClick={() => void copy()}>
        Copy
      </button>
    </details>
  )
}

export function DataSources() {
  const q = useInvoke('sources:list')
  const setData = q.setData
  useEffect(() => api.on('state:sources', (rows) => setData(rows)), [setData])
  const [busy, setBusy] = useState('')
  const rows = q.data

  const refresh = async (id: string) => {
    setBusy(id)
    try {
      setData(await api.invoke('sources:refresh', id))
    } catch (e) {
      showError('Could not refresh it', e)
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p>Where everything the app shows comes from, and how each source last fared. If a page is empty or out of date, the answer is usually here.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void act('app:openLogs')}>
            Open log folder
          </button>
        </div>
      </div>
      {!rows ? (
        <Pending what="the data sources" error={q.error} retry={q.reload} />
      ) : (
        KINDS.filter((k) => rows.some((r) => r.kind === k)).map((kind) => (
          <div className="card mb-16" key={kind}>
            <h2>{KIND_TITLE[kind]}</h2>
            <div className="table-scroll">
              <table className="table sources-table">
                <colgroup>
                  <col style={{ width: '48%' }} />
                  <col style={{ width: '28%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '11%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>State</th>
                    <th>Last good read</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => r.kind === kind)
                    .map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.label}</div>
                          <div className="faint small">
                            <WithCommands text={r.what} />
                          </div>
                        </td>
                        <td>
                          <span className={`chip ${STATUS[r.status].chip}`}>{STATUS[r.status].word}</span>
                          {r.detail && (
                            <div className="small">
                              <WithCommands text={r.detail} />
                            </div>
                          )}
                          {r.error && <ErrorText block>{r.error}</ErrorText>}
                          {r.report && <SourceReport report={r.report} />}
                        </td>
                        <td className="small">{r.lastOk ? <Ago t={r.lastOk} /> : '—'}</td>
                        <td>
                          {r.refreshable && (
                            <button className="btn small" disabled={busy === r.id || r.status === 'reading'} onClick={() => void refresh(r.id)}>
                              {verb(r)[busy === r.id ? 1 : 0]}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </>
  )
}
