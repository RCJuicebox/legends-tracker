import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArchiveOutcome } from '../../src/shared/runtime'
import type { ArchiveStatus, FeedItem } from '../../src/shared/types'

// The archiver itself runs for real on a scratch game folder while the game counts as closed; where
// the test needs what only a running game can cause (a deferral, a live handoff), its answer is
// given instead. The limit is a thousandth of a megabyte, so a small log is "large".
vi.mock('../../src/core/archiver', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/core/archiver')>()
  return { ...real, archiveLog: vi.fn(real.archiveLog) }
})
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const archiver = await import('../../src/core/archiver')
const realArchiveLog = (await vi.importActual<typeof import('../../src/core/archiver')>('../../src/core/archiver')).archiveLog
const { ArchiveManager, mb } = await import('../../src/main/archiveManager')
const { defaultSettings } = await import('../../src/main/storeCore')

const LIMIT_MB = 0.001
const line = (n: number) => `[Wed Sep 23 13:${String(n % 60).padStart(2, '0')}:00 2026] Tester says, 'line ${n}'\r\n`
const BIG = Array.from({ length: 40 }, (_, i) => line(i)).join('')
const SMALL = line(1)

let game: string
let logs: string
let running: boolean

function manager(o: { auto?: boolean; installDir?: string } = {}) {
  const statuses: ArchiveStatus[] = []
  const feed: { kind: FeedItem['kind']; text: string }[] = []
  const isGameRunning = vi.fn(async () => running)
  const m = new ArchiveManager({
    settings: () => ({ ...defaultSettings(), installDir: o.installDir ?? game, archive: { autoEnabled: o.auto ?? true, thresholdMB: LIMIT_MB, archiveDir: '' } }),
    isGameRunning,
    onStatus: (s) => statuses.push(s),
    feed: (kind, text) => feed.push({ kind, text })
  })
  return { m, statuses, feed, isGameRunning }
}

async function writeLog(name: string, text: string): Promise<string> {
  const p = join(logs, name)
  await fs.writeFile(p, text)
  return p
}

async function zips(): Promise<string[]> {
  return (await fs.readdir(join(logs, 'archive')).catch(() => [] as string[])).filter((n) => n.endsWith('.zip'))
}

beforeEach(async () => {
  game = mkdtempSync(join(tmpdir(), 'lt141-d-archive-'))
  logs = join(game, 'Logs')
  await fs.mkdir(logs)
  running = false
  vi.mocked(archiver.archiveLog).mockReset().mockImplementation(realArchiveLog)
})
afterEach(async () => {
  await fs.rm(game, { recursive: true, force: true })
})

describe('archiving logs past the size limit', () => {
  it('archives a log over the limit, and says so in the feed', async () => {
    const big = await writeLog('eqlog_Tester_testzone.txt', BIG)
    const { m, feed, statuses } = manager()
    await m.check()
    expect(existsSync(big)).toBe(false)
    expect(await zips()).toEqual(['eqlog_Tester_testzone_2026-09-23_to_2026-09-23.zip'])
    expect(feed[0]).toEqual({ kind: 'archive', text: `eqlog_Tester_testzone.txt is 0.0 MB, over the ${LIMIT_MB} MB limit.` })
    expect(feed[1].kind).toBe('archive')
    expect(feed[1].text).toMatch(/^Archived eqlog_Tester_testzone\.txt: 0\.0 MB → 0\.0 MB \(\d+% smaller\) as eqlog_Tester_testzone_2026-09-23_to_2026-09-23\.zip$/)
    expect(statuses.some((s) => s.busy)).toBe(true)
    expect(m.status.busy).toBe(false)
    expect(m.status.message).toBe(feed[1].text)
  })

  it('leaves a log under the limit alone', async () => {
    const small = await writeLog('eqlog_Tester_testzone.txt', SMALL)
    const { m, feed } = manager()
    await m.check()
    expect(existsSync(small)).toBe(true)
    expect(feed).toEqual([])
    expect(archiver.archiveLog).not.toHaveBeenCalled()
  })

  it('archives one log per check', async () => {
    await writeLog('eqlog_Tester_testzone.txt', BIG)
    await writeLog('eqlog_Other_testzone.txt', BIG)
    const { m } = manager()
    await m.check()
    expect(archiver.archiveLog).toHaveBeenCalledOnce()
    await m.check()
    expect(archiver.archiveLog).toHaveBeenCalledTimes(2)
    expect(await fs.readdir(logs)).toEqual(['archive'])
  })

  it('does nothing on its own when automatic archiving is off', async () => {
    const big = await writeLog('eqlog_Tester_testzone.txt', BIG)
    const { m } = manager({ auto: false })
    await m.check()
    expect(existsSync(big)).toBe(true)
    expect(archiver.archiveLog).not.toHaveBeenCalled()
  })

  it('does nothing before the game folder is known', async () => {
    const { m, isGameRunning } = manager({ installDir: '' })
    await m.check()
    expect(isGameRunning).not.toHaveBeenCalled()
  })

  it('keeps track of whether the game runs', async () => {
    const { m, statuses } = manager({ auto: false })
    running = true
    await m.check()
    expect(m.status.gameRunning).toBe(true)
    running = false
    await m.check()
    expect(m.status.gameRunning).toBe(false)
    expect(statuses.map((s) => s.gameRunning)).toEqual([true, false])
  })
})

