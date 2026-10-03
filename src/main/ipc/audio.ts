import { isAbsolute } from 'node:path'
import { handle } from './handle'
import { textArg } from '../../core/validate'
import { onSend } from '../push'
import type { AppContext } from '../context'

// Speech, sounds and the output device.

export function registerAudioIpc(ctx: AppContext): void {
  const { store, engine, speech, azure } = ctx

  handle('audio:test', (text) => engine.speak(textArg(text, 300), true))
  handle('audio:azure', async () => {
    await azure.load()
    return azure.status()
  })
  handle('audio:setAzure', (region, key) => {
    if (typeof region !== 'string' || typeof key !== 'string' || key.length > 200 || region.length > 40) throw new Error('Not a region and key.')
    return azure.configure(region, key)
  })
  // A page may play a sound from the sound folders, or a file one of the saved triggers already names.
  handle('audio:sound', (file) => {
    if (typeof file !== 'string') return
    const named = store.triggers.get().some((t) => t.actions.some((a) => a.type === 'sound' && a.file === file))
    if (isAbsolute(file) && !named) throw new Error('Only sounds from the sound folders can be played from here.')
    return engine.playSound(file, 1)
  })
  handle('audio:sounds', () => engine.listSounds())
  handle('audio:watchDevices', (on) => ctx.windows.watchDevices(on === true))
  // The Windows voice list needs the speech process; the Audio page asks for it when it opens.
  handle('audio:voices', async () => {
    await speech.warm()
    const v = { voices: speech.voices, error: speech.failed }
    ctx.windows.toMain('state:voices', v)
    return v
  })

  onSend('audio:devices', (devices) => {
    if (!Array.isArray(devices)) return
    ctx.audioDevices = devices
      .filter((d) => d && typeof d.deviceId === 'string' && typeof d.label === 'string')
      .slice(0, 64)
      .map((d) => ({ deviceId: d.deviceId.slice(0, 200), label: d.label.slice(0, 200) }))
    ctx.windows.toMain('state:devices', ctx.audioDevices)
  })
}
