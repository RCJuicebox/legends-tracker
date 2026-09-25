import { useEffect, useState } from 'react'
import { useApp } from '../state'
import { api, clock, ago, errorMessage } from '../api'
import { useInvoke } from '../hooks'
import { showError, showUndo } from '../toast'
import { who } from '../format'
import { CategoryChip, ConfirmButton, Field, Info, LoadError, NumberInput, SpellIcon, Switch } from '../components/ui'
import {
  CATEGORY_LABELS, CLASS_NAMES, DEFAULT_TIER_DURATION_PCT,
  type ClassName, type FocusSource, type KnownSpell, type LogCheckRow, type SpellCategory, type SpellRule, type SpellSummary
} from '../../../shared/types'

export function Spells() {
  const { state } = useApp()
  const q = useInvoke<KnownSpell[]>('spells:known', [], [state.character, state.settings.tracking, state.status.spellsLoaded])
  const known = q.data ?? []
  const setKnown = q.setData
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

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
        {q.error && <LoadError what="your spells" error={q.error} retry={q.reload} />}
        <CharacterCard />

        <div className="card">
          <h2>
            Your spells <span className="chip">{known.length}</span>
            <span className="spacer" />
            <input placeholder="Filter…" aria-label="Filter spells" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 200, textTransform: 'none' }} />
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
                  <th title="As the in-game Spell window shows it: base (with rank and focus)">
                    Spell window <Info label="About Spell window" text="As the in-game Spell window shows it: base (with rank and focus)" />
                  </th>
                  <th title="Including the partial tick it lands in">
                    Wears off <Info label="About Wears off" text="Including the partial tick it lands in" />
                  </th>
                  <th>Tracking</th>
                  <th title="The spoken &quot;Recast …&quot; warning before it ends">
                    Recast cue <Info label="About Recast cue" text="The spoken “Recast …” warning before it ends" />
                  </th>
                  <th title="The spoken announcement when it wears off">
                    Fade cue <Info label="About Fade cue" text="The spoken announcement when it wears off" />
                  </th>
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
        {who(state.characterKey)} <span className="spacer" />
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
                  aria-label={`${name} level`}
                  style={{ width: 54, padding: '1px 4px' }}
                  onChange={(e) => saveCharacter({ ...c, classLevels: { ...c.classLevels, [name]: Number(e.target.value) } })}
                />
                <button
                  className="btn ghost small x-btn"
                  aria-label={`Remove ${name}`}
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
              aria-label="Add a class"
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

/** A search as the player types: after a pause, and only the newest answer kept. */
function useSearch<T>(channel: string, q: string): T[] {
  const [results, setResults] = useState<T[]>([])
  useEffect(() => {
    if (q.trim().length < 3) return setResults([])
    let live = true
    const id = setTimeout(
      () =>
        api.invoke<T[]>(channel, q).then(
          (r) => live && setResults(r),
          (e) => live && showError('Search failed', e)
        ),
      200
    )
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [channel, q])
  return results
}

function FocusSources() {
  const { state, saveCharacter, latest } = useApp()
  const c = state.character
  const [q, setQ] = useState('')
  const results = useSearch<FocusSource>('focus:search', q)
  const [from, setFrom] = useState('')
  const save = (list: FocusSource[]) => saveCharacter({ ...c, focusSources: list })
  const update = (id: string, patch: Partial<FocusSource>) => save(c.focusSources.map((f) => (f.id === id ? { ...f, ...patch } : f)))
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
        id: `custom-${Date.now().toString(36)}`, name: 'New focus', kind: 'aa', from: 'AA', pct: 10, appliesTo: 'beneficial',
        maxLevel: 0, decayPct: 0, minTicks: 0, requireSpas: [], excludeSpas: [], enabled: true
      }
    ])
  return (
    <div className="mt-16">
      <div className="field mb-8">
        <span>Duration focus effects</span>
        <div className="hint">
          Each applies spell by spell with its own level cap: past the cap it loses its decay percentage of itself per
          level. Only the best item focus counts; AAs add on top. Each spell's breakdown shows exactly what applied.
        </div>
      </div>
      {c.focusSources.length > 0 && (
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
                  <input value={f.name} aria-label="Focus name" onChange={(e) => update(f.id, { name: e.target.value })} style={{ width: 210 }} />
                </td>
                <td>
                  <select value={f.kind} aria-label={`${f.name} type`} onChange={(e) => update(f.id, { kind: e.target.value as FocusSource['kind'] })}>
                    <option value="item">Item</option>
                    <option value="aa">AA</option>
                  </select>
                </td>
                <td>
                  <input value={f.from} placeholder="Which item?" aria-label={`${f.name} comes from`} onChange={(e) => update(f.id, { from: e.target.value })} style={{ width: 150 }} />
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
      )}
      <div className="row">
        <input className="grow" placeholder="Add an item focus by name, e.g. Extended Enhancement II" aria-label="Add an item focus by name" value={q} onChange={(e) => setQ(e.target.value)} />
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

/** Flips one of a spell's cues straight from the table, keeping the rest of its rule. */
async function setCue(k: KnownSpell, patch: Partial<SpellRule>, onSaved: (list: KnownSpell[]) => void): Promise<void> {
  try {
    onSaved(await api.invoke<KnownSpell[]>('spells:rule', k.name, { ...k.rule, ...patch }))
  } catch (e) {
    showError(`Could not change ${k.name}`, e)
  }
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
          {/* The row opens on a click anywhere; this is the same for the keyboard. */}
          <button
            className="link-button"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation()
              toggle()
            }}
          >
            {k.rule.alias ? `${k.rule.alias}` : k.rankedName}
          </button>
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
            <Switch on={k.rule.recastCue !== false} title="Recast warning" label={`Recast warning for ${k.rankedName}`} onChange={(v) => void setCue(k, { recastCue: v ? undefined : false }, onSaved)} />
            {k.rule.recastCue !== false && <span className="faint small">{k.rule.warnSec !== undefined ? `${k.rule.warnSec}s` : 'default'}</span>}
          </span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <Switch on={k.rule.fadeCue !== false} title="Fade announcement" label={`Fade announcement for ${k.rankedName}`} onChange={(v) => void setCue(k, { fadeCue: v ? undefined : false }, onSaved)} />
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

