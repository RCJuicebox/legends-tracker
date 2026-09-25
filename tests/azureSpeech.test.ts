import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Azure itself is not called: fetch is replaced, and Electron's app and safeStorage with stand-ins.
const dir = mkdtempSync(join(tmpdir(), 'lt-azure-'))
vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))

const { AzureSpeech, VoiceRouter } = await import('../src/main/azureSpeech')

const VOICES = [
  { ShortName: 'en-US-JennyNeural', DisplayName: 'Jenny', LocaleName: 'English (United States)', Locale: 'en-US', Gender: 'Female', VoiceType: 'Neural' },
  { ShortName: 'de-DE-KatjaNeural', DisplayName: 'Katja', LocaleName: 'German (Germany)', Locale: 'de-DE', Gender: 'Female', VoiceType: 'Neural' }
]
const WAV = Buffer.from('RIFF....WAVEfmt fake')

let calls: { url: string; init?: RequestInit }[] = []
beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const headers = (init?.headers ?? {}) as Record<string, string>
    if (headers['Ocp-Apim-Subscription-Key'] !== 'good-key') return new Response('', { status: 401 })
    if (url.endsWith('/voices/list')) return new Response(JSON.stringify(VOICES), { status: 200 })
    return new Response(WAV, { status: 200 })
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('Azure voices', () => {
  it('checks a key by listing voices, and keeps it encrypted', async () => {
    const az = new AzureSpeech()
    await expect(az.configure('eastus', 'bad-key')).rejects.toThrow(/turned the key down/)
    expect(az.status().configured).toBe(false)
    const s = await az.configure('EastUS', 'good-key')
    expect(s).toMatchObject({ configured: true, region: 'eastus', error: '' })
    expect(s.voices.map((v) => v.name)).toEqual(['de-DE-KatjaNeural', 'en-US-JennyNeural'])
    const stored = JSON.parse(readFileSync(join(dir, 'azure-speech.json'), 'utf8'))
    expect(stored.key).toBe(Buffer.from('enc:good-key').toString('base64'))
    expect(JSON.stringify(s)).not.toContain('good-key')
  })

  it('asks Azure once per phrase, with the voice, speed and text in SSML', async () => {
    const az = new AzureSpeech()
    await az.configure('eastus', 'good-key')
    calls = []
    const wav = await az.synthesize('Recast <Odium> & friends', 'en-US-JennyNeural', 1.3)
    expect(wav.equals(WAV)).toBe(true)
    await az.synthesize('Recast <Odium> & friends', 'en-US-JennyNeural', 1.3)
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe('https://eastus.tts.speech.microsoft.com/cognitiveservices/v1')
    expect((init!.headers as Record<string, string>)['X-Microsoft-OutputFormat']).toBe('riff-24khz-16bit-mono-pcm')
    expect(init!.body).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="en-US-JennyNeural"><prosody rate="+30%">Recast &lt;Odium&gt; &amp; friends</prosody></voice></speak>'
    )
  })
})

describe('the voice router', () => {
  const windows = { synthesize: vi.fn(async (text: string, voice: string) => Buffer.from(`win:${voice}:${text}`)) }

  it('sends Windows voices to Windows and azure: voices to Azure', async () => {
    const az = new AzureSpeech()
    await az.configure('eastus', 'good-key')
    const r = new VoiceRouter(windows, az)
    expect((await r.synthesize('hi', 'Microsoft Mark', 1)).toString()).toBe('win:Microsoft Mark:hi')
    expect((await r.synthesize('hi there', 'azure:en-US-JennyNeural', 1)).equals(WAV)).toBe(true)
  })

  it('falls back to the Windows default when Azure cannot answer, so a cue is never lost', async () => {
    const az = new AzureSpeech()
    await az.configure('', '')
    const r = new VoiceRouter(windows, az)
    expect((await r.synthesize('Recast Odium', 'azure:en-US-JennyNeural', 1)).toString()).toBe('win::Recast Odium')
  })
})
