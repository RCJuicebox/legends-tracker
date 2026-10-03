import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flushLog, initLog, log, logDir } from '../../src/main/log'

/** A file the log writes, once what it holds back is written. */
const readFlushed = async (path: string, enc: BufferEncoding) => {
  await flushLog()
  return readFileSync(path, enc)
}

// The log module keeps its folder in module state; every test here that names one names its own.
const root = mkdtempSync(join(tmpdir(), 'lt-log-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
afterEach(() => vi.restoreAllMocks())

const TWO_MB = 2 * 1024 * 1024
let n = 0
const freshDir = () => join(root, `logs-${++n}`)

describe('the diagnostic log', () => {
  it('has no folder and writes to the console until it is given one', async () => {
    expect(logDir()).toBe('')
    const out = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    log.info('starting up')
    log.warn('a warning')
    expect(out).toHaveBeenCalledOnce()
    expect(String(out.mock.calls[0][0])).toMatch(/ INFO  starting up$/)
    expect(err).toHaveBeenCalledOnce()
    expect(String(err.mock.calls[0][0])).toMatch(/ WARN  a warning$/)
  })

  it('makes its folder and appends lines stamped in local time with its offset', async () => {
    const dir = freshDir()
    initLog(dir)
    expect(logDir()).toBe(dir)
    log.info('one', 2, { three: 3 })
    log.error(new Error('broke'))
    const lines = (await readFlushed(join(dir, 'main.log'), 'utf8')).split('\n')
    // Local time, as the game's own log is: a line here and one there can be matched by eye.
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} [+-]\d\d:\d\d INFO  one 2 \{"three":3\}$/)
    expect(lines[1]).toMatch(/ ERROR Error: broke$/)
  })

  it('does not roll over short of 2 MB', async () => {
    const dir = freshDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'main.log'), 'x'.repeat(TWO_MB - 100))
    initLog(dir)
    log.info('still the same file')
    expect((await flushLog(), existsSync(join(dir, 'main.old.log')))).toBe(false)
    expect(await readFlushed(join(dir, 'main.log'), 'utf8')).toMatch(/still the same file\n$/)
  })

  it('rolls main.log over to main.old.log once a line would take it past 2 MB', async () => {
    const dir = freshDir()
    mkdirSync(dir, { recursive: true })
    const big = 'x'.repeat(TWO_MB + 1)
    writeFileSync(join(dir, 'main.log'), big)
    initLog(dir)
    log.warn('after the roll')
    expect(await readFlushed(join(dir, 'main.old.log'), 'utf8')).toBe(big)
    expect(await readFlushed(join(dir, 'main.log'), 'utf8')).toMatch(/^\S+ \S+ \S+ WARN  after the roll\n$/)
  })

  it('keeps two old logs: a third roll drops the oldest', async () => {
    const dir = freshDir()
    mkdirSync(dir, { recursive: true })
    const roll = async (fill: string, line: string) => {
      writeFileSync(join(dir, 'main.log'), fill.repeat(TWO_MB + 1))
      initLog(dir)
      log.info(line)
      await flushLog()
    }
    await roll('a', 'first roll')
    await roll('b', 'second roll')
    await roll('c', 'third roll')
    expect((await readFlushed(join(dir, 'main.old.log'), 'utf8')).startsWith('c')).toBe(true)
    expect((await readFlushed(join(dir, 'main.old2.log'), 'utf8')).startsWith('b')).toBe(true)
    expect(await readFlushed(join(dir, 'main.log'), 'utf8')).toMatch(/third roll\n$/)
  })

  it('writes a line that comes again and again once, then how many more times', async () => {
    const dir = freshDir()
    initLog(dir)
    for (let i = 0; i < 5; i++) log.warn('Page overlay.html: the same warning')
    log.info('something else')
    const lines = (await readFlushed(join(dir, 'main.log'), 'utf8')).trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/WARN  Page overlay\.html: the same warning$/)
    expect(lines[1]).toMatch(/WARN  \(the line above 4 more times\)$/)
    expect(lines[2]).toMatch(/INFO  something else$/)
  })

  it('keeps writing past 2 MB when the roll-over fails, and says so once (LT-435)', async () => {
    const dir = freshDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'main.log'), 'x'.repeat(TWO_MB + 1))
    // A folder in main.old2.log's place cannot be cleared, as a held file could not be.
    mkdirSync(join(dir, 'main.old2.log', 'held'), { recursive: true })
    initLog(dir)
    log.info('first after')
    await flushLog()
    log.info('second after')
    const text = await readFlushed(join(dir, 'main.log'), 'utf8')
    expect(text).toMatch(/first after\n.*second after\n$/s)
    expect(text.match(/could not be rolled over/g)).toHaveLength(1)
  })

  it('falls back to the console when its folder cannot be made', async () => {
    // A folder under a file cannot exist.
    const blocker = join(root, `blocker-${++n}`)
    writeFileSync(blocker, '')
    const dir = join(blocker, 'logs')
    initLog(dir)
    const out = vi.spyOn(console, 'log').mockImplementation(() => {})
    log.info('nowhere to write')
    expect(out).toHaveBeenCalledOnce()
    expect(existsSync(join(dir, 'main.log'))).toBe(false)
  })
})
