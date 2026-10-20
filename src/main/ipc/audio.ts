import { isAbsolute } from 'node:path'
import { handle } from './handle'
import { textArg } from '../../core/validate'
import { onSend } from '../push'
import { log } from '../log'
import type { AppContext } from '../context'

// Speech, sounds and the output device.

export function registerAudioIpc(ctx: AppContext): void {
  const { store, engine, speech } = ctx

  handle('audio:test', (text) => engine.speak(textArg(text, 300), true))
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

  // What the audio window could not do, logged once each and counted for Copy diagnostics (LT-618):
  // "I hear nothing" reports carried nothing before.
  onSend('audio:problem', (kind, detail) => {
    if (kind !== 'device' && kind !== 'decode' && kind !== 'play') return
    const text = typeof detail === 'string' ? detail.slice(0, 300) : ''
    const key = `${kind}|${text}`
    const n = (ctx.audioProblems.get(key) ?? 0) + 1
    ctx.audioProblems.set(key, n)
    if (n === 1) log.warn(`Audio: ${kind === 'device' ? 'the saved output device is gone; playing on the default' : `could not ${kind}`}${text ? `: ${text}` : ''}`)
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
