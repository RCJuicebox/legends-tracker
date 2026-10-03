import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notifier } from '../../src/main/engine/notifier'
import type { AppSettings, FeedItem } from '../../src/shared/types'
import type { AudioCommand } from '../../src/main/engine/contracts'

const root = mkdtempSync(join(tmpdir(), 'lt-sounds-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

// The folders in the order the app searches them: the profile's own, then the game's default and shared.
const mine = join(root, 'profile', 'sounds')
const defaults = join(root, 'game', 'AudioTriggers', 'default')
const shared = join(root, 'game', 'AudioTriggers', 'shared')
const elsewhere = join(root, 'elsewhere')
for (const d of [mine, defaults, shared, elsewhere]) mkdirSync(d, { recursive: true })
const put = (dir: string, name: string) => {
  const p = join(dir, name)
  writeFileSync(p, `sound ${name}`)
  return p
}
put(mine, 'ding.wav')
put(defaults, 'ding.wav')
put(defaults, 'bell.mp3')
put(shared, 'Gong.OGG')
put(shared, 'readme.txt')
put(root, 'escape.wav')
put(root, 'game/AudioTriggers/up.wav')
const outsideWav = put(elsewhere, 'imported.wav')
const outsideExe = put(elsewhere, 'payload.exe')

let audio: AudioCommand[] = []
let feed: FeedItem[] = []
let dirs = [mine, defaults, shared]
const notifier = new Notifier(
  { synthesize: async () => Buffer.alloc(0) },
  { alert: () => {}, audio: (a) => void audio.push(a), feed: (f) => void feed.push(f) },
  () => ({}) as AppSettings,
  () => dirs
)

beforeEach(() => {
  audio = []
  feed = []
  dirs = [mine, defaults, shared]
  // Warnings go to the diagnostic log, which is the console here.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('resolveSound', () => {
  it('finds a name in the sound folders, the first folder that has it winning', () => {
    expect(notifier.resolveSound('ding.wav')).toBe(join(mine, 'ding.wav'))
    expect(notifier.resolveSound('bell.mp3')).toBe(join(defaults, 'bell.mp3'))
    expect(notifier.resolveSound('Gong.OGG')).toBe(join(shared, 'Gong.OGG'))
  })

  it('finds nothing for a name in none of them, or with no sound folders at all', () => {
    expect(notifier.resolveSound('missing.wav')).toBeNull()
    dirs = []
    expect(notifier.resolveSound('ding.wav')).toBeNull()
  })

  it('plays only wav, mp3 and ogg files', () => {
    expect(notifier.resolveSound('readme.txt')).toBeNull()
    expect(notifier.resolveSound('ding.wav.exe')).toBeNull()
    expect(notifier.resolveSound(outsideExe)).toBeNull()
    expect(notifier.resolveSound('ding')).toBeNull()
  })

  it('refuses a name that reaches out of the sound folders', () => {
    for (const name of ['../escape.wav', '..\\escape.wav', '../../escape.wav', '../up.wav', 'sub/ding.wav', 'sub\\ding.wav']) {
      expect(notifier.resolveSound(name), name).toBeNull()
    }
  })

  it('takes an absolute path to a sound that exists, wherever it is, for triggers imported from elsewhere', () => {
    expect(notifier.resolveSound(outsideWav)).toBe(outsideWav)
    expect(notifier.resolveSound(join(elsewhere, 'gone.wav'))).toBeNull()
  })
})

describe('playing a sound', () => {
  it('sends the file’s bytes to the audio window', async () => {
    await notifier.playSound('bell.mp3', 0.5)
    expect(audio).toHaveLength(1)
    const a = audio[0]
    expect(a).toMatchObject({ kind: 'sound', volume: 0.5 })
    // Named by its whole path and when it was written, so two folders' bell.mp3 are two sounds.
    expect(a.kind === 'sound' && a.name.startsWith(`${join(defaults, 'bell.mp3')}|`)).toBe(true)
    expect(a.kind === 'sound' && Buffer.from(a.data).toString()).toBe('sound bell.mp3')
  })

  it('says so on the activity feed when a sound is refused or missing', async () => {
    await notifier.playSound('../escape.wav', 1)
    await notifier.playSound('missing.wav', 1)
    expect(audio).toEqual([])
    expect(feed.map((f) => [f.kind, f.text])).toEqual([
      ['warn', 'Sound not found: ../escape.wav'],
      ['warn', 'Sound not found: missing.wav']
    ])
  })
})
