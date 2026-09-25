import { app, safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { log } from './log'
import type { SpeechWorker } from './speech'
import type { AzureStatus, AzureVoice } from '../shared/types'

// Microsoft's neural voices (Jenny, Aria, Guy…) through Azure AI Speech, with the player's own key:
// the free tier allows half a million characters a month. A phrase is rendered once and kept on disk,
// and the tracker's cues repeat all evening, so a night's play costs a few hundred characters. The
// key is kept encrypted with Windows' own data protection (Electron's safeStorage), in a file of its
// own, and never goes to a page.
//
// REST: https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech

/** A voice setting naming an Azure voice: "azure:en-US-JennyNeural". Anything else is a Windows voice. */
export const AZURE_PREFIX = 'azure:'
const AGENT = 'LegendsTracker (https://github.com/RCJuicebox/legends-tracker)'
const TIMEOUT_MS = 10_000
const VOICES_FRESH_MS = 7 * 24 * 3600_000
/** Phrases kept on disk at most; the oldest go first. */
const CACHE_MAX = 4000

interface Stored {
  region: string
  /** The key, encrypted with safeStorage, base64. */
  key: string
  voices?: AzureVoice[]
  voicesAt?: number
}

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

export class AzureSpeech {
  private region = ''
  private key = ''
  private voices: AzureVoice[] = []
  private voicesAt = 0
  private error = ''
  private loaded: Promise<void> | null = null
  private readonly memory = new Map<string, Buffer>()
  private writes = 0

  private get file(): string {
    return join(app.getPath('userData'), 'azure-speech.json')
  }

  private get cacheDir(): string {
    return join(app.getPath('userData'), 'speech-cache')
  }

  load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const s = JSON.parse(await fs.readFile(this.file, 'utf8')) as Stored
        this.region = typeof s.region === 'string' ? s.region : ''
        this.key = s.key && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(s.key, 'base64')) : ''
        this.voices = Array.isArray(s.voices) ? s.voices : []
        this.voicesAt = s.voicesAt ?? 0
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Could not read the Azure speech settings:', e)
      }
      if (this.ready && Date.now() - this.voicesAt > VOICES_FRESH_MS) void this.fetchVoices().catch(() => undefined)
    })()
    return this.loaded
  }

  get ready(): boolean {
    return !!(this.key && this.region)
  }

  status(): AzureStatus {
    return { configured: this.ready, region: this.region, voices: this.voices, error: this.error }
  }

  private async save(): Promise<void> {
    const stored: Stored = {
      region: this.region,
      key: this.key ? safeStorage.encryptString(this.key).toString('base64') : '',
      voices: this.voices,
      voicesAt: this.voicesAt
    }
    const tmp = this.file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(stored), 'utf8')
    await fs.rename(tmp, this.file)
  }

  /** A new key and region, checked by asking for the voice list; '' as the key forgets them. */
  async configure(region: string, key: string): Promise<AzureStatus> {
    await this.load()
    const r = region.trim().toLowerCase()
    const k = key.trim()
    if (!k) {
      this.key = ''
      this.region = ''
      this.voices = []
      this.error = ''
      await this.save()
      return this.status()
    }
    if (!/^[a-z0-9]+$/.test(r)) throw new Error('The region is a single word, like eastus or westeurope.')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows cannot encrypt the key on this PC, so it was not saved.')
    const before = { key: this.key, region: this.region }
    this.key = k
    this.region = r
    try {
      await this.fetchVoices()
    } catch (e) {
      this.key = before.key
      this.region = before.region
      throw e
    }
    this.error = ''
    this.memory.clear()
    await this.save()
    return this.status()
  }

  private async fetchVoices(): Promise<void> {
    const res = await fetch(`https://${this.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
      headers: { 'Ocp-Apim-Subscription-Key': this.key, 'User-Agent': AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (res.status === 401 || res.status === 403) throw new Error('Azure turned the key down: check the key and that the region is the one the resource was made in.')
    if (!res.ok) throw new Error(`Azure answered ${res.status} for the voice list.`)
    const list = (await res.json()) as { ShortName: string; DisplayName: string; LocaleName: string; Locale: string; Gender: string; VoiceType?: string }[]
    this.voices = list
      .filter((v) => !v.VoiceType || v.VoiceType === 'Neural')
      .map((v) => ({ name: v.ShortName, label: `${v.DisplayName} (${v.LocaleName}, ${v.Gender.toLowerCase()})`, locale: v.Locale, gender: v.Gender }))
      .sort((a, b) => a.locale.localeCompare(b.locale) || a.label.localeCompare(b.label))
    this.voicesAt = Date.now()
    await this.save()
  }

  /** A phrase as WAV, from memory, then disk, then Azure. */
  async synthesize(text: string, voice: string, rate: number): Promise<Buffer> {
    await this.load()
    if (!this.ready) throw new Error('No Azure key is set.')
    const pct = Math.round((rate - 1) * 100)
    const id = createHash('sha1').update(`${voice}|${pct}|${text}`).digest('hex')
    const hit = this.memory.get(id)
    if (hit) return hit
    const path = join(this.cacheDir, `${id}.wav`)
    try {
      const wav = await fs.readFile(path)
      this.remember(id, wav)
      return wav
    } catch {
      // Not rendered yet.
    }
    const lang = /^([a-z]{2,3}-[A-Z]{2,4})/.exec(voice)?.[1] ?? 'en-US'
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${xml(voice)}"><prosody rate="${pct >= 0 ? '+' : ''}${pct}%">${xml(text)}</prosody></voice></speak>`
    const res = await fetch(`https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
        'User-Agent': AGENT
      },
      body: ssml,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) {
      this.error = res.status === 401 || res.status === 403 ? 'Azure turned the key down.' : res.status === 429 ? 'Azure says the key is over its limit for now.' : `Azure answered ${res.status}.`
      throw new Error(this.error)
    }
    const wav = Buffer.from(await res.arrayBuffer())
    this.error = ''
    this.remember(id, wav)
    void this.store(path, wav)
    return wav
  }

  private remember(id: string, wav: Buffer): void {
    if (this.memory.size > 300) this.memory.delete(this.memory.keys().next().value!)
    this.memory.set(id, wav)
  }

  private async store(path: string, wav: Buffer): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true })
      await fs.writeFile(path, wav)
      if (++this.writes % 100 === 0) await this.trim()
    } catch (e) {
      log.warn('Could not keep a spoken phrase on disk:', e)
    }
  }

  /** The oldest phrases go once there are too many. */
  private async trim(): Promise<void> {
    const names = (await fs.readdir(this.cacheDir)).filter((n) => n.endsWith('.wav'))
    if (names.length <= CACHE_MAX) return
    const aged = await Promise.all(names.map(async (n) => ({ n, t: (await fs.stat(join(this.cacheDir, n))).mtimeMs })))
    aged.sort((a, b) => a.t - b.t)
    for (const { n } of aged.slice(0, names.length - CACHE_MAX)) await fs.rm(join(this.cacheDir, n), { force: true })
  }
}

/**
 * Speech for the engine: an "azure:" voice through Azure, falling back to the Windows default voice
 * when Azure cannot answer (offline, a bad key), so a cue is never lost; anything else through Windows.
 */
export class VoiceRouter {
  private warned = false

  constructor(
    private readonly windows: Pick<SpeechWorker, 'synthesize'>,
    private readonly azure: AzureSpeech
  ) {}

  async synthesize(text: string, voice: string, rate: number): Promise<Buffer> {
    if (!voice.startsWith(AZURE_PREFIX)) return this.windows.synthesize(text, voice, rate)
    try {
      return await this.azure.synthesize(text, voice.slice(AZURE_PREFIX.length), rate)
    } catch (e) {
      if (!this.warned) log.warn('Azure speech failed; using the Windows voice meanwhile:', e)
      this.warned = true
      return this.windows.synthesize(text, '', rate)
    }
  }
}