/**
 * The editor's rule after the saved one changed underneath it (a cue switched in the row, a
 * refresh): each field the player has not touched takes the new value; each they changed keeps
 * theirs.
 */
function rebase(draft: SpellRule, oldBase: SpellRule, newBase: SpellRule): SpellRule {
  const out: SpellRule = {}
  const keys = new Set([...Object.keys(draft), ...Object.keys(oldBase), ...Object.keys(newBase)]) as Set<keyof SpellRule>
  for (const key of keys) {
    const edited = JSON.stringify(draft[key]) !== JSON.stringify(oldBase[key])
    const v = edited ? draft[key] : newBase[key]
    if (v !== undefined) (out as Record<string, unknown>)[key] = v
  }
  return out
}

function RuleEditor({ k, onSaved }: { k: KnownSpell; onSaved: (list: KnownSpell[]) => void }) {
  const { state } = useApp()
  const [rule, setRule] = useState<SpellRule>(k.rule)
  const [base, setBase] = useState<SpellRule>(k.rule)
  const [error, setError] = useState('')
  if (JSON.stringify(base) !== JSON.stringify(k.rule)) {
    setRule((r) => rebase(r, base, k.rule))
    setBase(k.rule)
  }
  const set = (patch: Partial<SpellRule>) => setRule((r) => ({ ...r, ...patch }))
  const save = async (r: SpellRule | null) => {
    setError('')
    try {
      onSaved(await api.invoke<KnownSpell[]>('spells:rule', k.name, r))
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const beneficial = k.beneficial
  const t = state.settings.tracking
  const overlays = state.settings.overlays.filter((o) => o.kind === 'timers')
  return (
    <div className="grid two" style={{ padding: '8px 4px', alignItems: 'start' }}>
      <div className="stack gap-12">
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
      <div className="stack gap-12">
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
          <ConfirmButton className="btn ghost" question="Clear every setting for this spell?" onConfirm={() => void save(null)}>
            Reset to defaults
          </ConfirmButton>
        </div>
        {error && (
          <div className="notice bad small" role="alert">
            Could not save: {error}
          </div>
        )}
      </div>
    </div>
  )
}

function AddSpell({ onAdded }: { onAdded: (list: KnownSpell[]) => void }) {
  const [q, setQ] = useState('')
  const results = useSearch<SpellSummary>('spells:search', q)
  const withDuration = results.filter((r) => r.formula !== 0 || r.cap !== 0)
  return (
    <div className="mt-14">
      <div className="row">
        <input placeholder="Add a spell you haven't cast yet — search the spell book…" aria-label="Add a spell: search the spell book" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>
      {withDuration.length > 0 && (
        <div className="stack" style={{ gap: 2, marginTop: 8, maxHeight: 260, overflow: 'auto' }}>
          {withDuration.map((r) => (
            <button key={r.id} className="tree-item" onClick={async () => {
              try {
                onAdded(await api.invoke<KnownSpell[]>('spells:rule', r.name, { track: true }))
                setQ('')
              } catch (e) {
                showError(`Could not add ${r.name}`, e)
              }
            }}>
              <SpellIcon icon={r.icon} />
              <span className="name">{r.name}</span>
              <CategoryChip category={r.category} />
              <span className="faint small">{r.classes}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function LogCheck() {
  const [rows, setRows] = useState<LogCheckRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mbs, setMbs] = useState(100)

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      setRows(await api.invoke<LogCheckRow[]>('spells:checkLog', mbs))
    } catch (e) {
      setError(errorMessage(e))
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
          <NumberInput value={mbs} min={10} max={2000} step={50} width={80} label="Megabytes of log to check" onChange={(v) => setMbs(v ?? 100)} />
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
      {error && (
        <div className="notice bad" role="alert">
          Could not check the log: {error}
        </div>
      )}
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

