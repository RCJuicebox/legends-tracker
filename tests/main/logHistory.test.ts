import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yazl from 'yazl'
import { createWriteStream } from 'node:fs'
import { LogHistory, readBackward, type HistoryConsumer } from '../../src/main/sources/logHistory'
import { castCounter, dayConsumer, type Days } from '../../src/main/castHistory'
import { purchaseConsumer, PurchaseHistory } from '../../src/main/purchases'
import { fileIdentity, sameFile } from '../../src/core/fileIdentity'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lt-history-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const line = (stamp: string, text: string) => `[${stamp}] ${text}\r\n`

function zip(path: string, name: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const z = new yazl.ZipFile()
    z.addBuffer(Buffer.from(text, 'latin1'), name)
    z.end()
    z.outputStream.pipe(createWriteStream(path)).on('close', resolve).on('error', reject)
  })
}

describe('readBackward', () => {
  it('gives every line newest first with where it starts, across chunk edges', async () => {
    const path = join(dir, 'log.txt')
    const lines = ['first line', 'second, a longer line', '', 'fourth']
    const text = lines.join('\r\n') + '\r\n'
    await fs.writeFile(path, text)
    for (const step of [3, 7, 64]) {
      const seen: [string, number][] = []
      await readBackward(path, (raw, offset) => void seen.push([raw, offset]), { step })
      expect(seen.map(([raw]) => raw)).toEqual(['fourth', 'second, a longer line', 'first line'])
      for (const [raw, offset] of seen) expect(text.slice(offset, offset + raw.length)).toBe(raw)
    }
  })

  it('stops where asked, and at a byte limit without giving half a line', async () => {
    const path = join(dir, 'log.txt')
    await fs.writeFile(path, 'aaaa\nbbbb\ncccc\ndddd\n')
    const seen: string[] = []
    await readBackward(path, (raw) => void seen.push(raw), { step: 4, stopAt: 10 })
    expect(seen).toEqual(['dddd', 'cccc'])
    const limited: string[] = []
    await readBackward(path, (raw) => void limited.push(raw), { step: 4, maxBytes: 12 })
    expect(limited).toEqual(['dddd', 'cccc'])
  })
})

describe('file identity', () => {
  it('is unknown where the drive gives none, and then only shrinking means replaced', () => {
    expect(fileIdentity({ dev: 5n, ino: 0n })).toBe('')
    expect(fileIdentity({ dev: 5n, ino: 42n })).toBe('5:42')
    expect(sameFile({ id: '', size: 100 }, { id: '', size: 120 })).toBe(true)
    expect(sameFile({ id: '', size: 100 }, { id: '', size: 90 })).toBe(false)
    expect(sameFile({ id: '5:42', size: 100 }, { id: '5:43', size: 120 })).toBe(false)
  })
})

