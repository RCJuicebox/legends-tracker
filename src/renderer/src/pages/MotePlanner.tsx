import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { Switch } from '../components/ui'
import { MOTE_RANKS } from '../../../core/motes'
import { countsToArray, fixItem, levelFromName, makeable, plan } from '../../../core/moteCalc'
import type { MoteStock } from '../../../shared/types'

const short = (i: number) => MOTE_RANKS[i].name || 'Potential'
const long = (i: number, n: number) => `${n === 1 ? 'Mote' : 'Motes'} of ${MOTE_RANKS[i].name ? MOTE_RANKS[i].name + ' ' : ''}Potential`
const num = (n: number) => n.toLocaleString()

export function useStock(): [MoteStock | null, (s: MoteStock) => void] {
  const [stock, setStock] = useState<MoteStock | null>(null)
  useEffect(() => {
    void api.invoke<MoteStock>('stock:get').then(setStock)
    return api.on('state:stock', (s: MoteStock) => setStock(s))
  }, [])
  return [stock, setStock]
}

interface ScreenRead {
  counts: Record<string, number>
  rows: string[]
  nearMisses: string[]
  screens: number
}

function ReadFromScreen({ stock, onApplied }: { stock: MoteStock; onApplied: (s: MoteStock) => void }) {
  const [busy, setBusy] = useState(false)
  const [read, setRead] = useState<ScreenRead | null>(null)
  const [error, setError] = useState('')
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      setRead(await api.invoke<ScreenRead>('stock:readScreen'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const found = read ? MOTE_RANKS.filter((r) => read.counts[r.key] !== undefined) : []
  return (
    <div className="stack" style={{ gap: 10, marginBottom: 14 }}>
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
          <div className="row">
            <button
              className="btn primary"
              onClick={async () => {
                onApplied(await api.invoke<MoteStock>('stock:counts', { ...stock.counts, ...read.counts }))
                setRead(null)
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
            <div className="mono">{read.rows.map((r, i) => <div key={i}>{r}</div>)}</div>
          </details>
        </div>
      )}
    </div>
  )
}

export function MotePlanner() {
  const [stock, setStock] = useStock()
  // Typed values are kept as text while editing, so a field can be cleared and retyped.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const item = useMemo(() => fixItem(stock?.item ?? {}), [stock?.item])
  const result = useMemo(() => (stock ? plan(item, stock.counts) : null), [item, stock])
  if (!stock || !result) return <div className="empty">Loading…</div>

  const inv = countsToArray(stock.counts)
  const setItem = async (patch: Partial<MoteStock['item']>, field: string) => {
    const d = { ...stock.item, ...patch }
    if (field === 'name') {
      const lvl = levelFromName(String(patch.name))
      if (lvl !== null) Object.assign(d, { lvl, xp: 0, to: lvl + 1 })
    }
    if (field === 'lvl') d.to = Math.max(Number(d.to) || 0, (Number(d.lvl) || 0) + 1)
    setStock(await api.invoke<MoteStock>('stock:item', d))
  }
  const setCount = async (key: string, value: string) => {
    setDraft((x) => ({ ...x, [key]: value }))
    const v = Math.max(0, Math.floor(Number(value) || 0))
    setStock(await api.invoke<MoteStock>('stock:counts', { ...stock.counts, [key]: v }))
  }
  const spent = result.after
    ? MOTE_RANKS.map((r, i) => ({ i, d: (stock.counts[r.key] ?? 0) - result.after![i] })).filter((x) => x.d > 0)
    : []

  return (
    <div className="grid two" style={{ alignItems: 'start' }}>
      <div className="card stack" style={{ gap: 14 }}>
        <h2>Item</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Put in the item's level and the xp in its bar. It works out which motes you need, how many, and what to combine
          from your stock.
        </p>
        <label className="field">
          <span>Name</span>
          <input value={stock.item.name} placeholder="Wu's Fist of Mastery +6" onChange={(e) => void setItem({ name: e.target.value }, 'name')} />
        </label>
        <div className="grid three">
          <label className="field">
            <span>Level now</span>
            <input type="number" min={0} max={10} value={item.lvl} onChange={(e) => void setItem({ lvl: Number(e.target.value) }, 'lvl')} />
          </label>
          <label className="field">
            <span>XP in bar (of {num(2 ** item.lvl)})</span>
            <input type="number" min={0} value={item.xp} onChange={(e) => void setItem({ xp: Number(e.target.value) }, 'xp')} />
          </label>
          <label className="field">
            <span>Upgrade to</span>
            <input type="number" min={1} max={11} value={item.to} onChange={(e) => void setItem({ to: Number(e.target.value) }, 'to')} />
          </label>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          {result.steps.map((st) => {
            const state = st.noMote || st.short ? 'bad' : st.unsourced ? '' : 'ok'
            const pill = st.noMote ? 'No mote' : st.short ? `Short ${num(st.short)}` : st.unsourced ? 'Needs the step above' : 'Covered'
            const have = (st.count ?? 0) - (st.short ?? 0)
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
                ) : (
                  <>
                    <div>
                      <b>
                        {num(st.count!)} × {long(st.m, st.count!)}
                      </b>{' '}
                      <span className="muted">
                        at {MOTE_RANKS[st.m].xp} xp each{st.over ? `, ${st.over} xp over` : ''}
                      </span>
                    </div>
                    {!st.unsourced && (st.combos!.length > 0 || have > 0) && (
                      <ol className="steps" style={{ fontSize: 13 }}>
                        {st.combos!.map((c, i) => (
                          <li key={i}>
                            Combine {num(c.n)} {short(c.from)} into {num(c.make)} {short(c.to)}
                          </li>
                        ))}
                        {have > 0 && (
                          <li>
                            Use {num(have)} {short(st.m)} on the item
                          </li>
                        )}
                      </ol>
                    )}
                    {!!st.short && (
                      <div className="notice bad small">
                        You're {num(st.short)} {short(st.m)} short, counting everything you could combine.
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>

        {result.covered > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="muted small">From your stock this uses {spent.map((x) => `${num(x.d)} ${short(x.i)}`).join(', ')}.</div>
            <button className="btn primary" onClick={async () => setStock(await api.invoke<MoteStock>('stock:apply'))}>
              Done: take them off my stock and set the item to +{result.reached}
            </button>
          </div>
        )}
        <p className="faint small" style={{ margin: 0 }}>
          Each mote works on one item level, one below its rank: Greater on +5 items, Superior on +6. Two motes combine into one
          of the next rank. XP left over past the next level is assumed lost, so a plan spanning several levels may slightly
          overcount.
        </p>
      </div>

      <div className="card">
        <h2>
          Your motes <span className="spacer" />
          <span className="row tight" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
            <Switch on={stock.autoAdd} onChange={async (v) => setStock(await api.invoke<MoteStock>('stock:autoAdd', v))} />
            Add looted motes automatically
          </span>
        </h2>
        <ReadFromScreen stock={stock} onApplied={setStock} />
        <table className="table">
          <thead>
            <tr>
              <th>Mote</th>
              <th title="Item xp each mote gives">XP each</th>
              <th title="The item level this mote works on">Works on</th>
              <th>Have</th>
              <th title="Counting what you could combine up from the ranks below">Can make</th>
            </tr>
          </thead>
          <tbody>
            {MOTE_RANKS.map((r, i) => (
              <tr key={r.key}>
                <td>{long(i, 2)}</td>
                <td className="mono">{r.xp}</td>
                <td className="mono">+{i}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    style={{ width: 80 }}
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
        <p className="faint small" style={{ marginBottom: 0 }}>
          {stock.autoAdd
            ? 'Every mote you loot is added here as it drops, including reward chests. Edit a count if it is off.'
            : 'Counts change only when you edit them or press Done.'}
        </p>
      </div>
    </div>
  )
}
