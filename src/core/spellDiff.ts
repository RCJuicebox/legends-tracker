import type { Spell, SpellBook } from './spells'

/** What a game patch changed in the spell file (FEAT-026): the old book against the new. */
export interface SpellDiff {
  before: number
  after: number
  /** Names in the new book and not the old, and the other way round. */
  added: string[]
  removed: string[]
  /** The spells you cast or keep a rule for whose numbers moved, each with what moved. */
  changed: { name: string; what: string[] }[]
  /** The file's columns moved: where its effects and icon are read from now. */
  layout: string | null
}

/** The fields compared on a watched spell, with how each is said. */
const FIELDS: { key: keyof Spell; say: (v: number) => string; label: string }[] = [
  { key: 'castMs', label: 'cast', say: (v) => `${v / 1000}s` },
  { key: 'recastMs', label: 'recast', say: (v) => `${v / 1000}s` },
  { key: 'formula', label: 'duration formula', say: String },
  { key: 'cap', label: 'duration', say: (v) => `${v} ticks` },
  { key: 'mana', label: 'mana', say: String },
  { key: 'range', label: 'range', say: String }
]

/** `watched`: spell names (base, unranked) whose changes are listed; the counts cover every spell. */
export function diffSpellBooks(old: SpellBook, next: SpellBook, watched: Iterable<string>): SpellDiff {
  const names = (b: SpellBook) => new Set([...b.all()].map((s) => s.name))
  const was = names(old)
  const now = names(next)
  const changed: SpellDiff['changed'] = []
  for (const name of new Set(watched)) {
    const a = old.named(name)
    const b = next.named(name)
    if (!a || !b) continue
    const what: string[] = []
    for (const f of FIELDS) {
      const x = a[f.key] as number
      const y = b[f.key] as number
      if (x !== y) what.push(`${f.label} ${f.say(x)} → ${f.say(y)}`)
    }
    if (effectsKey(a) !== effectsKey(b)) what.push('effects changed')
    if (a.landSelf !== b.landSelf || a.landOther !== b.landOther || a.fade !== b.fade) what.push('messages changed')
    if (what.length) changed.push({ name, what })
  }
  const lo = old.layout
  const ln = next.layout
  return {
    before: old.size,
    after: next.size,
    added: [...now].filter((n) => !was.has(n)).sort(),
    removed: [...was].filter((n) => !now.has(n)).sort(),
    changed: changed.sort((x, y) => x.name.localeCompare(y.name)),
    layout: lo.effects !== ln.effects || lo.icon !== ln.icon ? `effects field ${lo.effects} → ${ln.effects}, icon field ${lo.icon} → ${ln.icon}` : null
  }
}

function effectsKey(s: Spell): string {
  return s.effects.map((e) => `${e.slot}|${e.spa}|${e.base}|${e.base2}|${e.formula}|${e.max}`).join('$')
}

/** Nothing worth saying: the same spells and columns, none watched changed. */
export function spellDiffEmpty(d: SpellDiff): boolean {
  return !d.added.length && !d.removed.length && !d.changed.length && !d.layout
}

/** One line for the feed: "Spell data: 12 new spells, 3 of yours changed". */
export function spellDiffSummary(d: SpellDiff): string {
  if (spellDiffEmpty(d)) return 'no spell you use changed'
  const parts: string[] = []
  if (d.added.length) parts.push(`${d.added.length} new spell${d.added.length === 1 ? '' : 's'}`)
  if (d.removed.length) parts.push(`${d.removed.length} gone`)
  if (d.changed.length)
    parts.push(
      `${d.changed.length} of yours changed (${d.changed
        .map((c) => c.name)
        .slice(0, 3)
        .join(', ')}${d.changed.length > 3 ? '…' : ''})`
    )
  if (d.layout) parts.push('its columns moved')
  return parts.join(', ')
}

/** The whole report, for Data Sources' spell-data row and its Copy. */
export function spellDiffText(d: SpellDiff, shown = 60): string {
  const out = [`Spells: ${d.before} → ${d.after}`]
  if (d.layout) out.push(`Columns moved: ${d.layout}`)
  const list = (title: string, names: string[]) => {
    if (!names.length) return
    out.push('', `${title} (${names.length}):`, ...names.slice(0, shown).map((n) => `  ${n}`))
    if (names.length > shown) out.push(`  … and ${names.length - shown} more`)
  }
  if (d.changed.length) out.push('', `Changed, of the spells you cast or keep a rule for (${d.changed.length}):`, ...d.changed.map((c) => `  ${c.name}: ${c.what.join('; ')}`))
  list('New', d.added)
  list('Gone', d.removed)
  return out.join('\n')
}
