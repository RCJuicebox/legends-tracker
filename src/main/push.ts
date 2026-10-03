import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { log } from './log'
import type { PushChannel, Pushes, SendChannel, Sends } from '../shared/ipc'

// Typed ends of the one-way channels in shared/ipc.ts: what main pushes to a window, and what a
// window sends main without waiting for an answer.

export function push<K extends PushChannel>(wc: WebContents, channel: K, ...args: Parameters<Pushes[K]>): void {
  wc.send(channel, ...args)
}

/** The app's pages: the main window, an overlay alone (arranging), the overlays of a monitor, the sound player. */
export type PageName = 'index' | 'overlay' | 'overlays' | 'audio'
const PAGES: readonly PageName[] = ['index', 'overlay', 'overlays', 'audio']

/** Where the built pages are, as a file URL ending in a slash (lower-cased: Windows paths are case-blind). */
export function rendererUrl(): string {
  return pathToFileURL(join(__dirname, '../renderer') + '/').href.toLowerCase()
}

/**
 * Which of our pages a frame's URL is: one of the built files in the app's own renderer folder, or the
 * dev server in a development run; null for anything else, another local file included.
 */
export function pageOf(url: string): PageName | null {
  const dev = process.env['ELECTRON_RENDERER_URL']
  let rest: string
  if (dev && url.startsWith(dev)) rest = url.slice(dev.length)
  else if (url.toLowerCase().startsWith(rendererUrl())) rest = url.slice(rendererUrl().length)
  else return null
  const name = /^\/?([a-z]+)\.html(?:[?#]|$)/.exec(rest)?.[1] as PageName | undefined
  return name && PAGES.includes(name) ? name : null
}

/** One of our own pages. */
export function isOwnPage(url: string): boolean {
  return pageOf(url) !== null
}

/**
 * A message from a frame that is not one of the pages allowed on its channel is dropped (and logged
 * once per channel). Every page but the main window gets only what it needs: an overlay cannot save
 * the settings or install an update.
 */
const refused = new Set<string>()
export function fromOwnPage(e: IpcMainEvent | IpcMainInvokeEvent, channel: string, pages: readonly PageName[] = ['index']): boolean {
  const url = e.senderFrame?.url ?? ''
  const page = pageOf(url)
  if (page && pages.includes(page)) return true
  if (!refused.has(channel)) log.warn(`Refused ${channel} from ${url || 'an unknown frame'}`)
  refused.add(channel)
  return false
}

/** Which pages besides the main window send on each channel. */
const SEND_PAGES: Record<SendChannel, readonly PageName[]> = {
  'overlay:mouse': ['index', 'overlay', 'overlays'],
  'overlay:meter': ['index', 'overlay', 'overlays'],
  'audio:devices': ['audio']
}

/** Listens for a page's send. The arguments are whatever the page sent: check them before use. */
export function onSend<K extends SendChannel>(channel: K, fn: (...args: Parameters<Sends[K]>) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (fromOwnPage(e, channel, SEND_PAGES[channel])) fn(...(args as Parameters<Sends[K]>))
  })
}
