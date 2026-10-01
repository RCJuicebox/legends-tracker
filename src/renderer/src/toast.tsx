import { useSyncExternalStore, type ReactNode } from 'react'
import { api, errorMessage } from './api'
import type { InvokeChannel, InvokeResult, Invokes } from '../../shared/ipc'

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
/** The pointer is on the toasts: none goes while someone may be reading it. */
let hovering = false

/** Takes a toast down when its time is up, or a moment later while the pointer rests on the toasts. */
function expire(id: number): void {
  if (hovering) setTimeout(() => expire(id), 1000)
  else dismissToast(id)
}
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id)
  // The last one gone from under the pointer: no leave event comes, so the next toasts must not wait on it.
  if (!toasts.length) hovering = false
  emit()
}

export function showToast(text: ReactNode, opts: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}): number {
  const id = ++nextId
  toasts = [...toasts.slice(-3), { id, text, tone: opts.tone ?? 'info', action: opts.action }]
  emit()
  setTimeout(() => expire(id), opts.ms ?? (opts.action ? 8000 : 6000))
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
export async function act<K extends InvokeChannel>(channel: K, ...args: Parameters<Invokes[K]>): Promise<InvokeResult<K> | undefined> {
  try {
    return await api.invoke(channel, ...args)
  } catch (e) {
    showError('That did not work', e)
    return undefined
  }
}

/**
 * As act(), and says it worked: `done` is the message, or a function of the answer giving one (null
 * for nothing to say, as when a save dialog was cancelled).
 */
export async function actDone<K extends InvokeChannel>(
  done: string | ((r: InvokeResult<K>) => string | null),
  channel: K,
  ...args: Parameters<Invokes[K]>
): Promise<InvokeResult<K> | undefined> {
  try {
    const r = await api.invoke(channel, ...args)
    const text = typeof done === 'string' ? done : done(r)
    if (text) showToast(text)
    return r
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
    <div className="toasts" aria-live="polite" onMouseEnter={() => (hovering = true)} onMouseLeave={() => (hovering = false)}>
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
