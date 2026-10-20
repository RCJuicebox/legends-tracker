import { describe, expect, it } from 'vitest'
import { emptyKillTallies, joinKillTallies, readKillLine } from '../../../src/features/slayer/core'
import { lockoutKillsSince } from '../../../src/features/slayer/main'
import { lockoutDayStart } from '../../../src/shared/game/slayerCamps'

// A raid lockout's kills today come from the log's own kill times, kept for its bosses alone: an
// export since the kills (which the live counts start again from) loses none of them.

describe('lockout kills', () => {
  it('counts a boss killed since the noon reset, across stretches, its pets not', () => {
    const t = (iso: string) => Date.parse(iso)
    const a = emptyKillTallies()
    const b = emptyKillTallies()
    readKillLine({ time: t('2026-10-19T10:14:00-04:00'), text: "You have entered Nagafen's Lair." }, a)
    readKillLine({ time: t('2026-10-19T11:35:00-04:00'), text: 'You have slain Lord Nagafen!' }, a)
    readKillLine({ time: t('2026-10-19T12:56:00-04:00'), text: 'You have slain Lord Nagafen!' }, a)
    readKillLine({ time: t('2026-10-19T13:05:00-04:00'), text: 'Lord Nagafen has been slain by Jasartik!' }, a)
    readKillLine({ time: t('2026-10-20T10:00:00-04:00'), text: 'You have entered The Permafrost Caverns - Replay.' }, b)
    readKillLine({ time: t('2026-10-20T10:00:01-04:00'), text: 'You have slain Lady Vox!' }, b)
    readKillLine({ time: t('2026-10-20T10:07:25-04:00'), text: 'You have slain Lady Vox pet!' }, b)
    readKillLine({ time: t('2026-10-20T10:08:35-04:00'), text: 'You have slain Lady Vox!' }, b)
    readKillLine({ time: t('2026-10-20T10:09:00-04:00'), text: 'You have slain a snow orc!' }, b)
    const zones = joinKillTallies([a, b])
    const reset = lockoutDayStart(t('2026-10-20T11:18:00-04:00'))
    expect(lockoutKillsSince(zones, ['Lord Nagafen'], reset)).toBe(2)
    expect(lockoutKillsSince(zones, ['Lady Vox'], reset)).toBe(2)
    // A mob that is no lockout boss keeps no kill times.
    expect(
      Object.values(zones)
        .flatMap((z) => Object.values(z.mobs))
        .find((m) => m.name === 'a snow orc')?.times
    ).toBeUndefined()
    // After the next reset, nothing yet.
    expect(lockoutKillsSince(zones, ['Lady Vox', 'Lord Nagafen'], lockoutDayStart(t('2026-10-20T12:00:00-04:00')))).toBe(0)
  })

  it('names Innoruuk whole, comma and all', () => {
    const a = emptyKillTallies()
    readKillLine({ time: 1000, text: 'You have entered The Plane of Hate.' }, a)
    readKillLine({ time: 2000, text: 'You have slain Innoruuk, the Prince of Hate!' }, a)
    expect(lockoutKillsSince(joinKillTallies([a]), ['Innoruuk, the Prince of Hate'], 0)).toBe(1)
  })
})
