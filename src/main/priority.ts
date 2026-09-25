import os from 'node:os'

// Below-normal priority for work that should never compete with the game for a frame. Windows
// still runs it whenever a core is free; it just loses every tie with EverQuest.

export function yieldPriority(pid: number | undefined, yieldToGame = true): void {
  if (!pid) return
  try {
    os.setPriority(pid, yieldToGame ? os.constants.priority.PRIORITY_BELOW_NORMAL : os.constants.priority.PRIORITY_NORMAL)
  } catch {
    // The process may already have exited, or be one we may not change.
  }
}
