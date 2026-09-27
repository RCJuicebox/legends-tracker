import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { channelAllowed, type ChannelUse } from './channels'

function check(channel: string, use: ChannelUse): void {
  if (!channelAllowed(channel, use)) throw new Error(`Channel not allowed: ${channel}`)
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
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
})
