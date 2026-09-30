import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { basename, join } from 'node:path'
import { logDir } from './log'
import { cacheDir } from './paths'
import type { AppSettings } from '../shared/types'
import type { AppContext } from './context'

// What a bug report needs, in one block of text the player can copy: the version, the machine, the
// settings that matter (no key, no Windows user name), what went wrong at start, and the end of the log.

/** Paths with the Windows user's folder replaced, so a pasted report does not carry their name. */
export function redact(text: string): string {
  const home = homedir()
  return home ? text.split(home).join('%USERPROFILE%') : text
}

/** The settings a support question turns on, on one line. */
export function settingsSummary(s: AppSettings, triggers: number): string {
  const voice = !s.audio.voice ? 'Windows default' : s.audio.voice.startsWith('azure:') ? `Azure ${s.audio.voice.slice(6)}` : s.audio.voice
  const overlays = s.overlays.map((o) => `${o.id}${o.visible ? '' : ' (hidden)'}`).join(', ')
  return redact(
    [
      `game folder ${s.installDir || 'not set'}`,
      `log ${s.logFile ? basename(s.logFile) : 'none'}`,
      `watch at start ${s.autoStart ? 'on' : 'off'}`,
      `overlays ${overlays || 'none'}${s.overlaysOnlyWithGame ? ', only with the game' : ''}`,
      `voice ${voice}${s.audio.muted ? ', muted' : ''}`,
      `tracking ${s.tracking.enabled ? 'on' : 'off'} (self buffs ${s.tracking.selfBuffs ? 'on' : 'off'}, dots ${s.tracking.dots ? 'on' : 'off'}, group buffs ${s.tracking.groupBuffs ? 'on' : 'off'})`,
      `${triggers} trigger${triggers === 1 ? '' : 's'}`,
      `archive ${s.archive.autoEnabled ? `auto at ${s.archive.thresholdMB} MB` : 'by hand'}`,
      `yield to game ${s.yieldToGame ? 'on' : 'off'}`
    ].join('; ')
  )
}

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

export function diagnostics(ctx: AppContext): string {
  const s = ctx.store.settings.get()
  const u = ctx.updater.status
  const lines = [
    `Legends Tracker ${app.getVersion()}${app.isPackaged ? '' : ' (development)'}, Electron ${process.versions.electron}, Windows ${release()} ${process.arch}`,
    `Settings: ${app.getPath('userData')}   Caches: ${cacheDir()}`,
    `Settings summary: ${settingsSummary(s, ctx.store.triggers.get().length)}`,
    `Watching: ${ctx.engine.status.watching ? 'yes' : 'no'}; spells loaded ${ctx.engine.status.spellsLoaded}${ctx.engine.status.spellError ? ` (${ctx.engine.status.spellError})` : ''}; game ${ctx.watcher.state.gameRunning ? 'running' : 'not running'}`,
    `Update: ${u.state}${'version' in u ? ` ${u.version}` : ''}${u.state === 'error' ? ` (${u.message})` : ''}`
  ]
  lines.push(...processMetrics())
  if (ctx.store.recovered.length) lines.push(`Set aside at start (unreadable): ${ctx.store.recovered.map((f) => basename(f)).join(', ')}`)
  if (ctx.store.unreadable.length) lines.push(`Could not be opened at start (left as they are): ${ctx.store.unreadable.join(', ')}`)
  if (ctx.store.newer.length) lines.push(`Written by a newer version: ${ctx.store.newer.join(', ')}`)
  lines.push('', '--- main.log, last 300 lines ---', logTail(300))
  return redact(lines.join('\n'))
}
