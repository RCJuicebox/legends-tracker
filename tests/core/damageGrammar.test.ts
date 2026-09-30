import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCombatLine, SELF } from '../../src/core/combatLines'

// The player's own damage lines, shared with the workspace's Python parser (dps/test_grammar.py):
// both must read every line the same way.
interface Expected {
  kind: 'melee' | 'miss' | 'spell' | 'dot' | 'ds'
  target: string
  skill?: string
  amount?: number
  outcome?: string
  crit?: boolean
  riposte: boolean
}
const { lines } = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'damage-lines.json'), 'utf8')) as { lines: { line: string; expect: Expected }[] }

/** What the app's parser made of a line, in the fixture's terms. */
function read(line: string): Expected | null {
  const ev = parseCombatLine(line)
  if (!ev) return null
  const mods = 'mods' in ev ? ev.mods : []
  if (ev.kind === 'miss') return { kind: 'miss', target: ev.target, skill: ev.skill, outcome: ev.outcome, riposte: mods.includes('riposte') }
  if (ev.kind !== 'damage' || ev.source !== SELF) return null
  const base = { kind: ev.how, target: ev.target, amount: ev.amount, crit: mods.includes('critical'), riposte: mods.includes('riposte') }
  return ev.how === 'ds' ? base : { ...base, skill: ev.skill }
}

describe('the damage grammar shared with the Python parser', () => {
  it.each(lines.map((l) => [l.line, l.expect] as const))('%s', (line, expected) => {
    expect(read(line)).toEqual(expected)
  })
})
