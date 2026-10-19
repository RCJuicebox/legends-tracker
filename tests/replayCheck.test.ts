import { describe, expect, it } from 'vitest'
import { parseLogLine } from '../src/core/logLine'
import { DEFAULT_CHARACTER } from '../src/shared/types'
import { fixtureBook, TRACKING } from './helpers'
import { ReplayCheck, reportText } from './replay/replayCheck'

// The replay check's own workings (FEAT-019), on hand-written lines: a DoT's fade against its estimate,
// a fade with no timer, and the lines no part takes counted by shape.

const run = (text: string) => {
  const check = new ReplayCheck(fixtureBook(), { character: { ...DEFAULT_CHARACTER, classLevels: { Shaman: 50 } }, self: 'Kelwyn', rules: {}, tracking: TRACKING })
  for (const raw of text.trim().split('\n')) {
    const l = parseLogLine(raw.trim())
    if (l) check.line(l)
  }
  return check.report()
}

describe('the replay check', () => {
  it('times a fade, finds a fade with no timer, and counts unread lines by shape', () => {
    const r = run(`
      [Tue Sep 01 12:15:00 2026] You begin casting Envenomed Bolt X.
      [Tue Sep 01 12:15:09 2026] Bazzt Zzzt has been poisoned.
      [Tue Sep 01 12:16:08 2026] Your Envenomed Bolt spell has worn off of Bazzt Zzzt.
      [Tue Sep 01 12:20:00 2026] You begin casting Envenomed Bolt X.
      [Tue Sep 01 12:20:09 2026] Bazzt Zzzt has been poisoned.
      [Tue Sep 01 12:21:08 2026] Your Envenomed Bolt spell has worn off of Bazzt Zzzt.
      [Tue Sep 01 12:22:00 2026] Your Envenomed Bolt spell has worn off of a rat.
      [Tue Sep 01 12:23:00 2026] You have become better at Kick! (113)
      [Tue Sep 01 12:23:30 2026] Your target is too far away, get closer!
      [Tue Sep 01 12:24:00 2026] Your target is too far away, get closer!
      [Tue Sep 01 12:25:00 2026] Fenwick says, 'hello'
      [Tue Sep 01 12:25:01 2026] Ungral Silverstomp told you, 'Welcome to my bank!'
      [Tue Sep 01 12:25:02 2026] Description: This passive ability improves your melee attacks by 2%.`)
    expect(r.fades).toEqual([expect.objectContaining({ spell: 'Envenomed Bolt X', n: 2, median: 59 })])
    expect(r.fadesNoTimer).toEqual([{ spell: 'Envenomed Bolt', n: 1 }])
    expect(r.unread.map((s) => [s.shape, s.n])).toEqual([['Your target is too far away, get closer!', 2]])
    // A banker's welcome and the AA window's descriptions are talk, not lines to read (LT-753).
    expect(r.chat).toBe(3)
    expect(reportText(r, 'eqlog_Kelwyn_neriak.txt')).toContain('| Envenomed Bolt X | 2 | 59 |')
  })
})
