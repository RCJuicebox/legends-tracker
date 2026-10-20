import { readFile } from 'node:fs/promises'
import * as ort from 'onnxruntime-node'
import { phonemize } from 'phonemizer'
import { encodeWav, kokoroPhonemes, kokoroStyle, kokoroTokens } from '../core/kokoro'
import type { KokoroAnswer, KokoroAsk } from './kokoroSpeech'

// The Kokoro voices' own process (an Electron utility process): it holds the model (some 300 MB
// once loaded), so the app's main process does not, and the app stops it when no phrase has been
// asked for in a while. Phrases are rendered one at a time, in the order asked.

const port = process.parentPort
let session: Promise<ort.InferenceSession> | null = null
const voices = new Map<string, Promise<Float32Array>>()
let queue: Promise<void> = Promise.resolve()

const post = (a: KokoroAnswer) => port.postMessage(a)

function voiceData(file: string): Promise<Float32Array> {
  let v = voices.get(file)
  if (!v) {
    v = readFile(file).then((b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
    voices.set(file, v)
    v.catch(() => voices.delete(file))
  }
  return v
}

async function speak(ask: Extract<KokoroAsk, { type: 'speak' }>): Promise<void> {
  try {
    if (!session) throw new Error('The voice model is not loaded')
    const [model, voice] = await Promise.all([session, voiceData(ask.voiceFile)])
    const ids = kokoroTokens(await kokoroPhonemes(ask.text, ask.voice, phonemize))
    const out = await model.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      style: new ort.Tensor('float32', kokoroStyle(voice, ids.length), [1, 256]),
      speed: new ort.Tensor('float32', Float32Array.of(ask.rate), [1])
    })
    post({ type: 'wav', id: ask.id, wav: encodeWav(out['waveform'].data as Float32Array) })
  } catch (e) {
    post({ type: 'failed', id: ask.id, message: (e as Error).message })
  }
}

port.on('message', (e: { data: KokoroAsk }) => {
  const ask = e.data
  if (ask.type === 'load') {
    session = ort.InferenceSession.create(ask.model, { executionProviders: ['cpu'], intraOpNumThreads: ask.threads, interOpNumThreads: 1 })
    session.then(
      () => post({ type: 'loaded' }),
      (err: unknown) => post({ type: 'loadFailed', message: (err as Error).message })
    )
  } else if (ask.type === 'speak') queue = queue.then(() => speak(ask))
})