describe('waiting for the game to exit', () => {
  it('waits for the game to exit when it keeps its log open, then archives it', async () => {
    const big = await writeLog('eqlog_Tester_testzone.txt', BIG)
    const held: ArchiveOutcome = {
      status: 'deferred',
      reason: 'held-open',
      message: 'The game keeps its log open while running, so the log was put back. It will be archived once the game closes.'
    }
    vi.mocked(archiver.archiveLog).mockResolvedValueOnce(held)
    running = true
    const { m, feed } = manager()
    await m.check()
    expect(m.status.pendingUntilGameExits).toEqual([big])
    expect(m.status.liveRotation).toBe('unsupported')
    expect(feed.at(-1)).toEqual({ kind: 'archive', text: held.message })

    // Still running: nothing is tried, not even the other large log.
    await writeLog('eqlog_Other_testzone.txt', BIG)
    await m.check()
    expect(archiver.archiveLog).toHaveBeenCalledOnce()

    running = false
    await m.check()
    expect(archiver.archiveLog).toHaveBeenCalledTimes(2)
    expect(vi.mocked(archiver.archiveLog).mock.calls[1][0]).toBe(big)
    expect(existsSync(big)).toBe(false)
    expect(m.status.pendingUntilGameExits).toEqual([])
    expect(feed.at(-1)!.text).toMatch(/^Archived eqlog_Tester_testzone\.txt/)
  })

  it('skips only the locked log while the game runs, where the game is known to hand logs off', async () => {
    const tester = await writeLog('eqlog_Tester_testzone.txt', BIG)
    const other = await writeLog('eqlog_Other_testzone.txt', SMALL)
    vi.mocked(archiver.archiveLog).mockResolvedValueOnce({
      status: 'deferred',
      reason: 'locked',
      message: 'The game has the log locked. It will be archived once the game closes.'
    })
    running = true
    const { m } = manager()
    await m.check()
    expect(m.status.pendingUntilGameExits).toEqual([tester])
    expect(m.status.liveRotation).toBe('unknown')

    // The other log grows past the limit: it is tried; the locked one is not tried again yet.
    await fs.writeFile(other, BIG)
    vi.mocked(archiver.archiveLog).mockResolvedValueOnce({
      status: 'archived',
      zipPath: join(logs, 'archive', 'x.zip'),
      originalBytes: 2 * 1048576,
      zipBytes: 1048576,
      liveHandoff: true
    })
    await m.check()
    expect(vi.mocked(archiver.archiveLog).mock.calls.map((c) => c[0])).toEqual([tester, other])
    expect(m.status.liveRotation).toBe('supported')
    expect(m.status.pendingUntilGameExits).toEqual([tester])
    expect(m.status.message).toBe('Archived eqlog_Other_testzone.txt: 2.0 MB → 1.0 MB (50% smaller) as x.zip')
  })

  it('stops waiting on a deferred log deleted by hand, and judges a new file at its path by size', async () => {
    const big = await writeLog('eqlog_Tester_testzone.txt', BIG)
    vi.mocked(archiver.archiveLog).mockResolvedValueOnce({ status: 'deferred', reason: 'locked', message: 'locked' })
    running = true
    const { m } = manager()
    await m.check()
    expect(m.status.pendingUntilGameExits).toEqual([big])

    await fs.rm(big)
    await m.check()
    expect(m.status.pendingUntilGameExits).toEqual([])

    // The game starts a fresh, small log at the same path; after it exits, that log is left alone.
    await writeLog('eqlog_Tester_testzone.txt', SMALL)
    running = false
    await m.check()
    expect(archiver.archiveLog).toHaveBeenCalledOnce()
    expect(existsSync(big)).toBe(true)
    expect(await zips()).toEqual([])
  })

  it('reports a failure as a warning, and stops waiting on that log', async () => {
    const big = await writeLog('eqlog_Tester_testzone.txt', BIG)
    vi.mocked(archiver.archiveLog)
      .mockResolvedValueOnce({ status: 'deferred', reason: 'locked', message: 'locked' })
      .mockResolvedValueOnce({ status: 'failed', message: 'the disk is full' })
    running = true
    const { m, feed } = manager()
    await m.check()
    running = false
    await m.check()
    expect(feed.at(-1)).toEqual({ kind: 'warn', text: 'the disk is full' })
    expect(m.status.pendingUntilGameExits).toEqual([])
    expect(existsSync(big)).toBe(true)
  })
})

