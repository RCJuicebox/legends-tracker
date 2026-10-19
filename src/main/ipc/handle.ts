import { ipcMain } from 'electron'
import { fromOwnPage, type PageName } from '../push'
import { log } from '../log'
import type { InvokeChannel, InvokeResult, Invokes } from '../../shared/ipc'
import { CHECKS } from './checks'

/**
 * Answers one invoke channel, typed by the contract in shared/ipc.ts. What the page sends goes through the
 * channel's entry in CHECKS first (LT-754): the wrong number or kinds of arguments are refused before the
 * handler runs. An object or a list is only known to be one there, so a handler still sanitises any it
 * stores or builds a path from. A handler that fails is logged under its channel; the page still sees the rejection.
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
    const checked = (CHECKS[channel] as (a: readonly unknown[]) => Parameters<Invokes[K]> | null)(args)
    if (!checked) throw new Error(`${channel}: those are not the arguments it takes.`)
    try {
      return await fn(...checked)
    } catch (err) {
      log.error(`${channel} failed:`, err)
      throw err
    }
  })
}
