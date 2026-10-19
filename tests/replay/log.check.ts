import { it } from 'vitest'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { LogClock } from '../../src/core/logLine'
import { characterKey, characterName } from '../../src/main/storeCore'
import { loadSpellBook } from '../../src/main/game'
import { DEFAULT_CHARACTER, type AppSettings } from '../../src/shared/types'
import { ReplayCheck, reportText } from './replayCheck'

// npm run replay: the player's log, as Settings names it, read through the live parts, and the report
// written to replay/ (FEAT-019). Read only, never in CI: the log is the player's.
//   LT_REPLAY_LOG   another log than the one followed
//   LT_REPLAY_MB    how much of the log's end to read (default 50; 0 for all of it)
//   LT_TRACE        print how each timer of a spell whose name holds this text ended ("Puma")

it('replays the log', async () => {
  const profile = process.env['LT_REPLAY_PROFILE'] ?? join(process.env['APPDATA'] ?? '', 'Legends Tracker')
  const read = (f: string) => (existsSync(join(profile, f)) ? JSON.parse(readFileSync(join(profile, f), 'utf8')) : null)
  const settings = read('settings.json') as AppSettings | null
  const log = process.env['LT_REPLAY_LOG'] ?? settings?.logFile ?? ''
  if (!log || !existsSync(log) || !settings?.installDir) throw new Error(`No log to replay: set LT_REPLAY_LOG, or a game folder and log in the app (${profile}).`)
  const book = await loadSpellBook(settings.installDir)
  const key = characterKey(log)
  const check = new ReplayCheck(book, {
    character: settings.characters?.[key] ?? DEFAULT_CHARACTER,
    self: characterName(log),
    rules: read('spell-rules.json') ?? {},
    tracking: settings.tracking
  })
  const mb = Number(process.env['LT_REPLAY_MB'] ?? 50)
  const size = statSync(log).size
  const start = mb > 0 ? Math.max(0, size - mb * 1048576) : 0
  const clock = new LogClock()
  const rl = createInterface({ input: createReadStream(log, { encoding: 'latin1', start }), crlfDelay: Infinity })
  let first = start > 0
  for await (const raw of rl) {
    if (first) {
      first = false
      continue
    }
    const line = clock.parse(raw)
    if (line) check.line(line)
  }
  const report = check.report()
  const dir = join(__dirname, '..', '..', 'replay')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, `${basename(log, '.txt')}-${new Date().toISOString().slice(0, 10)}.md`)
  writeFileSync(out, reportText(report, basename(log)))
  process.stdout.write(
    `Replay check: ${report.lines.toLocaleString()} lines; ${report.fades.length} spells timed, ${report.fadesNoTimer.length} with fades and no timer; report in ${out}\n`
  )
}, 3_600_000)
