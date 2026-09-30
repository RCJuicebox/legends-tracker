import { handle } from './handle'
import { summarize } from '../../core/spells'
import { focusFromSpell, isDurationFocus } from '../../core/focus'
import { castRows } from '../../core/spellMotes'
import { intArg, isCharacterKey, isRecordKey, sanitizeSpellRule, textArg } from '../../core/validate'
import { logFileFor, logStem } from '../storeCore'
import type { AppContext } from '../context'

// Spells: the ones cast lately, their per-spell settings, the log check, focus effects and the casts
// that decide which spells to put motes into.

export function registerSpellIpc(ctx: AppContext): void {
  const { store, engine } = ctx

  handle('spells:known', () => engine.knownSpells())
  handle('spells:search', (q) => engine.book?.search(textArg(q, 100)).map(summarize) ?? [])
  handle('spells:rule', (name, input) => {
    if (!isRecordKey(name, 100)) throw new Error('Not a spell.')
    const rule = sanitizeSpellRule(input)
    const rules = { ...store.rules.get() }
    if (rule && Object.values(rule).some((v) => v !== undefined && v !== '')) rules[name] = rule
    else delete rules[name]
    store.rules.set(rules)
    engine.reconfigure()
    return engine.knownSpells()
  })
  // Megabytes of the log to read back: the page offers up to a few hundred.
  handle('spells:checkLog', (mb) => engine.checkLog(intArg(mb, 1, 2048, 100)))
  // Duration focus effects from the spell book, e.g. "Extended Enhancement II", with their limits.
  handle('focus:search', (q) =>
    (engine.book?.search(textArg(q, 100), 200, true) ?? [])
      .filter(isDurationFocus)
      .slice(0, 30)
      .map((s) => focusFromSpell(s, 'item', ''))
  )

  // Which spells to put motes into: the character's casts over the last `days` days of play, joined
  // with the spell file. The page scores and sorts them itself.
  handle('motes:spellCasts', async (character, days) => {
    const book = engine.book
    if (!book) return null
    const key = character || ctx.characterKey()
    if (!isCharacterKey(key)) return { rows: [], unknown: [], window: null, mine: [] }
    const recent = await ctx.castHistory.recent({
      logPath: logFileFor(ctx.installDir(), key),
      archiveDir: engine.archiveDir(),
      stem: logStem(key),
      days: intArg(days, 0, 3650, 14)
    })
    return { ...castRows(book, recent.counts, engine.character()), window: { total: recent.total, from: recent.from, to: recent.to }, mine: engine.myClasses() }
  })
}
