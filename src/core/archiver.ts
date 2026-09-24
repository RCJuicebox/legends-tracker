import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { crc32 } from 'node:zlib'
import yazl from 'yazl'
import yauzl from 'yauzl'
import { parseLogLine } from './logLine'

export type ArchiveOutcome =
  | { status: 'archived'; zipPath: string; originalBytes: number; zipBytes: number; liveHandoff: boolean }
  | { status: 'deferred'; reason: 'locked' | 'held-open'; message: string }
  | { status: 'failed'; message: string }

export interface ArchiverDeps {
  isGameRunning: () => Promise<boolean>
  pollMs?: number
  progress?: (message: string) => void
  signal?: AbortSignal
}

const STAGING_PREFIX = '.staging-'

/**
 * Archives a character log: moves it aside, zips it, verifies the zip, and only then deletes the
 * uncompressed copy.
 *
 * Moving the log while the game runs is safe only if the game reopens its log by name rather than
 * writing through a handle it keeps. The archiver does not assume either — it watches what happens:
 *
 * - the rename fails → the game has the file locked; nothing moved; try again after the game exits.
 * - the game creates a fresh log at the old path → it reopens by name; the moved file is complete.
 * - the moved file keeps growing → the game still writes through its old handle; the file is moved
 *   straight back, so the game carries on in the same file, and archiving waits for the game to exit.
 * - the game exits → the moved file is complete.
 *
 * No path loses a line.
 */
export async function archiveLog(logPath: string, archiveDir: string, deps: ArchiverDeps): Promise<ArchiveOutcome> {
  await fs.mkdir(archiveDir, { recursive: true })
  const staging = join(archiveDir, `${STAGING_PREFIX}${basename(logPath, '.txt')}-${Date.now()}.txt`)
  try {
    await fs.rename(logPath, staging)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      return { status: 'deferred', reason: 'locked', message: 'The game has the log locked. It will be archived once the game closes.' }
    }
    return { status: 'failed', message: (e as Error).message }
  }
  return finishStaged(staging, logPath, archiveDir, deps)
}

/** Completes an archive whose log has already been moved to `staging`, including one left by an earlier run. */
export async function finishStaged(staging: string, logPath: string, archiveDir: string, deps: ArchiverDeps): Promise<ArchiveOutcome> {
  let liveHandoff = false
  if (await deps.isGameRunning()) {
    deps.progress?.('Log moved aside. Waiting for the game to write its next line, to confirm it starts a new file.')
    const pollMs = deps.pollMs ?? 500
    let last = await sizeOf(staging)
    let gameCheck = 0
    for (;;) {
      if (deps.signal?.aborted) return { status: 'deferred', reason: 'held-open', message: 'Stopped before the handoff was confirmed; it resumes next start.' }
      await sleep(pollMs)
      if (await exists(logPath)) {
        await waitStable(staging, pollMs)
        liveHandoff = true
        break
      }
      const now = await sizeOf(staging)
      if (now > last) {
        // Still being written through the old handle: put it back where the game expects it.
        try {
          await fs.rename(staging, logPath)
        } catch (e) {
          return { status: 'failed', message: `The game kept writing to the moved log and it could not be moved back: ${(e as Error).message}. It is at ${staging}.` }
        }
        return { status: 'deferred', reason: 'held-open', message: 'The game keeps its log open while running, so the log was put back. It will be archived once the game closes.' }
      }
      last = now
      if (++gameCheck % 10 === 0 && !(await deps.isGameRunning())) break
    }
  }
  return zipAndVerify(staging, logPath, archiveDir, liveHandoff, deps)
}

async function zipAndVerify(staging: string, logPath: string, archiveDir: string, liveHandoff: boolean, deps: ArchiverDeps): Promise<ArchiveOutcome> {
  const originalBytes = await sizeOf(staging)
  const stem = await archiveStem(staging, basename(logPath, '.txt'))
  const zipPath = await uniquePath(archiveDir, stem, '.zip')
  deps.progress?.(`Compressing ${(originalBytes / 1048576).toFixed(0)} MB…`)
  try {
    const written = await zipFile(staging, zipPath, `${stem}.txt`)
    deps.progress?.('Verifying the archive…')
    const read = await readZipEntryCrc(zipPath)
    if (read.crc !== written.crc || read.size !== written.size || written.size !== originalBytes) {
      throw new Error('the archive did not read back identically')
    }
  } catch (e) {
    await fs.rm(zipPath, { force: true })
    return { status: 'failed', message: `Archiving failed (${(e as Error).message}). The log is untouched at ${staging}.` }
  }
  await fs.unlink(staging)
  return { status: 'archived', zipPath, originalBytes, zipBytes: await sizeOf(zipPath), liveHandoff }
}

