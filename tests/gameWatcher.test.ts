import { describe, expect, it } from 'vitest'
import { overlaysVisible } from '../src/main/gameWatcher'

const state = (name: string, pid = 100) => ({ foregroundName: name, foregroundPid: pid, gameRunning: true })

describe('overlaysVisible', () => {
  it('shows overlays only while the game or this app has focus', () => {
    expect(overlaysVisible({ onlyWithGame: true, arranging: false, state: state('eqgame'), ownPid: 1 })).toBe(true)
    expect(overlaysVisible({ onlyWithGame: true, arranging: false, state: state('chrome'), ownPid: 1 })).toBe(false)
    expect(overlaysVisible({ onlyWithGame: true, arranging: false, state: state('electron', 1), ownPid: 1 })).toBe(true)
  })

  it('always shows them while arranging, or when the setting is off', () => {
    expect(overlaysVisible({ onlyWithGame: true, arranging: true, state: state('chrome'), ownPid: 1 })).toBe(true)
    expect(overlaysVisible({ onlyWithGame: false, arranging: false, state: state('chrome'), ownPid: 1 })).toBe(true)
  })
})
