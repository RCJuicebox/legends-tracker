import type { FeedItem } from '../../shared/types'
import { day } from '../../core/format'
import type { AppState as WireState, InvokeChannel, InvokeResult, Invokes, PushChannel, Pushes, SendChannel, Sends } from '../../shared/ipc'

/** The preload's bridge, typed by the channel contract in shared/ipc.ts. */
interface Bridge {
  invoke<K extends InvokeChannel>(channel: K, ...args: Parameters<Invokes[K]>): Promise<InvokeResult<K>>
  send<K extends SendChannel>(channel: K, ...args: Parameters<Sends[K]>): void
  on<K extends PushChannel>(channel: K, listener: Pushes[K]): () => void
}

declare global {
  interface Window {
    eql: Bridge
  }
}

export const api = window.eql

/** What went wrong in a call to the main process, without Electron's "Error invoking remote method" wrapping. */
export function errorMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(?:[A-Z]\w*)?Error:\s*/, '') || 'unknown error'
}

/** An activity line, numbered as it arrives so the list can keep each row. */
export type FeedEntry = FeedItem & { id: number }

/** The main window's state: what app:state gives, with the feed numbered. */
export type AppState = Omit<WireState, 'feed'> & { feed: FeedEntry[] }

export const iconUrl = (n?: number) => (n === undefined || n < 0 ? '' : `eqicon://icon/${n}`)

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV']
export const roman = (n?: number) => (n ? (ROMAN[n] ?? String(n)) : '')

/** Timers' m:ss, from core/format, for the pages that take it from here. */
export { clock } from '../../core/format'

export function mb(bytes: number): string {
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`
}

export function ago(t: number, now = Date.now()): string {
  if (!t) return 'never'
  const s = Math.round((now - t) / 1000)
  // The same units as duration() everywhere else: "12 s", "3 min", "2 h" (LT-471).
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return day(t, now)
}