describe('LogHistory', () => {
  it('reads a log once for every consumer, archives included, and only new lines after', async () => {
    const logPath = join(dir, 'eqlog_Kelwyn_neriak.txt')
    const archiveDir = join(dir, 'archive')
    await fs.mkdir(archiveDir)
    await zip(
      join(archiveDir, 'eqlog_Kelwyn_neriak_2026-09-01_to_2026-09-10.zip'),
      'eqlog_Kelwyn_neriak.txt',
      line('Tue Sep 01 10:00:00 2026', 'You begin casting Odium.') + line('Tue Sep 01 10:01:00 2026', 'You purchased 5 Small Vial from Kizzie for 5 copper.')
    )
    await fs.writeFile(logPath, line('Thu Sep 24 16:00:00 2026', 'You begin casting Envenomed Bolt X.'))
    let reads = 0
    const counting: HistoryConsumer<Days> = {
      ...dayConsumer(castCounter),
      reader: () => {
        reads++
        return castCounter()
      }
    }
    const history = new LogHistory(join(dir, 'log-history.json'), { casts: counting, purchases: purchaseConsumer })
    const where = { logPath, archiveDir, stem: 'eqlog_Kelwyn_neriak' }

    const bought = await new PurchaseHistory(history, 'purchases').latest(where)
    expect(Object.keys(bought)).toEqual(['small vial'])
    const readsAfterFirst = reads
    // The casts were counted in the same pass: asking for them reads nothing new.
    const casts = await history.get<Days>('casts', where)
    expect(reads).toBe(readsAfterFirst)
    expect(casts.archives.map((a) => a.value)).toEqual([{ '2026-09-01': { Odium: 1 } }])
    expect(casts.live).toEqual({ '2026-09-24': { 'Envenomed Bolt X': 1 } })

    // Only what the live log gains is read again.
    await fs.appendFile(logPath, line('Thu Sep 24 16:00:30 2026', 'You begin casting Odium.'))
    expect((await history.get<Days>('casts', where)).live).toEqual({ '2026-09-24': { 'Envenomed Bolt X': 1, Odium: 1 } })
  })

  it('forgets an archive gone from the folder, and a live log nobody asked about for two months (LT-423)', async () => {
    const logPath = join(dir, 'eqlog_Kelwyn_neriak.txt')
    const archiveDir = join(dir, 'archive')
    const cacheFile = join(dir, 'log-history.json')
    await fs.mkdir(archiveDir)
    const archive = join(archiveDir, 'eqlog_Kelwyn_neriak_2026-09-01_to_2026-09-10.zip')
    await zip(archive, 'eqlog_Kelwyn_neriak.txt', line('Tue Sep 01 10:00:00 2026', 'You begin casting Odium.'))
    await fs.writeFile(logPath, line('Thu Sep 24 16:00:00 2026', 'You begin casting Odium.'))
    const where = { logPath, archiveDir, stem: 'eqlog_Kelwyn_neriak' }
    const history = new LogHistory(cacheFile, { casts: dayConsumer(castCounter) })
    expect((await history.get<Days>('casts', where)).archives).toHaveLength(1)
    await fs.rm(archive)
    expect((await history.get<Days>('casts', where)).archives).toHaveLength(0)
    await history.flush()
    const saved = JSON.parse(await fs.readFile(cacheFile, 'utf8'))
    expect(Object.keys(saved.archives)).toEqual([])
    // A live log last asked about long ago is gone at the next start.
    const key = Object.keys(saved.live)[0]
    saved.live[key].askedAt = Date.now() - 61 * 86_400_000
    saved.live['c:\\elsewhere\\eqlog_old_x.txt'] = { ...saved.live[key], askedAt: Date.now() - 61 * 86_400_000 }
    await fs.writeFile(cacheFile, JSON.stringify(saved))
    const again = new LogHistory(cacheFile, { casts: dayConsumer(castCounter) })
    await again.get<Days>('casts', where)
    await again.flush()
    expect(Object.keys(JSON.parse(await fs.readFile(cacheFile, 'utf8')).live)).toEqual([key])
  })

  it('drops what a consumer the app no longer has left in the cache', async () => {
    const logPath = join(dir, 'eqlog_Kelwyn_neriak.txt')
    const cacheFile = join(dir, 'log-history.json')
    const where = { logPath, archiveDir: join(dir, 'archive'), stem: 'eqlog_Kelwyn_neriak' }
    await fs.writeFile(logPath, line('Thu Sep 24 16:00:00 2026', 'You purchased 5 Small Vial from Kizzie for 5 copper.'))
    const first = new LogHistory(cacheFile, { casts: dayConsumer(castCounter), purchases: purchaseConsumer })
    await first.get('casts', where)
    // Written a while after a change, or at quit: not after every read.
    await expect(fs.readFile(cacheFile, 'utf8')).rejects.toThrow()
    await first.flush()
    expect(await fs.readFile(cacheFile, 'utf8')).toContain('"purchases"')

    // Purchases gone from the app: its values go with the next save.
    const history = new LogHistory(cacheFile, { casts: dayConsumer(castCounter) })
    await fs.appendFile(logPath, line('Thu Sep 24 16:00:30 2026', 'You begin casting Odium.'))
    expect((await history.get<Days>('casts', where)).live).toEqual({ '2026-09-24': { Odium: 1 } })
    await history.flush()
    const saved = await fs.readFile(cacheFile, 'utf8')
    expect(saved).toContain('"casts"')
    expect(saved).not.toContain('"purchases"')
  })

  it('reads the live log again only for a consumer new or bumped, the others counting on', async () => {
    const logPath = join(dir, 'eqlog_Kelwyn_neriak.txt')
    const cacheFile = join(dir, 'log-history.json')
    const where = { logPath, archiveDir: join(dir, 'archive'), stem: 'eqlog_Kelwyn_neriak' }
    await fs.writeFile(
      logPath,
      line('Thu Sep 24 16:00:00 2026', 'You begin casting Odium.') + line('Thu Sep 24 16:01:00 2026', 'You purchased 5 Small Vial from Kizzie for 5 copper.')
    )
    const counted = (seen: { n: number }): HistoryConsumer<Days> => ({
      ...dayConsumer(castCounter),
      reader: () => {
        const r = castCounter()
        return (l, into) => {
          seen.n++
          r(l, into)
        }
      }
    })
    const castsSeen = { n: 0 }
    const first = new LogHistory(cacheFile, { casts: counted(castsSeen), purchases: purchaseConsumer })
    await first.get('casts', where)
    await first.flush()
    expect(castsSeen.n).toBe(2)

    // Purchases bumped to a new version: it alone reads the log up to where the casts had got.
    castsSeen.n = 0
    const history = new LogHistory(cacheFile, { casts: counted(castsSeen), purchases: { ...purchaseConsumer, version: purchaseConsumer.version + 1 } })
    await fs.appendFile(logPath, line('Thu Sep 24 16:02:00 2026', 'You begin casting Odium.'))
    expect((await history.get<Days>('casts', where)).live).toEqual({ '2026-09-24': { Odium: 2 } })
    expect(castsSeen.n).toBe(1)
    expect(Object.keys(await new PurchaseHistory(history, 'purchases').latest(where))).toEqual(['small vial'])
  })
})
