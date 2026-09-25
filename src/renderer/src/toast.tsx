import { useSyncExternalStore, type ReactNode } from 'react'
import { api, errorMessage } from './api'

// Short messages in the corner: a call to the main process that failed, or an undo for something
// just removed. They outlive the page that raised them.

interface Toast {
  id: number
  text: ReactNode
  tone: 'bad' | 'info'
  action?: { label: string; run: () => void }
}

let toasts: Toast[] = []
let nextId = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function showToast(text: ReactNode, opts: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}): number {
  const id = ++nextId
  toasts = [...toasts.slice(-3), { id, text, tone: opts.tone ?? 'info', action: opts.action }]
  emit()
  setTimeout(() => dismissToast(id), opts.ms ?? (opts.action ? 8000 : 6000))
  return id
}

export function showError(what: string, e: unknown): void {
  showToast(`${what}: ${errorMessage(e)}`, { tone: 'bad' })
}

/** An offer to put back what was just removed. */
export function showUndo(text: ReactNode, undo: () => void): void {
  showToast(text, { action: { label: 'Undo', run: undo } })
}

/**
 * A call to the main process whose answer nothing waits on (a button's action, a save). A failure
 * shows in the corner instead of vanishing into the console.
 */
export async function act<T = unknown>(channel: string, ...args: unknown[]): Promise<T | undefined> {
  try {
    return await api.invoke<T>(channel, ...args)
  } catch (e) {
    showError('That did not work', e)
    return undefined
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function Toasts() {
  const list = useSyncExternalStore(subscribe, () => toasts)
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} role={t.tone === 'bad' ? 'alert' : undefined}>
          <span className="grow">{t.text}</span>
          {t.action && (
            <button
              className="btn small"
              onClick={() => {
                t.action!.run()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="btn ghost small x-btn" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
