import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../tempDir'
import type { KokoroAnswer, KokoroAsk, KokoroProcess } from '../../src/main/kokoroSpeech'

// Nothing reaches Hugging Face and no model is loaded: the files are a few bytes served by a stand-in
// fetch (their hashes put in place of the real ones), and the worker is a stand-in that answers as
// kokoroWorker.ts does.

const MODEL = Buffer.from('a stand-in for the model')
const VOICE = Buffer.from('a stand-in for a voice file')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

vi.mock('electron', () => ({ app: { getVersion: () => 'test' } }))
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/core/kokoro', async (original) => {
  const real = await original<typeof import('../../src/core/kokoro')>()
  const voice = { ...real.KOKORO_VOICES[0], sha256: sha(VOICE), size: VOICE.length }
  return { ...real, KOKORO_MODEL: { ...real.KOKORO_MODEL, sha256: sha(MODEL), size: MODEL.length }, kokoroVoice: (id: string) => (id === voice.id ? voice : undefined) }
})

const { KokoroSpeech } = await import('../../src/main/kokoroSpeech')
const { encodeWav } = await import('../../src/core/kokoro')

class FakeWorker extends EventEmitter implements KokoroProcess {
  readonly pid = undefined
  readonly asked: KokoroAsk[] = []
  killed = false
  /** Whether phrases are answered. */
  answer = true

  postMessage(ask: KokoroAsk): void {
    this.asked.push(ask)
    queueMicrotask(() => {
      if (ask.type === 'load') this.say({ type: 'loaded' })
      else if (this.answer) this.say({ type: 'wav', id: ask.id, wav: encodeWav(new Float32Array(100).fill(0.1)) })
    })
  }

  say(a: KokoroAnswer): void {
    this.emit('message', a)
  }

  kill(): boolean {
    this.killed = true
    return true
  }
}

function setup(o: { model?: Buffer } = {}) {
  const dir = tempDir('lt-kokoro-')
  const workers: FakeWorker[] = []
  const fetched: string[] = []
  const fetchFn = vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    fetched.push(u)
    return new Response(new Uint8Array(u.endsWith('.onnx') ? (o.model ?? MODEL) : VOICE))
  }) as unknown as typeof fetch
  const clock = { t: 1_000_000 }
  const make = () =>
    new KokoroSpeech({
      dir,
      fork: () => {
        const w = new FakeWorker()
        workers.push(w)
        return w
      },
      fetch: fetchFn,
      now: () => clock.t
    })
  return { dir, workers, fetched, clock, make }
}

describe('the Kokoro voices', () => {
  it('downloads the model once, checked, and is ready afterwards', async () => {
    const { dir, fetched, make } = setup()
    const k = make()
    const seen: string[] = []
    k.onStatus((s) => seen.push(s.state))
    expect(k.status().state).toBe('absent')
    expect(k.ready('af_heart')).toBe(false)
    await k.download()
    expect(k.status()).toEqual({ state: 'ready', fraction: null, error: '' })
    expect(seen[0]).toBe('downloading')
    expect(seen.at(-1)).toBe('ready')
    expect(fetched).toHaveLength(1)
    expect(fetched[0]).toMatch(/^https:\/\/huggingface\.co\/onnx-community\/Kokoro-82M-v1\.0-ONNX\/resolve\/[0-9a-f]{40}\/onnx\/model_quantized\.onnx$/)
    expect(readdirSync(dir).filter((n) => n.endsWith('.part'))).toEqual([])
    expect(k.ready('af_heart')).toBe(true)
    expect(k.ready('xx_unknown')).toBe(false)
    // A new run finds it on disk.
    expect(make().status().state).toBe('ready')
  })

  it('keeps no damaged download, and leaves it alone for ten minutes unless asked', async () => {
    const { dir, fetched, clock, make } = setup({ model: Buffer.from('not the model') })
    const k = make()
    await k.download()
    expect(k.status().state).toBe('failed')
    expect(k.status().error).toMatch(/damaged/)
    expect(readdirSync(dir)).toEqual([])
    k.prepare('af_heart')
    expect(fetched).toHaveLength(1)
    clock.t += 11 * 60_000
    k.prepare('af_heart')
    await vi.waitFor(() => expect(fetched).toHaveLength(2))
    await vi.waitFor(() => expect(k.status().state).toBe('failed'))
    // Try again goes at once.
    await k.download()
    expect(fetched).toHaveLength(3)
  })

  it('will not render before the model is here', async () => {
    const { workers, make } = setup()
    await expect(make().synthesize('Tester Spell down', 'af_heart', 1)).rejects.toThrow(/not downloaded/)
    expect(workers).toHaveLength(0)
  })

  it('renders a phrase in its process, fetching the voice once, and keeps it in memory and on disk', async () => {
    const { workers, fetched, make, dir } = setup()
    const k = make()
    await k.download()
    const wav = await k.synthesize('Recast Tester Spell', 'af_heart', 1.2)
    expect(wav.toString('latin1', 0, 4)).toBe('RIFF')
    expect(workers).toHaveLength(1)
    expect(workers[0].asked.map((a) => a.type)).toEqual(['load', 'speak'])
    expect(workers[0].asked[1]).toMatchObject({ text: 'Recast Tester Spell', voice: 'af_heart', rate: 1.2 })
    expect(fetched.filter((u) => u.endsWith('/voices/af_heart.bin'))).toHaveLength(1)

    expect((await k.synthesize('Recast Tester Spell', 'af_heart', 1.2)).equals(wav)).toBe(true)
    expect(workers[0].asked).toHaveLength(2)
    await vi.waitFor(() => expect(readdirSync(join(dir, 'phrases')).filter((n) => n.endsWith('.wav'))).toHaveLength(1))

    // The next run says it from disk, without starting a process.
    const again = make()
    expect((await again.synthesize('Recast Tester Spell', 'af_heart', 1.2)).equals(wav)).toBe(true)
    expect(workers).toHaveLength(1)
    // Another speed is another phrase.
    await k.synthesize('Recast Tester Spell', 'af_heart', 1.5)
    expect(workers[0].asked).toHaveLength(3)
  })

  it('fails the phrase waiting when the process dies, and starts another for the next', async () => {
    const { workers, make } = setup()
    const k = make()
    await k.download()
    await k.warm()
    workers[0].answer = false
    const said = k.synthesize('one', 'af_heart', 1)
    await vi.waitFor(() => expect(workers[0].asked).toHaveLength(2))
    workers[0].emit('exit', 1)
    await expect(said).rejects.toThrow(/stopped/)
    await k.synthesize('two', 'af_heart', 1)
    expect(workers).toHaveLength(2)
  })

  it('stops its process on stop, and the next phrase starts one again', async () => {
    const { workers, make, dir } = setup()
    const k = make()
    await k.download()
    await k.synthesize('one', 'af_heart', 1)
    k.stop()
    expect(workers[0].killed).toBe(true)
    await k.synthesize('two', 'af_heart', 1)
    expect(workers).toHaveLength(2)
    expect(existsSync(join(dir, 'voices'))).toBe(true)
  })
})
