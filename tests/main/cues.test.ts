import { describe, expect, it, vi } from 'vitest'
import { Notifier } from '../../src/main/engine/notifier'
import { defaultSettings } from '../../src/main/storeCore'
import type { AppSettings } from '../../src/shared/types'
import type { AudioCommand } from '../../src/main/engine/contracts'

// The cue path: phrases rendered by a stand-in engine, each slow or quick as a test needs.
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

function setup(delays: Record<string, number> = {}) {
  const audio: AudioCommand[] = []
  const rendered: string[] = []
  let settings: AppSettings = defaultSettings()
  const warm = vi.fn()
  const speech = {
    synthesize: (text: string) => {
      rendered.push(text)
      return new Promise<Buffer>((r) => setTimeout(() => r(Buffer.from(text)), delays[text] ?? 0))
    },
    warm
  }
  const notifier = new Notifier(
    speech,
    { alert: () => {}, audio: (a) => void audio.push(a), feed: () => {} },
    () => settings,
    () => []
  )
  const said = () => audio.map((a) => (a.kind === 'speech' ? Buffer.from(a.wav).toString() : a.kind))
  return { notifier, audio, rendered, said, warm, set: (s: Partial<AppSettings['audio']>) => (settings = { ...settings, audio: { ...settings.audio, ...s } }) }
}

describe('cues', () => {
  it('go to the audio window in the order asked, though a later one renders first (LT-345)', async () => {
    const { notifier, said } = setup({ slow: 50 })
    const a = notifier.speak('slow')
    const b = notifier.speak('quick')
    await Promise.all([a, b])
    expect(said()).toEqual(['slow', 'quick'])
  })

  it('carry how late they may be said: a timer cue until its timer ends, a trigger for ten seconds', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    try {
      const { notifier, audio } = setup()
      notifier.notify([{ kind: 'speak', text: 'Recast Tester Bolt', interrupt: false }], { endsAt: 1_012_000 })
      notifier.notify([{ kind: 'speak', text: 'Tester Bolt faded', interrupt: false }], { endsAt: 999_000 })
      notifier.notify([{ kind: 'speak', text: 'A trigger', interrupt: false }])
      await vi.runAllTimersAsync()
      expect(audio.map((a) => (a.kind === 'speech' ? a.expiresAt : 0))).toEqual([1_012_000, 1_004_000, 1_010_000])
    } finally {
      vi.useRealTimers()
    }
  })

  it('are rendered as their timer starts, not when they are due (LT-346), and not while muted', async () => {
    const { notifier, rendered, set } = setup()
    notifier.prepare([
      { kind: 'speak', text: 'Recast Tester Bolt', interrupt: false },
      { kind: 'text', text: 'x', color: '#fff', durationSec: 1 }
    ])
    expect(rendered).toEqual(['Recast Tester Bolt'])
    set({ muted: true })
    notifier.prepare([{ kind: 'speak', text: 'Muted', interrupt: false }])
    expect(rendered).toEqual(['Recast Tester Bolt'])
  })

  it('warm the speech engine as audio is unmuted (LT-363)', () => {
    const { notifier, warm, set } = setup()
    notifier.reconfigure()
    set({ muted: true })
    notifier.reconfigure()
    expect(warm).not.toHaveBeenCalled()
    set({ muted: false })
    notifier.reconfigure()
    expect(warm).toHaveBeenCalledOnce()
  })
})
