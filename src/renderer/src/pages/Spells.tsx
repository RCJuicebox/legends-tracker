import { useEffect, useState } from 'react'
import { useApp } from '../state'
import { api, clock, ago } from '../api'
import { CategoryChip, Field, NumberInput, SpellIcon, Switch } from '../components/ui'
import {
  CATEGORY_LABELS, CLASS_NAMES, DEFAULT_TIER_DURATION_PCT,
  type ClassName, type FocusSource, type KnownSpell, type LogCheckRow, type SpellCategory, type SpellRule, type SpellSummary
} from '../../../shared/types'

export function Spells() {
  const { state } = useApp()
  const [known, setKnown] = useState<KnownSpell[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const refresh = () => void api.invoke<KnownSpell[]>('spells:known').then(setKnown)
  useEffect(refresh, [state.character, state.settings.tracking, state.status.spellsLoaded])

  const shown = known.filter((k) => !filter || k.rankedName.toLowerCase().includes(filter.toLowerCase()))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Spell Timers</h1>
          <p>
            Durations are calculated from the game's spell data, your level, the spell's rank and your focus effects —
            the same sum the in-game Spell window shows in brackets. Every spell you cast appears here automatically.
          </p>
        </div>
      </div>

      <div className="stack">
        <CharacterCard />

        <div className="card">
          <h2>
            Your spells <span className="chip">{known.length}</span>
            <span className="spacer" />
            <input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 200, textTransform: 'none' }} />
          </h2>
          {known.length === 0 ? (
            <div className="empty">
              No spells yet. Cast something while watching, or add a spell below.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>Spell</th>
                  <th>Type</th>
                  <th title="As the in-game Spell window shows it: base (with rank and focus)">Spell window</th>
                  <th title="Including the partial tick it lands in">Wears off</th>
                  <th>Tracking</th>
                  <th title="The spoken &quot;Recast …&quot; warning before it ends">Recast cue</th>
                  <th title="The spoken announcement when it wears off">Fade cue</th>
                  <th>Last cast</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((k) => (
                  <SpellRow key={k.name} k={k} open={open === k.name} toggle={() => setOpen(open === k.name ? null : k.name)} onSaved={setKnown} />
                ))}
              </tbody>
            </table>
          )}
          <AddSpell onAdded={setKnown} />
        </div>

        <LogCheck />
        <TierTable />
      </div>
    </>
  )
}

