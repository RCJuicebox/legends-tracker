import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yauzl from 'yauzl'
import { decodeCp1252, parseLogLine } from '../src/core/logLine'
import { LogTailer } from '../src/core/tailer'
import { archiveLog, compressLoose } from '../src/core/archiver'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'eqlat-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('parseLogLine', () => {
  it('parses a space-padded day as local time', () => {
    const l = parseLogLine('[Thu Jul  9 08:01:02 2026] You have entered Neriak.')!
    expect(new Date(l.time)).toEqual(new Date(2026, 6, 9, 8, 1, 2))
    expect(l.text).toBe('You have entered Neriak.')
  })

  it('decodes Windows-1252, not UTF-8', () => {
    expect(decodeCp1252(Uint8Array.from([0x49, 0x6b, 0x73, 0x61, 0x72, 0x92, 0x73]))).toBe('Iksar’s')
  })
})

describe('LogTailer', () => {
  it('keeps one handle across reads, lets the archiver rename the log away, and follows the new file', async () => {
    const path = join(dir, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(path, '')
    const got: string[] = []
    const resets: string[] = []
    const t = new LogTailer(path, { startAtEnd: false, onLines: (l) => got.push(...l), onReset: (r) => resets.push(r) })
    await fs.appendFile(path, 'one\r\n')
    await t.readOnce()
    await fs.appendFile(path, 'two\r\n')
    await t.readOnce()
    // The handle is still open here, and the rename must succeed anyway.
    await fs.rename(path, join(dir, 'archived.txt'))
    await fs.writeFile(path, 'three\r\n')
    await t.readOnce()
    await t.readOnce()
    await t.release()
    expect(got).toEqual(['one', 'two', 'three'])
    expect(resets).toEqual(['replaced'])
  })

  it('holds partial lines, skips existing content at start, and survives truncation and replacement', async () => {
    const path = join(dir, 'eqlog_Test_x.txt')
    await fs.writeFile(path, 'old line\r\n')
    const got: string[] = []
    const resets: string[] = []
    const t = new LogTailer(path, { startAtEnd: true, onLines: (l) => got.push(...l), onReset: (r) => resets.push(r) })
    await t.readOnce()
    await fs.appendFile(path, 'first\r\nsec')
    await t.readOnce()
    expect(got).toEqual(['first'])
    await fs.appendFile(path, 'ond\r\n')
    await t.readOnce()
    expect(got).toEqual(['first', 'second'])

    await fs.writeFile(path, 'x\r\n')
    await t.readOnce()
    expect(resets).toEqual(['truncated'])
    expect(got.at(-1)).toBe('x')

    await fs.rename(path, join(dir, 'moved.txt'))
    await t.readOnce()
    await fs.writeFile(path, 'fresh file\r\n')
    await t.readOnce()
    expect(resets).toEqual(['truncated', 'replaced'])
    expect(got.at(-1)).toBe('fresh file')
  })
})

const LOG = [
  '[Tue Sep 01 12:15:08 2026] You begin casting Envenomed Bolt X.',
  '[Tue Sep 01 12:15:09 2026] Bazzt Zzzt has been poisoned.',
  '[Wed Sep 23 13:29:06 2026] You begin to snarl as your features become feline.'
].join('\r\n') + '\r\n'

async function unzipOnly(zipPath: string): Promise<{ name: string; text: string }> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err)
      zip.on('entry', (e: yauzl.Entry) =>
        zip.openReadStream(e, (e2, s) => {
          if (e2) return reject(e2)
          const parts: Buffer[] = []
          s.on('data', (c: Buffer) => parts.push(c))
          s.on('end', () => {
            zip.close()
            resolve({ name: e.fileName, text: Buffer.concat(parts).toString('latin1') })
          })
        })
      )
      zip.readEntry()
    })
  })
}

describe('archiveLog', () => {
  it('zips a log named by its date range, verifies it, and removes the original, when the game is closed', async () => {
    const log = join(dir, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(log, LOG)
    const out = await archiveLog(log, join(dir, 'archive'), { isGameRunning: async () => false })
    expect(out.status).toBe('archived')
    if (out.status !== 'archived') return
    expect(out.zipPath.endsWith('eqlog_Kelwyn_neriak_2026-09-01_to_2026-09-23.zip')).toBe(true)
    const entry = await unzipOnly(out.zipPath)
    expect(entry.name).toBe('eqlog_Kelwyn_neriak_2026-09-01_to_2026-09-23.txt')
    expect(entry.text).toBe(LOG)
    await expect(fs.access(log)).rejects.toThrow()
    expect((await fs.readdir(join(dir, 'archive'))).filter((f) => f.startsWith('.staging'))).toEqual([])
  })

  it('completes a live handoff once the game starts a fresh log at the old path', async () => {
    const log = join(dir, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(log, LOG)
    const pending = archiveLog(log, join(dir, 'archive'), { isGameRunning: async () => true, pollMs: 20 })
    await new Promise((r) => setTimeout(r, 60))
    await fs.writeFile(log, '[Wed Sep 23 13:40:00 2026] new session line\r\n')
    const out = await pending
    expect(out.status).toBe('archived')
    if (out.status === 'archived') expect(out.liveHandoff).toBe(true)
    expect(await fs.readFile(log, 'latin1')).toContain('new session line')
  })

  it('puts the log back and defers when the game keeps writing through its old handle', async () => {
    const log = join(dir, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(log, LOG)
    const handle = await fs.open(log, 'a')
    const pending = archiveLog(log, join(dir, 'archive'), { isGameRunning: async () => true, pollMs: 20 })
    await new Promise((r) => setTimeout(r, 60))
    await handle.write('[Wed Sep 23 13:40:00 2026] written through the held handle\r\n')
    const out = await pending
    await handle.close()
    expect(out.status).toBe('deferred')
    const text = await fs.readFile(log, 'latin1')
    expect(text.startsWith(LOG)).toBe(true)
    expect(text).toContain('written through the held handle')
  })

  it('compresses a loose text archive in place', async () => {
    const loose = join(dir, 'eqlog_Kelwyn_neriak_thru-2026-08-07.txt')
    await fs.writeFile(loose, LOG)
    const out = await compressLoose(loose, { isGameRunning: async () => false })
    expect(out.status).toBe('archived')
    expect(await fs.readdir(dir)).toEqual(['eqlog_Kelwyn_neriak_thru-2026-08-07.zip'])
  })
})
