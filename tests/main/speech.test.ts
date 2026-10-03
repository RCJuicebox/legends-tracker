import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

// No PowerShell is started: spawn hands back a stand-in process that answers like the speech
// script does (a voices line on start, a wav line per phrase), or stays silent when told to.

class FakeStream extends EventEmitter {
  setEncoding(): this {
    return this
  }
}

class FakeProcess extends EventEmitter {
  readonly stdout = new FakeStream()
  readonly stderr = new FakeStream()
  readonly stdin = Object.assign(new EventEmitter(), { write: vi.fn((line: string) => this.written(line)) })
  readonly pid = undefined
  /** Phrases asked for, in order. */
  readonly asked: { id: number; text: string; voice: string; rate: number }[] = []
  killed = false
  /** Whether phrases are answered at once. */
  answer = true

  constructor() {
    super()
    // The script lists its voices once it has loaded.
    queueMicrotask(() => this.say({ type: 'voices', voices: ['Tester Voice', 'Other Voice'] }))
  }

  say(msg: object): void {
    this.stdout.emit('data', JSON.stringify(msg) + '\n')
  }

  wav(id: number, text: string): void {
    this.say({ type: 'wav', id, data: Buffer.from(`wav:${text}`).toString('base64') })
  }

  private written(line: string): boolean {
    const req = JSON.parse(line)
    this.asked.push(req)
    if (this.answer) queueMicrotask(() => this.wav(req.id, req.text))
    return true
  }

  kill = vi.fn(() => {
    this.killed = true
    // A killed process reports its exit a moment later, as a real one does.
    queueMicrotask(() => this.emit('exit', 1))
    return true
  })
}

const procs: FakeProcess[] = []
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const p = new FakeProcess()
    procs.push(p)
    return p
  })
}))
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { spawn } = await import('node:child_process')
const { SpeechWorker } = await import('../../src/main/speech')

const MINUTE = 60_000

beforeEach(() => {
  procs.length = 0
  vi.mocked(spawn).mockClear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the Windows speech engine starting', () => {
  it('starts nothing until the first phrase is asked for', async () => {
    const w = new SpeechWorker()
    expect(spawn).not.toHaveBeenCalled()
    const wav = await w.synthesize('Recast Tester Spell', 'Tester Voice', 1)
    expect(wav.toString()).toBe('wav:Recast Tester Spell')
    expect(spawn).toHaveBeenCalledOnce()
    expect(vi.mocked(spawn).mock.calls[0][0]).toBe('powershell.exe')
    w.stop()
  })

  it('learns the installed voices when it starts, and runs one process for every phrase after', async () => {
    const w = new SpeechWorker()
    await w.warm()
    expect(w.voices).toEqual(['Tester Voice', 'Other Voice'])
    expect(w.failed).toBe('')
    await w.warm()
    await w.synthesize('one', '', 1)
    await w.synthesize('two', 'Other Voice', 1.5)
    expect(spawn).toHaveBeenCalledOnce()
    expect(procs[0].asked.map((a) => [a.text, a.voice, a.rate])).toEqual([
      ['one', '', 1],
      ['two', 'Other Voice', 1.5]
    ])
    w.stop()
  })

  it('takes a single voice name as a list of one', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const p = new FakeProcess()
      p.say = function (this: FakeProcess, msg: object) {
        const m = msg as { type: string }
        const fixed = m.type === 'voices' ? { type: 'voices', voices: 'Tester Voice' } : msg
        this.stdout.emit('data', JSON.stringify(fixed) + '\n')
      }
      procs.push(p)
      return p as never
    })
    const w = new SpeechWorker()
    await w.warm()
    expect(w.voices).toEqual(['Tester Voice'])
    w.stop()
  })

  it('gives up waiting after fifteen seconds when the engine never lists its voices', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const p = new FakeProcess()
      p.say = () => undefined
      procs.push(p)
      return p as never
    })
    const w = new SpeechWorker()
    const ready = w.warm()
    await vi.advanceTimersByTimeAsync(15_000)
    await ready
    expect(w.failed).toBe('Speech engine did not start')
    w.stop()
  })

  it('reports a process that cannot run at all, and tries again on the next phrase', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const p = new FakeProcess()
      p.say = () => undefined
      queueMicrotask(() => p.emit('error', new Error('spawn powershell.exe ENOENT')))
      procs.push(p)
      return p as never
    })
    const w = new SpeechWorker()
    await w.warm()
    expect(w.failed).toBe('spawn powershell.exe ENOENT')
    const wav = await w.synthesize('again', '', 1)
    expect(wav.toString()).toBe('wav:again')
    expect(spawn).toHaveBeenCalledTimes(2)
    w.stop()
  })
})

