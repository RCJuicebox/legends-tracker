import { ipcMain } from 'electron'
import { fromOwnPage, type PageName } from '../push'
import { log } from '../log'
import type { InvokeChannel, InvokeResult, Invokes } from '../../shared/ipc'

/**
 * Answers one invoke channel, typed by the contract in shared/ipc.ts. The contract types what the page
 * sends, but nothing checks it on the way in: a handler still checks any argument it stores or builds a
 * path from. A handler that fails is logged under its channel; the page still sees the rejection.
 */
/** The invoke channels the overlays use; every other channel answers the main window alone. */
const OVERLAY_PAGES: readonly PageName[] = ['index', 'overlay', 'overlays']
const INVOKE_PAGES: Partial<Record<InvokeChannel, readonly PageName[]>> = {
  'overlay:hostState': OVERLAY_PAGES,
  'combat:newSession': OVERLAY_PAGES,
  'combat:segment': OVERLAY_PAGES,
  // Done on an overlay being arranged.
  'overlays:arrange': ['index', 'overlay']
}

export function handle<K extends InvokeChannel>(channel: K, fn: (...args: Parameters<Invokes[K]>) => InvokeResult<K> | Promise<InvokeResult<K>>): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!fromOwnPage(e, channel, INVOKE_PAGES[channel])) throw new Error('Not allowed.')
    try {
      return await fn(...(args as Parameters<Invokes[K]>))
    } catch (err) {
      log.error(`${channel} failed:`, err)
      throw err
    }
  })
}