describe('archiving a log by hand', () => {
  it('refuses anything that is not a character log in the game’s Logs folder', async () => {
    const elsewhere = join(game, 'eqlog_Tester_testzone.txt')
    await fs.writeFile(elsewhere, BIG)
    const notALog = await writeLog('notes.txt', BIG)
    const { m } = manager()
    for (const p of [elsewhere, notALog, '']) {
      const out = await m.archiveNow(p)
      expect(out.status).toBe('failed')
    }
    expect(archiver.archiveLog).not.toHaveBeenCalled()
    expect(existsSync(elsewhere) && existsSync(notALog)).toBe(true)
  })

  it('refuses a second archive while one is running', async () => {
    const tester = await writeLog('eqlog_Tester_testzone.txt', BIG)
    const other = await writeLog('eqlog_Other_testzone.txt', BIG)
    let finish!: (o: ArchiveOutcome) => void
    vi.mocked(archiver.archiveLog).mockImplementationOnce(() => new Promise((r) => (finish = r)))
    const { m } = manager()
    const first = m.archiveNow(tester)
    expect(await m.archiveNow(other)).toEqual({ status: 'failed', message: 'An archive is already in progress.' })
    finish({ status: 'failed', message: 'stopped' })
    await first
    expect(m.status.busy).toBe(false)
  })

  it('turns an archiver that throws into a failed outcome, and is free again after', async () => {
    const tester = await writeLog('eqlog_Tester_testzone.txt', BIG)
    vi.mocked(archiver.archiveLog).mockRejectedValueOnce(new Error('boom'))
    const { m, feed } = manager()
    expect(await m.archiveNow(tester)).toEqual({ status: 'failed', message: 'Archiving eqlog_Tester_testzone.txt failed: boom' })
    expect(feed.at(-1)).toEqual({ kind: 'warn', text: 'Archiving eqlog_Tester_testzone.txt failed: boom' })
    expect(m.status.busy).toBe(false)
  })
})

describe('finishing an interrupted archive', () => {
  it('zips a log the app had moved aside before it closed', async () => {
    const archiveDir = join(logs, 'archive')
    await fs.mkdir(archiveDir)
    await fs.writeFile(join(archiveDir, '.staging-eqlog_Tester_testzone-1727000000000.txt'), BIG)
    const { m, feed } = manager()
    await m.resumeStaging()
    expect(await fs.readdir(archiveDir)).toEqual(['eqlog_Tester_testzone_2026-09-23_to_2026-09-23.zip'])
    expect(feed.at(-1)!.text).toMatch(/^Archived eqlog_Tester_testzone\.txt/)
    expect(m.status.busy).toBe(false)
  })
})

describe('sizes in the archive messages', () => {
  it('shows one decimal under 10 MB and whole megabytes above', () => {
    expect(mb(1.5 * 1048576)).toBe('1.5 MB')
    expect(mb(150 * 1048576)).toBe('150 MB')
  })
})
