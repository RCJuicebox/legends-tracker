import { useEffect, useMemo, useState } from 'react'
import { api, errorMessage } from '../api'
import { useDebounced, useInvoke } from '../hooks'
import { showError } from '../toast'
import { ConfirmButton, Pending, Switch } from '../components/ui'
import { numExact as num } from '../../../core/format'
import { bestFor, farmPlaces, FRAGMENT_RANKS, fragmentName, fragmentSpellXp, MOTE_RANKS } from '../../../core/motes'
import { countsToArray, fixItem, levelFromName, makeable, plan, MAX_LEVEL, type PlanUse } from '../../../core/moteCalc'
import type { MoteStock } from '../../../shared/types'
import type { Invokes } from '../../../shared/ipc'
import type { MoteScreenRead } from '../../../shared/ipc'

const short = (i: number) => MOTE_RANKS[i].name || 'Potential'
const long = (i: number, n: number) => `${n === 1 ? 'Mote' : 'Motes'} of ${MOTE_RANKS[i].name ? MOTE_RANKS[i].name + ' ' : ''}Potential`
const fragLong = (i: number, n: number) => fragmentName(FRAGMENT_RANKS[i].key, n)

/** "3 × Motes of Major Potential at 5 xp each", "1 × Fragment of Grand Potential at 24 xp each (a guess …)". */
function spendLine(u: PlanUse): string {
  if (u.kind === 'mote') return `${num(u.n)} × ${long(u.m, u.n)} at ${MOTE_RANKS[u.m].xp} xp each`
  const r = FRAGMENT_RANKS[u.m]
  return `${num(u.n)} × ${fragLong(u.m, u.n)} at ${r.xp} xp each${r.checked ? '' : ' (a guess: not seen in game yet)'}`
}

export function useStock() {
  const q = useInvoke('stock:get')
  const setData = q.setData
  useEffect(() => api.on('state:stock', (s: MoteStock) => setData(s)), [setData])
  return q
}

/** A stock write; the reply is the stock as stored. A failure is shown and changes nothing. */
/** How long typing in the planner waits before it is written. */
const SAVE_MS = 400

type StockWrite = 'stock:counts' | 'stock:fragments' | 'stock:fragmentsOnItems' | 'stock:item' | 'stock:autoAdd' | 'stock:apply'

async function writeStock<K extends StockWrite>(set: (s: MoteStock) => void, channel: K, ...args: Parameters<Invokes[K]>): Promise<void> {
  try {
    set(await api.invoke(channel, ...args))
  } catch (e) {
    showError('Could not update your motes', e)
  }
}

type ScreenRead = MoteScreenRead

