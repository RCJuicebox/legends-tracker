import { beforeEach, describe, expect, it, vi } from 'vitest'

// Both engines are stand-ins: no model is loaded and no Windows voice is started.
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { VoiceRouter } = await import('../../src/main/voiceRouter')
const { log } = await import('../../src/main/log')

function engines(clock = { t: 0 }) {
  const windows = {
    synthesize: vi.fn(async (text: string, voice: string, rate: number) => Buffer.from(`win:${voice}:${rate}:${text}`)),
    warm: vi.fn(async () => undefined)
  }
  const kokoro = {
    isReady: true,
    ready: vi.fn((_id: string) => kokoro.isReady),
    prepare: vi.fn(),
    synthesize: vi.fn(async (text: string, voice: string, rate: number) => Buffer.from(`kokoro:${voice}:${rate}:${text}`))
  }
  const router = new VoiceRouter(windows, kokoro, () => clock.t)
  return { windows, kokoro, router, clock }
}

beforeEach(() => vi.mocked(log.warn).mockClear())

describe('speaking through the voice router', () => {
  it('gives a kokoro: voice to Kokoro without the prefix, and leaves Windows alone', async () => {
    const { windows, kokoro, router } = engines()
    const wav = await router.synthesize('Recast Tester Spell', 'kokoro:af_heart', 1.2)
    expect(wav.toString()).toBe('kokoro:af_heart:1.2:Recast Tester Spell')
    expect(kokoro.synthesize).toHaveBeenCalledWith('Recast Tester Spell', 'af_heart', 1.2)
    expect(windows.synthesize).not.toHaveBeenCalled()
  })

  it('gives any other voice, the default included, to Windows', async () => {
    const { windows, kokoro, router } = engines()
    expect((await router.synthesize('hi', 'Tester Voice', 1)).toString()).toBe('win:Tester Voice:1:hi')
    expect((await router.synthesize('hi', '', 1)).toString()).toBe('win::1:hi')
    expect(kokoro.synthesize).not.toHaveBeenCalled()
    expect(windows.synthesize).toHaveBeenCalledTimes(2)
  })

  it('starts the download and speaks in the Windows default while the model is not here', async () => {
    const { windows, kokoro, router } = engines()
    kokoro.isReady = false
    kokoro.synthesize.mockRejectedValueOnce(new Error('The Kokoro voices are not downloaded yet'))
    const wav = await router.synthesize('Tester Spell down', 'kokoro:af_heart', 1.5)
    expect(wav.toString()).toBe('win::1.5:Tester Spell down')
    expect(kokoro.prepare).toHaveBeenCalledWith('af_heart')
    expect(windows.synthesize).toHaveBeenCalledWith('Tester Spell down', '', 1.5)
    // Nothing failed: the model is simply not here yet.
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('still says a phrase kept from before in Kokoro while the model is not here', async () => {
    const { windows, kokoro, router } = engines()
    kokoro.isReady = false
    expect((await router.synthesize('kept', 'kokoro:af_heart', 1)).toString()).toBe('kokoro:af_heart:1:kept')
    expect(windows.synthesize).not.toHaveBeenCalled()
  })

  it('says the phrase in the Windows default voice, at the same speed, when Kokoro fails', async () => {
    const { windows, kokoro, router } = engines()
    kokoro.synthesize.mockRejectedValueOnce(new Error('The Kokoro voices stopped'))
    const wav = await router.synthesize('Tester Spell down', 'kokoro:af_heart', 1.5)
    expect(wav.toString()).toBe('win::1.5:Tester Spell down')
    expect(windows.synthesize).toHaveBeenCalledWith('Tester Spell down', '', 1.5)
  })

  it('leaves Kokoro alone for a minute after it fails, Windows warmed, then tries it again', async () => {
    const { windows, kokoro, router, clock } = engines()
    kokoro.synthesize.mockRejectedValueOnce(new Error('stopped'))
    await router.synthesize('one', 'kokoro:af_heart', 1)
    expect(windows.warm).toHaveBeenCalled()
    clock.t += 30_000
    expect((await router.synthesize('two', 'kokoro:af_heart', 1)).toString()).toBe('win::1:two')
    expect(kokoro.synthesize).toHaveBeenCalledOnce()
    clock.t += 31_000
    expect((await router.synthesize('three', 'kokoro:af_heart', 1)).toString()).toBe('kokoro:af_heart:1:three')
    expect(windows.synthesize).toHaveBeenCalledTimes(2)
    expect(kokoro.synthesize).toHaveBeenCalledTimes(2)
  })

  it('races a phrase Kokoro is slow on against Windows after two and a half seconds', async () => {
    vi.useFakeTimers()
    try {
      const { windows, kokoro, router } = engines()
      kokoro.synthesize.mockImplementationOnce(() => new Promise((r) => setTimeout(() => r(Buffer.from('late kokoro')), 8000)))
      const said = router.synthesize('slow', 'kokoro:af_heart', 1)
      await vi.advanceTimersByTimeAsync(2000)
      expect(windows.synthesize).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(600)
      expect((await said).toString()).toBe('win::1:slow')
      expect(windows.synthesize).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(8000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes the Kokoro failure to the diagnostic log only the first time', async () => {
    const { kokoro, router, clock } = engines()
    kokoro.synthesize.mockRejectedValue(new Error('stopped'))
    for (const text of ['one', 'two', 'three']) {
      await router.synthesize(text, 'kokoro:af_heart', 1)
      clock.t += 61_000
    }
    expect(kokoro.synthesize).toHaveBeenCalledTimes(3)
    expect(log.warn).toHaveBeenCalledOnce()
  })

  it('fails the phrase when Kokoro fails and Windows cannot speak either', async () => {
    const { windows, kokoro, router } = engines()
    kokoro.synthesize.mockRejectedValueOnce(new Error('stopped'))
    windows.synthesize.mockRejectedValueOnce(new Error('Speech engine unavailable'))
    await expect(router.synthesize('lost', 'kokoro:af_heart', 1)).rejects.toThrow('Speech engine unavailable')
  })

  it('warms Kokoro for a Kokoro voice, and Windows as well while Kokoro cannot speak', () => {
    const { windows, kokoro, router } = engines()
    router.warm('kokoro:af_heart')
    expect(kokoro.prepare).toHaveBeenCalledWith('af_heart')
    expect(windows.warm).not.toHaveBeenCalled()
    kokoro.isReady = false
    router.warm('kokoro:af_heart')
    expect(windows.warm).toHaveBeenCalledOnce()
    router.warm('Tester Voice')
    expect(windows.warm).toHaveBeenCalledTimes(2)
    expect(kokoro.prepare).toHaveBeenCalledTimes(2)
  })
})
