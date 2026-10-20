import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs, statSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { KOKORO_MODEL, KOKORO_REPO, kokoroVoice, type KokoroVoice } from '../core/kokoro'
import type { KokoroStatus } from '../shared/runtime'
import { cacheDir } from './paths'
import { jobs } from './sources/jobs'
import { log } from './log'
import { writeFileAtomic } from './storeCore'
import { yieldPriority } from './priority'

// The Kokoro voices (src/core/kokoro.ts): the model is downloaded once, the first time a Kokoro
// voice is chosen (92 MB, from Hugging Face, checked against its SHA-256), and each voice's file
// (half a megabyte) the first time it speaks. Phrases are rendered in a process of their own
// (kokoroWorker.ts), started when needed and stopped when idle, and kept on disk: cues repeat all
// evening, so most are rendered once.

export type KokoroAsk = { type: 'load'; model: string; threads: number } | { type: 'speak'; id: number; text: string; voice: string; voiceFile: string; rate: number }
export type KokoroAnswer =
  { type: 'loaded' } | { type: 'loadFailed'; message: string } | { type: 'wav'; id: number; wav: Uint8Array } | { type: 'failed'; id: number; message: string }

/** The worker process as this class uses it; a stand-in in the tests. */
export interface KokoroProcess {
  readonly pid: number | undefined
  postMessage(ask: KokoroAsk): void
  on(event: 'spawn', fn: () => void): this
  on(event: 'message', fn: (a: KokoroAnswer) => void): this
  on(event: 'exit', fn: (code: number) => void): this
  kill(): boolean
}

interface Options {
  /** Starts kokoroWorker.ts as a utility process. */
  fork: () => KokoroProcess
  /** The folder the model, voices and phrases are kept in. */
  dir?: string
  fetch?: typeof fetch
  now?: () => number
}

/** Bumped when a change here would render a kept phrase differently. */
const PHRASE_VERSION = 1
/** Phrases kept on disk at most; the ones not heard for longest go first. */
const PHRASES_MAX = 4000
const LOAD_TIMEOUT_MS = 30_000
const PHRASE_TIMEOUT_MS = 20_000
/** With nothing said for this long the process (and the model it holds) is stopped. */
const IDLE_MS = 5 * 60_000
/** After a failed download, phrases do not start another for this long; Try again on the Audio page does. */
const RETRY_MS = 10 * 60_000

let agent = ''
const userAgent = () => (agent ||= `LegendsTracker/${app?.getVersion?.() ?? 'dev'} (https://github.com/RCJuicebox/legends-tracker)`)

/** Half the cores, two to four: a phrase in about a second without taking the game's. */
const threads = () => Math.max(2, Math.min(4, Math.floor(os.availableParallelism() / 2)))

/** Whether a kept phrase is a whole WAV: its RIFF header and more than a header's length. */
const isWav = (b: Buffer) => b.length > 44 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE'

