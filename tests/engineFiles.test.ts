import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { readLines } from '../src/main/moteHistory'
import { offsetBefore } from '../src/main/sources/logHistory'
import { lastZone, lastZoneLine } from '../src/main/game'
import { readAasFromLog } from '../src/main/stats'
import type { LogLine } from '../src/core/logLine'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lt-files-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('readLines', () => {
  const text = '[Thu Sep 24 16:00:00 2026] one\r\n[Thu Sep 24 16:00:01 2026] two'

  it('hands over a last line with no newline, and counts its bytes', async () => {
    const got: LogLine[] = []
    const end = await readLines(Readable.from([Buffer.from(text.slice(0, 20)), Buffer.from(text.slice(20))]), (l) => got.push(l))
    expect(got.map((l) => l.text)).toEqual(['one', 'two'])
    expect(end).toBe(text.length)
  })

  it('holds it back when asked, stopping at the end of the last whole line', async () => {
    const got: LogLine[] = []
    const end = await readLines(Readable.from([Buffer.from(text)]), (l) => got.push(l), { flushLast: false })
    expect(got.map((l) => l.text)).toEqual(['one'])
    expect(end).toBe(text.indexOf('\n') + 1)
  })
})

describe('offsetBefore', () => {
  it('finds a line older than the time asked for, reading back from the end', async () => {
    const path = join(dir, 'eqlog_A_b.txt')
    const lines = Array.from({ length: 200 }, (_, i) => `[Thu Sep 24 16:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')} 2026] line ${i}\r\n`)
    await fs.writeFile(path, lines.join(''))
    const at = await offsetBefore(path, new Date(2026, 8, 24, 16, 2, 30).getTime(), { step: 256 })
    const rest = (await fs.readFile(path, 'latin1')).slice(at)
    expect(rest.startsWith('[')).toBe(true)
    const first = Number(/line (\d+)/.exec(rest)![1])
    expect(first).toBeLessThan(150)
    expect(first).toBeGreaterThan(100)
    expect(await offsetBefore(path, 0, { step: 256 })).toBe(0)
  })

  it('finds it within a look of the first newer line in a big log, and never after one', async () => {
    const path = join(dir, 'eqlog_A_b.txt')
    // Three hours a line a second, some 150 KB; looks of 1 KB.
    const at = (i: number) => new Date(2026, 8, 24, 13, 0, i)
    const stamp = (d: Date) =>
      d
        .toString()
        .slice(0, 24)
        .replace(/^(\w+) (\w+) (\d+) (\d+) ([\d:]+)$/, '$1 $2 $3 $5 $4')
    const lines = Array.from({ length: 3 * 3600 }, (_, i) => `[${stamp(at(i))}] You feel better. ${i}\r\n`)
    const text = lines.join('')
    await fs.writeFile(path, text)
    for (const i of [1, 500, 5000, 10_799]) {
      const off = await offsetBefore(path, at(i).getTime(), { step: 1024 })
      const first = Number(/better\. (\d+)/.exec(text.slice(off))![1])
      expect(first, `line ${i}`).toBeLessThan(i)
      expect(i - first, `line ${i}`).toBeLessThanOrEqual(1024 / 40 + 2)
    }
    // Slack reaches back as asked.
    const withSlack = await offsetBefore(path, at(7200).getTime(), { step: 1024, slackMs: 3600_000 })
    expect(Number(/better\. (\d+)/.exec(text.slice(withSlack))![1])).toBeLessThan(3600)
    // A time after every line: the start of a line near the end.
    const end = await offsetBefore(path, at(20_000).getTime(), { step: 1024 })
    expect(text.length - end).toBeLessThan(1024 + 60)
  })

  it('reads on past a look that holds no whole line, going earlier rather than missing one', async () => {
    const path = join(dir, 'eqlog_A_b.txt')
    const long = 'x'.repeat(600)
    const lines = Array.from({ length: 60 }, (_, i) => `[Thu Sep 24 16:00:${String(i).padStart(2, '0')} 2026] ${long} ${i}\r\n`)
    await fs.writeFile(path, lines.join(''))
    // Looks of 256 bytes are shorter than a line: none is ever read whole, so the search ends at 0.
    expect(await offsetBefore(path, new Date(2026, 8, 24, 16, 0, 40).getTime(), { step: 256 })).toBe(0)
  })
})

describe('lastZone', () => {
  it('finds a zone line that straddles two chunks', async () => {
    const path = join(dir, 'eqlog_A_b.txt')
    const filler = '[Thu Sep 24 16:00:01 2026] You feel better.\r\n'.repeat(3)
    await fs.writeFile(path, '[Thu Sep 24 16:00:00 2026] You have entered The Plane of Fear 4 (Refined).\r\n' + filler)
    // Small chunks, so the zone line is cut across several of them.
    expect(await lastZone(path, 16)).toBe('The Plane of Fear 4 (Refined)')
    expect(await lastZone(path)).toBe('The Plane of Fear 4 (Refined)')
    // Before an offset: the zone as it was there.
    const later = '[Thu Sep 24 16:00:02 2026] You have entered Neriak - Commons.\r\n'
    await fs.appendFile(path, later)
    const size = (await fs.stat(path)).size
    expect(await lastZone(path)).toBe('Neriak - Commons')
    expect((await lastZoneLine(path, { step: 16, end: size - later.length }))?.text).toBe('You have entered The Plane of Fear 4 (Refined).')
  })

  it('passes over arenas', async () => {
    const path = join(dir, 'eqlog_A_b.txt')
    await fs.writeFile(path, '[Thu Sep 24 16:00:00 2026] You have entered Neriak.\r\n[Thu Sep 24 16:00:05 2026] You have entered an Arena (PvP) area.\r\n')
    expect(await lastZone(path, 16)).toBe('Neriak')
  })
})

describe('readAasFromLog', () => {
  it('stops widening at the cap and reports not found', async () => {
    const path = join(dir, 'eqlog_A_b.txt')
    const dump = '[Sat Sep 12 16:23:16 2026] Ability #33: Combat Stability\r\n'
    const filler = '[Sat Sep 12 16:30:00 2026] You feel better.\r\n'.repeat(100)
    await fs.writeFile(path, dump + filler)
    expect(await readAasFromLog(path, { firstSpan: 256, maxSpan: 1024 })).toBeNull()
    expect((await readAasFromLog(path, { firstSpan: 256 }))?.abilities.map((a) => a.name)).toEqual(['Combat Stability'])
  })
})
