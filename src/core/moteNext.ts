import type { MergeOption } from './mergeValue'
import type { SpellUpgradeOption } from './spellMotes'
import { score, type Weights } from './gearFinder'
import { EFFECT_RANK_PCT } from '../shared/game/guide'

// Motes › Next (FEAT-033): Best merge and Spell upgrades in one list. Both already price motes in
// Infinitesimal-equivalents; the gain is made the same where it can be: an item's gain in your
// weights' points over what 1% more weapon damage counts for (`ratioWeight`), and a damage spell's
// rank as its damage bonus times that spell's share of your damage. A buff's rank is what it adds to
// your stats, priced by the same weights as a merge (kept up, it is worn); a proc buff's adds its proc's
// share of your damage times the proc's rate. Heals, debuffs and crowd control keep the guide's points,
// ranked after the ones a gain could be put on.

export interface NextRow {
  kind: 'item' | 'spell'
  name: string
  /** "+5 → +6", "VIII → IX"; and the level or rank it starts from, to sort by. */
  step: string
  level: number
  /** What the step costs, in Infinitesimal motes' worth; null when the stock cannot pay it yet. */
  cost: number | null
  /** About how much more of your damage it gives, in percent; null where it cannot be said. */
  gainPct: number | null
  /** That gain for each 1,000 motes it costs: the list's order. Null without a gain or a cost. */
  perK: number | null
  /** Its gain in its own terms, for when no share can be put on it. */
  note: string
  affordable: boolean
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
const DAMAGE = new Set(['nuke', 'dot'])

export function nextRanking(
  items: readonly MergeOption[],
  spells: readonly SpellUpgradeOption[],
  o: {
    /** What 1% more weapon damage counts for in the weights (their `ratio`); 0 leaves items without a share. */
    ratioWeight: number
    /** A spell's share of your damage (0 to 1) by its name, or null when the meter has none of it. */
    damageShare: (spell: string) => number | null
    /** Your stat weights, to price what a buff's rank adds; without them buffs keep their points. */
    weights?: Weights
  }
): NextRow[] {
  const rows: NextRow[] = []
  const perK = (gainPct: number | null, cost: number | null) => (gainPct !== null && cost ? (gainPct / cost) * 1000 : null)
  for (const m of items) {
    const gainPct = o.ratioWeight > 0 ? m.gain / o.ratioWeight : null
    rows.push({
      kind: 'item',
      name: m.item.name.replace(/\s*\+\d+$/, ''),
      step: `+${m.level} → +${m.next}`,
      level: m.level,
      cost: m.cost,
      gainPct,
      perK: perK(gainPct, m.cost),
      note: `${m.gain.toFixed(1)} points by your weights`,
      affordable: m.affordable
    })
  }
  for (const s of spells) {
    if (s.maxed) continue
    const power = s.parts.find((p) => p.key === 'power')
    const share = DAMAGE.has(s.row.category) && power ? o.damageShare(s.row.name) : null
    const cost = s.spend.short ? null : s.spend.worth
    const buff = buffGain(s, o)
    const gainPct = share !== null && power ? power.pct * share : (buff?.pct ?? null)
    rows.push({
      kind: 'spell',
      name: s.row.name,
      step: `${ROMAN[s.rank] ?? s.rank} → ${ROMAN[s.next] ?? s.next}`,
      level: s.rank,
      cost,
      gainPct,
      perK: perK(gainPct, cost),
      note: buff?.note ?? `${s.worth.toFixed(0)} points over your casts`,
      affordable: s.affordable
    })
  }
  const per = (r: NextRow) => r.perK ?? -1
  return rows.sort(
    (a, b) => Number(b.gainPct !== null) - Number(a.gainPct !== null) || per(b) - per(a) || Number(b.affordable) - Number(a.affordable) || a.name.localeCompare(b.name)
  )
}

/**
 * What a buff's next rank gives in the list's terms: its stats priced by your weights over what 1% more
 * weapon damage counts for, plus its proc's share of your damage times the proc's rate. Null when
 * neither can be said.
 */
function buffGain(s: SpellUpgradeOption, o: { ratioWeight: number; damageShare: (spell: string) => number | null; weights?: Weights }): { pct: number; note: string } | null {
  const parts: string[] = []
  let pct = 0
  if (s.row.rankStats && o.weights && o.ratioWeight > 0) {
    // Not a hand: a shield's AC rule has no place here.
    const { shieldAc: _shield, ...w } = o.weights
    const points = score(s.row.rankStats, w)
    pct += points / o.ratioWeight
    parts.push(`${points.toFixed(1)} points by your weights`)
  }
  const share = s.row.procSpell ? o.damageShare(s.row.procSpell) : null
  if (share !== null) {
    pct += EFFECT_RANK_PCT.procDamage * share
    parts.push(`${s.row.procSpell} ${(share * 100).toFixed(1)}% of your damage`)
  }
  return parts.length ? { pct, note: parts.join('; ') } : null
}

/** Each spell's share of your damage in a meter segment, by its unranked name, from your skills' totals (DoT ticks with their hits). */
export function spellShares(skills: Readonly<Record<string, { name: string; total: number; how: string }>>, unranked: (name: string) => string): Map<string, number> {
  let all = 0
  const by = new Map<string, number>()
  for (const s of Object.values(skills)) {
    all += s.total
    if (s.how !== 'spell' && s.how !== 'dot') continue
    const k = unranked(s.name)
    by.set(k, (by.get(k) ?? 0) + s.total)
  }
  if (all <= 0) return new Map()
  return new Map([...by].map(([k, v]) => [k, v / all]))
}