interface Waiter {
  resolve: (wav: Buffer) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export class KokoroSpeech {
  private readonly dir: string
  private readonly fork: () => KokoroProcess
  private readonly fetch: typeof fetch
  private readonly now: () => number
  private current: KokoroStatus = { state: 'absent', fraction: null, error: '' }
  private sink: ((s: KokoroStatus) => void) | null = null
  private failedAt = 0
  /** Cancelled on the job strip: no phrase starts the download again until the player asks. */
  private cancelled = false
  private proc: KokoroProcess | null = null
  private loaded: Promise<void> | null = null
  private seq = 0
  private readonly waiting = new Map<number, Waiter>()
  private readonly memory = new Map<string, Buffer>()
  private readonly rendering = new Map<string, Promise<Buffer>>()
  private readonly voiceFiles = new Map<string, Promise<string>>()
  private idle: NodeJS.Timeout | null = null
  private yieldToGame = true
  private writes = 0

  constructor(o: Options) {
    this.dir = o.dir ?? join(cacheDir(), 'kokoro')
    this.fork = o.fork
    this.fetch = o.fetch ?? fetch
    this.now = o.now ?? Date.now
    if (this.modelOnDisk()) this.current = { state: 'ready', fraction: null, error: '' }
  }

  private get modelPath(): string {
    return join(this.dir, `model-${KOKORO_MODEL.sha256.slice(0, 8)}.onnx`)
  }

  private get phraseDir(): string {
    return join(this.dir, 'phrases')
  }

  private modelOnDisk(): boolean {
    try {
      return existsSync(this.modelPath) && statSync(this.modelPath).size === KOKORO_MODEL.size
    } catch {
      return false
    }
  }

  status(): KokoroStatus {
    return { ...this.current }
  }

  /** Told every change of status: the Audio page's line under the voice. */
  onStatus(sink: (s: KokoroStatus) => void): void {
    this.sink = sink
  }

  private set(next: KokoroStatus): void {
    this.current = next
    this.sink?.(this.status())
  }

  /** Whether `voiceId` can speak now: the model is here and the voice is one of the list. */
  ready(voiceId: string): boolean {
    return this.current.state === 'ready' && !!kokoroVoice(voiceId)
  }

  /**
   * A Kokoro voice is wanted: the model is downloaded if it is not here (unless a download failed in
   * the last ten minutes or was cancelled), or the process started if it is, so the next phrase is quick.
   */
  prepare(voiceId: string): void {
    if (!kokoroVoice(voiceId)) return
    if (this.current.state === 'ready') {
      void this.warm().catch(() => undefined)
      return
    }
    if (this.current.state === 'downloading' || this.cancelled || (this.failedAt && this.now() - this.failedAt < RETRY_MS)) return
    void this.download()
  }

  /** Downloads the model, as a job on the strip; asked for by the player, it goes whatever failed before. */
  download(): Promise<void> {
    this.cancelled = false
    if (this.current.state === 'ready') return Promise.resolve()
    return jobs.run('kokoro', `Downloading the Kokoro voices (${Math.round(KOKORO_MODEL.size / 1e6)} MB, once)`, async (job) => {
      this.set({ state: 'downloading', fraction: 0, error: '' })
      let shown = 0
      try {
        await fs.mkdir(this.dir, { recursive: true })
        await this.fetchFile(`${KOKORO_REPO}/${KOKORO_MODEL.file}`, this.modelPath, KOKORO_MODEL, job.signal, (got) => {
          const fraction = got / KOKORO_MODEL.size
          job.progress(fraction, `${Math.round(got / 1e6)} of ${Math.round(KOKORO_MODEL.size / 1e6)} MB`)
          // The page is told each whole per cent, not each chunk.
          if (Math.floor(fraction * 100) === shown) return
          shown = Math.floor(fraction * 100)
          this.set({ state: 'downloading', fraction, error: '' })
        })
        this.failedAt = 0
        log.info('Kokoro voices downloaded')
        this.set({ state: 'ready', fraction: null, error: '' })
      } catch (e) {
        if (job.signal.aborted) {
          this.cancelled = true
          this.set({ state: 'absent', fraction: null, error: '' })
          return
        }
        this.failedAt = this.now()
        log.warn('Kokoro voices: the download failed', e)
        this.set({ state: 'failed', fraction: null, error: (e as Error).message })
      }
    })
  }

  /** Fetches one file to `path`, through a .part file, checked against its size and SHA-256. */
  private async fetchFile(url: string, path: string, want: { sha256: string; size: number }, signal?: AbortSignal, progress?: (got: number) => void): Promise<void> {
    const res = await this.fetch(url, { headers: { 'User-Agent': userAgent() }, signal: signal ?? AbortSignal.timeout(60_000) })
    if (!res.ok || !res.body) throw new Error(`Hugging Face answered ${res.status}`)
    const part = `${path}.part`
    const hash = createHash('sha256')
    let got = 0
    const file = await fs.open(part, 'w')
    try {
      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        await file.write(chunk)
        hash.update(chunk)
        got += chunk.length
        progress?.(got)
      }
    } catch (e) {
      await file.close()
      await fs.rm(part, { force: true })
      throw e
    }
    await file.close()
    if (got !== want.size || hash.digest('hex') !== want.sha256) {
      await fs.rm(part, { force: true })
      throw new Error('The download came back damaged; try again')
    }
    await fs.rename(part, path)
  }

  /** A voice's file on disk, fetched the first time the voice speaks. */
  private voiceFile(v: KokoroVoice): Promise<string> {
    let p = this.voiceFiles.get(v.id)
    if (!p) {
      const path = join(this.dir, 'voices', `${v.id}-${v.sha256.slice(0, 8)}.bin`)
      p = (async () => {
        if (existsSync(path) && statSync(path).size === v.size) return path
        await fs.mkdir(join(this.dir, 'voices'), { recursive: true })
        await this.fetchFile(`${KOKORO_REPO}/voices/${v.id}.bin`, path, v)
        return path
      })()
      this.voiceFiles.set(v.id, p)
      p.catch(() => this.voiceFiles.delete(v.id))
    }
    return p
  }

  /** A phrase as WAV: from memory, then disk, then the model. */
  synthesize(text: string, voiceId: string, rate: number): Promise<Buffer> {
    const key = createHash('sha1')
      .update(`${PHRASE_VERSION}|${KOKORO_MODEL.sha256}|${voiceId}|${rate.toFixed(2)}|${text}`)
      .digest('hex')
    const hit = this.memory.get(key)
    if (hit) return Promise.resolve(hit)
    const busy = this.rendering.get(key)
    if (busy) return busy
    const p = this.render(key, text, voiceId, rate).finally(() => this.rendering.delete(key))
    this.rendering.set(key, p)
    return p
  }

