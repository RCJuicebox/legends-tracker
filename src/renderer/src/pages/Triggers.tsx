import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useApp } from '../state'
import { Field, Icon, NumberInput, Switch } from '../components/ui'
import type { Phrase, Trigger, TriggerAction, TriggerTestResult } from '../../../shared/types'

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))

function blankTrigger(folder: string): Trigger {
  return { id: newId(), name: 'New trigger', folder, enabled: true, comment: '', phrases: [{ text: '', regex: false }], cooldownSec: 0, actions: [{ type: 'speak', text: '', interrupt: false }] }
}

function blankAction(type: TriggerAction['type']): TriggerAction {
  switch (type) {
    case 'speak': return { type, text: '', interrupt: false }
    case 'sound': return { type, file: '', volume: 1 }
    case 'text': return { type, text: '', color: '#ffd84d', durationSec: 5 }
    case 'timer': return { type, name: '', durationSec: 30, color: '#e8b44c', overlay: 'targets', warnSec: 5, warnSpeech: '', endSpeech: '', restart: 'restart', endEarly: [] }
  }
}

export function Triggers() {
  const { state } = useApp()
  const [list, setList] = useState<Trigger[]>([])
  const [saved, setSaved] = useState<Trigger[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [errors, setErrors] = useState(state.triggerErrors)

  useEffect(() => {
    void api.invoke<Trigger[]>('triggers:get').then((t) => {
      setList(t)
      setSaved(t)
      setSelected(t[0]?.id ?? null)
    })
  }, [])

  const dirty = JSON.stringify(list) !== JSON.stringify(saved)
  const save = async (next = list) => {
    setErrors(await api.invoke('triggers:save', next))
    setSaved(next)
  }
  const update = (t: Trigger) => setList((l) => l.map((x) => (x.id === t.id ? t : x)))
  const current = list.find((t) => t.id === selected) ?? null

  const folders = useMemo(() => {
    const q = query.toLowerCase()
    const map = new Map<string, Trigger[]>()
    for (const t of list) {
      if (q && !t.name.toLowerCase().includes(q) && !t.phrases.some((p) => p.text.toLowerCase().includes(q))) continue
      map.set(t.folder || 'General', [...(map.get(t.folder || 'General') ?? []), t])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [list, query])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Triggers</h1>
          <p>
            Your own alerts for any log line. Spell durations don't need a trigger; the spell tracker handles every spell
            you cast.
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={async () => {
            const imported = await api.invoke<Trigger[] | null>('triggers:import')
            if (imported) setList((l) => [...l, ...imported.map((t) => ({ ...blankTrigger(''), ...t, id: newId() }))])
          }}>
            Import…
          </button>
          <button className="btn" onClick={() => api.invoke('triggers:export', list)}>
            Export…
          </button>
          <button className="btn" onClick={() => {
            const t = blankTrigger(current?.folder ?? '')
            setList((l) => [...l, t])
            setSelected(t.id)
          }}>
            <Icon name="plus" /> New trigger
          </button>
          <button className="btn primary" disabled={!dirty} onClick={() => void save()}>
            {dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="notice bad" style={{ marginBottom: 16 }}>
          {errors.map((e) => (
            <div key={e.trigger}>
              <b>{e.trigger}</b>: {e.error}
            </div>
          ))}
        </div>
      )}

      <div className="split">
        <div className="card" style={{ padding: 10 }}>
          <input placeholder="Search triggers…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
          <div className="tree">
            {folders.length === 0 && <div className="empty">No triggers.</div>}
            {folders.map(([folder, items]) => (
              <div key={folder}>
                <div className="tree-folder">{folder}</div>
                {items.map((t) => (
                  <div key={t.id} className={`tree-item${t.id === selected ? ' active' : ''}${t.enabled ? '' : ' disabled'}`} onClick={() => setSelected(t.id)}>
                    <span className="name">{t.name}</span>
                    <Switch
                      on={t.enabled}
                      title={t.enabled ? 'Enabled' : 'Disabled'}
                      onChange={(v) => {
                        // Enabling or disabling takes effect at once; no save needed.
                        const next = list.map((x) => (x.id === t.id ? { ...x, enabled: v } : x))
                        setList(next)
                        void save(next)
                      }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {current ? (
          <TriggerEditor
            key={current.id}
            t={current}
            folders={[...new Set(list.map((t) => t.folder).filter(Boolean))]}
            onChange={update}
            onDelete={() => {
              setList((l) => l.filter((x) => x.id !== current.id))
              setSelected(null)
            }}
            onDuplicate={() => {
              const copy = { ...structuredClone(current), id: newId(), name: `${current.name} (copy)` }
              setList((l) => [...l, copy])
              setSelected(copy.id)
            }}
          />
        ) : (
          <div className="card empty">Select a trigger, or make a new one.</div>
        )}
      </div>
    </>
  )
}

function TriggerEditor({ t, folders, onChange, onDelete, onDuplicate }: { t: Trigger; folders: string[]; onChange: (t: Trigger) => void; onDelete: () => void; onDuplicate: () => void }) {
  const set = (patch: Partial<Trigger>) => onChange({ ...t, ...patch })
  const setPhrase = (i: number, p: Phrase) => set({ phrases: t.phrases.map((x, j) => (j === i ? p : x)) })
  const setAction = (i: number, a: TriggerAction) => set({ actions: t.actions.map((x, j) => (j === i ? a : x)) })
  return (
    <div className="stack">
      <div className="card">
        <h2>
          Trigger <span className="spacer" />
          <button className="btn small" onClick={onDuplicate}>Duplicate</button>
          <button className="btn small danger" onClick={onDelete}>Delete</button>
        </h2>
        <div className="grid three">
          <Field label="Name">
            <input value={t.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Folder">
            <input list="folders" value={t.folder} onChange={(e) => set({ folder: e.target.value })} placeholder="General" />
            <datalist id="folders">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </Field>
          <Field label="Cooldown" hint="Seconds before it can fire again.">
            <NumberInput value={t.cooldownSec} min={0} onChange={(v) => set({ cooldownSec: v ?? 0 })} />
          </Field>
        </div>
        <Field label="Notes" style={{ marginTop: 12 }}>
          <input value={t.comment} onChange={(e) => set({ comment: e.target.value })} placeholder="What this is for" />
        </Field>
      </div>

      <div className="card">
        <h2>
          When the log says <span className="spacer" />
          <button className="btn small" onClick={() => set({ phrases: [...t.phrases, { text: '', regex: false }] })}>
            <Icon name="plus" /> Phrase
          </button>
        </h2>
        <div className="stack" style={{ gap: 8 }}>
          {t.phrases.map((p, i) => (
            <div className="phrase-row" key={i}>
              <input className="mono" value={p.text} onChange={(e) => setPhrase(i, { ...p, text: e.target.value })} placeholder={p.regex ? "^(?<S1>\\w+) tells you, '(?<S2>.+)'$" : 'You feel yourself starting to appear.'} />
              <label className="check small">
                <input type="checkbox" checked={p.regex} onChange={(e) => setPhrase(i, { ...p, regex: e.target.checked })} /> Regex
              </label>
              <button className="btn ghost small" onClick={() => set({ phrases: t.phrases.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
        </div>
        <p className="faint small" style={{ marginBottom: 0 }}>
          Plain text matches anywhere in the line, ignoring case. Snippets: <code>{'{C}'}</code> your character,{' '}
          <code>{'{S1}'}</code> any text, <code>{'{N1}'}</code> a number, <code>{'${Name}'}</code> a named capture. Use them in
          the outputs below too.
        </p>
      </div>

      <div className="card">
        <h2>
          Then <span className="spacer" />
          <select value="" onChange={(e) => e.target.value && set({ actions: [...t.actions, blankAction(e.target.value as TriggerAction['type'])] })} style={{ textTransform: 'none', letterSpacing: 0 }}>
            <option value="">Add an action…</option>
            <option value="speak">Speak</option>
            <option value="sound">Play a sound</option>
            <option value="text">Show text</option>
            <option value="timer">Start a timer</option>
          </select>
        </h2>
        <div className="stack" style={{ gap: 10 }}>
          {t.actions.length === 0 && <div className="empty">No actions: this trigger does nothing.</div>}
          {t.actions.map((a, i) => (
            <ActionEditor key={i} a={a} onChange={(x) => setAction(i, x)} onRemove={() => set({ actions: t.actions.filter((_, j) => j !== i) })} />
          ))}
        </div>
      </div>

      <TestPanel t={t} />
    </div>
  )
}

function ActionEditor({ a, onChange, onRemove }: { a: TriggerAction; onChange: (a: TriggerAction) => void; onRemove: () => void }) {
  const { state } = useApp()
  const [sounds, setSounds] = useState<string[]>([])
  useEffect(() => {
    if (a.type === 'sound') void api.invoke<string[]>('audio:sounds').then(setSounds)
  }, [a.type])
  const head = { speak: 'Speak', sound: 'Play a sound', text: 'Show text', timer: 'Start a timer' }[a.type]
  return (
    <div className="action-card">
      <div className="row">
        <b>{head}</b>
        <span className="grow" />
        <button className="btn ghost small" onClick={onRemove}>Remove</button>
      </div>
      {a.type === 'speak' && (
        <div className="row">
          <input className="grow" value={a.text} onChange={(e) => onChange({ ...a, text: e.target.value })} placeholder="Tell from {S1}: {S2}" />
          <label className="check small">
            <input type="checkbox" checked={a.interrupt} onChange={(e) => onChange({ ...a, interrupt: e.target.checked })} /> Interrupt other speech
          </label>
          <button className="btn small" onClick={() => api.invoke('audio:test', a.text.replace(/\{\w+\}|\$\{\w+\}/g, 'something'))}>Hear</button>
        </div>
      )}
      {a.type === 'sound' && (
        <div className="row">
          <select className="grow" value={a.file} onChange={(e) => onChange({ ...a, file: e.target.value })}>
            <option value="">Choose a sound…</option>
            {[...new Set([a.file, ...sounds])].filter(Boolean).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <span className="muted small">Volume</span>
          <input type="range" min={0} max={1} step={0.05} value={a.volume} onChange={(e) => onChange({ ...a, volume: Number(e.target.value) })} />
          <button className="btn small" disabled={!a.file} onClick={() => api.invoke('audio:sound', a.file)}>Play</button>
        </div>
      )}
      {a.type === 'text' && (
        <div className="row">
          <input className="grow" value={a.text} onChange={(e) => onChange({ ...a, text: e.target.value })} placeholder="INVIS DROPPING" />
          <input type="color" value={a.color} onChange={(e) => onChange({ ...a, color: e.target.value })} style={{ width: 44, height: 32, padding: 2 }} />
          <NumberInput value={a.durationSec} min={1} width={64} onChange={(v) => onChange({ ...a, durationSec: v ?? 5 })} />
          <span className="muted small">seconds</span>
        </div>
      )}
      {a.type === 'timer' && (
        <div className="grid three">
          <Field label="Timer name" hint="Blank uses the trigger name.">
            <input value={a.name} onChange={(e) => onChange({ ...a, name: e.target.value })} placeholder="Mez ${Target}" />
          </Field>
          <Field label="Duration (seconds)">
            <NumberInput value={a.durationSec} min={1} onChange={(v) => onChange({ ...a, durationSec: v ?? 30 })} />
          </Field>
          <Field label="Overlay">
            <select value={a.overlay} onChange={(e) => onChange({ ...a, overlay: e.target.value })}>
              {state.settings.overlays.filter((o) => o.kind === 'timers').map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Warn at (seconds left)">
            <NumberInput value={a.warnSec} min={0} onChange={(v) => onChange({ ...a, warnSec: v ?? 0 })} />
          </Field>
          <Field label="Warning speech">
            <input value={a.warnSpeech} onChange={(e) => onChange({ ...a, warnSpeech: e.target.value })} placeholder="Mez ending" />
          </Field>
          <Field label="Ended speech">
            <input value={a.endSpeech} onChange={(e) => onChange({ ...a, endSpeech: e.target.value })} placeholder="Mez off" />
          </Field>
          <Field label="If already running">
            <select value={a.restart} onChange={(e) => onChange({ ...a, restart: e.target.value as 'restart' | 'ignore' })}>
              <option value="restart">Restart it</option>
              <option value="ignore">Leave it running</option>
            </select>
          </Field>
          <Field label="Bar colour">
            <input type="color" value={a.color} onChange={(e) => onChange({ ...a, color: e.target.value })} style={{ width: 44, height: 32, padding: 2 }} />
          </Field>
          <Field label="End early when" hint="One phrase per line. ${Name} is fixed to what started this timer.">
            <textarea
              className="mono"
              rows={2}
              value={a.endEarly.map((p) => p.text).join('\n')}
              onChange={(e) => onChange({ ...a, endEarly: e.target.value.split('\n').map((text) => ({ text, regex: false })) })}
            />
          </Field>
        </div>
      )}
    </div>
  )
}

function TestPanel({ t }: { t: Trigger }) {
  const [line, setLine] = useState('')
  const [result, setResult] = useState<TriggerTestResult | null>(null)
  useEffect(() => {
    if (!line.trim()) return setResult(null)
    const id = setTimeout(() => void api.invoke<TriggerTestResult>('triggers:test', t, line).then(setResult), 150)
    return () => clearTimeout(id)
  }, [line, t])
  return (
    <div className="card">
      <h2>Test</h2>
      <input className="mono" style={{ width: '100%' }} value={line} onChange={(e) => setLine(e.target.value)} placeholder="Paste a log line, e.g. [Wed Sep 23 13:29:05 2026] Aldric tells you, 'inc'" />
      {result && (
        <div style={{ marginTop: 10 }}>
          {result.error ? (
            <div className="notice bad">{result.error}</div>
          ) : result.matched ? (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row">
                <span className="chip ok">Matches phrase {result.phraseIndex + 1}</span>
                {Object.entries(result.captures).map(([k, v]) => (
                  <span key={k} className="chip mono">{k} = {v}</span>
                ))}
              </div>
              {result.outputs.map((o, i) => (
                <div key={i} className="mono small muted">→ {o}</div>
              ))}
            </div>
          ) : (
            <span className="chip bad">No match</span>
          )}
        </div>
      )}
    </div>
  )
}
