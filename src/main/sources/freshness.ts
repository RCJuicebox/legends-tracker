import type { WikiProgress } from '../../shared/ipc'
import type { Job } from './jobs'
import { sources } from './registry'

// What the app keeps from eqlwiki (the item catalog, the recipes, items looked up, pet pages, faction
// pages) serves a week before it is fetched again; Allakhazam's faction pages a month.

/** How long what is kept from the wiki serves before it is fetched again. */
export const WIKI_FRESH_MS = 7 * 24 * 3600_000

/** Whether something fetched at `fetchedAt` is due again: never fetched, or older than `freshMs`. */
export function expired(fetchedAt: number | undefined, freshMs = WIKI_FRESH_MS, now = Date.now()): boolean {
  return fetchedAt === undefined || now - fetchedAt > freshMs
}

/** Whether a whole download (the item catalog, the recipes) is due again: none yet, kept in an older form, or a week old. */
export function downloadStale(file: { fetchedAt: number; format?: number } | null, format: number): boolean {
  return !file || (file.format ?? 1) < format || expired(file.fetchedAt)
}

/**
 * A download's progress, to its job and the Data Sources page: pages read while it runs, then its
 * error, or what is kept (stale once due again).
 */
export function reportDownload(id: string, progress: WikiProgress, job: Job | null, kept: { what: string; stale: boolean } | null): void {
  const pages = `${progress.pages} of ${progress.total || '?'} pages`
  if (progress.busy) {
    job?.progress(progress.total ? progress.pages / progress.total : null, pages)
    sources.reading(id, pages)
  } else if (progress.error) sources.fail(id, new Error(progress.error))
  else if (kept?.stale) sources.stale(id, kept.what)
  else if (kept) sources.ok(id, kept.what)
}
