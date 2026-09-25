import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { channelAllowed } from './channels'

function check(channel: string): void {
  if (!channelAllowed(channel)) throw new Error(`Channel not allowed: ${channel}`)
}

contextBridge.exposeInMainWorld('eql', {
  invoke: (channel: string, ...args: unknown[]) => {
    check(channel)
    return ipcRenderer.invoke(channel, ...args)
  },
  send: (channel: string, ...args: unknown[]) => {
    check(channel)
    ipcRenderer.send(channel, ...args)
  },
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    check(channel)
    const wrapped = (_e: IpcRendererEvent, ...args: unknown[]) => listener(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
})
