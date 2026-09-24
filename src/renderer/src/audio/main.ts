import { api } from '../api'
import type { AudioSettings } from '../../../shared/types'

// Runs in a hidden window for the life of the app. One AudioContext, routed to the chosen output
// device, carries both alert sounds and speech. Speech is strictly one phrase at a time — two
// voices at once are unintelligible — and the backlog is capped: warnings about a finished fight
// are worse than losing them.

type Play =
  | { kind: 'speech'; wav: Uint8Array; interrupt: boolean }
  | { kind: 'speech-fallback'; text: string; interrupt: boolean }
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
const soundCache = new Map<string, AudioBuffer>()
const queue: (() => Promise<void>)[] = []
let speaking: { stop: () => void } | null = null
let busy = false

async function applyConfig(c: AudioSettings): Promise<void> {
  config = c
  master.gain.value = c.masterVolume
  speechGain.gain.value = c.speechVolume
  soundGain.gain.value = c.soundVolume
  const sink = c.deviceId && c.deviceId !== 'default' ? c.deviceId : ''
  const withSink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string }
  if (withSink.setSinkId && withSink.sinkId !== sink) {
    try {
      await withSink.setSinkId(sink)
    } catch {
      // A saved device that has been unplugged: keep playing on the default rather than going silent.
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
  const done = new Promise<void>((r) => (src.onended = () => r()))
  src.start()
  return { done, stop: () => src.stop() }
}

async function pump(): Promise<void> {
  if (busy) return
  busy = true
  while (queue.length) {
    const next = queue.shift()!
    try {
      await next()
    } catch {
      // A phrase that fails to play must not block the ones behind it.
    }
  }
  busy = false
}

function enqueueSpeech(job: () => Promise<void>, interrupt: boolean): void {
  if (interrupt) {
    queue.length = 0
    speaking?.stop()
    window.speechSynthesis?.cancel()
  }
  if (queue.length >= MAX_QUEUE) queue.shift()
  queue.push(job)
  void pump()
}

async function handle(cmd: Play): Promise<void> {
  if (ctx.state === 'suspended') await ctx.resume()
  if (cmd.kind === 'sound') {
    let buf = soundCache.get(cmd.name)
    if (!buf) {
      buf = await decode(cmd.data)
      soundCache.set(cmd.name, buf)
    }
    playBuffer(buf, soundGain, cmd.volume)
  } else if (cmd.kind === 'speech') {
    const wav = cmd.wav
    enqueueSpeech(async () => {
      const p = playBuffer(await decode(wav), speechGain)
      speaking = p
      await p.done
      speaking = null
    }, cmd.interrupt)
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
      cmd.interrupt
    )
  }
}

async function reportDevices(): Promise<void> {
  const all = await navigator.mediaDevices.enumerateDevices()
  api.send(
    'audio:devices',
    all.filter((d) => d.kind === 'audiooutput').map((d) => ({ deviceId: d.deviceId, label: d.label || 'Output device' }))
  )
}

api.on('audio:config', (c: AudioSettings) => void applyConfig(c))
api.on('audio:play', (cmd: Play) => void handle(cmd))
navigator.mediaDevices.addEventListener('devicechange', () => void reportDevices())
void reportDevices()
