import { describe, expect, it } from 'vitest'
import { phonemize } from 'phonemizer'
import { KOKORO_VOICES, encodeWav, kokoroNormalize, kokoroPhonemes, kokoroStyle, kokoroTokens } from '../../src/core/kokoro'
import GOLDEN from '../fixtures/kokoro-golden.json'

// The Kokoro port against kokoro-js itself: GOLDEN is what kokoro-js 1.2.1 made of these phrases
// (its phonemes and token ids), captured with the same phonemizer.

describe('Kokoro: text into the model input', () => {
  it.each(GOLDEN.map((g) => [g.text, g] as const))('makes the phonemes and tokens kokoro-js makes of %j', async (_text, g) => {
    const ph = await kokoroPhonemes(g.text, g.voice, phonemize)
    expect(ph).toBe(g.phonemes)
    expect(kokoroTokens(ph)).toEqual(g.ids)
  })

  it('says times, years and money as words', () => {
    expect(kokoroNormalize('at 9:00 and 9:05')).toBe("at 9 o'clock and 9 oh 5")
    expect(kokoroNormalize('in 1990')).toBe('in 19 90')
    expect(kokoroNormalize('$1 or £2.01')).toBe('1 dollar or 2 pounds and 1 penny')
  })

  it('drops what the model has no token for and keeps a long phrase to 512 tokens', () => {
    expect(kokoroTokens('a☃b')).toEqual([0, 43, 44, 0])
    const long = kokoroTokens('a'.repeat(2000))
    expect(long).toHaveLength(512)
    expect(long[0]).toBe(0)
    expect(long.at(-1)).toBe(0)
  })

  it('takes the style row for the phrase length, the last row for anything longer', () => {
    const voice = Float32Array.from({ length: 510 * 256 }, (_, i) => Math.floor(i / 256))
    expect(kokoroStyle(voice, 2)[0]).toBe(0)
    expect(kokoroStyle(voice, 29)).toHaveLength(256)
    expect(kokoroStyle(voice, 29)[255]).toBe(27)
    expect(kokoroStyle(voice, 5000)[0]).toBe(509)
  })
})

describe('Kokoro: voices and the WAV', () => {
  it('lists English voices only, each with its file hash', () => {
    expect(KOKORO_VOICES.length).toBeGreaterThan(10)
    for (const v of KOKORO_VOICES) {
      expect(v.id).toMatch(/^[ab][fm]_[a-z]+$/)
      expect(v.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(KOKORO_VOICES[0]).toMatchObject({ id: 'af_heart', name: 'Heart', accent: 'US', gender: 'female' })
    expect(KOKORO_VOICES.find((v) => v.id === 'bm_george')).toMatchObject({ accent: 'UK', gender: 'male' })
  })

  it('writes 16-bit mono PCM at 24 kHz, clipping what is out of range', () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 2]))
    const v = new DataView(wav.buffer)
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE')
    expect(v.getUint32(24, true)).toBe(24_000)
    expect(v.getUint32(40, true)).toBe(8)
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32767, 32767])
  })
})
