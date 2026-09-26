import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SpellBook } from '../src/core/spells'
import { casterLevel, computeDuration } from '../src/core/durations'
import { focusFor, focusFromSpell } from '../src/core/focus'
import { TimerBoard } from '../src/core/timers'
import { SpellTracker } from '../src/core/spellTracker'
import { parseLogLine } from '../src/core/logLine'
import { DEFAULT_TIER_DURATION_PCT, type CharacterSettings, type FocusSource, type Notification, type SpellRule, type TrackingSettings } from '../src/shared/types'

/** Real rows from the EQL client's spell files: Plague, Envenomed Bolt, Odium, Spirit of the Puma, Slugs Healing. */
export function fixtureBook(): SpellBook {
  const dir = join(__dirname, 'fixtures')
  return SpellBook.parse(readFileSync(join(dir, 'spells_us.txt'), 'latin1'), readFileSync(join(dir, 'spells_us_str.txt'), 'latin1'))
}

export const TRACKING: TrackingSettings = {
  enabled: true,
  selfBuffs: true,
  otherBuffs: true,
  groupBuffs: true,
  dots: true,
  debuffs: true,
  buffWarnSec: 12,
  dotWarnSec: 12,
  buffWarnSpeech: 'Recast {spell}',
  buffFadeSpeech: '{spell} down',
  dotWarnSpeech: 'Recast {spell}',
  dotFadeSpeech: '{spell} off',
  announceOtherBuffFades: false,
  tierDurationPct: DEFAULT_TIER_DURATION_PCT
}

/** The AA from Kelwyn's /alternateadv list: "increases the duration of beneficial spells that you cast by 50%". */
export const SPELL_CASTING_REINFORCEMENT: FocusSource = {
  id: 'scr', name: 'Spell Casting Reinforcement', kind: 'aa', from: 'AA', pct: 50, appliesTo: 'beneficial',
  maxLevel: 0, decayPct: 0, minTicks: 0, requireSpas: [], excludeSpas: [], enabled: true
}

/** Kelwyn as of 2026-09-23: the AA plus Extended Enhancement II from the Engineer's Ring's exaltation. */
export function exampleShaman(book = fixtureBook()): CharacterSettings {
  return {
    level: 50,
    classLevels: {},
    focusSources: [SPELL_CASTING_REINFORCEMENT, focusFromSpell(book.named('Extended Enhancement II')!, 'item', "Engineer's Ring")]
  }
}

export function harness(opts: { character?: CharacterSettings; rules?: Record<string, SpellRule> } = {}) {
  const book = fixtureBook()
  const character: CharacterSettings = opts.character ?? { level: 50, classLevels: {}, focusSources: [] }
  const spoken: string[] = []
  const board = new TimerBoard({
    onChange: () => {},
    onNotify: (ns: Notification[]) => ns.forEach((n) => n.kind === 'speak' && spoken.push(n.text))
  })
  const tracker = new SpellTracker(
    book,
    board,
    {
      tracking: TRACKING,
      ruleFor: (name) => opts.rules?.[name] ?? {},
      durationFor: (spell, rank) =>
        computeDuration({
          spell,
          rank,
          level: 50,
          tierPct: DEFAULT_TIER_DURATION_PCT,
          focusPct: focusFor(spell, character, casterLevel(spell, character)).pct
        })
    },
    {
      notify: (ns) => ns.forEach((n) => n.kind === 'speak' && spoken.push(n.text)),
      feed: () => {}
    }
  )
  const feed = (text: string) => {
    for (const raw of text.trim().split('\n')) {
      const line = parseLogLine(raw.trim())
      if (!line) throw new Error(`bad fixture line: ${raw}`)
      tracker.handle(line)
      board.tick(line.time)
    }
  }
  return { book, board, tracker, spoken, feed }
}

export function at(stamp: string): number {
  return parseLogLine(`[${stamp}] x`)!.time
}
