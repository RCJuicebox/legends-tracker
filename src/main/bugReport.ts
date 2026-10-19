import { app } from 'electron'
import { createWriteStream, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import yazl from 'yazl'
import { anonymizer } from '../core/anonymize'
import { redact } from '../core/diagnosticsText'
import { diagnostics } from './diagnostics'
import { listLogs } from './game'
import { logDir } from './log'
import type { AppContext } from './context'

// "Save bug report…" (FEAT-039): one zip with what a bug report needs, the player and guild names in it
// swapped for the test characters' and the Windows user's folder taken out, ready to attach to an issue.

/** The watched log's lines put in: enough to see what led up to it. */
const LOG_LINES = 2000
/** Read from the end of the log for them: lines are rarely over 200 characters. */
const LOG_TAIL_BYTES = 600_000

/** The last `bytes` of a file as text, or '' when it cannot be read. */
async function tail(path: string, bytes: number): Promise<string> {
  try {
    const h = await fs.open(path, 'r')
    try {
      const { size } = await h.stat()
      const from = Math.max(0, size - bytes)
      const buf = Buffer.alloc(size - from)
      await h.read(buf, 0, buf.length, from)
      const text = buf.toString('latin1')
      // A cut first line is dropped.
      return from > 0 ? text.slice(text.indexOf('\n') + 1) : text
    } finally {
      await h.close()
    }
  } catch {
    return ''
  }
}

async function readText(path: string): Promise<string | null> {
  return fs.readFile(path, 'utf8').catch(() => null)
}

/** The newest crash dump Crashpad kept, if any. */
async function newestDump(): Promise<string | null> {
  try {
    const dir = join(app.getPath('crashDumps'), 'reports')
    const dumps = (await fs.readdir(dir)).filter((f) => f.endsWith('.dmp'))
    const stamped = await Promise.all(dumps.map(async (f) => ({ f, at: (await fs.stat(join(dir, f))).mtimeMs })))
    const newest = stamped.sort((a, b) => b.at - a.at)[0]
    return newest ? join(dir, newest.f) : null
  } catch {
    return null
  }
}

/** Writes the bug report zip to `file`; says how many names were swapped. */
export async function saveBugReport(ctx: AppContext, file: string): Promise<{ names: number }> {
  const settings = ctx.store.settings.get()
  const home = homedir()
  const logLines = (await tail(settings.logFile, LOG_TAIL_BYTES)).split(/\r?\n/).slice(-LOG_LINES)
  // Your characters and everyone /who showed, whatever the lines say; the lines give away the rest.
  const known = new Set<string>(Object.keys(ctx.store.buffs.get().people))
  if (settings.installDir) for (const l of await listLogs(settings.installDir).catch(() => [])) known.add(l.character.split('_')[0])
  const anon = anonymizer(known, logLines)
  const clean = (text: string) => anon.apply(redact(text, home))
  const zip = new yazl.ZipFile()
  const text = (name: string, body: string) => zip.addBuffer(Buffer.from(body, 'utf8'), name)
  text('diagnostics.txt', clean(diagnostics(ctx)))
  for (const name of ['main.log', 'main.old.log']) {
    const body = await readText(join(logDir(), name))
    if (body !== null) text(name, clean(body))
  }
  const schema = await readText(join(ctx.store.dir, 'schema.json'))
  if (schema !== null) text('schema.json', schema)
  text('settings.json', clean(JSON.stringify(settings, null, 2)))
  if (logLines.length > 1) text('log-tail.txt', clean(logLines.join('\n')))
  const dump = await newestDump()
  if (dump) zip.addFile(dump, 'crash.dmp')
  text(
    'README.txt',
    [
      `Legends Tracker ${app.getVersion()} bug report, ${new Date().toISOString()}.`,
      'Player and guild names are swapped for made-up ones (Kelwyn, Aldric, Brenna…) and what anyone said is cut;',
      'the Windows user folder reads %USERPROFILE%. No keys are in it: the Azure key is kept apart from the settings.'
    ].join('\n')
  )
  zip.end()
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(file)
    out.on('close', () => resolve())
    out.on('error', reject)
    zip.outputStream.on('error', reject).pipe(out)
  })
  return { names: anon.swaps.size }
}
