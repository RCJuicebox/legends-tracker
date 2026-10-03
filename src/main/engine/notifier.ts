import { existsSync, promises as fs } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { log } from '../log'
import { sources } from '../sources/registry'
import type { AppSettings, FeedItem, Notification } from '../../shared/types'
import type { EngineOutputs, Speaker } from './contracts'

/** The kinds of file the audio window plays. */
const SOUND_FILE = /\.(wav|mp3|ogg)$/i
/** As many activity lines as the Live page keeps. */
const FEED_MAX = 300
/**
 * How late a phrase may still be said: a timer's cue until the timer ends (a fade a few seconds
 * after), a trigger's for ten seconds. Past that the audio window drops it rather than say it about
 * a fight that has moved on (LT-345).
 */
const LATE_MS = 4000
const TRIGGER_LATE_MS = 10_000

/** What the player hears and reads: alerts, speech, sounds and the activity feed. */
export class Notifier {
  private readonly items: FeedItem[] = []
  private speechFailed = false
  private warmedAt = 0
  private wasMuted: boolean | null = null
  /** Phrases go to the audio window in the order they were asked for, whichever renders first. */
  private order: Promise<void> = Promise.resolve()

  constructor(
    private readonly speech: Speaker,
    private readonly out: Pick<EngineOutputs, 'alert' | 'audio' | 'feed'>,
    private readonly settings: () => AppSettings,
    private readonly soundDirs: () => string[]
  ) {}

  get feed(): FeedItem[] {
    return this.items
  }

  /** `timer`: the timer whose cue this is, which says how late it may still be said. */
  notify(ns: Notification[], timer?: { endsAt: number }): void {
    const audio = this.settings().audio
    const now = Date.now()
    const expiresAt = timer ? Math.max(timer.endsAt, now + LATE_MS) : now + TRIGGER_LATE_MS
    for (const n of ns) {
      if (n.kind === 'text') this.out.alert({ text: n.text, color: n.color, durationSec: n.durationSec })
      else if (audio.muted) continue
      else if (n.kind === 'speak') void this.speak(n.text, n.interrupt, expiresAt)
      else if (n.kind === 'sound') void this.playSound(n.file, n.volume)
    }
  }

  /**
   * Renders a new timer's cue phrases now, so the cue, when it is due, does not wait on the speech
   * engine or Azure (LT-346). Both keep what they render, by text.
   */
  prepare(ns: Notification[]): void {
    const a = this.settings().audio
    if (a.muted) return
    for (const n of ns) if (n.kind === 'speak' && n.text.trim()) void this.speech.synthesize(n.text, a.voice, a.rate).catch(() => {})
  }

  /** The settings changed: unmuted, the speech engine is started ahead of the next phrase (LT-363). */
  reconfigure(): void {
    const a = this.settings().audio
    if (this.wasMuted === true && !a.muted) {
      this.warmedAt = Date.now()
      this.speech.warm?.(a.voice)
    }
    this.wasMuted = a.muted
  }

  /** The log is growing, so someone is playing: keeps the speech engine up so a cue is not held up while it starts. */
  playing(now: number): void {
    // Muted, nothing will be said: the speech engine (some 60 MB) is left to go.
    if (now - this.warmedAt <= 60_000 || this.settings().audio.muted) return
    this.warmedAt = now
    this.speech.warm?.(this.settings().audio.voice)
  }

  speak(text: string, interrupt = false, expiresAt?: number): Promise<void> {
    if (!text.trim()) return Promise.resolve()
    const a = this.settings().audio
    // Rendered at once, but sent after every phrase asked for before it: a cached phrase must not
    // overtake one still rendering (LT-345).
    const rendered = this.speech.synthesize(text, a.voice, a.rate).then(
      (wav) => ({ wav }),
      (error: unknown) => ({ error })
    )
    const sent = this.order.then(async () => {
      const r = await rendered
      if ('wav' in r) {
        this.out.audio({ kind: 'speech', wav: new Uint8Array(r.wav), interrupt, expiresAt })
        if (this.speechFailed) {
          this.speechFailed = false
          sources.ok('speech', 'Speaking again')
        }
        return
      }
      // The audio window speaks it itself instead. Said once in the log, and shown on Data Sources
      // until the engine speaks again.
      if (!this.speechFailed) {
        log.warn('Speech synthesis failed; falling back to the audio window’s own voice:', r.error)
        sources.fail('speech', r.error, 'The audio window speaks with its own voice meanwhile')
      }
      this.speechFailed = true
      this.out.audio({ kind: 'speech-fallback', text, interrupt, expiresAt })
    })
    this.order = sent
    return sent
  }

  async playSound(file: string, volume: number): Promise<void> {
    const path = this.resolveSound(file)
    if (!path) {
      this.pushFeed('warn', `Sound not found: ${file}`)
      return
    }
    try {
      const [data, stat] = await Promise.all([fs.readFile(path), fs.stat(path)])
      // Named by its whole path and when it was written, so a trigger's own alert.wav is not taken for
      // the library's, nor an edited file for the old one (LT-357).
      this.out.audio({ kind: 'sound', data: new Uint8Array(data), volume, name: `${path}|${stat.mtimeMs}` })
    } catch (e) {
      this.pushFeed('warn', `Could not play ${basename(path)}: ${(e as Error).message}`)
    }
  }

  /** A sound file to play: an absolute path (a trigger imported from elsewhere) or a name in the sound folders. Audio files only. */
  resolveSound(file: string): string | null {
    if (!SOUND_FILE.test(file)) return null
    if (isAbsolute(file)) return existsSync(file) ? file : null
    // A name, not a path: nothing outside the sound folders.
    if (basename(file) !== file) return null
    for (const dir of this.soundDirs()) {
      const p = join(dir, file)
      if (existsSync(p)) return p
    }
    return null
  }

  async listSounds(): Promise<string[]> {
    const names = new Set<string>()
    for (const dir of this.soundDirs()) {
      try {
        for (const f of await fs.readdir(dir)) if (SOUND_FILE.test(f)) names.add(f)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not list sounds in ${dir}:`, e)
      }
    }
    return [...names].sort()
  }

  pushFeed(kind: FeedItem['kind'], text: string): void {
    if (kind === 'warn') log.warn(text)
    else if (kind === 'info') log.info(text)
    const item = { at: Date.now(), kind, text }
    this.items.push(item)
    if (this.items.length > FEED_MAX) this.items.shift()
    this.out.feed(item)
  }
}
