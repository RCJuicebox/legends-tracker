import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initLog, log, logDir } from '../src/main/log'

// The log module keeps its folder in module state; every test here that names one names its own.
const root = mkdtempSync(join(tmpdir(), 'lt-log-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
afterEach(() => vi.restoreAllMocks())

const TWO_MB = 2 * 1024 * 1024
let n = 0
const freshDir = () => join(root, `logs-${++n}`)

describe('the diagnostic log', () => {
  it('has no folder and writes to the console until it is given one', () => {
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

  it('makes its folder and appends timestamped lines to main.log', () => {
    const dir = freshDir()
    initLog(dir)
    expect(logDir()).toBe(dir)
    log.info('one', 2, { three: 3 })
    log.error(new Error('broke'))
    const lines = readFileSync(join(dir, 'main.log'), 'utf8').split('\n')
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z INFO  one 2 \{"three":3\}$/)
    expect(lines[1]).toMatch(/ ERROR Error: broke$/)
  })

  it('does not roll over at exactly 2 MB', () => {
    const dir = freshDir()
    initLog(dir)
    writeFileSync(join(dir, 'main.log'), 'x'.repeat(TWO_MB))
    log.info('still the same file')
    expect(existsSync(join(dir, 'main.old.log'))).toBe(false)
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toMatch(/still the same file\n$/)
  })

  it('rolls main.log over to main.old.log once it is past 2 MB', () => {
    const dir = freshDir()
    initLog(dir)
    const big = 'x'.repeat(TWO_MB + 1)
    writeFileSync(join(dir, 'main.log'), big)
    log.warn('after the roll')
    expect(readFileSync(join(dir, 'main.old.log'), 'utf8')).toBe(big)
    const now = readFileSync(join(dir, 'main.log'), 'utf8')
    expect(now).toMatch(/^\S+ WARN  after the roll\n$/)
  })

  it('keeps only one old log: a second roll replaces the first', () => {
    const dir = freshDir()
    initLog(dir)
    writeFileSync(join(dir, 'main.log'), 'a'.repeat(TWO_MB + 1))
    log.info('first roll')
    writeFileSync(join(dir, 'main.log'), 'b'.repeat(TWO_MB + 1))
    log.info('second roll')
    const old = readFileSync(join(dir, 'main.old.log'), 'utf8')
    expect(old.startsWith('b')).toBe(true)
    expect(old).not.toContain('a')
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toMatch(/second roll\n$/)
  })

  it('falls back to the console when its folder cannot be made', () => {
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
