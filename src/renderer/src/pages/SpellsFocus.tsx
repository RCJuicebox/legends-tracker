import { useState } from 'react'
import { useApp } from '../state'
import { useSearch } from '../hooks'
import { showUndo } from '../toast'
import { NumberInput, Switch } from '../components/ui'
import { type FocusSource } from '../../../shared/types'

// Spell Timers' duration focus effects: the AAs and item focus that lengthen your spells, as the tracker counts them.

/** A name or "from" typed is saved once typing stops (LT-394). */
const TYPING_MS = 400

export function FocusSources() {
  const { state, saveCharacter, latest } = useApp()
  const c = state.character
  const [q, setQ] = useState('')
  const results = useSearch('focus:search', q)
  const [from, setFrom] = useState('')
  const save = (list: FocusSource[], debounceMs?: number) => saveCharacter({ ...c, focusSources: list }, { debounceMs })
  const update = (id: string, patch: Partial<FocusSource>, debounceMs?: number) =>
    save(
      c.focusSources.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      debounceMs
    )
  // A removed focus goes back where it was, into the list as it is by then.
  const remove = (f: FocusSource) => {
    const at = c.focusSources.indexOf(f)
    void save(c.focusSources.filter((x) => x.id !== f.id))
    showUndo(`Removed ${f.name}.`, () => {
      const cur = latest().character
      if (cur.focusSources.some((x) => x.id === f.id)) return
      const list = [...cur.focusSources]
      list.splice(Math.min(at, list.length), 0, f)
      void saveCharacter({ ...cur, focusSources: list })
    })
  }
  const addCustom = () =>
    save([
      ...c.focusSources,
      {
        id: `custom-${Date.now().toString(36)}`,
        name: 'New focus',
        kind: 'aa',
        from: 'AA',
        pct: 10,
        appliesTo: 'beneficial',
        maxLevel: 0,
        decayPct: 0,
        minTicks: 0,
        requireSpas: [],
        excludeSpas: [],
        enabled: true
      }
    ])
  return (
    <div className="mt-16">
      <div className="field mb-8">
        <span>Duration focus effects</span>
        <div className="hint">
          Each applies spell by spell with its own level cap: past the cap it loses its decay percentage of itself per level. Only the best item focus counts; AAs add on top. Each
          spell's breakdown shows exactly what applied.
        </div>
      </div>
      {c.focusSources.length > 0 && (
        <div className="table-scroll">
          <table className="table mb-10">
            <thead>
              <tr>
                <th>On</th>
                <th>Focus</th>
                <th>Type</th>
                <th>From</th>
                <th>Bonus</th>
                <th>Spells</th>
                <th title="Spells above this level get less; 0 = no cap">Level cap</th>
                <th title="Percent of the focus lost per level over the cap">Decay / level</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {c.focusSources.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Switch on={f.enabled} label={`Use ${f.name}`} onChange={(v) => update(f.id, { enabled: v })} />
                  </td>
                  <td>
                    <input value={f.name} aria-label="Focus name" onChange={(e) => update(f.id, { name: e.target.value }, TYPING_MS)} style={{ width: 210 }} />
                  </td>
                  <td>
                    <select value={f.kind} aria-label={`${f.name} type`} onChange={(e) => update(f.id, { kind: e.target.value as FocusSource['kind'] })}>
                      <option value="item">Item</option>
                      <option value="aa">AA</option>
                    </select>
                  </td>
                  <td>
                    <input
                      value={f.from}
                      placeholder="Which item?"
                      aria-label={`${f.name} comes from`}
                      onChange={(e) => update(f.id, { from: e.target.value }, TYPING_MS)}
                      style={{ width: 150 }}
                    />
                  </td>
                  <td className="nowrap">
                    <NumberInput value={f.pct} width={64} label={`${f.name} bonus %`} onChange={(v) => update(f.id, { pct: v ?? 0 })} /> %
                  </td>
                  <td>
                    <select value={f.appliesTo} aria-label={`${f.name} applies to`} onChange={(e) => update(f.id, { appliesTo: e.target.value as FocusSource['appliesTo'] })}>
                      <option value="beneficial">Beneficial</option>
                      <option value="detrimental">Detrimental</option>
                      <option value="both">All</option>
                    </select>
                  </td>
                  <td>
                    <NumberInput value={f.maxLevel} width={64} min={0} label={`${f.name} level cap`} onChange={(v) => update(f.id, { maxLevel: v ?? 0 })} />
                  </td>
                  <td className="nowrap">
                    <NumberInput value={f.decayPct} width={56} min={0} label={`${f.name} decay per level %`} onChange={(v) => update(f.id, { decayPct: v ?? 0 })} /> %
                  </td>
                  <td>
                    <button className="btn ghost small" onClick={() => remove(f)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        <input
          className="grow"
          placeholder="Find an item focus to add, e.g. Extended Enhancement II…"
          aria-label="Add an item focus by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <input placeholder="On which item? (optional)" aria-label="On which item (optional)" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 220 }} />
        <button className="btn" onClick={addCustom}>
          Add an AA or other
        </button>
      </div>
      {results.length > 0 && (
        <div className="stack" style={{ gap: 2, marginTop: 8, maxHeight: 240, overflow: 'auto' }}>
          {results.map((r) => (
            <button
              key={r.spellId}
              className="tree-item"
              onClick={() => {
                void save([...c.focusSources, { ...r, from }])
                setQ('')
                setFrom('')
              }}
            >
              <span className="name">{r.name}</span>
              <span className="chip">
                +{r.pct}% {r.appliesTo}
              </span>
              <span className="faint small">{r.maxLevel ? `cap ${r.maxLevel}, loses ${r.decayPct}% per level over` : 'no level cap'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
