import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SpellBook } from '../src/core/spells'
import { casterLevel, computeDuration } from '../src/core/durations'
import { focusFor, focusFromSpell } from '../src/core/focus'
import { TimerBoard } from '../src/core/timers'
import { SpellTracker } from '../src/core/spellTracker'
import { parseLogLine } from '../src/core/logLine'
import { DEFAULT_TIER_DURATION_PCT, type CharacterSettings, type FocusSource, type Notification, type SpellRule, type TrackingSettings } from '../src/shared/types'
import type { Weights } from '../src/core/upgrades'

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
  id: 'scr',
  name: 'Spell Casting Reinforcement',
  kind: 'aa',
  from: 'AA',
  pct: 50,
  appliesTo: 'beneficial',
  maxLevel: 0,
  decayPct: 0,
  minTicks: 0,
  requireSpas: [],
  excludeSpas: [],
  enabled: true
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
  const feedItems: [string, string][] = []
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
      feed: (kind, text) => void feedItems.push([kind, text])
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
  return { book, board, tracker, spoken, feed, feedItems }
}

export function at(stamp: string): number {
  return parseLogLine(`[${stamp}] x`)!.time
}

/** Fixed weights for the gear tests, per point of the stat (the app derives its own from ROLE_PRESETS). */
export const PRESETS: Record<string, Weights> = {
  Balanced: {
    ac: 2,
    hp: 0.25,
    mana: 0.2,
    end: 0.1,
    str: 0.6,
    sta: 0.8,
    agi: 0.6,
    dex: 0.5,
    wis: 0.5,
    int: 0.5,
    cha: 0.1,
    resists: 0.2,
    haste: 2,
    attack: 1,
    hpRegen: 2,
    manaRegen: 2,
    endRegen: 1,
    ratio: 0,
    rangedRatio: 0
  },
  Tank: {
    ac: 4,
    hp: 0.4,
    mana: 0,
    end: 0.1,
    str: 0.4,
    sta: 1.2,
    agi: 0.8,
    dex: 0.3,
    wis: 0.1,
    int: 0.1,
    cha: 0,
    resists: 0.4,
    haste: 1.5,
    attack: 0.5,
    hpRegen: 3,
    manaRegen: 0,
    endRegen: 1,
    ratio: 40,
    rangedRatio: 0
  },
  Melee: {
    ac: 1,
    hp: 0.2,
    mana: 0,
    end: 0.2,
    str: 1.2,
    sta: 0.5,
    agi: 0.6,
    dex: 1,
    wis: 0,
    int: 0,
    cha: 0,
    resists: 0.1,
    haste: 4,
    attack: 2,
    hpRegen: 1,
    manaRegen: 0,
    endRegen: 2,
    ratio: 40,
    rangedRatio: 0
  },
  Caster: {
    ac: 0.8,
    hp: 0.25,
    mana: 0.5,
    end: 0,
    str: 0,
    sta: 0.6,
    agi: 0.3,
    dex: 0.1,
    wis: 1.2,
    int: 1.2,
    cha: 0.2,
    resists: 0.3,
    haste: 0,
    attack: 0,
    hpRegen: 1,
    manaRegen: 4,
    endRegen: 0,
    ratio: 0,
    rangedRatio: 0
  }
}
