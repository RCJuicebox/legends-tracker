import { useEffect, useMemo } from 'react'
import { ago, api } from '../api'
import { useInvoke } from '../hooks'
import { remember, useRemembered } from '../remember'
import { showError, showToast } from '../toast'
import { Info } from '../components/ui'
import { num } from '../format'
import { useStock } from './MotePlanner'
import { itemKey, parseStatsBlock, slotLabel, type InvItem } from '../../../core/inventory'
import type { LootEntry } from '../../../core/loot'
import { mergeOptions, type MergeOption } from '../../../core/mergeValue'
import { MAX_LEVEL } from '../../../core/moteCalc'
import { MOTE_RANKS } from '../../../core/motes'
import { ROLE_PRESETS } from '../../../core/statValue'
import { WEIGHT_LABELS, type WeightKey, type Weights } from '../../../core/upgrades'
import type { InventoryView } from '../../../shared/types'

const moteName = (i: number, n: number) => `${n === 1 ? 'Mote' : 'Motes'} of ${MOTE_RANKS[i].name ? MOTE_RANKS[i].name + ' ' : ''}Potential`
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

const HOW =
  'Every worn item the wiki knows, with what its next merge level would add to your stats, weighed the way the upgrade finder weighs them for the role picked ' +
  'above. The cost is the motes that level takes: a +N item needs 2^N xp from the mote of rank N+1, and since two motes of a rank make one of the next, a mote is ' +
  'worth 2^rank Infinitesimal motes. Gain per 100 is the stat gain per 100 Infinitesimal motes’ worth spent, so the cheap low levels of a good item come first ' +
  'and the top levels of anything come last. Have counts what you could combine up from lower ranks. Plan puts the item in the Motes page’s upgrade planner.'

function Deltas({ d }: { d: Partial<Record<WeightKey, number>> }) {
  const parts = (Object.entries(d) as [WeightKey, number][]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  if (!parts.length) return <span className="faint">no weighed stat changes</span>
  return (
    <>
      {parts.map(([k, v], i) => (
        <span key={k} className="nowrap">
          {i > 0 && ', '}
          {WEIGHT_LABELS[k]} {v > 0 ? '+' : ''}
          {fmt(v)}
        </span>
      ))}
    </>
  )
}

/**
 * Gear looted or merged since the inventory export was written: the export is the only record of
 * what is worn, so after those the list may be behind the game.
 */
function useSinceExport(view: InventoryView) {
  const q = useInvoke<{ entries: LootEntry[] }>('loot:get')
  const setData = q.setData
  useEffect(() => api.on('state:loot', (v: { entries: LootEntry[] }) => setData(v)), [setData])
  const me = (view.character || '').split('_')[0].toLowerCase()
  return useMemo(() => {
    const mine = (e: LootEntry) => e.looter === 'You' || e.looter.toLowerCase() === me
    const later = (q.data?.entries ?? []).filter((e) => view.modified > 0 && e.at > view.modified && mine(e) && !/\bMotes? of\b/i.test(e.item))
    const merged = later.filter((e) => e.outcome === 'merged')
    return { looted: later.length, merged: merged.length, into: [...new Set(merged.map((e) => e.into).filter((x): x is string => !!x))] }
  }, [q.data, view.modified, me])
}

/** The Gear page's Best merge tab: which worn item's next +1 gives the most for its motes. */
export function MergeTab({ view, weights, preset, setPreset, go }: { view: InventoryView; weights: Weights; preset: string; setPreset: (p: string) => void; go?: (page: 'motes') => void }) {
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
    const all = mergeOptions({ worn, baseStatsOf, weights, stock: stock?.counts, planned: stock?.item })
    return sortBy === 'gain' ? [...all].sort((a, b) => b.gain - a.gain || a.cost - b.cost) : all
  }, [worn, view.items, weights, stock, sortBy])
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
    remember('motes.tab', 'planner')
    if (go) go('motes')
    else showToast(`${o.item.name} is set up in Motes › Upgrade planner`)
  }

  return (
    <div className="stack gap-12">
      <div className="card stack gap-12">
        <div className="row">
          <b>Weigh stats for</b>
          <span className="lt-seg" role="group" aria-label="Weigh stats for">
            {[...Object.keys(ROLE_PRESETS), 'Custom'].map((name) => (
              <button key={name} className={preset === name ? 'on' : ''} aria-pressed={preset === name} onClick={() => setPreset(name)}>
                {name}
              </button>
            ))}
          </span>
          <Info label="How the best merge is worked out" text={HOW} />
          <span className="grow" />
          <b>Order by</b>
          <span className="lt-seg" role="group" aria-label="Order by">
            <button className={sortBy === 'rate' ? 'on' : ''} aria-pressed={sortBy === 'rate'} onClick={() => setSortBy('rate')} title="Stat gain per mote value spent">
              Gain per mote value
            </button>
            <button className={sortBy === 'gain' ? 'on' : ''} aria-pressed={sortBy === 'gain'} onClick={() => setSortBy('gain')} title="The biggest boost, whatever it costs">
              Gain
            </button>
          </span>
          <label className="row tight">
            <input type="checkbox" checked={onlyAffordable} onChange={(e) => setOnlyAffordable(e.target.checked)} />
            Only what your motes cover
          </label>
        </div>
        <p className="muted small m-0">
          The next +1 of each item you wear, best stat boost per mote first. What you wear comes from the inventory export
          {view.modified > 0 ? ` written ${ago(view.modified)}` : ''}; motes on hand from the Motes page{stock ? '' : ' (not loaded yet)'}.
          {unknown > 0 && ` ${unknown} worn item${unknown === 1 ? ' is' : 's are'} not on the wiki, so ${unknown === 1 ? 'it is' : 'they are'} left out.`}
          {maxed > 0 && ` ${maxed} ${maxed === 1 ? 'is' : 'are'} at +10 already.`}
        </p>
      </div>

      {since.looted > 0 && (
        <div className="notice bad">
          Since that export you looted {since.looted} piece{since.looted === 1 ? '' : 's'} of gear
          {since.merged > 0 ? ` and merged ${since.merged} into ${since.into.length ? since.into.join(', ') : 'your gear'}` : ''}, so this list may not be what you wear now. Type{' '}
          <span className="mono">/outputfile inventory</span> in game and it follows the new file.
        </div>
      )}

      {!shown.length ? (
        <div className="card empty">{options.length ? 'Your motes do not cover any next level yet.' : 'Nothing to merge: no worn item the wiki knows is under +10.'}</div>
      ) : (
        <div className="card">
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
                  Value
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
                  <td>
                    <div style={{ fontWeight: 600 }}>{o.item.name}</div>
                    <div className="small muted">{slotLabel(o.item.location)}</div>
                  </td>
                  <td className="mono nowrap">
                    +{o.level} → +{o.next}
                  </td>
                  <td className="small">
                    <Deltas d={o.deltas} />
                  </td>
                  <td className="mono num">{fmt(o.gain)}</td>
                  <td className="small">
                    <span className={`chip ${o.affordable ? 'ok' : 'warn'}`} title={`${o.need} xp; you could make ${num(o.canMake)}`}>
                      {o.motes} × {moteName(o.mote, o.motes)}
                    </span>
                    <div className="faint">have {num(o.canMake)}</div>
                  </td>
                  <td className="mono num">{num(o.cost)}</td>
                  <td className="mono num">{fmt(o.rate)}</td>
                  <td>
                    <button className="btn ghost small" onClick={() => void plan(o)} title="Put this item in the Motes page's upgrade planner">
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