  private async render(key: string, text: string, voiceId: string, rate: number): Promise<Buffer> {
    const path = join(this.phraseDir, `${key}.wav`)
    try {
      const wav = await fs.readFile(path)
      if (isWav(wav)) {
        this.remember(key, wav)
        // Heard: the trim takes the phrases not heard for longest, not the cues said most.
        const now = new Date()
        void fs.utimes(path, now, now).catch(() => undefined)
        return wav
      }
    } catch {
      // Not rendered yet.
    }
    const v = kokoroVoice(voiceId)
    if (!v) throw new Error(`There is no Kokoro voice ${voiceId}`)
    if (this.current.state !== 'ready') throw new Error('The Kokoro voices are not downloaded yet')
    const [voiceFile] = await Promise.all([this.voiceFile(v), this.warm()])
    const proc = this.proc
    if (!proc) throw new Error('The Kokoro voices stopped')
    const id = ++this.seq
    const wav = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.waiting.delete(id)) return
        reject(new Error('The Kokoro voices did not answer'))
        this.restart(proc)
      }, PHRASE_TIMEOUT_MS)
      this.waiting.set(id, { resolve, reject, timer })
      proc.postMessage({ type: 'speak', id, text, voice: v.id, voiceFile, rate })
    })
    this.touch()
    this.remember(key, wav)
    void this.store(path, wav)
    return wav
  }

  /** Starts the process and loads the model if they are not, and keeps them for another idle spell. */
  warm(): Promise<void> {
    this.touch()
    if (this.loaded) return this.loaded
    if (this.current.state !== 'ready') return Promise.reject(new Error('The Kokoro voices are not downloaded yet'))
    const proc = this.fork()
    this.proc = proc
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('The Kokoro voices did not start'))
        this.restart(proc)
      }, LOAD_TIMEOUT_MS)
      proc.on('spawn', () => yieldPriority(proc.pid, this.yieldToGame))
      proc.on('message', (a) => {
        if (this.proc !== proc) return
        if (a.type === 'loaded') {
          clearTimeout(timer)
          if (this.current.error) this.set({ ...this.current, error: '' })
          resolve()
        } else if (a.type === 'loadFailed') {
          clearTimeout(timer)
          log.warn('Kokoro voices: the model would not load:', a.message)
          this.set({ ...this.current, error: a.message })
          reject(new Error(a.message))
          this.restart(proc)
        } else {
          const w = this.waiting.get(a.id)
          if (!w) return
          this.waiting.delete(a.id)
          clearTimeout(w.timer)
          if (a.type === 'wav') w.resolve(Buffer.from(a.wav))
          else w.reject(new Error(a.message))
        }
      })
      proc.on('exit', (code) => {
        clearTimeout(timer)
        if (this.proc !== proc) return
        log.warn(`Kokoro voices: the process exited (code ${code})`)
        reject(new Error('The Kokoro voices stopped'))
        this.drop('The Kokoro voices stopped')
      })
      proc.postMessage({ type: 'load', model: this.modelPath, threads: threads() })
    })
    loaded.catch(() => undefined)
    this.loaded = loaded
    return loaded
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      this.idle = null
      if (this.waiting.size) return this.touch()
      if (this.proc) log.info('Kokoro voices idle; stopping their process until they are needed')
      this.stop()
    }, IDLE_MS)
    this.idle.unref()
  }

  /** "Yield CPU to EverQuest": below normal while it is on, as the app's other processes are (LT-614). */
  setYield(on: boolean): void {
    this.yieldToGame = on
    yieldPriority(this.proc?.pid, on)
  }

  stop(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    const proc = this.proc
    this.drop('The Kokoro voices stopped')
    proc?.kill()
  }

  /** Drops a hung or failed process; the next phrase starts another. */
  private restart(proc: KokoroProcess): void {
    if (this.proc !== proc) return
    this.drop('The Kokoro voices restarted')
    proc.kill()
  }

  private drop(reason: string): void {
    this.proc = null
    this.loaded = null
    for (const w of this.waiting.values()) {
      clearTimeout(w.timer)
      w.reject(new Error(reason))
    }
    this.waiting.clear()
  }

  private remember(key: string, wav: Buffer): void {
    if (this.memory.size > 300) this.memory.delete(this.memory.keys().next().value!)
    this.memory.set(key, wav)
  }

  private async store(path: string, wav: Buffer): Promise<void> {
    try {
      await fs.mkdir(this.phraseDir, { recursive: true })
      await writeFileAtomic(path, wav)
      if (++this.writes % 100 === 0) await this.trim()
    } catch (e) {
      log.warn('Kokoro voices: could not keep a phrase on disk:', e)
    }
  }

  /** The phrases not heard for longest go once there are too many. */
  private async trim(): Promise<void> {
    const names = (await fs.readdir(this.phraseDir)).filter((n) => n.endsWith('.wav'))
    if (names.length <= PHRASES_MAX) return
    const aged = await Promise.all(names.map(async (n) => ({ n, t: (await fs.stat(join(this.phraseDir, n))).mtimeMs })))
    aged.sort((a, b) => a.t - b.t)
    for (const { n } of aged.slice(0, names.length - PHRASES_MAX)) await fs.rm(join(this.phraseDir, n), { force: true })
  }
}
