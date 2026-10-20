import VOCAB from './kokoroVocab.json'

// Kokoro (hexgrad/Kokoro-82M, Apache-2.0): a small open voice model that sounds close to Microsoft's
// natural voices and runs on the CPU, offline once its files are downloaded. What happens to a phrase
// before and after the model, ported from kokoro-js (Apache-2.0, https://github.com/hexgrad/kokoro):
// the text is cleaned up and turned into phonemes (espeak-ng, through the phonemizer package), the
// phonemes into the model's token ids, and the voice file gives the model one style row by the
// phrase's length. The model's answer is 24 kHz samples, kept as a WAV.

/** A voice setting naming a Kokoro voice: "kokoro:af_heart". Anything else is a Windows voice. */
export const KOKORO_PREFIX = 'kokoro:'

/** The model's files, pinned to one revision so a change upstream cannot change them under the app. */
export const KOKORO_REPO = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231'
export const KOKORO_MODEL = { file: 'onnx/model_quantized.onnx', sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478', size: 92_361_116 }
export const KOKORO_SAMPLE_RATE = 24_000

export interface KokoroVoice {
  id: string
  name: string
  accent: 'US' | 'UK'
  gender: 'female' | 'male'
  /** The voice file's SHA-256 and size, as the pinned revision has it. */
  sha256: string
  size: number
}

/**
 * The English voices graded C- or better on the model card, best first; the weaker ones (most of
 * the men, graded D and F) are left out. The first letter says the accent (a American, b British),
 * the second the gender.
 */
export const KOKORO_VOICES: KokoroVoice[] = (
  [
    ['af_heart', 'Heart', 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b'],
    ['af_bella', 'Bella', 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b'],
    ['af_nicole', 'Nicole', 'cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a'],
    ['bf_emma', 'Emma', '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73'],
    ['af_aoede', 'Aoede', '4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361'],
    ['af_kore', 'Kore', '9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e'],
    ['af_sarah', 'Sarah', '4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a'],
    ['am_fenrir', 'Fenrir', 'c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43'],
    ['am_michael', 'Michael', '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1'],
    ['am_puck', 'Puck', 'fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0'],
    ['af_alloy', 'Alloy', 'c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45'],
    ['af_nova', 'Nova', '18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f'],
    ['bf_isabella', 'Isabella', '3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f'],
    ['bm_george', 'George', 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc'],
    ['bm_fable', 'Fable', 'f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1'],
    ['af_sky', 'Sky', '4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9']
  ] as const
).map(([id, name, sha256]) => ({ id, name, accent: id[0] === 'b' ? 'UK' : 'US', gender: id[1] === 'm' ? 'male' : 'female', sha256, size: 522_240 }))

export const kokoroVoice = (id: string): KokoroVoice | undefined => KOKORO_VOICES.find((v) => v.id === id)

/** What the voice list shows: "Heart (US, female)". */
export const kokoroLabel = (v: KokoroVoice): string => `${v.name} (${v.accent}, ${v.gender})`

/** The espeak-ng language a voice's phonemes are made in. */
export const kokoroLanguage = (id: string): 'en-us' | 'en' => (id[0] === 'b' ? 'en' : 'en-us')

// ---- Text into phonemes ----

/** A time, a year or a number with a point, as words the phonemizer says right ("1990" → "19 90"). */
function splitNumber(m: string): string {
  if (m.includes('.')) return m
  if (m.includes(':')) {
    const [h, min] = m.split(':').map(Number)
    return min === 0 ? `${h} o'clock` : min < 10 ? `${h} oh ${min}` : `${h} ${min}`
  }
  const year = parseInt(m.slice(0, 4), 10)
  if (year < 1100 || year % 1000 < 10) return m
  const left = m.slice(0, 2)
  const right = parseInt(m.slice(2, 4), 10)
  const s = m.endsWith('s') ? 's' : ''
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${s}`
    if (right < 10) return `${left} oh ${right}${s}`
  }
  return `${left} ${right}${s}`
}

function money(m: string): string {
  const unit = m[0] === '$' ? 'dollar' : 'pound'
  const amount = m.slice(1)
  if (isNaN(Number(amount))) return `${amount} ${unit}s`
  if (!amount.includes('.')) return `${amount} ${unit}${amount === '1' ? '' : 's'}`
  const [whole, part] = amount.split('.')
  const cents = parseInt(part.padEnd(2, '0'), 10)
  const small = m[0] === '$' ? (cents === 1 ? 'cent' : 'cents') : cents === 1 ? 'penny' : 'pence'
  return `${whole} ${unit}${whole === '1' ? '' : 's'} and ${cents} ${small}`
}

const point = (m: string): string => {
  const [whole, part] = m.split('.')
  return `${whole} point ${part.split('').join(' ')}`
}

/** kokoro-js's clean-up before phonemes: quotes, titles, times, years and money said as words. */
export function kokoroNormalize(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, '“')
    .replace(/»/g, '”')
    .replace(/[“”]/g, '"')
    .replace(/\(/g, '«')
    .replace(/\)/g, '»')
    .replace(/[^\S \n]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNumber)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, money)
    .replace(/\d*\.\d+/g, point)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim()
}

/** Runs of punctuation, which the model takes as they are; the words between go to the phonemizer. */
const PUNCTUATION = /(\s*[;:,.!?¡¿—…"«»“”(){}[\]]+\s*)+/g

/** Phonemes for a phrase, `phonemize` being espeak-ng's (the phonemizer package's `phonemize`). */
export async function kokoroPhonemes(text: string, voiceId: string, phonemize: (text: string, language: string) => Promise<string[]>): Promise<string> {
  const clean = kokoroNormalize(text)
  const parts: { punctuation: boolean; text: string }[] = []
  let at = 0
  for (const m of clean.matchAll(PUNCTUATION)) {
    if (at < m.index) parts.push({ punctuation: false, text: clean.slice(at, m.index) })
    if (m[0].length) parts.push({ punctuation: true, text: m[0] })
    at = m.index + m[0].length
  }
  if (at < clean.length) parts.push({ punctuation: false, text: clean.slice(at) })
  const language = kokoroLanguage(voiceId)
  const said = await Promise.all(parts.map(async (p) => (p.punctuation ? p.text : (await phonemize(p.text, language)).join(' '))))
  let ph = said
    .join('')
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z')
  if (language === 'en-us') ph = ph.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di')
  return ph.trim()
}

// ---- Phonemes into the model's input ----

const vocab: Record<string, number> = VOCAB
/** The model takes 512 tokens at most, the two pads included. */
const MAX_TOKENS = 512

/** The model's token ids for a phoneme string: one a character, unknown ones dropped, a pad (0) at each end. */
export function kokoroTokens(phonemes: string): number[] {
  const ids: number[] = []
  for (const ch of phonemes) {
    const id = vocab[ch]
    if (id !== undefined && ids.length < MAX_TOKENS - 2) ids.push(id)
  }
  return [0, ...ids, 0]
}

/** A voice file is 510 style rows of 256 numbers; a phrase takes the row for its length in tokens. */
export function kokoroStyle(voice: Float32Array, tokens: number): Float32Array {
  const row = Math.min(Math.max(tokens - 2, 0), 509)
  return voice.slice(256 * row, 256 * row + 256)
}

/** The model's samples (-1..1) as a 16-bit mono WAV. */
export function encodeWav(samples: Float32Array, rate = KOKORO_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(bytes.buffer)
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  tag(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  tag(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true)
  return bytes
}
