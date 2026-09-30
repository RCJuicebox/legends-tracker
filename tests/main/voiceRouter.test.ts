import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AzureSpeech } from '../../src/main/azureSpeech'

// Both engines are stand-ins: nothing reaches Azure and no Windows voice is started.
vi.mock('electron', () => ({ app: { getPath: () => '' }, safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { VoiceRouter } = await import('../../src/main/azureSpeech')
const { log } = await import('../../src/main/log')

function engines() {
  const windows = {
    synthesize: vi.fn(async (text: string, voice: string, rate: number) => Buffer.from(`win:${voice}:${rate}:${text}`)),
    warm: vi.fn(async () => undefined)
  }
  const azure = { synthesize: vi.fn(async (text: string, voice: string, rate: number) => Buffer.from(`azure:${voice}:${rate}:${text}`)) }
  const router = new VoiceRouter(windows, azure as unknown as AzureSpeech)
  return { windows, azure, router }
}

beforeEach(() => vi.mocked(log.warn).mockClear())

describe('speaking through the voice router', () => {
  it('gives an azure: voice to Azure without the prefix, and leaves Windows alone', async () => {
    const { windows, azure, router } = engines()
    const wav = await router.synthesize('Recast Tester Spell', 'azure:en-US-TesterNeural', 1.2)
    expect(wav.toString()).toBe('azure:en-US-TesterNeural:1.2:Recast Tester Spell')
    expect(azure.synthesize).toHaveBeenCalledWith('Recast Tester Spell', 'en-US-TesterNeural', 1.2)
    expect(windows.synthesize).not.toHaveBeenCalled()
  })

  it('gives any other voice, the default included, to Windows', async () => {
    const { windows, azure, router } = engines()
    expect((await router.synthesize('hi', 'Tester Voice', 1)).toString()).toBe('win:Tester Voice:1:hi')
    expect((await router.synthesize('hi', '', 1)).toString()).toBe('win::1:hi')
    expect(azure.synthesize).not.toHaveBeenCalled()
    expect(windows.synthesize).toHaveBeenCalledTimes(2)
  })

  it('says the phrase in the Windows default voice, at the same speed, when Azure fails', async () => {
    const { windows, azure, router } = engines()
    azure.synthesize.mockRejectedValueOnce(new Error('Azure turned the key down'))
    const wav = await router.synthesize('Tester Spell down', 'azure:en-US-TesterNeural', 1.5)
    expect(wav.toString()).toBe('win::1.5:Tester Spell down')
    expect(windows.synthesize).toHaveBeenCalledWith('Tester Spell down', '', 1.5)
  })

  it('goes back to Azure for the next phrase once it answers again', async () => {
    const { windows, azure, router } = engines()
    azure.synthesize.mockRejectedValueOnce(new Error('offline'))
    await router.synthesize('one', 'azure:en-US-TesterNeural', 1)
    const wav = await router.synthesize('two', 'azure:en-US-TesterNeural', 1)
    expect(wav.toString()).toBe('azure:en-US-TesterNeural:1:two')
    expect(windows.synthesize).toHaveBeenCalledOnce()
    expect(azure.synthesize).toHaveBeenCalledTimes(2)
  })

  it('writes the Azure failure to the diagnostic log only the first time', async () => {
    const { azure, router } = engines()
    azure.synthesize.mockRejectedValue(new Error('offline'))
    await router.synthesize('one', 'azure:en-US-TesterNeural', 1)
    await router.synthesize('two', 'azure:en-US-TesterNeural', 1)
    await router.synthesize('three', 'azure:en-US-TesterNeural', 1)
    expect(log.warn).toHaveBeenCalledOnce()
  })

  it('fails the phrase when Azure fails and Windows cannot speak either', async () => {
    const { windows, azure, router } = engines()
    azure.synthesize.mockRejectedValueOnce(new Error('offline'))
    windows.synthesize.mockRejectedValueOnce(new Error('Speech engine unavailable'))
    await expect(router.synthesize('lost', 'azure:en-US-TesterNeural', 1)).rejects.toThrow('Speech engine unavailable')
  })

  it('passes a Windows failure straight on for a Windows voice, without trying Azure', async () => {
    const { windows, azure, router } = engines()
    windows.synthesize.mockRejectedValueOnce(new Error('Speech engine exited'))
    await expect(router.synthesize('x', 'Tester Voice', 1)).rejects.toThrow('Speech engine exited')
    expect(azure.synthesize).not.toHaveBeenCalled()
  })
})
