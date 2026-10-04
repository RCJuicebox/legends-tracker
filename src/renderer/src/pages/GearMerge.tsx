import { Fragment, useMemo } from 'react'
import { num1 } from '../../../core/format'
import { api } from '../api'
import { useLootView } from '../hooks'
import { remember, useRemembered } from '../remember'
import { showError, showToast } from '../toast'
import { Ago, GameCommand, Info, Segmented, Tip } from '../components/ui'
import { num } from '../../../core/format'
import { useStock } from './MotePlanner'
import { itemKey, parseStatsBlock, slotLabel, type InvItem } from '../../../core/inventory'
import type { LootEntry } from '../../../core/loot'
import { mergeOptions, type MergeOption } from '../../../core/mergeValue'
import { MAX_LEVEL } from '../../../core/moteCalc'
import { MOTE_RANKS } from '../../../core/motes'
import { ROLE_PRESETS } from '../../../core/statValue'
import { WEIGHT_LABELS, type HandWeights, type WeightKey, type Weights } from '../../../core/gearFinder'
import type { InventoryView } from '../../../shared/types'
import { TAB_KEY } from '../nav'

const moteName = (i: number, n: number) => `${n === 1 ? 'Mote' : 'Motes'} of ${MOTE_RANKS[i].name ? MOTE_RANKS[i].name + ' ' : ''}Potential`
/** A rank as the Motes page's chips name it: "Major", "Potential". */
const rankName = (i: number) => MOTE_RANKS[i].name || 'Potential'

const HOW =
  'Every worn item the wiki knows, with what its next merge level would add to your stats, weighed the way the upgrade finder weighs them for the role picked ' +
  'above. The cost is the motes that level takes: a +N item needs 2^N xp from the mote of rank N+1, and since two motes of a rank make one of the next, a mote is ' +
  'worth 2^rank Infinitesimal motes. Gain per 100 is the stat gain per 100 Infinitesimal motes’ worth spent, so the cheap low levels of a good item come first ' +
  'and the top levels of anything come last. Under the motes: how many of that rank you have, and how many more combining your lower ranks would make. Plan puts the item in the Merge planner, the next tab.'

