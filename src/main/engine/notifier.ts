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

/** What the player hears and reads: alerts, speech, sounds and the activity feed. */
export class Notifier {
  private readonly items: FeedItem[] = []
  private speechFailed = false
  private warmedAt = 0

  constructor(
    private readonly speech: Speaker,
    private readonly out: Pick<EngineOutputs, 'alert' | 'audio' | 'feed'>,
    private readonly settings: () => AppSettings,
    private readonly soundDirs: () => string[]
  ) {}

  get feed(): FeedItem[] {
    return this.items
  }

  notify(ns: Notification[]): void {
    const audio = this.settings().audio
    for (const n of ns) {
      if (n.kind === 'text') this.out.alert({ text: n.text, color: n.color, durationSec: n.durationSec })
      else if (audio.muted) continue
      else if (n.kind === 'speak') void this.speak(n.text, n.interrupt)
      else if (n.kind === 'sound') void this.playSound(n.file, n.volume)
    }
  }

  /** The log is growing, so someone is playing: keeps the speech engine up so a cue is not held up while it starts. */
  playing(now: number): void {
    if (now - this.warmedAt <= 60_000) return
    this.warmedAt = now
    this.speech.warm?.(this.settings().audio.voice)
  }

  async speak(text: string, interrupt = false): Promise<void> {
    if (!text.trim()) return
    const a = this.settings().audio
    try {
      const wav = await this.speech.synthesize(text, a.voice, a.rate)
      this.out.audio({ kind: 'speech', wav: new Uint8Array(wav), interrupt })
      if (this.speechFailed) {
        this.speechFailed = false
        sources.ok('speech', 'Speaking again')
      }
    } catch (e) {
      // The audio window speaks it itself instead. Said once in the log, and shown on Data Sources
      // until the engine speaks again.
      if (!this.speechFailed) {
        log.warn('Speech synthesis failed; falling back to the audio window’s own voice:', e)
        sources.fail('speech', e, 'The audio window speaks with its own voice meanwhile')
      }
      this.speechFailed = true
      this.out.audio({ kind: 'speech-fallback', text, interrupt })
    }
  }

  async playSound(file: string, volume: number): Promise<void> {
    const path = this.resolveSound(file)
    if (!path) {
      this.pushFeed('warn', `Sound not found: ${file}`)
      return
    }
    try {
      const data = await fs.readFile(path)
      this.out.audio({ kind: 'sound', data: new Uint8Array(data), volume, name: basename(path) })
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
