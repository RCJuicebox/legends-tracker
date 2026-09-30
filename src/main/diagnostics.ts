import { app, BrowserWindow, screen } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { basename, join } from 'node:path'
import { logDir } from './log'
import { cacheDir } from './paths'
import { sources } from './sources/registry'
import { win32Available } from './win32'
import { characterKey } from './storeCore'
import type { AppContext } from './context'
import { redact, settingsSummary } from '../core/diagnosticsText'

// What a bug report needs, in one block of text the player can copy: the version, the machine, the
// settings that matter (no key, no Windows user name), what went wrong at start, and the end of the log.

/**
 * Memory and CPU by process: the main process, each window's renderer, the GPU. Working set is
 * what Task Manager shows as memory; the heap line is the main process's JavaScript alone.
 */
export function processMetrics(): string[] {
  const titles = new Map<number, string>()
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue
    const url = w.webContents.getURL()
    const page = url.split('/').pop()?.split('?')[0].replace('.html', '') ?? ''
    const id = new URL(url || 'file:///').searchParams.get('id')
    titles.set(w.webContents.getOSProcessId(), id ? `${page} ${id}` : page)
  }
  const mb = (kb: number) => `${Math.round(kb / 1024)} MB`
  const rows = app.getAppMetrics().map((m) => {
    const what = m.type === 'Tab' ? (titles.get(m.pid) ?? 'window') : m.type === 'Browser' ? 'main' : m.type.toLowerCase()
    return `  ${what.padEnd(20)} ${mb(m.memory.workingSetSize).padStart(7)}  cpu ${m.cpu.percentCPUUsage.toFixed(1)}%`
  })
  const total = app.getAppMetrics().reduce((n, m) => n + m.memory.workingSetSize, 0)
  const heap = process.memoryUsage()
  return [`Processes (${mb(total)} in all; main heap ${Math.round(heap.heapUsed / 1048576)} of ${Math.round(heap.heapTotal / 1048576)} MB):`, ...rows]
}

/** The last `n` lines of the diagnostic log. */
function logTail(n: number): string {
  try {
    const lines = readFileSync(join(logDir(), 'main.log'), 'utf8').trimEnd().split('\n')
    return lines.slice(-n).join('\n')
  } catch {
    return '(no log yet)'
  }
}

/** Each monitor: where it is, its size and its scaling, the primary marked. */
export function displayLines(): string[] {
  const primary = screen.getPrimaryDisplay().id
  return screen
    .getAllDisplays()
    .map((d) => `  ${d.id === primary ? 'primary ' : ''}${d.bounds.width}×${d.bounds.height} at ${d.bounds.x},${d.bounds.y}, scale ${Math.round(d.scaleFactor * 100)}%`)
}

/** When a file was last written, or why it cannot be said. */
function modified(path: string): string {
  try {
    return statSync(path).mtime.toISOString()
  } catch (e) {
    return (e as NodeJS.ErrnoException).code ?? 'unreadable'
  }
}

/** The state of each data source, one line each; the ones in error first. */
export function sourceLines(): string[] {
  const rows = sources.list().sort((a, b) => Number(b.status === 'error') - Number(a.status === 'error'))
  const when = (t: number) => (t ? new Date(t).toISOString() : 'never')
  return rows.map((r) => `  ${r.label}: ${r.status}${r.detail ? `, ${r.detail}` : ''}; last good ${when(r.lastOk)}${r.error ? `; error: ${r.error}` : ''}`)
}

export function diagnostics(ctx: AppContext): string {
  const s = ctx.store.settings.get()
  const u = ctx.updater.status
  const lines = [
    `Legends Tracker ${app.getVersion()}${app.isPackaged ? '' : ' (development)'}, Electron ${process.versions.electron}, Windows ${release()} ${process.arch}`,
    `Settings: ${app.getPath('userData')}   Caches: ${cacheDir()}`,
    `Settings summary: ${settingsSummary(s, ctx.store.triggers.get().length, homedir())}`,
    `Watching: ${ctx.engine.status.watching ? 'yes' : 'no'}; spells loaded ${ctx.engine.status.spellsLoaded}${ctx.engine.status.spellError ? ` (${ctx.engine.status.spellError})` : ''}; game ${ctx.watcher.state.gameRunning ? 'running' : 'not running'}`,
    `Update: ${u.state}${'version' in u ? ` ${u.version}` : ''}${u.state === 'error' ? ` (${u.message})` : ''}`
  ]
  const key = characterKey(s.logFile)
  const who = key ? ctx.store.characterByKey(key) : null
  if (who)
    lines.push(
      `Character ${key}: level ${who.level}, classes ${
        Object.entries(who.classLevels)
          .map(([c, l]) => `${c} ${l}`)
          .join(', ') || 'not set'
      }, race ${who.race || 'not set'}, deity ${who.deity || 'not set'}, ${who.focusSources.length} focus source${who.focusSources.length === 1 ? '' : 's'}`
    )
  lines.push(`Spell file: spells_us.txt written ${s.installDir ? modified(join(s.installDir, 'spells_us.txt')) : 'no game folder'}`)
  const speech = ctx.speech
  const azure = ctx.azure.status()
  lines.push(
    `Speech: ${speech.running || speech.voices.length ? `${speech.voices.length} Windows voice${speech.voices.length === 1 ? '' : 's'}` : 'Windows speech not started (it starts when first needed)'}${speech.failed ? ` (${speech.failed})` : ''}; Azure ${azure.configured ? `set up (${azure.region})` : 'not set up'}${azure.error ? ` (${azure.error})` : ''}`
  )
  lines.push(`Windows calls (koffi): ${win32Available() ? 'available' : 'not available; the game is found by process list instead'}`)
  lines.push(`Hotkeys: ${s.hotkeys ? (ctx.hotkeysTaken.length ? `on; held by another program: ${ctx.hotkeysTaken.join(', ')}` : 'on') : 'off'}`)
  const triggerErrors = ctx.engine.triggers.errors
  if (triggerErrors.length) lines.push(`Triggers that would not compile: ${triggerErrors.map((t) => `${t.trigger} (${t.error})`).join('; ')}`)
  try {
    lines.push(`schema.json: ${readFileSync(join(ctx.store.dir, 'schema.json'), 'utf8').trim()}`)
  } catch {
    lines.push('schema.json: not written yet')
  }
  lines.push('Displays:', ...displayLines())
  lines.push('Data sources:', ...sourceLines())
  lines.push(...processMetrics())
  if (ctx.store.recovered.length) lines.push(`Set aside at start (unreadable): ${ctx.store.recovered.map((f) => basename(f)).join(', ')}`)
  if (ctx.store.unreadable.length) lines.push(`Could not be opened at start (left as they are): ${ctx.store.unreadable.join(', ')}`)
  if (ctx.store.newer.length) lines.push(`Written by a newer version: ${ctx.store.newer.join(', ')}`)
  lines.push('', '--- main.log, last 300 lines ---', logTail(300))
  return redact(lines.join('\n'), homedir())
}
