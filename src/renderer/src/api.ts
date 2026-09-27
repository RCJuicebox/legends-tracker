import type { FeedItem } from '../../shared/types'
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
export const roman = (n?: number) => (n ? ROMAN[n] ?? String(n) : '')

export function clock(sec: number): string {
  if (!Number.isFinite(sec)) return '∞'
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function mb(bytes: number): string {
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`
}

export function ago(t: number, now = Date.now()): string {
  if (!t) return 'never'
  const s = Math.round((now - t) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(t).toLocaleDateString()
}