/** Zips a loose `.txt` log already sitting in the archive folder. */
export async function compressLoose(txtPath: string, deps: ArchiverDeps): Promise<ArchiveOutcome> {
  const dir = dirname(txtPath)
  const stem = basename(txtPath, '.txt')
  const zipPath = await uniquePath(dir, stem, '.zip')
  const originalBytes = await sizeOf(txtPath)
  deps.progress?.(`Compressing ${basename(txtPath)}…`)
  try {
    const written = await zipFile(txtPath, zipPath, `${stem}.txt`)
    const read = await readZipEntryCrc(zipPath)
    if (read.crc !== written.crc || read.size !== originalBytes) throw new Error('the archive did not read back identically')
  } catch (e) {
    await fs.rm(zipPath, { force: true })
    return { status: 'failed', message: `Compressing ${basename(txtPath)} failed: ${(e as Error).message}` }
  }
  await fs.unlink(txtPath)
  return { status: 'archived', zipPath, originalBytes, zipBytes: await sizeOf(zipPath), liveHandoff: false }
}

export async function findStaging(archiveDir: string): Promise<string[]> {
  try {
    return (await fs.readdir(archiveDir)).filter((f) => f.startsWith(STAGING_PREFIX)).map((f) => join(archiveDir, f))
  } catch {
    return []
  }
}

/** `.staging-eqlog_Kelwyn_neriak-1727000000000.txt` → `eqlog_Kelwyn_neriak.txt` */
export function stagingOriginalName(stagingPath: string): string {
  return basename(stagingPath).slice(STAGING_PREFIX.length).replace(/-\d+\.txt$/, '.txt')
}

function zipFile(src: string, zipPath: string, entryName: string): Promise<{ crc: number; size: number }> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    const input = createReadStream(src)
    const pass = new PassThrough()
    let crc = 0
    let size = 0
    input.on('data', (chunk) => {
      const b = chunk as Buffer
      crc = crc32(b, crc)
      size += b.length
    })
    input.on('error', reject)
    input.pipe(pass)
    zip.addReadStream(pass, entryName, { compress: true, compressionLevel: 6 })
    zip.end()
    const tmp = zipPath + '.partial'
    const out = createWriteStream(tmp)
    out.on('error', reject)
    out.on('close', () => {
      fs.rename(tmp, zipPath).then(() => resolve({ crc, size }), reject)
    })
    zip.outputStream.pipe(out)
  })
}

function readZipEntryCrc(zipPath: string): Promise<{ crc: number; size: number }> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('could not open archive'))
      zip.on('error', reject)
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return reject(e2 ?? new Error('could not read archive entry'))
          let crc = 0
          let size = 0
          stream.on('data', (c: Buffer) => {
            crc = crc32(c, crc)
            size += c.length
          })
          stream.on('error', reject)
          stream.on('end', () => {
            zip.close()
            resolve({ crc, size })
          })
        })
      })
      zip.readEntry()
    })
  })
}

/** `eqlog_Kelwyn_neriak_2026-08-07_to_2026-09-23`, from the log's first and last timestamps. */
async function archiveStem(path: string, fallback: string): Promise<string> {
  const handle = await fs.open(path, 'r')
  try {
    const size = (await handle.stat()).size
    const head = Buffer.alloc(Math.min(4096, size))
    await handle.read(head, 0, head.length, 0)
    const tail = Buffer.alloc(Math.min(8192, size))
    await handle.read(tail, 0, tail.length, Math.max(0, size - tail.length))
    const first = head.toString('latin1').split('\n').map((l) => parseLogLine(l.trim())).find(Boolean)
    const last = tail.toString('latin1').split('\n').reverse().map((l) => parseLogLine(l.trim())).find(Boolean)
    if (!first || !last) return `${fallback}_${ymd(Date.now())}`
    return `${fallback}_${ymd(first.time)}_to_${ymd(last.time)}`
  } finally {
    await handle.close()
  }
}

function ymd(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function uniquePath(dir: string, stem: string, ext: string): Promise<string> {
  for (let i = 1; ; i++) {
    const p = join(dir, i === 1 ? `${stem}${ext}` : `${stem}-${i}${ext}`)
    if (!(await exists(p))) return p
  }
}

async function waitStable(path: string, pollMs: number): Promise<void> {
  let prev = -1
  for (let i = 0; i < 20; i++) {
    const s = await sizeOf(path)
    if (s === prev) return
    prev = s
    await sleep(Math.max(pollMs, 500))
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function sizeOf(p: string): Promise<number> {
  try {
    return (await fs.stat(p)).size
  } catch {
    return 0
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
