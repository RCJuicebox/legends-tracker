import { findProcess, foregroundPid, processName, watchProcess, win32Available, type ProcessWatch } from './win32'

// Which process owns the foreground window (checked four times a second, reported only when it
// changes) and whether eqgame.exe is running, asked of Windows directly. The game is noticed in front
// (its name is looked up then anyway) or by a walk of the process list every 30 s; once found it is
// held by a handle that says when it ends. A walk every 3 s was half or more of the main process's
// idle CPU, ~9 ms each over some 500 processes (LT-558).

/** Laps (a quarter second each) between walks of the process list while the game is not held. */
const WALK_LAPS = 120

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
  /** Whether the process list has been looked at yet: until then `gameRunning` is only a default. */
  private looked = false
  /** The game, held while it runs. */
  private game: ProcessWatch | null = null

  /** The game running, as the last look (at most three seconds ago) found; null before the first look. */
  get gameRunning(): boolean | null {
    return this.looked ? this.state.gameRunning : null
  }

  constructor(private readonly onChange: (state: GameState, previous: GameState) => void) {}

  start(): void {
    if (this.timer) return
    if (!win32Available()) {
      // Nothing can be asked, so assume the game is up and in front: overlays stay visible rather
      // than hidden for good, and timers are not stopped for a game that may well be running.
      const previous = this.state
      this.state = { foregroundPid: 0, foregroundName: 'eqgame', gameRunning: true }
      this.looked = true
      this.onChange(this.state, previous)
      return
    }
    this.check()
    this.timer = setInterval(() => this.check(), 250)
  }

  private check(): void {
    const pid = foregroundPid()
    const previous = this.state
    // The name is only looked up when the foreground process changes.
    const name = pid === previous.foregroundPid ? previous.foregroundName : processName(pid)
    let running = previous.gameRunning
    if (this.game?.ended()) {
      this.game.close()
      this.game = null
      running = false
    }
    if (!this.game) {
      // In front: the game is that process. Else a walk now and then, for a game started behind.
      const found = name === 'eqgame' ? pid : this.ticks % WALK_LAPS === 0 ? findProcess('eqgame.exe') : undefined
      if (found !== undefined) {
        this.looked = true
        // Windows could not be asked: assumed running, as before.
        if (found === null) running = true
        else if (found) {
          this.game = watchProcess(found)
          running = true
        } else running = false
      }
    }
    this.ticks++
    if (pid === previous.foregroundPid && running === previous.gameRunning) return
    this.state = { foregroundPid: pid, foregroundName: name, gameRunning: running }
    this.onChange(this.state, previous)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.game?.close()
    this.game = null
  }
}
