import { ipcMain } from 'electron'
import { fromOwnPage } from '../push'
import { log } from '../log'
import type { InvokeChannel, InvokeResult, Invokes } from '../../shared/ipc'

/**
 * Answers one invoke channel, typed by the contract in shared/ipc.ts. The contract types what the page
 * sends, but nothing checks it on the way in: a handler still checks any argument it stores or builds a
 * path from. A handler that fails is logged under its channel; the page still sees the rejection.
 */
export function handle<K extends InvokeChannel>(channel: K, fn: (...args: Parameters<Invokes[K]>) => InvokeResult<K> | Promise<InvokeResult<K>>): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!fromOwnPage(e, channel)) throw new Error('Not allowed.')
    try {
      return await fn(...(args as Parameters<Invokes[K]>))
    } catch (err) {
      log.error(`${channel} failed:`, err)
      throw err
    }
  })
}
