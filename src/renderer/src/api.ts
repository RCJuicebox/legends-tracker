import type {
  AppSettings, ArchiveStatus, CharacterSettings, FeedItem, TimerView, WatchStatus
} from '../../shared/types'

interface Bridge {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  send(channel: string, ...args: unknown[]): void
  on(channel: string, listener: (...args: any[]) => void): () => void
}

declare global {
  interface Window {
    eql: Bridge
  }
}

export const api = window.eql

export interface AppState {
  settings: AppSettings
  status: WatchStatus
  timers: TimerView[]
  feed: FeedItem[]
  archive: ArchiveStatus
  character: CharacterSettings
  characterKey: string
  voices: string[]
  speechError: string
  arranging: boolean
  devices: { deviceId: string; label: string }[]
  triggerErrors: { trigger: string; error: string }[]
}

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
