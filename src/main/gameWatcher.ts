import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

// A resident PowerShell loop that reports which process owns the foreground window (checked four
// times a second, reported only when it changes) and whether eqgame.exe is running (every 3s).
// $procId, not $pid: $PID is PowerShell's own read-only automatic variable.
const SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$lastPid = -1; $lastName = ''; $lastRunning = $null; $n = 0
while ($true) {
  $procId = [uint32]0
  [void][Fg]::GetWindowThreadProcessId([Fg]::GetForegroundWindow(), [ref]$procId)
  if ($procId -ne $lastPid) {
    $lastPid = $procId
    $lastName = try { [System.Diagnostics.Process]::GetProcessById([int]$procId).ProcessName } catch { '' }
    $changed = $true
  } else { $changed = $false }
  if ($n % 12 -eq 0) {
    $running = [System.Diagnostics.Process]::GetProcessesByName('eqgame').Length -gt 0
    if ($running -ne $lastRunning) { $lastRunning = $running; $changed = $true }
  }
  if ($changed) {
    [Console]::Out.WriteLine('{"pid":' + $lastPid + ',"name":' + (ConvertTo-Json ([string]$lastName)) + ',"running":' + $lastRunning.ToString().ToLower() + '}')
    [Console]::Out.Flush()
  }
  $n++
  Start-Sleep -Milliseconds 250
}
`

export interface GameState {
  /** Process id owning the foreground window. */
  foregroundPid: number
  foregroundName: string
  gameRunning: boolean
}

export class GameWatcher {
  private proc: ChildProcessWithoutNullStreams | null = null
  private stopped = false
  private buffer = ''
  state: GameState = { foregroundPid: 0, foregroundName: '', gameRunning: false }

  constructor(private readonly onChange: (state: GameState, previous: GameState) => void) {}

  start(): void {
    this.stopped = false
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    const proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true
    })
    this.proc = proc
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let nl: number
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim()
        this.buffer = this.buffer.slice(nl + 1)
        try {
          const m = JSON.parse(line) as { pid: number; name: string; running: boolean }
          const previous = this.state
          this.state = { foregroundPid: m.pid, foregroundName: m.name.toLowerCase(), gameRunning: m.running }
          this.onChange(this.state, previous)
        } catch {
          // a partial or non-JSON line; ignore
        }
      }
    })
    proc.on('exit', () => {
      this.proc = null
      // Keep watching: restart after a pause unless the app is shutting down.
      if (!this.stopped) setTimeout(() => this.start(), 3000)
    })
  }

  stop(): void {
    this.stopped = true
    this.proc?.kill()
    this.proc = null
  }
}

/**
 * Overlays show while the game has focus, while this app's own window does (so arranging and the
 * demo work), and always while arranging. Otherwise they hide, unless the setting is off.
 */
export function overlaysVisible(opts: { onlyWithGame: boolean; arranging: boolean; state: GameState; ownPid: number }): boolean {
  if (!opts.onlyWithGame || opts.arranging) return true
  const { foregroundName, foregroundPid } = opts.state
  return foregroundName === 'eqgame' || foregroundPid === opts.ownPid
}
