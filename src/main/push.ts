import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { log } from './log'
import type { PushChannel, Pushes, SendChannel, Sends } from '../shared/ipc'

// Typed ends of the one-way channels in shared/ipc.ts: what main pushes to a window, and what a
// window sends main without waiting for an answer.

export function push<K extends PushChannel>(wc: WebContents, channel: K, ...args: Parameters<Pushes[K]>): void {
  wc.send(channel, ...args)
}

/** One of our own pages: the built files, or the dev server in a development run. */
export function isOwnPage(url: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL']
  return url.startsWith('file:') || (!!dev && url.startsWith(dev))
}

/** A message from a frame that is not one of our pages is dropped (and logged once per channel). */
const refused = new Set<string>()
export function fromOwnPage(e: IpcMainEvent | IpcMainInvokeEvent, channel: string): boolean {
  const url = e.senderFrame?.url ?? ''
  if (isOwnPage(url)) return true
  if (!refused.has(channel)) log.warn(`Refused ${channel} from ${url || 'an unknown frame'}`)
  refused.add(channel)
  return false
}

/** Listens for a page's send. The arguments are whatever the page sent: check them before use. */
export function onSend<K extends SendChannel>(channel: K, fn: (...args: Parameters<Sends[K]>) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (fromOwnPage(e, channel)) fn(...(args as Parameters<Sends[K]>))
  })
}
