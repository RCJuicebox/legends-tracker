import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { profileName, settingsFolder } from '../../src/core/profile'

// --profile <name> for a second player on one PC (FEAT-041).

const APPDATA = join('C:', 'Users', 'someone', 'AppData', 'Roaming')

describe('settingsFolder', () => {
  it('keeps the usual folder, a profile under it, and lets EQL_USER_DATA win', () => {
    expect(settingsFolder(['electron', '.'], APPDATA, undefined)).toBe(join(APPDATA, 'Legends Tracker'))
    expect(settingsFolder(['app.exe', '--profile', 'Second'], APPDATA, undefined)).toBe(join(APPDATA, 'Legends Tracker', 'profiles', 'Second'))
    expect(settingsFolder(['app.exe', '--profile=My Alt'], APPDATA, undefined)).toBe(join(APPDATA, 'Legends Tracker', 'profiles', 'My Alt'))
    expect(settingsFolder(['app.exe', '--profile', 'Second'], APPDATA, 'D:/scratch')).toBe('D:/scratch')
  })

  it('takes no name a folder could not be, or one that climbs out', () => {
    for (const bad of ['..', '.', '../x', 'a/b', 'a\\b', '', ' ', 'x'.repeat(41)]) expect(profileName(['--profile', bad])).toBe('')
    expect(profileName(['--profile'])).toBe('')
    expect(profileName(['--profile', ' Two '])).toBe('Two')
  })
})
