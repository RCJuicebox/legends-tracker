import { describe, expect, it } from 'vitest'
import { CombatMeter } from '../../src/core/combatMeter'
import { overlayFight } from '../../src/shared/combat'
import { attackerRows, attackerSkillRows, damageRows, healerRows, healSpellRows, skillRows } from '../../src/core/combatView'
import { parseLogLine } from '../../src/core/logLine'

// What a meter overlay host gets of the live fight (LT-557): what its rows and drill-ins read, and none
// of what only the main window's panes read.

const LINES = `[Sat Oct 03 20:30:00 2026] You punch a gnoll for 50 points of damage.
[Sat Oct 03 20:30:01 2026] A gnoll hits YOU for 20 points of damage.
[Sat Oct 03 20:30:02 2026] A gnoll tries to hit YOU, but YOU dodge!
[Sat Oct 03 20:30:03 2026] Aldric healed you for 30 hit points by Light Healing.
[Sat Oct 03 20:30:04 2026] You kick a gnoll for 12 points of damage.`

describe('overlayFight', () => {
  it('draws the same rows and drill-ins, without damage taken by skill, defence or heals by target', () => {
    const meter = new CombatMeter({ fightGapSec: 30, newSessionOnZone: false })
    meter.setSelf('Kelwyn')
    for (const raw of LINES.split('\n')) meter.handle(parseLogLine(raw)!)
    const full = meter.liveFight!
    const lean = overlayFight(full)
    for (const scope of ['you', 'group', 'everyone'] as const) {
      expect(damageRows(lean, scope, true)).toEqual(damageRows(full, scope, true))
      expect(attackerRows(lean, scope)).toEqual(attackerRows(full, scope))
      expect(healerRows(lean, scope)).toEqual(healerRows(full, scope))
      expect(attackerSkillRows(lean, scope, 'a gnoll')).toEqual(attackerSkillRows(full, scope, 'a gnoll'))
    }
    const row = damageRows(full, 'everyone', false)[0]
    expect(skillRows(lean, row)).toEqual(skillRows(full, row))
    expect(healSpellRows(lean, 'aldric')).toEqual(healSpellRows(full, 'aldric'))
    const you = Object.values(lean.entities).find((e) => e.kind === 'you')!
    expect(you.takenBy).toEqual({})
    expect(you.defense.swings).toBe(0)
    expect(JSON.stringify(lean).length).toBeLessThan(JSON.stringify(full).length)
    // The meter's own copy is untouched.
    expect(Object.values(full.entities).find((e) => e.kind === 'you')!.defense.swings).toBeGreaterThan(0)
  })
})
