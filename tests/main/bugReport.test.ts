import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yauzl from 'yauzl'
import { describe, expect, it, vi } from 'vitest'
import { tempDir } from '../tempDir'

// "Save bug report…" (FEAT-039): the zip's files, with the names in them swapped. The names are made up.

const h = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => join(h.dir, 'crash'), getVersion: () => '9.9.9', isPackaged: false } }))
vi.mock('../../src/main/diagnostics', () => ({ diagnostics: () => 'Character Quixly_neriak: level 50' }))
vi.mock('../../src/main/log', () => ({ logDir: () => join(h.dir, 'logs') }))

/** Each file in a zip, as text. */
function unzip(file: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const out: Record<string, string> = {}
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err)
      zip.on('end', () => resolve(out))
      zip.on('entry', (e: yauzl.Entry) =>
        zip.openReadStream(e, (e2, s) => {
          if (e2 || !s) return reject(e2)
          const parts: Buffer[] = []
          s.on('data', (c: Buffer) => parts.push(c))
          s.on('end', () => {
            out[e.fileName] = Buffer.concat(parts).toString('utf8')
            zip.readEntry()
          })
        })
      )
      zip.readEntry()
    })
  })
}

describe('saveBugReport', () => {
  it('zips the diagnostics, logs, settings and the end of the game log, every name swapped', async () => {
    h.dir = tempDir('lt-bug-')
    const game = join(h.dir, 'game')
    mkdirSync(join(game, 'Logs'), { recursive: true })
    mkdirSync(join(h.dir, 'logs'))
    mkdirSync(join(h.dir, 'crash', 'reports'), { recursive: true })
    const logFile = join(game, 'Logs', 'eqlog_Quixly_neriak.txt')
    writeFileSync(logFile, ["[Mon Oct 19 20:00:00 2026] Vandrel tells you, 'my secret'", '[Mon Oct 19 20:00:01 2026] You hit a gnoll for 12 points of damage.'].join('\n'))
    writeFileSync(join(h.dir, 'logs', 'main.log'), `INFO Watching ${logFile}`)
    writeFileSync(join(h.dir, 'schema.json'), '{"settings.json":3}')
    writeFileSync(join(h.dir, 'crash', 'reports', 'a.dmp'), 'dump')
    const ctx = {
      store: { dir: h.dir, settings: { get: () => ({ logFile, installDir: game }) }, buffs: { get: () => ({ people: { ostrevan: {} } }) } }
    }
    const { saveBugReport } = await import('../../src/main/bugReport')
    const file = join(h.dir, 'report.zip')
    expect(await saveBugReport(ctx as never, file)).toEqual({ names: 3 })
    const files = await unzip(file)
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'crash.dmp', 'diagnostics.txt', 'log-tail.txt', 'main.log', 'schema.json', 'settings.json'])
    const all = Object.values(files).join('\n')
    for (const name of ['Quixly', 'Vandrel', 'my secret']) expect(all).not.toContain(name)
    expect(files['diagnostics.txt']).toMatch(/^Character [A-Z][a-z]+_neriak: level 50$/)
    expect(files['log-tail.txt']).toContain("tells you, '…'")
    expect(files['schema.json']).toBe('{"settings.json":3}')
  })
})