function CharacterCard() {
  const { state, saveCharacter } = useApp()
  const c = state.character
  const [addClass, setAddClass] = useState<ClassName | ''>('')
  const classes = Object.entries(c.classLevels) as [ClassName, number][]
  if (!state.characterKey) {
    return <div className="notice">Choose a character log under Settings to set up focus and levels.</div>
  }
  return (
    <div className="card">
      <h2>
        {state.characterKey.replace('_', ' · ')} <span className="spacer" />
      </h2>
      <div className="grid two" style={{ alignItems: 'start' }}>
        <Field label="Level" hint="Used when no class level below applies. Most durations stop growing well before 50.">
          <NumberInput value={c.level} min={1} max={130} onChange={(v) => saveCharacter({ ...c, level: v ?? 1 })} />
        </Field>
        <Field label="Class levels" hint="EQL levels each class separately; a spell uses the level of a class that can cast it.">
          <div className="row tight">
            {classes.map(([name, lv]) => (
              <span key={name} className="chip" style={{ padding: '2px 4px 2px 9px' }}>
                {name}
                <input
                  type="number"
                  value={lv}
                  min={1}
                  max={130}
                  style={{ width: 54, padding: '1px 4px' }}
                  onChange={(e) => saveCharacter({ ...c, classLevels: { ...c.classLevels, [name]: Number(e.target.value) } })}
                />
                <button
                  className="btn ghost small"
                  style={{ padding: '0 4px' }}
                  onClick={() => {
                    const next = { ...c.classLevels }
                    delete next[name]
                    void saveCharacter({ ...c, classLevels: next })
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <select
              value={addClass}
              onChange={(e) => {
                const v = e.target.value as ClassName
                setAddClass('')
                if (v) void saveCharacter({ ...c, classLevels: { ...c.classLevels, [v]: c.level } })
              }}
            >
              <option value="">Add class…</option>
              {CLASS_NAMES.filter((n) => !(n in c.classLevels)).map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </div>
        </Field>
      </div>
      <FocusSources />
    </div>
  )
}

function FocusSources() {
  const { state, saveCharacter } = useApp()
  const c = state.character
  const [q, setQ] = useState('')
  const [results, setResults] = useState<FocusSource[]>([])
  const [from, setFrom] = useState('')
  useEffect(() => {
    if (q.trim().length < 3) return setResults([])
    const id = setTimeout(() => void api.invoke<FocusSource[]>('focus:search', q).then(setResults), 200)
    return () => clearTimeout(id)
  }, [q])
  const save = (list: FocusSource[]) => saveCharacter({ ...c, focusSources: list })
  const update = (id: string, patch: Partial<FocusSource>) => save(c.focusSources.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const addCustom = () =>
    save([
      ...c.focusSources,
      {
        id: `custom-${Date.now().toString(36)}`, name: 'New focus', kind: 'aa', from: 'AA', pct: 10, appliesTo: 'beneficial',
        maxLevel: 0, decayPct: 0, minTicks: 0, requireSpas: [], excludeSpas: [], enabled: true
      }
    ])
  return (
    <div style={{ marginTop: 16 }}>
      <div className="field" style={{ marginBottom: 8 }}>
        <span>Duration focus effects</span>
        <div className="hint">
          Each applies spell by spell with its own level cap: past the cap it loses its decay percentage of itself per
          level. Only the best item focus counts; AAs add on top. Each spell's breakdown shows exactly what applied.
        </div>
      </div>
      {c.focusSources.length > 0 && (
        <table className="table" style={{ marginBottom: 10 }}>
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
                  <Switch on={f.enabled} onChange={(v) => update(f.id, { enabled: v })} />
                </td>
                <td>
                  <input value={f.name} onChange={(e) => update(f.id, { name: e.target.value })} style={{ width: 210 }} />
                </td>
                <td>
                  <select value={f.kind} onChange={(e) => update(f.id, { kind: e.target.value as FocusSource['kind'] })}>
                    <option value="item">Item</option>
                    <option value="aa">AA</option>
                  </select>
                </td>
                <td>
                  <input value={f.from} placeholder="Which item?" onChange={(e) => update(f.id, { from: e.target.value })} style={{ width: 150 }} />
                </td>
                <td className="nowrap">
                  <NumberInput value={f.pct} width={64} onChange={(v) => update(f.id, { pct: v ?? 0 })} /> %
                </td>
                <td>
                  <select value={f.appliesTo} onChange={(e) => update(f.id, { appliesTo: e.target.value as FocusSource['appliesTo'] })}>
                    <option value="beneficial">Beneficial</option>
                    <option value="detrimental">Detrimental</option>
                    <option value="both">All</option>
                  </select>
                </td>
                <td>
                  <NumberInput value={f.maxLevel} width={64} min={0} onChange={(v) => update(f.id, { maxLevel: v ?? 0 })} />
                </td>
                <td className="nowrap">
                  <NumberInput value={f.decayPct} width={56} min={0} onChange={(v) => update(f.id, { decayPct: v ?? 0 })} /> %
                </td>
                <td>
                  <button className="btn ghost small" onClick={() => save(c.focusSources.filter((x) => x.id !== f.id))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <input className="grow" placeholder="Add an item focus by name, e.g. Extended Enhancement II" value={q} onChange={(e) => setQ(e.target.value)} />
        <input placeholder="On which item? (optional)" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 220 }} />
        <button className="btn" onClick={addCustom}>
          Add an AA or other
        </button>
      </div>
      {results.length > 0 && (
        <div className="stack" style={{ gap: 2, marginTop: 8, maxHeight: 240, overflow: 'auto' }}>
          {results.map((r) => (
            <div
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Flips one of a spell's cues straight from the table, keeping the rest of its rule. */
async function setCue(k: KnownSpell, patch: Partial<SpellRule>, onSaved: (list: KnownSpell[]) => void): Promise<void> {
  onSaved(await api.invoke<KnownSpell[]>('spells:rule', k.name, { ...k.rule, ...patch }))
}

function trackLabel(rule: SpellRule): string {
  return rule.track === undefined ? 'Default' : rule.track ? 'Always' : 'Off'
}

function SpellRow({ k, open, toggle, onSaved }: { k: KnownSpell; open: boolean; toggle: () => void; onSaved: (list: KnownSpell[]) => void }) {
  const d = k.duration
  return (
    <>
      <tr className={`clickable${open ? ' selected' : ''}`} onClick={toggle}>
        <td style={{ width: 36 }}>
          <SpellIcon icon={k.icon} />
        </td>
        <td>
          <div style={{ fontWeight: 600 }}>{k.rule.alias ? `${k.rule.alias}` : k.rankedName}</div>
          {k.rule.alias && <div className="faint small">{k.rankedName}</div>}
        </td>
        <td>
          <CategoryChip category={k.category} />
        </td>
        <td className="mono nowrap">
          {d.permanent ? 'Permanent' : `${clock(d.baseSec)} (${clock(d.spellWindowSec)})`}
        </td>
        <td className="nowrap muted">{d.permanent ? '—' : `${d.earliestSec}–${d.latestSec}s`}</td>
        <td>
          <span className={`chip${k.rule.track === false ? ' bad' : k.rule.track ? ' ok' : ''}`}>{trackLabel(k.rule)}</span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <span className="row tight nowrap">
            <Switch on={k.rule.recastCue !== false} title="Recast warning" onChange={(v) => void setCue(k, { recastCue: v ? undefined : false }, onSaved)} />
            {k.rule.recastCue !== false && <span className="faint small">{k.rule.warnSec !== undefined ? `${k.rule.warnSec}s` : 'default'}</span>}
          </span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <Switch on={k.rule.fadeCue !== false} title="Fade announcement" onChange={(v) => void setCue(k, { fadeCue: v ? undefined : false }, onSaved)} />
        </td>
        <td className="faint small nowrap">{k.lastCast ? ago(k.lastCast) : 'rule only'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={{ background: 'var(--bg-2)' }}>
            <RuleEditor k={k} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  )
}

function RuleEditor({ k, onSaved }: { k: KnownSpell; onSaved: (list: KnownSpell[]) => void }) {
  const { state } = useApp()
  const [rule, setRule] = useState<SpellRule>(k.rule)
  const set = (patch: Partial<SpellRule>) => setRule((r) => ({ ...r, ...patch }))
  const save = async (r: SpellRule | null) => onSaved(await api.invoke<KnownSpell[]>('spells:rule', k.name, r))
  const beneficial = k.beneficial
  const t = state.settings.tracking
  const overlays = state.settings.overlays.filter((o) => o.kind === 'timers')
  return (
    <div className="grid two" style={{ padding: '8px 4px', alignItems: 'start' }}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="row">
          <SpellIcon icon={k.icon} large />
          <div>
            <div style={{ fontWeight: 650, fontSize: 15 }}>{k.rankedName}</div>
            <div className="faint small">{k.classes || 'No class can scribe this'}</div>
          </div>
        </div>
        <ol className="steps">
          {k.duration.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <div className="small faint" style={{ lineHeight: 1.6 }}>
          {k.landSelf && <div>Lands on you: “{k.landSelf}”</div>}
          {k.landOther && <div>Lands on others: “<i>Name</i>{k.landOther}”</div>}
          {k.fade && <div>Fades: “{k.fade}”</div>}
        </div>
      </div>
      <div className="stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 24 }}>
          <label className="row tight">
            <Switch on={rule.recastCue !== false} onChange={(v) => set({ recastCue: v ? undefined : false })} />
            Recast warning
          </label>
          <label className="row tight">
            <Switch on={rule.fadeCue !== false} onChange={(v) => set({ fadeCue: v ? undefined : false })} />
            Fade announcement
          </label>
        </div>
        <div className="grid two">
          <Field label="Tracking">
            <select value={rule.track === undefined ? '' : rule.track ? 'on' : 'off'} onChange={(e) => set({ track: e.target.value === '' ? undefined : e.target.value === 'on' })}>
              <option value="">Default ({beneficial ? 'buff' : 'DoT/debuff'} setting)</option>
              <option value="on">Always track</option>
              <option value="off">Never track</option>
            </select>
          </Field>
          <Field label="Short name" hint="Shown on the bar and spoken.">
            <input value={rule.alias ?? ''} placeholder={k.name} onChange={(e) => set({ alias: e.target.value || undefined })} />
          </Field>
          <Field label="Warn before it ends" hint={`Seconds. Default: ${beneficial ? t.buffWarnSec : t.dotWarnSec}s (0 = off).`}>
            <NumberInput value={rule.warnSec} placeholder="default" min={0} onChange={(v) => set({ warnSec: v })} />
          </Field>
          <Field label="Overlay">
            <select value={rule.overlay ?? ''} onChange={(e) => set({ overlay: e.target.value || undefined })}>
              <option value="">Default ({beneficial ? 'Buffs' : 'DoTs & Timers'})</option>
              {overlays.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Warning speech" hint="{spell} and {target} are filled in.">
            <input value={rule.warnSpeech ?? ''} placeholder={beneficial ? t.buffWarnSpeech : t.dotWarnSpeech} onChange={(e) => set({ warnSpeech: e.target.value === '' ? undefined : e.target.value })} />
          </Field>
          <Field label="Fade speech" hint="Leave blank for the default.">
            <input value={rule.fadeSpeech ?? ''} placeholder={beneficial ? t.buffFadeSpeech : t.dotFadeSpeech} onChange={(e) => set({ fadeSpeech: e.target.value === '' ? undefined : e.target.value })} />
          </Field>
          <Field label="Extra focus for this spell" hint="Percent, added to your character focus (e.g. an item that only extends this line).">
            <NumberInput value={rule.extraFocusPct} placeholder="0" onChange={(v) => set({ extraFocusPct: v })} />
          </Field>
          <Field label="Bar colour">
            <div className="row tight">
              <input type="color" value={rule.color ?? '#3fb6a8'} onChange={(e) => set({ color: e.target.value })} style={{ width: 44, height: 32, padding: 2 }} />
              {rule.color && (
                <button className="btn ghost small" onClick={() => set({ color: undefined })}>
                  Reset
                </button>
              )}
            </div>
          </Field>
        </div>
        <Field label="Fixed duration override" hint="Only for a spell the calculation cannot model. Seconds; blank to calculate.">
          <NumberInput value={rule.durationOverrideSec} placeholder="calculated" min={0} onChange={(v) => set({ durationOverrideSec: v })} />
        </Field>
        <div className="row">
          <button className="btn primary" onClick={() => void save(rule)}>
            Save
          </button>
          <button className="btn" onClick={() => void api.invoke('audio:test', (rule.warnSpeech ?? (beneficial ? t.buffWarnSpeech : t.dotWarnSpeech)).replace(/\{spell\}/gi, rule.alias || k.name).replace(/\{target\}/gi, 'a gnoll'))}>
            Hear warning
          </button>
          <span className="grow" />
          <button className="btn ghost" onClick={() => void save(null)}>
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  )
}

function AddSpell({ onAdded }: { onAdded: (list: KnownSpell[]) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SpellSummary[]>([])
  useEffect(() => {
    if (q.trim().length < 3) return setResults([])
    const id = setTimeout(() => void api.invoke<SpellSummary[]>('spells:search', q).then(setResults), 200)
    return () => clearTimeout(id)
  }, [q])
  const withDuration = results.filter((r) => r.formula !== 0 || r.cap !== 0)
  return (
    <div style={{ marginTop: 14 }}>
      <div className="row">
        <input placeholder="Add a spell you haven't cast yet — search the spell book…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>
      {withDuration.length > 0 && (
        <div className="stack" style={{ gap: 2, marginTop: 8, maxHeight: 260, overflow: 'auto' }}>
          {withDuration.map((r) => (
            <div key={r.id} className="tree-item" onClick={async () => {
              onAdded(await api.invoke<KnownSpell[]>('spells:rule', r.name, { track: true }))
              setQ('')
            }}>
              <SpellIcon icon={r.icon} />
              <span className="name">{r.name}</span>
              <CategoryChip category={r.category} />
              <span className="faint small">{r.classes}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LogCheck() {
  const [rows, setRows] = useState<LogCheckRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [mbs, setMbs] = useState(100)

  const run = async () => {
    setBusy(true)
    try {
      setRows(await api.invoke<LogCheckRow[]>('spells:checkLog', mbs))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>
        Check against your log <span className="spacer" />
        <span className="row tight" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
          last
          <NumberInput value={mbs} min={10} max={2000} step={50} width={80} onChange={(v) => setMbs(v ?? 100)} />
          MB
        </span>
        <button className="btn small" onClick={() => void run()} disabled={busy}>
          {busy ? 'Reading…' : 'Run check'}
        </button>
      </h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        A diagnostic, not a data source: replays recent history and compares each spell's real landing-to-fade time with
        the calculation. A mismatch usually means a focus effect missing from, or wrongly set in, the list above;
        the row shows the total focus that spell would need.
      </p>
      {rows && rows.length === 0 && <div className="empty">No complete land-to-fade pairs found in that part of the log.</div>}
      {rows && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Spell</th>
              <th>Type</th>
              <th>Samples</th>
              <th>Log median</th>
              <th>Calculated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((r) => (
              <tr key={r.rankedName}>
                <td>{r.rankedName}</td>
                <td>
                  <CategoryChip category={r.category} />
                </td>
                <td className="muted">{r.samples}</td>
                <td className="mono">{r.observedMedianSec}s</td>
                <td className="mono">
                  {r.calculatedEarliestSec}–{r.calculatedLatestSec}s
                </td>
                <td>
                  {r.fits ? (
                    <span className="chip ok">Fits</span>
                  ) : (
                    <span className="chip warn" title={r.impliedFocusRange ? `Fits with focus ${r.impliedFocusRange[0]}% to ${r.impliedFocusRange[1]}%` : ''}>
                      Off{r.impliedFocusPct !== null ? ` — needs ≈ ${r.impliedFocusPct}% focus in total` : ''}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function TierTable() {
  const { state, patchSettings } = useApp()
  const pct = state.settings.tracking.tierDurationPct
  const cats = (['dot', 'hot', 'buff', 'debuff', 'mez', 'charm'] as SpellCategory[])
  return (
    <div className="card">
      <h2>
        Rank bonuses <span className="spacer" />
        <button className="btn small ghost" onClick={() => patchSettings((s) => ({ ...s, tracking: { ...s.tracking, tierDurationPct: { ...DEFAULT_TIER_DURATION_PCT } } }))}>
          Reset to guide values
        </button>
      </h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Duration bonus per rank, from the EQL spell upgrade guide: rank X is ten tiers, an unranked spell none. Confirmed
        in game for DoTs (Envenomed Bolt X 0:36 → 0:54) and buffs (Spirit of the Puma X). Heal over time is fitted
        rather than from the guide: 7% matches Slugs Healing V's Spell window and log, where the guide's 5% does not.
      </p>
      <div className="grid three">
        {cats.map((c) => (
          <Field key={c} label={CATEGORY_LABELS[c]}>
            <div className="row tight">
              <NumberInput
                value={pct[c]}
                step={0.5}
                onChange={(v) => patchSettings((s) => ({ ...s, tracking: { ...s.tracking, tierDurationPct: { ...s.tracking.tierDurationPct, [c]: v ?? 0 } } }))}
              />
              <span className="muted">% per rank</span>
            </div>
          </Field>
        ))}
      </div>
    </div>
  )
}

