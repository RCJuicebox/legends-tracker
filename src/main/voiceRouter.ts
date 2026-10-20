import { KOKORO_PREFIX } from '../core/kokoro'
import { log } from './log'
import type { KokoroSpeech } from './kokoroSpeech'
import type { SpeechWorker } from './speech'

/** A phrase Kokoro has not rendered in this long is raced against the Windows voice. */
const KOKORO_SLOW_MS = 2500
/** After Kokoro fails, phrases go to Windows for this long before Kokoro is tried again. */
const KOKORO_REST_MS = 60_000

/**
 * Speech for the engine: a "kokoro:" voice through Kokoro, anything else through Windows. A Kokoro
 * voice speaks in the Windows default meanwhile (its model downloading, a failure, a phrase slow to
 * render), so a cue is never lost: a phrase not ready in two and a half seconds is raced against
 * Windows (Kokoro's answer is still kept for next time), and after a failure Kokoro is left alone for
 * a minute, Windows warmed meanwhile.
 */
export class VoiceRouter {
  private warned = false
  private downUntil = 0

  constructor(
    private readonly windows: Pick<SpeechWorker, 'synthesize' | 'warm'>,
    private readonly kokoro: Pick<KokoroSpeech, 'ready' | 'prepare' | 'synthesize'>,
    private readonly now: () => number = Date.now
  ) {}

  /** Gets the engine the voice will use going ahead of the next phrase (or Kokoro's download). */
  warm(voice: string): void {
    if (!voice.startsWith(KOKORO_PREFIX)) return void this.windows.warm()
    const id = voice.slice(KOKORO_PREFIX.length)
    this.kokoro.prepare(id)
    if (!this.kokoro.ready(id) || this.now() < this.downUntil) void this.windows.warm()
  }

  async synthesize(text: string, voice: string, rate: number): Promise<Buffer> {
    if (!voice.startsWith(KOKORO_PREFIX)) return this.windows.synthesize(text, voice, rate)
    const id = voice.slice(KOKORO_PREFIX.length)
    if (this.now() < this.downUntil) return this.windows.synthesize(text, '', rate)
    if (!this.kokoro.ready(id)) {
      // Not downloaded yet: a phrase kept from before still comes from Kokoro, anything else from Windows.
      this.kokoro.prepare(id)
      return this.kokoro.synthesize(text, id, rate).catch(() => this.windows.synthesize(text, '', rate))
    }
    const kokoro = this.kokoro.synthesize(text, id, rate)
    const failed = (e: unknown) => {
      if (!this.warned) log.warn('Kokoro voices failed; using the Windows voice meanwhile:', e)
      this.warned = true
      this.downUntil = this.now() + KOKORO_REST_MS
      void this.windows.warm()
    }
    let slow: NodeJS.Timeout | undefined
    const first = await Promise.race([
      kokoro.then(
        (wav) => ({ wav }),
        (error: unknown) => ({ error })
      ),
      new Promise<null>((r) => (slow = setTimeout(() => r(null), KOKORO_SLOW_MS)))
    ])
    clearTimeout(slow)
    if (first && 'wav' in first) return first.wav
    if (first) {
      failed(first.error)
      return this.windows.synthesize(text, '', rate)
    }
    // Slow: whichever answers first; Kokoro's answer, if it comes, is kept for next time.
    kokoro.catch(failed)
    return Promise.any([kokoro, this.windows.synthesize(text, '', rate)])
  }
}
