import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkAgainstLog } from '../src/core/logCheck'
import { fixtureBook } from './helpers'
import { DEFAULT_TIER_DURATION_PCT } from '../src/shared/types'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'eqlcheck-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

// Two Spirit of the Puma X casts, each fading 196s after landing, as Kelwyn's log shows.
const PUMA = `
[Wed Sep 23 13:29:05 2026] You begin casting Spirit of the Puma X.
[Wed Sep 23 13:29:06 2026] You begin to snarl as your features become feline.
[Wed Sep 23 13:32:22 2026] The spirit of the puma departs.
[Wed Sep 23 13:40:05 2026] You begin casting Spirit of the Puma X.
[Wed Sep 23 13:40:06 2026] You begin to snarl as your features become feline.
[Wed Sep 23 13:43:22 2026] The spirit of the puma departs.
[Wed Sep 23 13:50:05 2026] You begin casting Envenomed Bolt X.
[Wed Sep 23 13:50:06 2026] A ratman warrior has been poisoned.
[Wed Sep 23 13:51:02 2026] Your Envenomed Bolt spell has worn off of A ratman warrior.
`

async function check(text: string, focusPct: number) {
  const logPath = join(dir, 'eqlog_Kelwyn_neriak.txt')
  await fs.writeFile(logPath, text.trim().split('\n').join('\r\n') + '\r\n', 'latin1')
  return checkAgainstLog({ logPath, book: fixtureBook(), megabytes: 1, level: () => 50, focusPct: (s) => (s.beneficial ? focusPct : 0), tierPct: DEFAULT_TIER_DURATION_PCT })
}

describe('checkAgainstLog', () => {
  it('finds the model fits when the focus is right, and skips spells seen fading only once', async () => {
    const rows = await check(PUMA, 60.5)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rankedName: 'Spirit of the Puma X', samples: 2, observedMedianSec: 196, calculatedEarliestSec: 192, calculatedLatestSec: 198, fits: true, impliedFocusPct: null })
  })

  it('names the focus that would make a mismatch fit', async () => {
    const [row] = await check(PUMA, 0)
    expect(row.fits).toBe(false)
    const [lo, hi] = row.impliedFocusRange!
    expect(lo).toBeLessThanOrEqual(60.5)
    expect(hi).toBeGreaterThanOrEqual(60.5)
  })

  it('leaves out a timer joined part way, whose start was not seen', async () => {
    const rows = await check(`
[Tue Sep 01 12:15:14 2026] Bazzt Zzzt has taken 489 damage from your Envenomed Bolt X.
[Tue Sep 01 12:16:08 2026] Your Envenomed Bolt spell has worn off of Bazzt Zzzt.
[Tue Sep 01 12:20:14 2026] Bazzt Zzzt has taken 489 damage from your Envenomed Bolt X.
[Tue Sep 01 12:21:08 2026] Your Envenomed Bolt spell has worn off of Bazzt Zzzt.`, 0)
    expect(rows).toEqual([])
  })

  it('counts nothing for a timer that already expired when its fade line comes', async () => {
    // Envenomed Bolt X: 10 ticks, pinned by the tick at 12:15:14 to end at 12:16:08; exact ends get 3s grace.
    const rows = await check(`
[Tue Sep 01 12:15:08 2026] You begin casting Envenomed Bolt X.
[Tue Sep 01 12:15:09 2026] Bazzt Zzzt has been poisoned.
[Tue Sep 01 12:15:14 2026] Bazzt Zzzt has taken 489 damage from your Envenomed Bolt X.
[Tue Sep 01 12:16:11 2026] Kelwyn hits a ratman warrior for 55 points of damage.
[Tue Sep 01 12:16:11 2026] Your Envenomed Bolt spell has worn off of Bazzt Zzzt.
[Tue Sep 01 12:20:08 2026] You begin casting Envenomed Bolt X.
[Tue Sep 01 12:20:09 2026] Bazzt Zzzt has been poisoned.
[Tue Sep 01 12:20:14 2026] Bazzt Zzzt has taken 489 damage from your Envenomed Bolt X.
[Tue Sep 01 12:21:08 2026] Your Envenomed Bolt spell has worn off of Bazzt Zzzt.
[Tue Sep 01 12:25:08 2026] You begin casting Envenomed Bolt X.
[Tue Sep 01 12:25:09 2026] Bazzt Zzzt has been poisoned.
[Tue Sep 01 12:25:14 2026] Bazzt Zzzt has taken 489 damage from your Envenomed Bolt X.
[Tue Sep 01 12:26:08 2026] Your Envenomed Bolt spell has worn off of Bazzt Zzzt.`, 0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rankedName: 'Envenomed Bolt X', samples: 2, observedMedianSec: 59 })
  })
})