describe('the Windows speech engine going idle', () => {
  it('stops the process after five minutes with nothing said', async () => {
    const w = new SpeechWorker()
    await w.synthesize('hello', '', 1)
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1)
    expect(procs[0].killed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(procs[0].killed).toBe(true)
  })

  it('counts the five minutes from the last phrase', async () => {
    const w = new SpeechWorker()
    await w.synthesize('first', '', 1)
    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    await w.synthesize('second', '', 1)
    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    expect(procs[0].killed).toBe(false)
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(procs[0].killed).toBe(true)
  })

  it('starts a fresh process for the next phrase after an idle stop', async () => {
    const w = new SpeechWorker()
    await w.synthesize('before', '', 1)
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(procs[0].killed).toBe(true)
    const wav = await w.synthesize('after', '', 1)
    expect(wav.toString()).toBe('wav:after')
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(procs[1].killed).toBe(false)
    w.stop()
  })

  it('answers a phrase said before from memory, without asking the engine again', async () => {
    const w = new SpeechWorker()
    await w.synthesize('Recast', 'Tester Voice', 1)
    const again = await w.synthesize('Recast', 'Tester Voice', 1)
    expect(again.toString()).toBe('wav:Recast')
    expect(procs[0].asked).toHaveLength(1)
    // A different voice or speed is a different phrase.
    await w.synthesize('Recast', 'Tester Voice', 1.2)
    expect(procs[0].asked).toHaveLength(2)
    w.stop()
  })
})

describe('the Windows speech engine failing', () => {
  it('fails the phrase in progress when the process dies, and restarts on the next one', async () => {
    const w = new SpeechWorker()
    await w.warm()
    procs[0].answer = false
    const pending = w.synthesize('lost', '', 1)
    await vi.advanceTimersByTimeAsync(0)
    procs[0].emit('exit', 3)
    await expect(pending).rejects.toThrow('Speech engine exited')
    expect(w.failed).toBe('Speech engine exited')
    const wav = await w.synthesize('back', '', 1)
    expect(wav.toString()).toBe('wav:back')
    expect(spawn).toHaveBeenCalledTimes(2)
    // Hearing from the new process clears the old failure.
    expect(w.failed).toBe('')
    w.stop()
  })

  it('gives up on one slow phrase alone, and restarts an engine that takes over ten seconds twice running (LT-364)', async () => {
    const w = new SpeechWorker()
    await w.warm()
    procs[0].answer = false
    const pending = w.synthesize('stuck', '', 1)
    const settled = expect(pending).rejects.toThrow('Speech engine did not answer')
    await vi.advanceTimersByTimeAsync(5_000)
    const other = w.synthesize('waiting', '', 1)
    const otherSettled = expect(other).rejects.toThrow('Speech engine did not answer')
    await vi.advanceTimersByTimeAsync(5_000)
    await settled
    // One timeout: the other phrase still waits on the same engine.
    expect(procs[0].killed).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)
    await otherSettled
    expect(procs[0].killed).toBe(true)
    const wav = await w.synthesize('unstuck', '', 1)
    expect(wav.toString()).toBe('wav:unstuck')
    expect(spawn).toHaveBeenCalledTimes(2)
    w.stop()
  })

  it('renders a phrase asked for twice while rendering once', async () => {
    const w = new SpeechWorker()
    await w.warm()
    const [a, b] = await Promise.all([w.synthesize('twice', '', 1), w.synthesize('twice', '', 1)])
    expect(a).toBe(b)
    expect(procs[0].asked.filter((r) => r.text === 'twice')).toHaveLength(1)
    w.stop()
  })

  it('passes on the reason the engine gives for a phrase it could not say', async () => {
    const w = new SpeechWorker()
    await w.warm()
    procs[0].answer = false
    const pending = w.synthesize('bad', '', 1)
    await vi.advanceTimersByTimeAsync(0)
    procs[0].say({ type: 'error', id: procs[0].asked[0].id, message: 'no such voice' })
    await expect(pending).rejects.toThrow('no such voice')
    // The engine itself is fine: it is kept.
    expect(procs[0].killed).toBe(false)
    w.stop()
  })

  it('reads answers split across chunks, and skips lines that are not JSON', async () => {
    const w = new SpeechWorker()
    await w.warm()
    procs[0].answer = false
    const pending = w.synthesize('split', '', 1)
    await vi.advanceTimersByTimeAsync(0)
    const id = procs[0].asked[0].id
    const line = JSON.stringify({ type: 'wav', id, data: Buffer.from('wav:split').toString('base64') })
    procs[0].stdout.emit('data', 'not json at all\r\n' + line.slice(0, 10))
    procs[0].stdout.emit('data', line.slice(10) + '\r\n')
    expect((await pending).toString()).toBe('wav:split')
    w.stop()
  })

  it('fails every waiting phrase when stopped', async () => {
    const w = new SpeechWorker()
    await w.warm()
    procs[0].answer = false
    const a = w.synthesize('a', '', 1)
    const b = w.synthesize('b', '', 1)
    await vi.advanceTimersByTimeAsync(0)
    w.stop()
    await expect(a).rejects.toThrow('Speech engine stopped')
    await expect(b).rejects.toThrow('Speech engine stopped')
    expect(procs[0].killed).toBe(true)
  })

  it('ignores the exit of a process it has already replaced', async () => {
    const w = new SpeechWorker()
    await w.warm()
    w.stop()
    await w.warm()
    // The old process's exit arrives after the new one started.
    procs[0].emit('exit', 1)
    expect(w.failed).toBe('')
    expect((await w.synthesize('still here', '', 1)).toString()).toBe('wav:still here')
    expect(spawn).toHaveBeenCalledTimes(2)
    w.stop()
  })
})
