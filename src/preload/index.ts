import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { channelAllowed, type ChannelUse } from './channels'
import { WATCHED_PUSHES } from '../shared/ipc'

function check(channel: string, use: ChannelUse): void {
  if (!channelAllowed(channel, use)) throw new Error(`Channel not allowed: ${channel}`)
}

// The main window says which live views a page listens to, so main sends only those (LT-556). A page
// loaded afresh has none: said first, before any of its listeners.
const mainPage = /\/index\.html$/i.test((globalThis as { location?: { pathname: string } }).location?.pathname ?? '')
const listening = new Map<string, number>()
if (mainPage) ipcRenderer.send('views:watch', '', false)

function counted(channel: string, by: 1 | -1): void {
  if (!mainPage || !WATCHED_PUSHES.has(channel)) return
  const n = (listening.get(channel) ?? 0) + by
  listening.set(channel, n)
  if (n === 1 && by === 1) ipcRenderer.send('views:watch', channel, true)
  if (n === 0) ipcRenderer.send('views:watch', channel, false)
}

contextBridge.exposeInMainWorld('eql', {
  invoke: (channel: string, ...args: unknown[]) => {
    check(channel, 'invoke')
    return ipcRenderer.invoke(channel, ...args)
  },
  send: (channel: string, ...args: unknown[]) => {
    check(channel, 'send')
    ipcRenderer.send(channel, ...args)
  },
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    check(channel, 'on')
    const wrapped = (_e: IpcRendererEvent, ...args: unknown[]) => listener(...args)
    ipcRenderer.on(channel, wrapped)
    counted(channel, 1)
    let on = true
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
      if (on) counted(channel, -1)
      on = false
    }
  }
})
