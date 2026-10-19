import { handle } from './handle'
import { summarize } from '../../core/spells'
import { focusFromSpell, isDurationFocus } from '../../core/focus'
import { castRows } from '../../core/spellMotes'
import { intArg, isCharacterKey, isRecordKey, sanitizeSpellRule, textArg } from '../../core/validate'
import type { AppContext } from '../context'

// Spells: the ones cast lately, their per-spell settings, the log check, focus effects and the casts
// that decide which spells to put motes into.

export function registerSpellIpc(ctx: AppContext): void {
  const { store, engine } = ctx

  handle('spells:known', () => engine.queries.knownSpells())
  handle('spells:search', (q) => engine.book?.search(textArg(q, 100)).map(summarize) ?? [])
  handle('spells:rule', (name, input) => {
    if (!isRecordKey(name, 100)) throw new Error('Not a spell.')
    const rule = sanitizeSpellRule(input)
    const rules = { ...store.rules.get() }
    if (rule && Object.values(rule).some((v) => v !== undefined && v !== '')) rules[name] = rule
    else delete rules[name]
    store.rules.set(rules)
    engine.reconfigure()
    return engine.queries.knownSpells()
  })
  // Megabytes of the log to read back: the page offers up to a few hundred.
  handle('spells:checkLog', (mb) => engine.queries.checkLog(intArg(mb, 1, 2048, 100)))
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
    // Its logs on every PC it is played on.
    const where = { ...ctx.historyOf(key), days: intArg(days, 0, 3650, 14) }
    const [recent, resists, merges] = await Promise.all([
      ctx.castHistory.recent(where),
      ctx.resistHistory.recent(where).catch(() => null),
      // Every rank bought, whenever: the rank is what it is now.
      ctx.spellMergeHistory.recent({ ...where, days: 0 }).catch(() => null)
    ])
    return {
      ...castRows(book, recent.counts, engine.character(), resists?.counts, Object.keys(merges?.counts ?? {})),
      window: { total: recent.total, from: recent.from, to: recent.to },
      mine: engine.myClasses()
    }
  })

  // Your casts and resists of each spell over the last two weeks of play, by the spell's name, for Spell Timers' Resisted column (LT-722).
  handle('spells:resists', async () => {
    const book = engine.book
    const key = ctx.characterKey()
    if (!book || !isCharacterKey(key)) return {}
    const where = { ...ctx.historyOf(key), days: 14 }
    const [casts, resists] = await Promise.all([ctx.castHistory.recent(where), ctx.resistHistory.recent(where)])
    const out: Record<string, { casts: number; resisted: number }> = {}
    const add = (counts: Record<string, number>, field: 'casts' | 'resisted') => {
      for (const [name, n] of Object.entries(counts)) {
        const base = book.resolve(name)?.spell.name
        if (base) (out[base] ??= { casts: 0, resisted: 0 })[field] += n
      }
    }
    add(casts.counts, 'casts')
    add(resists.counts, 'resisted')
    return out
  })
}