function ReadFromScreen({ stock, onApplied }: { stock: MoteStock; onApplied: (s: MoteStock) => void }) {
  const [busy, setBusy] = useState(false)
  const [read, setRead] = useState<ScreenRead | null>(null)
  const [error, setError] = useState('')
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      setRead(await api.invoke('stock:readScreen'))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const found = read ? MOTE_RANKS.filter((r) => read.counts[r.key] !== undefined) : []
  return (
    <div className="stack gap-12 mb-16">
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => void run()}>
          {busy ? 'Reading the screen…' : 'Read motes from screen'}
        </button>
        <span className="faint small">Open your currency window in game first. This window steps aside for a second while it looks.</span>
      </div>
      {error && <div className="notice bad">Could not read the screen: {error}</div>}
      {read && found.length === 0 && (
        <div className="notice">
          No mote counts found on {read.screens} screen{read.screens === 1 ? '' : 's'}. Is the currency window open and not covered?
          {read.nearMisses.length > 0 && (
            <div className="small mono" style={{ marginTop: 6 }}>
              Nearby text it did read: {read.nearMisses.join(' · ')}
            </div>
          )}
        </div>
      )}
      {read && found.length > 0 && (
        <div className="action-card">
          <b>Read from the screen</b>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Mote</th>
                  <th>On screen</th>
                  <th>Your stock</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {found.map((r) => {
                  const now = stock.counts[r.key] ?? 0
                  const seen = read.counts[r.key]
                  return (
                    <tr key={r.key}>
                      <td>{r.name || 'Potential'}</td>
                      <td className="mono">{seen}</td>
                      <td className="mono">{now}</td>
                      <td>{seen === now ? <span className="chip ok">same</span> : <span className="chip warn">{seen > now ? `+${seen - now}` : seen - now}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  onApplied(await api.invoke('stock:counts', { ...stock.counts, ...read.counts }))
                  setRead(null)
                } catch (e) {
                  setError(errorMessage(e))
                }
              }}
            >
              Apply these counts
            </button>
            <button className="btn ghost" onClick={() => setRead(null)}>
              Discard
            </button>
            <span className="faint small">Ranks it did not see keep their current counts.</span>
          </div>
          <details className="small faint">
            <summary>Rows it read</summary>
            <div className="mono">
              {read.rows.map((r, i) => (
                <div key={i}>{r}</div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

export function MotePlanner() {
  const q = useStock()
  const stock = q.data
  const setStock = q.setData
  // Typed values are kept as text while editing, so a field can be cleared and retyped.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const item = useMemo(() => fixItem(stock?.item ?? {}), [stock?.item])
  const useFragments = stock?.fragmentsOnItems !== false
  const result = useMemo(() => (stock ? plan(item, stock.counts, useFragments ? (stock.fragments ?? {}) : {}) : null), [item, stock, useFragments])
  // What is typed shows at once and is written once typing stops.
  const saveItem = useDebounced((d: MoteStock['item']) => void writeStock(setStock, 'stock:item', d), SAVE_MS)
  const saveCounts = useDebounced((c: MoteStock['counts']) => void writeStock(setStock, 'stock:counts', c), SAVE_MS)
  const saveFragments = useDebounced((c: MoteStock['counts']) => void writeStock(setStock, 'stock:fragments', c), SAVE_MS)
  if (!stock || !result) return <Pending what="your mote stock" error={q.error} retry={q.reload} />

  const inv = countsToArray(stock.counts)
  const setItem = async (patch: Partial<MoteStock['item']>, field: string) => {
    const d = { ...stock.item, ...patch }
    if (field === 'name') {
      const lvl = levelFromName(String(patch.name))
      if (lvl !== null) Object.assign(d, { lvl, xp: 0, to: lvl + 1 })
    }
    if (field === 'lvl') d.to = Math.max(Number(d.to) || 0, (Number(d.lvl) || 0) + 1)
    setStock({ ...stock, item: d })
    saveItem.call(d)
  }
  const setCount = async (key: string, value: string) => {
    setDraft((x) => ({ ...x, [key]: value }))
    const v = Math.max(0, Math.floor(Number(value) || 0))
    const counts = { ...stock.counts, [key]: v }
    setStock({ ...stock, counts })
    saveCounts.call(counts)
  }
  const setFragment = (key: string, value: string) => {
    setDraft((x) => ({ ...x, [`f:${key}`]: value }))
    const fragments = { ...stock.fragments, [key]: Math.max(0, Math.floor(Number(value) || 0)) }
    setStock({ ...stock, fragments })
    saveFragments.call(fragments)
  }
  const spent = [
    ...(result.after ? MOTE_RANKS.map((r, i) => ({ d: (stock.counts[r.key] ?? 0) - result.after![i], name: short(i) })) : []),
    ...(result.afterFragments && useFragments
      ? FRAGMENT_RANKS.map((r, i) => ({ d: (stock.fragments?.[r.key] ?? 0) - result.afterFragments![i], name: `${short(i)} fragment` }))
      : [])
  ].filter((x) => x.d > 0)

  return (
    <div className="grid two" style={{ alignItems: 'start' }}>
      <div className="card stack gap-16">
        <h2>Item</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Put in the item's level and the xp in its bar. It works out which motes you need, how many, and what to combine from your stock.
        </p>
        <label className="field">
          <span>Name</span>
          <input value={stock.item.name} placeholder="Wu's Fist of Mastery +6" onChange={(e) => void setItem({ name: e.target.value }, 'name')} />
        </label>
        <div className="grid three">
          <label className="field">
            <span>Level now</span>
            <input type="number" min={0} max={MAX_LEVEL} value={item.lvl} onChange={(e) => void setItem({ lvl: Number(e.target.value) }, 'lvl')} />
          </label>
          <label className="field">
            <span>XP in bar (of {num(2 ** item.lvl)})</span>
            <input type="number" min={0} value={item.xp} onChange={(e) => void setItem({ xp: Number(e.target.value) }, 'xp')} />
          </label>
          <label className="field">
            <span>Upgrade to</span>
            <input type="number" min={1} max={MAX_LEVEL + 1} value={item.to} onChange={(e) => void setItem({ to: Number(e.target.value) }, 'to')} />
          </label>
        </div>

        <div className="stack gap-12">
          {result.steps.map((st) => {
            const state = st.noMote || st.short ? 'bad' : st.unsourced ? '' : 'ok'
            const pill = st.noMote ? 'No mote' : st.short ? `Short ${num(st.short)}` : st.unsourced ? 'Needs the step above' : 'Covered'
            const byCarry = !st.unsourced && !st.noMote && st.carried >= st.need
            return (
              <div key={st.from} className="action-card">
                <div className="row">
                  <b>
                    +{st.from} → +{st.to}
                  </b>
                  <span className="muted">{num(st.need)} xp</span>
                  <span className="grow" />
                  <span className={`chip ${state}`}>{pill}</span>
                </div>
                {st.noMote ? (
                  <div className="muted small">No mote upgrades a +{st.from} item. Mote of Infinite Potential tops out at +9 → +10.</div>
                ) : st.unsourced ? (
                  <div className="muted small">Planned once the level above is covered.</div>
                ) : byCarry ? (
                  <div className="muted small">Reached on xp carried over from the level below.</div>
                ) : (
                  <>
                    {st.carried > 0 && (
                      <div className="muted small">
                        {num(st.carried)} of {num(st.need)} xp already in the bar.
                      </div>
                    )}
                    {(st.combos.length > 0 || st.uses.length > 0) && (
                      <ol className="steps" style={{ fontSize: 13 }}>
                        {st.combos.map((c, i) => (
                          <li key={`c${i}`}>
                            Combine {num(c.n)} {short(c.from)} into {num(c.make)} {short(c.to)}
                          </li>
                        ))}
                        {st.uses.map((u, i) => (
                          <li key={`u${i}`}>Use {spendLine(u)}</li>
                        ))}
                      </ol>
                    )}
                    {!!st.short && (
                      <div className="notice bad small">
                        You're {num(st.short)} {short(st.m)} short, counting everything you could combine.
                        <WhereToFarm rank={st.m} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>

        {result.covered > 0 && (
          <div className="stack gap-8">
            <div className="muted small">
              From your stock this uses {spent.map((x) => `${num(x.d)} ${x.name}`).join(', ')}.
              {result.xp > 0 ? ` The item ends at +${result.reached} with ${num(result.xp)} xp in its bar.` : ''}
            </div>
            <ConfirmButton className="btn primary" question="Take them off your stock?" onConfirm={() => void writeStock(setStock, 'stock:apply')}>
              Done: take them off my stock and set the item to +{result.reached}
            </ConfirmButton>
          </div>
        )}
        <p className="faint small" style={{ margin: 0 }}>
          A mote or fragment works on any item below its rank: a Superior (rank 7) on +0 to +6. XP past a level carries on into the next. Each level takes whatever in your stock
          gives its xp cheapest, counted in what it would give a spell instead: that is the lowest mote rank that works, combined up from the ranks below when you have none. Two
          motes combine into one of the next rank; fragments do not.
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Your motes</h2>
          <span className="spacer" />
          <span className="row tight">
            <Switch on={stock.autoAdd} label="Add looted motes automatically" onChange={(v) => void writeStock(setStock, 'stock:autoAdd', v)} />
            Add looted motes automatically
          </span>
        </div>
        <ReadFromScreen stock={stock} onApplied={setStock} />
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Mote</th>
                <th title="Item xp each mote gives">XP each</th>
                <th title="The item levels this mote works on">Works on</th>
                <th>Have</th>
                <th title="Counting what you could combine up from the ranks below">Can make</th>
              </tr>
            </thead>
            <tbody>
              {MOTE_RANKS.map((r, i) => (
                <tr key={r.key}>
                  <td>{long(i, 2)}</td>
                  <td className="mono">{r.xp}</td>
                  <td className="mono">{i ? `+0 to +${i}` : '+0'}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      style={{ width: 80 }}
                      aria-label={`${long(i, 2)} you have`}
                      value={draft[r.key] ?? String(stock.counts[r.key] ?? 0)}
                      onChange={(e) => void setCount(r.key, e.target.value)}
                      onBlur={() => setDraft((x) => ({ ...x, [r.key]: undefined as unknown as string }))}
                    />
                  </td>
                  <td className="mono">{num(makeable(inv, i))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint small">
          {stock.autoAdd
            ? 'Every mote and fragment you loot is added here as it drops, including reward chests. Edit a count if it is off.'
            : 'Counts change only when you edit them or press Done.'}
        </p>
        <div className="card-head">
          <h3>Fragments of Potential</h3>
          <span className="spacer" />
          <span className="row tight">
            <Switch on={useFragments} label="Use fragments on items" onChange={(v) => void writeStock(setStock, 'stock:fragmentsOnItems', v)} />
            Use fragments on items
          </span>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Fragment</th>
                <th title="Item xp each fragment gives, from the game's upgrade previews">Item xp</th>
                <th title="Spell xp each fragment gives: twice its rank's mote">Spell xp</th>
                <th title="The item levels this fragment works on">Works on</th>
                <th>Have</th>
              </tr>
            </thead>
            <tbody>
              {FRAGMENT_RANKS.map((r, i) => (
                <tr key={r.key}>
                  <td>{fragLong(i, 2)}</td>
                  <td className="mono" title={r.checked ? 'Seen in game' : 'A guess from the pattern: not seen in game yet'}>
                    {r.checked ? r.xp : `${r.xp}?`}
                  </td>
                  <td className="mono">{num(fragmentSpellXp(i))}</td>
                  <td className="mono">{i ? `+0 to +${i}` : '+0'}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      style={{ width: 80 }}
                      aria-label={`${fragLong(i, 2)} you have`}
                      value={draft[`f:${r.key}`] ?? String(stock.fragments?.[r.key] ?? 0)}
                      onChange={(e) => setFragment(r.key, e.target.value)}
                      onBlur={() => setDraft((x) => ({ ...x, [`f:${r.key}`]: undefined as unknown as string }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint small" style={{ marginBottom: 0 }}>
          Fragments do not combine, and the game hands back any the item cannot take. Item xp marked ? is a guess (2, 3, 4, 6, 8, 12, 16, 24, 32 by rank) until one is previewed in
          game. {useFragments ? 'The plan spends them where they are the cheapest xp.' : 'The plan leaves them for spells.'} Read from screen counts motes only.
        </p>
      </div>
    </div>
  )
}

/** Where your runs dropped a rank fastest (FEAT-035): "The Plane of Hate 4 (Refined) dropped 2.1 Superior an hour over 9 runs". */
function WhereToFarm({ rank }: { rank: number }) {
  const runs = useInvoke('motes:get').data
  const best = useMemo(() => (runs ? bestFor(farmPlaces(runs.sessions, Date.now()), MOTE_RANKS[rank].key) : []), [runs, rank])
  if (!best.length) return null
  const b = best[0]
  return (
    <>
      {' '}
      {b.name} dropped {b.perHour.toFixed(1)} {short(rank)} an hour over {num(b.runs)} runs
      {best[1] ? `; ${best[1].name} ${best[1].perHour.toFixed(1)}` : ''}.
    </>
  )
}
