import { api } from '../api'
import type { AudioSettings } from '../../../shared/types'
import { queueSpeech } from '../../../core/speechQueue'

// Runs in a hidden window for the life of the app. One AudioContext, routed to the chosen output
// device, carries both alert sounds and speech. Speech is strictly one phrase at a time — two
// voices at once are unintelligible — and the backlog is capped: warnings about a finished fight
// are worse than losing them.

type Play =
  | { kind: 'speech'; wav: Uint8Array; interrupt: boolean; expiresAt?: number; urgent?: boolean }
  | { kind: 'speech-fallback'; text: string; interrupt: boolean; expiresAt?: number; urgent?: boolean }
  | { kind: 'sound'; data: Uint8Array; volume: number; name: string }

const MAX_QUEUE = 6

const ctx = new AudioContext({ latencyHint: 'interactive' })
const master = ctx.createGain()
const speechGain = ctx.createGain()
const soundGain = ctx.createGain()
speechGain.connect(master)
soundGain.connect(master)
master.connect(ctx.destination)

let config: AudioSettings | null = null
/** Decoded sounds by path, the most recently played last; at most SOUNDS_KEPT. */
const soundCache = new Map<string, AudioBuffer>()
const SOUNDS_KEPT = 32
/** Phrases waiting their turn, each with when it is too late to say; an urgent one goes to the front (LT-719). */
const queue: { play: () => Promise<void>; expiresAt?: number; urgent?: boolean }[] = []
let speaking: { stop: () => void } | null = null
let busy = false
/** Sounds and phrases playing now. */
let playing = 0
/**
 * With nothing playing or waiting this long, the AudioContext is suspended: running idle it was a
 * third of the app's idle CPU (~0.45% of a core); suspended, none. handle() resumes it (LT-561).
 */
const IDLE_SUSPEND_MS = 30_000
let idleTimer: ReturnType<typeof setTimeout> | null = null
function idleLater(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (!busy && !queue.length && !playing && ctx.state === 'running') void ctx.suspend()
  }, IDLE_SUSPEND_MS)
}

/** Everything said or waiting stops. */
function hush(): void {
  queue.length = 0
  speaking?.stop()
  window.speechSynthesis?.cancel()
}

async function applyConfig(c: AudioSettings): Promise<void> {
  // Muting silences the phrase playing and those queued too, not only what comes after (LT-344).
  if (c.muted && !config?.muted) hush()
  config = c
  master.gain.value = c.muted ? 0 : c.masterVolume
  speechGain.gain.value = c.speechVolume
  soundGain.gain.value = c.soundVolume
  const sink = c.deviceId && c.deviceId !== 'default' ? c.deviceId : ''
  const withSink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string }
  if (withSink.setSinkId && withSink.sinkId !== sink) {
    try {
      await withSink.setSinkId(sink)
    } catch (e) {
      // A saved device that has been unplugged: keep playing on the default rather than going silent, and say so.
      api.send('audio:problem', 'device', e instanceof Error ? e.message : String(e))
      await withSink.setSinkId('').catch(() => {})
    }
  }
}

async function decode(bytes: Uint8Array): Promise<AudioBuffer> {
  const copy = bytes.slice().buffer
  return ctx.decodeAudioData(copy)
}

function playBuffer(buffer: AudioBuffer, out: GainNode, volume = 1): { done: Promise<void>; stop: () => void } {
  const src = ctx.createBufferSource()
  const gain = ctx.createGain()
  gain.gain.value = volume
  src.buffer = buffer
  src.connect(gain).connect(out)
  playing++
  const done = new Promise<void>(
    (r) =>
      (src.onended = () => {
        playing--
        idleLater()
        r()
      })
  )
  src.start()
  return { done, stop: () => src.stop() }
}

async function pump(): Promise<void> {
  if (busy) return
  busy = true
  while (queue.length) {
    const next = queue.shift()!
    // A cue whose timer has ended by its turn is not worth saying.
    if (next.expiresAt !== undefined && Date.now() > next.expiresAt) continue
    try {
      await next.play()
    } catch (e) {
      // A phrase that fails to play must not block the ones behind it; it is said in main.log (LT-618).
      api.send('audio:problem', 'play', e instanceof Error ? e.message : String(e))
    }
  }
  busy = false
}

function enqueueSpeech(play: () => Promise<void>, interrupt: boolean, expiresAt?: number, urgent = false): void {
  if (config?.muted) return
  if (interrupt) hush()
  queueSpeech(queue, { play, expiresAt, urgent }, MAX_QUEUE)
  void pump()
}

async function handle(cmd: Play): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer)
  if (ctx.state === 'suspended') await ctx.resume()
  idleLater()
  if (cmd.kind === 'sound') {
    let buf = soundCache.get(cmd.name)
    if (buf) soundCache.delete(cmd.name)
    else
      try {
        buf = await decode(cmd.data)
      } catch (e) {
        api.send('audio:problem', 'decode', `${cmd.name}: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
    soundCache.set(cmd.name, buf)
    if (soundCache.size > SOUNDS_KEPT) soundCache.delete(soundCache.keys().next().value!)
    playBuffer(buf, soundGain, cmd.volume)
  } else if (cmd.kind === 'speech') {
    const wav = cmd.wav
    enqueueSpeech(
      async () => {
        const p = playBuffer(await decode(wav), speechGain)
        speaking = p
        await p.done
        speaking = null
      },
      cmd.interrupt,
      cmd.expiresAt,
      cmd.urgent
    )
  } else {
    // The speech engine is unavailable: Chromium's own voice, on the default device.
    const text = cmd.text
    enqueueSpeech(
      () =>
        new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(text)
          u.volume = (config?.masterVolume ?? 1) * (config?.speechVolume ?? 1)
          u.rate = config?.rate ?? 1
          u.onend = () => resolve()
          u.onerror = () => resolve()
          window.speechSynthesis.speak(u)
        }),
      cmd.interrupt,
      cmd.expiresAt,
      cmd.urgent
    )
  }
}

async function reportDevices(): Promise<void> {
  const all = await navigator.mediaDevices.enumerateDevices()
  api.send(
    'audio:devices',
    all.filter((d) => d.kind === 'audiooutput').map((d) => ({ deviceId: d.deviceId, label: d.label || 'Output device' /* the Audio page explains a blank name */ }))
  )
}

const onDeviceChange = () => void reportDevices()

api.on('audio:config', (c: AudioSettings) => void applyConfig(c))
api.on('audio:play', (cmd: Play) => void handle(cmd))
// Devices are listed, and followed, only while a page shows them (LT-447).
api.on('audio:watchDevices', (on: boolean) => {
  navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
  if (!on) return
  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)
  void reportDevices()
})

// Suspended until the first sound if nothing plays at start (LT-561).
idleLater()
