import { log } from '../log'
import type { SourceStatus, SourceView } from '../../shared/ipc'

// Every place the app's information comes from (the chat log, the game's files, the wiki, the screen)
// reports here how its last read went, so nothing degrades quietly: the Data Sources page lists them
// all with their age, their last error and a Refresh where one makes sense. A reader says ok() or
// fail(); the context registers each source's name, what it is and how to refresh it.

type Row = SourceView & { refresh?: () => Promise<unknown> }

class SourceRegistry {
  private readonly rows = new Map<string, Row>()
  private sink: ((rows: SourceView[]) => void) | null = null
  private timer: NodeJS.Timeout | null = null

  /** Where changes go (the main window), at most twice a second. */
  onChange(sink: (rows: SourceView[]) => void): void {
    this.sink = sink
  }

  add(id: string, o: { label: string; what: string; kind: SourceView['kind']; refresh?: () => Promise<unknown> }): void {
    const had = this.rows.get(id)
    this.rows.set(id, {
      id,
      label: o.label,
      what: o.what,
      kind: o.kind,
      status: had?.status ?? 'waiting',
      detail: had?.detail ?? '',
      error: had?.error ?? '',
      lastOk: had?.lastOk ?? 0,
      lastTried: had?.lastTried ?? 0,
      refreshable: !!o.refresh,
      refresh: o.refresh
    })
    this.changed()
  }

  private set(id: string, status: SourceStatus, patch: Partial<SourceView>): void {
    const row = this.rows.get(id) ?? { id, label: id, what: '', kind: 'app' as const, detail: '', error: '', lastOk: 0, lastTried: 0, refreshable: false, status }
    const now = Date.now()
    this.rows.set(id, { ...row, ...patch, status, lastTried: now, ...(status === 'ok' || status === 'stale' ? { lastOk: now, error: '' } : {}) })
    this.changed()
  }

  /** Read fine. `detail` says what was read ("73,975 spells"). */
  ok(id: string, detail = ''): void {
    this.set(id, 'ok', { detail })
  }

  /** Read, but old enough that a refresh is due. */
  stale(id: string, detail = ''): void {
    this.set(id, 'stale', { detail })
  }

  /** Not there (no game folder, no export yet): expected, not an error. */
  missing(id: string, detail: string): void {
    this.set(id, 'missing', { detail, error: '' })
  }

  /** Being read now. */
  reading(id: string, detail = ''): void {
    const row = this.rows.get(id)
    this.rows.set(id, { ...(row ?? { id, label: id, what: '', kind: 'app', error: '', lastOk: 0, lastTried: 0, refreshable: false }), status: 'reading', detail })
    this.changed()
  }

  /** Failed: logged once per distinct message, and shown until the next good read. */
  fail(id: string, e: unknown, detail?: string): void {
    const error = e instanceof Error ? e.message : String(e)
    const was = this.rows.get(id)
    if (was?.error !== error) log.warn(`${was?.label ?? id}:`, e)
    this.set(id, 'error', { error, ...(detail !== undefined ? { detail } : {}) })
  }

  list(): SourceView[] {
    return [...this.rows.values()].map(({ refresh: _refresh, ...v }) => v)
  }

  async refresh(id: string): Promise<SourceView[]> {
    const row = this.rows.get(id)
    if (!row?.refresh) throw new Error('That source has nothing to refresh.')
    this.reading(id, 'Refreshing…')
    try {
      await row.refresh()
      // A refresh that reported nothing itself leaves the row as it was before, now tried again.
      if (this.rows.get(id)?.status === 'reading') this.ok(id, row.detail)
    } catch (e) {
      this.fail(id, e)
    }
    return this.list()
  }

  private changed(): void {
    if (this.timer || !this.sink) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.sink?.(this.list())
    }, 500)
  }
}

/** The app's one source registry. */
export const sources = new SourceRegistry()
