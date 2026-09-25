import { foregroundPid, isProcessRunning, processName, win32Available } from './win32'

// Which process owns the foreground window (checked four times a second, reported only when it
// changes) and whether eqgame.exe is running (every 3s), asked of Windows directly. It used to be a
// resident PowerShell loop; a direct call costs well under a millisecond and launches nothing.

export interface GameState {
  /** Process id owning the foreground window. */
  foregroundPid: number
  foregroundName: string
  gameRunning: boolean
}

export class GameWatcher {
  private timer: NodeJS.Timeout | null = null
  private ticks = 0
  state: GameState = { foregroundPid: 0, foregroundName: '', gameRunning: false }

  constructor(private readonly onChange: (state: GameState, previous: GameState) => void) {}

  start(): void {
    if (this.timer) return
    if (!win32Available()) {
      // Nothing can be asked, so assume the game is up and in front: overlays stay visible rather
      // than hidden for good, and timers are not stopped for a game that may well be running.
      const previous = this.state
      this.state = { foregroundPid: 0, foregroundName: 'eqgame', gameRunning: true }
      this.onChange(this.state, previous)
      return
    }
    this.check()
    this.timer = setInterval(() => this.check(), 250)
  }

  private check(): void {
    const pid = foregroundPid()
    const running = this.ticks++ % 12 === 0 ? isProcessRunning('eqgame.exe') : this.state.gameRunning
    const previous = this.state
    if (pid === previous.foregroundPid && running === previous.gameRunning) return
    // The name is only looked up when the foreground process changes.
    const name = pid === previous.foregroundPid ? previous.foregroundName : processName(pid)
    this.state = { foregroundPid: pid, foregroundName: name, gameRunning: running }
    this.onChange(this.state, previous)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
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
