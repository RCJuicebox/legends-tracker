import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// Pages reach the main process only through these channel families.
const ALLOWED = /^(app|settings|character|watch|simulate|triggers|spells|focus|motes|stock|update|logs|overlays|overlay|audio|dialog|state):?/

function check(channel: string): void {
  if (!ALLOWED.test(channel)) throw new Error(`Channel not allowed: ${channel}`)
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