function Deltas({ d }: { d: Partial<Record<WeightKey, number>> }) {
  const parts = (Object.entries(d) as [WeightKey, number][]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  if (!parts.length) return <span className="faint">no weighed stat changes</span>
  return (
    <>
      {parts.map(([k, v], i) => (
        <Fragment key={k}>
          {/* The comma outside, so a long list breaks between stats and never inside one. */}
          {i > 0 && ', '}
          <span className="nowrap">
            {WEIGHT_LABELS[k]} {v > 0 ? '+' : ''}
            {num1(v)}
          </span>
        </Fragment>
      ))}
    </>
  )
}

/**
 * Gear looted or merged since the inventory export was written: the export is the only record of
 * what is worn, so after those the list may be behind the game.
 */
function useSinceExport(view: InventoryView) {
  const q = useLootView()
  const me = (view.character || '').split('_')[0].toLowerCase()
  return useMemo(() => {
    const mine = (e: LootEntry) => e.looter === 'You' || e.looter.toLowerCase() === me
    const later = (q.data?.entries ?? []).filter((e) => view.modified > 0 && e.at > view.modified && mine(e) && !/\bMotes? of\b/i.test(e.item))
    const merged = later.filter((e) => e.outcome === 'merged')
    return { looted: later.length, merged: merged.length, into: [...new Set(merged.map((e) => e.into).filter((x): x is string => !!x))] }
  }, [q.data, view.modified, me])
}

/** Motes › Best merge: which worn item's next +1 gives the most for its motes. */
export function MergeTab({
  view,
  weights,
  hands,
  preset,
  setPreset,
  onPlan
}: {
  view: InventoryView
  weights: Weights
  hands: HandWeights | null
  preset: string
  setPreset: (p: string) => void
  onPlan?: () => void
}) {
  const stockQ = useStock()
  const stock = stockQ.data
  const since = useSinceExport(view)
  const [sortBy, setSortBy] = useRemembered<'rate' | 'gain'>('merge.sort', 'rate')
  const [onlyAffordable, setOnlyAffordable] = useRemembered<boolean>('merge.affordable', false)
  const worn = useMemo(() => view.inventory?.worn ?? [], [view.inventory])

  const options = useMemo(() => {
    const baseStatsOf = (item: InvItem) => {
      const info = view.items[itemKey(item.name)]
      return info?.found ? parseStatsBlock(info.statsblock) : null
    }
    const all = mergeOptions({ worn, baseStatsOf, weights, hands, stock: stock?.counts, planned: stock?.item })
    return sortBy === 'gain' ? [...all].sort((a, b) => b.gain - a.gain || a.cost - b.cost) : all
  }, [worn, view.items, weights, hands, stock, sortBy])
  const shown = onlyAffordable ? options.filter((o) => o.affordable) : options
  const unknown = worn.filter((it) => !view.items[itemKey(it.name)]?.found).length
  const maxed = worn.filter((it) => /\+10$/.test(it.name.trim())).length

  const plan = async (o: MergeOption) => {
    try {
      await api.invoke('stock:item', { name: o.item.name, lvl: o.level, xp: 0, to: Math.min(MAX_LEVEL + 1, o.level + 1) })
    } catch (e) {
      showError('Could not set up the planner', e)
      return
    }
    remember(TAB_KEY.motes, 'planner')
    if (onPlan) onPlan()
    else showToast(`${o.item.name} is set up in Motes › Merge planner`)
  }

  return (
    <div className="stack gap-12">
      <div className="card stack gap-12">
        <div className="row">
          <b>Weigh stats for</b>
          <Segmented label="Weigh stats for" value={preset} onChange={setPreset} options={[...Object.keys(ROLE_PRESETS), 'Custom'].map((name) => [name, name] as const)} />
          <Info label="How the best merge is worked out" text={HOW} />
          <span className="grow" />
          <b>Order by</b>
          <Segmented
            label="Order by"
            value={sortBy}
            onChange={setSortBy}
            options={[
              ['rate', 'Gain per mote value', 'Stat gain per mote value spent'],
              ['gain', 'Gain', 'The biggest boost, whatever it costs']
            ]}
          />
          <label className="row tight">
            <input type="checkbox" checked={onlyAffordable} onChange={(e) => setOnlyAffordable(e.target.checked)} />
            Only what your motes cover
          </label>
        </div>
        <p className="muted small m-0">
          The next +1 of each item you wear, best stat boost per mote first. What you wear comes from the inventory export
          {view.modified > 0 && (
            <>
              {' '}
              written <Ago t={view.modified} />
            </>
          )}
          ; motes on hand from the Merge planner{stock ? '' : ' (not loaded yet)'}.
          {unknown > 0 && ` ${unknown} worn item${unknown === 1 ? ' is' : 's are'} not on the wiki, so ${unknown === 1 ? 'it is' : 'they are'} left out.`}
          {maxed > 0 && ` ${maxed} ${maxed === 1 ? 'is' : 'are'} at +10 already.`}
        </p>
      </div>

      {since.looted > 0 && (
        <div className="notice warn">
          Since that export you looted {since.looted} piece{since.looted === 1 ? '' : 's'} of gear
          {since.merged > 0 ? ` and merged ${since.merged} into ${since.into.length ? since.into.join(', ') : 'your gear'}` : ''}, so this list may not be what you wear now. Type{' '}
          <GameCommand cmd="/outputfile inventory" /> in game and it follows the new file.
        </div>
      )}

      {!shown.length ? (
        <div className="card empty">{options.length ? 'Your motes do not cover any next level yet.' : 'Nothing to merge: no worn item the wiki knows is under +10.'}</div>
      ) : (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Step</th>
                <th>What it adds</th>
                <th className="num" title="In the finder's score, with the role's weights">
                  Gain
                </th>
                <th title="The motes the step takes, and how many you could make">Motes</th>
                <th className="num" title="Those motes' combine value, in Infinitesimal motes">
                  Value (Infinitesimal)
                </th>
                <th className="num" title="Gain per 100 Infinitesimal motes' worth">
                  Gain / 100
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((o, i) => (
                <tr key={`${o.item.location}#${i}#${o.item.name}`} className={o.affordable ? '' : 'faint'}>
                  <td style={{ minWidth: 200 }}>
                    <div style={{ fontWeight: 600 }}>{o.item.name}</div>
                    <div className="small muted">{slotLabel(o.item.location)}</div>
                  </td>
                  <td className="mono nowrap">
                    +{o.level} → +{o.next}
                  </td>
                  <td className="small" style={{ maxWidth: 320 }}>
                    <Deltas d={o.deltas} />
                  </td>
                  <td className="mono num">{num1(o.gain)}</td>
                  <td className="small">
                    <Tip
                      className={`chip ${o.affordable ? 'ok' : 'warn'}`}
                      text={`${o.motes} ${moteName(o.mote, o.motes)}: ${o.need} xp. You have ${num(o.held)}${o.canMake > o.held ? `; combining your lower ranks makes ${num(o.canMake - o.held)} more, ${num(o.canMake)} in all` : ''}.`}
                    >
                      {o.motes} × {rankName(o.mote)}
                    </Tip>
                    <div className="faint">
                      have {num(o.held)}
                      {o.canMake > o.held && ` · +${num(o.canMake - o.held)} by combining`}
                    </div>
                  </td>
                  <td className="mono num">{num(o.cost)}</td>
                  <td className="mono num">{num1(o.rate)}</td>
                  <td>
                    <button className="btn ghost small" onClick={() => void plan(o)} title="Put this item in the Merge planner">
                      Plan
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
