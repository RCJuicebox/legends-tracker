import { useMemo } from 'react'
import { useSettled, useLive } from '../state'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { useCharacterChoice } from '../character'
import { useInventory } from '../gear/model'
import { useCharacterWeights } from '../gear/useCharacterWeights'
import { useCombat } from '../combat'
import { useStock } from './MotePlanner'
import { Info, Pending } from '../components/ui'
import { num, num1 } from '../../../core/format'
import { itemKey, parseStatsBlock, type InvItem } from '../../../core/inventory'
import { mergeOptions } from '../../../core/mergeValue'
import { castableByMine, DEFAULT_SPELL_WEIGHTS, spellUpgradeOptions, type SpellWeights } from '../../../core/spellMotes'
import { spellBase } from '../../../core/combatMeter'
import { nextRanking, spellShares } from '../../../core/moteNext'
import type { CharacterSheet, InventoryView } from '../../../shared/types'

// Motes › Next (FEAT-033): Best merge and Spell upgrades in one list, with what each step costs in
// Infinitesimal motes' worth and, where it can be said, how much more of your damage it gives.

const HOW =
  "An item's next merge counts its gain in your stat weights, over what 1% more weapon damage counts for in them. A damage spell's next rank counts its damage bonus times that spell's share of your damage in this meter session. Heals, buffs and crowd control have no share of damage to put on them: they follow, by their own worth. Cost is the motes' combine value in Infinitesimal motes."

export function MoteNext() {
  const exp = useCharacterChoice('inventory')
  const inv = useInventory(exp.character, !!exp.exports, exp.available.join(','))
  if (!inv.view?.inventory) return <Pending what="your gear" error={inv.error} retry={inv.reload} />
  return <Ranking view={inv.view} sheet={inv.sheet} />
}

function Ranking({ view, sheet }: { view: InventoryView; sheet: CharacterSheet | null }) {
  const c = useCharacterWeights(view, sheet)
  const stock = useStock().data
  const tracking = useSettled((s) => s.settings.tracking)
  const spellsLoaded = useLive((l) => l.status.spellsLoaded)
  const [spellWeights] = useRemembered<SpellWeights>('spellmotes.weights', DEFAULT_SPELL_WEIGHTS)
  const spellsQ = useInvoke(view.character ? 'motes:spellCasts' : null, [view.character, 14], [spellsLoaded])
  const snap = useCombat()
  const sessionId = snap?.liveSession?.id ?? snap?.sessions[0]?.id ?? ''
  const segQ = useInvoke(sessionId ? 'combat:segment' : null, [sessionId])

  const rows = useMemo(() => {
    const baseStatsOf = (item: InvItem) => {
      const info = view.items[itemKey(item.name)]
      return info?.found ? parseStatsBlock(info.statsblock) : null
    }
    const items = mergeOptions({ worn: view.inventory?.worn ?? [], baseStatsOf, weights: c.weights, hands: c.hands, stock: stock?.counts, planned: stock?.item })
    const data = spellsQ.data
    const mine = data?.mine ?? []
    const spellRows = mine.length ? (data?.rows ?? []).filter((r) => castableByMine(r, mine)) : (data?.rows ?? [])
    const spells = spellUpgradeOptions({ rows: spellRows, tierPct: tracking.tierDurationPct, weights: spellWeights, stock: stock?.counts })
    const you = segQ.data?.entities['you']
    const shares = you ? spellShares(you.skills, (n) => spellBase(n)) : new Map<string, number>()
    return nextRanking(items, spells, { ratioWeight: c.weights.ratio, damageShare: (name) => shares.get(name.toLowerCase()) ?? null })
  }, [view, c.weights, c.hands, stock, spellsQ.data, tracking.tierDurationPct, spellWeights, segQ.data])

  return (
    <div className="card">
      <div className="row mb-8">
        <span className="muted small">
          Your next merges and spell ranks in one list, the most of your damage per mote first. <Info label="How it is worked out" text={HOW} />
        </span>
      </div>
      {!rows.length ? (
        <div className="empty">Nothing to rank: no worn item the wiki knows under +10, and no spell cast lately to put motes into.</div>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>What</th>
                <th>Step</th>
                <th>Cost</th>
                <th>Gain</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((r) => (
                <tr key={`${r.kind}|${r.name}`} className={r.affordable ? '' : 'faint'}>
                  <td>
                    <b>{r.name}</b> <span className="chip small">{r.kind === 'item' ? 'merge' : 'spell'}</span>
                  </td>
                  <td className="mono nowrap">{r.step}</td>
                  <td className="mono nowrap">{r.cost === null ? <span className="faint">short</span> : num(r.cost)}</td>
                  <td className="small">{r.gainPct !== null ? <b>≈ {num1(Math.round(r.gainPct * 100) / 100)}% of your damage</b> : <span className="faint">{r.note}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
