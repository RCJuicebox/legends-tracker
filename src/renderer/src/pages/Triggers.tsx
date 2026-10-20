import { useEffect, useMemo, useRef, useState } from 'react'
import { api, errorMessage } from '../api'
import { useSettled } from '../state'
import { useInvoke } from '../hooks'
import { act, showError, showToast, actDone } from '../toast'
import { OVERLAY_TARGETS } from '../constants'
import { TRIGGER_TEXT_COLOR, TRIGGER_TIMER_COLOR } from '../../../shared/overlays'
import { recall, remember, useRemembered } from '../remember'
import { markUnsaved } from '../unsaved'
import { GroupHealthCard } from '../components/GroupHealthCard'
import { ConfirmButton, Field, FilterBox, Icon, LoadError, NumberInput, Pending, Switch } from '../components/ui'
import type { Phrase, Trigger, TriggerAction, TriggerCompare, TriggerTestResult, TriggerWhen } from '../../../shared/types'
import type { SimulateResult, TriggerError } from '../../../shared/ipc'
import { takeHandOff, TEST_CARD } from '../handoff'

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))

/** The lines waiting in the Test card, kept across visits and restarts (remember.ts). */
const TRY_LINES = 'try.lines'

const SAMPLE = `[Tue Sep 01 12:15:08 2026] You begin casting Envenomed Bolt X.
[Tue Sep 01 12:15:09 2026] A ratman warrior has been poisoned.
[Tue Sep 01 12:15:10 2026] You begin casting Spirit of the Puma X.
[Tue Sep 01 12:15:11 2026] You begin to snarl as your features become feline.`

/**
 * What running pasted lines did, for the corner: a line that matched nothing is told from a run that did not happen (LT-679).
 * @public
 */
export const ranLines = (r: SimulateResult): string => {
  if (!r.lines) return 'No log lines in the text: each needs its [time] in front'
  const n = (k: number, what: string) => `${k} ${what}${k === 1 ? '' : 's'}`
  const did = [r.timers ? n(r.timers, 'timer') : '', r.triggers ? n(r.triggers, 'trigger') : ''].filter(Boolean).join(', ')
  return `Ran ${n(r.lines, 'line')}: ${did || 'no timer or trigger matched'}`
}

function blankTrigger(folder: string): Trigger {
  return {
    id: newId(),
    name: 'New trigger',
    folder,
    enabled: true,
    comment: '',
    phrases: [{ text: '', regex: false }],
    cooldownSec: 0,
    actions: [{ type: 'speak', text: '', interrupt: false }]
  }
}

function blankAction(type: TriggerAction['type']): TriggerAction {
  switch (type) {
    case 'speak':
      return { type, text: '', interrupt: false }
    case 'sound':
      return { type, file: '', volume: 1 }
    case 'text':
      return { type, text: '', color: TRIGGER_TEXT_COLOR, durationSec: 5 }
    case 'timer':
      return { type, name: '', durationSec: 30, color: TRIGGER_TIMER_COLOR, overlay: OVERLAY_TARGETS, warnSec: 5, warnSpeech: '', endSpeech: '', restart: 'restart', endEarly: [] }
  }
}

interface Draft {
  /** What is being edited. */
  list: Trigger[]
  /** What is saved. */
  saved: Trigger[]
  selected: string | null
}

const same = (a: Trigger[], b: Trigger[]) => a === b || JSON.stringify(a) === JSON.stringify(b)
const unsaved = (d: Draft | null) => !!d && !same(d.list, d.saved)

// Unsaved edits live here rather than in the page, so leaving the page and coming back finds them
// as they were, and in local storage, so a restart or a crash does not lose them either.
const DRAFT_KEY = 'triggers.draft'
let kept: Draft | null = recall<Draft | null>(DRAFT_KEY, null)
markUnsaved('triggers', unsaved(kept))

function keep(d: Draft | null): void {
  kept = d
  const open = unsaved(d)
  markUnsaved('triggers', open)
  remember(DRAFT_KEY, open ? d : null)
}

/**
 * Unsaved edits over what is saved now. Triggers saved from elsewhere since the edits began (a
 * respawn timer, say) join the list, so saving the edits does not drop them.
 */
function rebase(d: Draft, stored: Trigger[]): Draft {
  if (same(d.saved, stored)) return d
  const known = new Set(d.saved.map((t) => t.id))
  const inList = new Set(d.list.map((t) => t.id))
  return { ...d, list: [...d.list, ...stored.filter((t) => !known.has(t.id) && !inList.has(t.id))], saved: stored }
}
// One empty list while nothing is loaded, so the memos below don't see a new one every render.
const NO_TRIGGERS: Trigger[] = []

export function Triggers() {
  const triggerErrors = useSettled((s) => s.triggerErrors)
  const [draft, setDraft] = useState<Draft | null>(kept)
  const shipped = useInvoke('triggers:defaults').data
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [errors, setErrors] = useState<TriggerError[]>(triggerErrors)

  useEffect(() => {
    keep(draft)
  }, [draft])

  // Sent here from a timer on Live: its trigger selected once the list is read (LT-691). Or by
  // "Try a log line" on Live or Spell Timers: the Test card in view.
  const wanted = useRef(takeHandOff('triggers'))
  useEffect(() => {
    let live = true
    setLoadError('')
    api.invoke('triggers:get').then(
      (t) =>
        live &&
        setDraft((d) =>
          // Edits left from an earlier visit win over a fresh read.
          unsaved(d)
            ? { ...rebase(d!, t), ...(wanted.current && t.some((x) => x.id === wanted.current) ? { selected: wanted.current } : {}) }
            : {
                list: t,
                saved: t,
                selected:
                  wanted.current && t.some((x) => x.id === wanted.current) ? wanted.current : d?.selected && t.some((x) => x.id === d.selected) ? d.selected : (t[0]?.id ?? null)
              }
        ),
      (e) => live && setLoadError(errorMessage(e))
    )
    return () => {
      live = false
    }
  }, [attempt])

  const list = draft?.list ?? NO_TRIGGERS
  const saved = draft?.saved ?? NO_TRIGGERS
  const selected = draft?.selected ?? null
  const setList = (fn: (l: Trigger[]) => Trigger[]) => setDraft((d) => (d ? { ...d, list: fn(d.list) } : d))
  const setSelected = (id: string | null) => setDraft((d) => (d ? { ...d, selected: id } : d))
  const dirty = useMemo(() => !same(list, saved), [list, saved])

  const write = async (next: Trigger[]): Promise<boolean> => {
    try {
      setErrors(await api.invoke('triggers:save', next))
      return true
    } catch (e) {
      showError('Could not save the triggers', e)
      return false
    }
  }
  const save = async () => {
    const next = list
    if (await write(next)) setDraft((d) => (d ? { ...d, saved: next } : d))
  }
  // Enabling or disabling takes effect at once: it saves that one flag onto what is saved, leaving
  // any other unsaved edits as they are.
  const setEnabled = async (id: string, on: boolean) => {
    setList((l) => l.map((x) => (x.id === id ? { ...x, enabled: on } : x)))
    if (!saved.some((x) => x.id === id)) return
    const next = saved.map((x) => (x.id === id ? { ...x, enabled: on } : x))
    if (await write(next)) setDraft((d) => (d ? { ...d, saved: next } : d))
  }
  const update = (t: Trigger) => setList((l) => l.map((x) => (x.id === t.id ? t : x)))
  const current = list.find((t) => t.id === selected) ?? null
  const folderNames = useMemo(() => [...new Set(list.map((t) => t.folder).filter(Boolean))], [list])

  const folders = useMemo(() => {
    const q = query.toLowerCase()
    const map = new Map<string, Trigger[]>()
    for (const t of list) {
      if (q && !t.name.toLowerCase().includes(q) && !t.phrases.some((p) => p.text.toLowerCase().includes(q))) continue
      map.set(t.folder || 'General', [...(map.get(t.folder || 'General') ?? []), t])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [list, query])

  if (!draft) return loadError ? <LoadError what="your triggers" error={loadError} retry={() => setAttempt((n) => n + 1)} /> : <Pending what="your triggers" />

  // The shipped triggers this profile does not have (FEAT-043): a new default reaches an old profile here.
  const have = new Set(list.map((t) => t.id))
  const missing = (shipped ?? []).filter((t) => !have.has(t.id))
  const importFrom = async (channel: 'triggers:import' | 'triggers:importGina', what: string) => {
    try {
      const imported = await api.invoke(channel)
      if (imported) {
        setList((l) => [...l, ...imported.map((t) => ({ ...blankTrigger(''), ...t, id: newId() }))])
        showToast(`Imported ${imported.length} trigger${imported.length === 1 ? '' : 's'} into the list; Save changes keeps them.`)
      }
    } catch (e) {
      showError(`Could not import that ${what}`, e)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Triggers</h1>
          <p>Your own alerts for any log line. Spell durations don't need a trigger: Spell Timers times every spell you cast.</p>
        </div>
        <div className="actions">
          {missing.length > 0 && (
            <button
              className="btn"
              title={`Triggers this version ships that your list does not have: ${missing.map((t) => t.name).join(', ')}`}
              onClick={() => {
                setList((l) => [...l, ...missing])
                showToast(`Added ${missing.length} shipped trigger${missing.length === 1 ? '' : 's'}; Save changes keeps them.`)
              }}
            >
              Add {missing.length} shipped
            </button>
          )}
          <button className="btn" onClick={() => void importFrom('triggers:import', 'file')}>
            Import…
          </button>
          <button
            className="btn"
            onClick={() => void actDone((saved) => (saved ? `Exported ${list.length} trigger${list.length === 1 ? '' : 's'}.` : null), 'triggers:export', list)}
          >
            Export…
          </button>
          <button className="btn" title="A GINA package (.gtp), as guilds share triggers" onClick={() => void importFrom('triggers:importGina', 'GINA package')}>
            Import GINA…
          </button>
          <button
            className="btn"
            title="As a GINA package (.gtp): speech, text and timers go across; sounds do not"
            onClick={() => void actDone((saved) => (saved ? `Exported ${list.length} trigger${list.length === 1 ? '' : 's'} for GINA.` : null), 'triggers:exportGina', list)}
          >
            Export GINA…
          </button>
          <button
            className="btn"
            onClick={() => {
              const t = blankTrigger(current?.folder ?? '')
              setList((l) => [...l, t])
              setSelected(t.id)
            }}
          >
            <Icon name="plus" /> New trigger
          </button>
          <button className="btn primary" disabled={!dirty} onClick={() => void save()}>
            {dirty ? 'Save changes' : 'Saved'}
          </button>
          <span className="sr-only" role="status">
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="notice bad mb-16">
          {errors.map((e) => (
            <div key={e.trigger}>
              <b>{e.trigger}</b>: {e.error}
            </div>
          ))}
        </div>
      )}

      <GroupHealthCard />

      <div className="split">
        <div className="card" style={{ padding: 10 }}>
          <FilterBox placeholder="Filter triggers…" label="Filter triggers" value={query} onChange={setQuery} width="100%" className="mb-8" />
          <div className="tree">
            {folders.length === 0 && <div className="empty">No triggers.</div>}
            {folders.map(([folder, items]) => (
              <div key={folder}>
                <div className="tree-folder">{folder}</div>
                {items.map((t) => (
                  <div key={t.id} className={`tree-item${t.id === selected ? ' active' : ''}${t.enabled ? '' : ' disabled'}`} onClick={() => setSelected(t.id)}>
                    <button className="name" title={t.name} aria-current={t.id === selected ? 'true' : undefined} onClick={() => setSelected(t.id)}>
                      {t.name}
                      {!t.enabled && <span className="faint"> (off)</span>}
                    </button>
                    <Switch on={t.enabled} title={t.enabled ? 'Enabled' : 'Disabled'} label={`${t.name} enabled`} onChange={(v) => void setEnabled(t.id, v)} />
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
            folders={folderNames}
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

      {/* The one test panel (Live and Spell Timers link here): the lines are matched against the selected trigger, and run for real through everything. */}
      <TestPanel t={current} focus={wanted.current === TEST_CARD} />
    </>
  )
}

/** Keys for the actions being edited: unique for the page's life. */
let nextActionKey = 1

function TriggerEditor({
  t,
  folders,
  onChange,
  onDelete,
  onDuplicate
}: {
  t: Trigger
  folders: string[]
  onChange: (t: Trigger) => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const set = (patch: Partial<Trigger>) => onChange({ ...t, ...patch })
  const setPhrase = (i: number, p: Phrase) => set({ phrases: t.phrases.map((x, j) => (j === i ? p : x)) })
  const setAction = (i: number, a: TriggerAction) => set({ actions: t.actions.map((x, j) => (j === i ? a : x)) })
  // Each action keeps a key of its own while it is edited, so removing one from the middle does not
  // hand the editors below it (and a sound list each loaded) to the wrong actions (LT-397).
  const [actionKeys, setActionKeys] = useState<number[]>(() => t.actions.map(() => nextActionKey++))
  if (actionKeys.length !== t.actions.length) setActionKeys(t.actions.map((_, i) => actionKeys[i] ?? nextActionKey++))
  const addAction = (a: TriggerAction) => {
    setActionKeys((k) => [...k, nextActionKey++])
    set({ actions: [...t.actions, a] })
  }
  const removeAction = (i: number) => {
    setActionKeys((k) => k.filter((_, j) => j !== i))
    set({ actions: t.actions.filter((_, j) => j !== i) })
  }
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <h2>Trigger</h2>
          <span className="spacer" />
          <button className="btn small" onClick={onDuplicate}>
            Duplicate
          </button>
          {/* Taken out of the list being edited; it is gone once the changes are saved (LT-477). */}
          <ConfirmButton question={`Remove ${t.name || 'this trigger'}? It goes with Save changes.`} onConfirm={onDelete}>
            Remove
          </ConfirmButton>
        </div>
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
        <div className="card-head">
          <h2>When the log says</h2>
          <span className="spacer" />
          <button className="btn small" onClick={() => set({ phrases: [...t.phrases, { text: '', regex: false }] })}>
            <Icon name="plus" /> Phrase
          </button>
        </div>
        <div className="stack gap-8">
          {t.phrases.map((p, i) => (
            <div className="phrase-row" key={i}>
              <input
                className="mono"
                value={p.text}
                aria-label={`Phrase ${i + 1}`}
                onChange={(e) => setPhrase(i, { ...p, text: e.target.value })}
                placeholder={p.regex ? "^(?<S1>\\w+) tells you, '(?<S2>.+)'$" : 'You feel yourself starting to appear.'}
              />
              <label className="check small">
                <input type="checkbox" checked={p.regex} onChange={(e) => setPhrase(i, { ...p, regex: e.target.checked })} /> Regex
              </label>
              <button className="btn ghost small x-btn" aria-label={`Remove phrase ${i + 1}`} onClick={() => set({ phrases: t.phrases.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
        </div>
        <p className="faint small" style={{ marginBottom: 0 }}>
          Plain text matches anywhere in the line, ignoring case. Snippets: <code>{'{C}'}</code> your character, <code>{'{S1}'}</code> any text, <code>{'{N1}'}</code> a number,{' '}
          <code>{'${Name}'}</code> a named capture. Use them in the outputs below too.
        </p>
      </div>

      <Conditions t={t} set={set} />

      <div className="card">
        <div className="card-head">
          <h2>Then</h2>
          <span className="spacer" />
          <select value="" aria-label="Add an action" onChange={(e) => e.target.value && addAction(blankAction(e.target.value as TriggerAction['type']))}>
            <option value="">Add an action…</option>
            <option value="speak">Speak</option>
            <option value="sound">Play a sound</option>
            <option value="text">Show text</option>
            <option value="timer">Start a timer</option>
          </select>
        </div>
        <div className="stack gap-12">
          {t.actions.length === 0 && <div className="empty">No actions: this trigger does nothing.</div>}
          {t.actions.map((a, i) => (
            <ActionEditor key={actionKeys[i] ?? `i${i}`} a={a} onChange={(x) => setAction(i, x)} onRemove={() => removeAction(i)} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Says words as a phrase would be said, its snippets filled with "something": the chosen voice and rate. */
const hear = (text: string) => void act('audio:test', text.replace(/\{\w+\}|\$\{\w+\}/g, 'something'))

/** A Hear button beside words to be spoken, off while there are none (LT-747). */
function HearButton({ text }: { text: string }) {
  return (
    <button type="button" className="btn small" disabled={!text.trim()} onClick={() => hear(text)}>
      Hear
    </button>
  )
}

const OPS: TriggerCompare['op'][] = ['>', '>=', '<', '<=', '=']

/**
 * When it may fire beyond its phrases (FEAT-030): a zone, in or out of a fight, which characters, the
 * n-th match in so many seconds, and a number snippet against a value. Each left empty holds always.
 */
function Conditions({ t, set }: { t: Trigger; set: (patch: Partial<Trigger>) => void }) {
  const w = t.when ?? {}
  const setWhen = (patch: Partial<TriggerWhen>) => {
    const next: TriggerWhen = { ...w, ...patch }
    for (const k of Object.keys(next) as (keyof TriggerWhen)[]) if (next[k] === undefined) delete next[k]
    set({ when: Object.keys(next).length ? next : undefined })
  }
  const set_ = Object.keys(w).length
  return (
    <details className="card" open={set_ > 0}>
      <summary>
        <b>Only when</b> <span className="faint small">{set_ ? `${set_} condition${set_ === 1 ? '' : 's'}` : 'always, as it is'}</span>
      </summary>
      <div className="grid three mt-8">
        <Field label="In a zone" hint="Its name holds this text, any case. Blank: anywhere.">
          <input value={w.zone ?? ''} onChange={(e) => setWhen({ zone: e.target.value || undefined })} placeholder="Plane of Fear" />
        </Field>
        <Field label="Fighting">
          <select
            value={w.fighting === undefined ? 'any' : w.fighting ? 'yes' : 'no'}
            onChange={(e) => setWhen({ fighting: e.target.value === 'any' ? undefined : e.target.value === 'yes' })}
          >
            <option value="any">In a fight or not</option>
            <option value="yes">Only in a fight</option>
            <option value="no">Only out of a fight</option>
          </select>
        </Field>
        <Field label="Characters" hint="Their names, with commas. Blank: every character.">
          <input
            value={(w.characters ?? []).join(', ')}
            onChange={(e) => {
              const names = e.target.value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
              setWhen({ characters: names.length ? names : undefined })
            }}
            placeholder="Kelwyn, Aldric"
          />
        </Field>
        <Field label="Only on the n-th match" hint="Fires on that many matches within the seconds after the first, then counts again. 0: every match.">
          <div className="row tight">
            <NumberInput
              value={w.count?.n ?? 0}
              min={0}
              max={100}
              width={64}
              label="Matches"
              onChange={(v) => setWhen({ count: v && v >= 2 ? { n: v, withinSec: w.count?.withinSec ?? 20 } : undefined })}
            />
            <span className="small muted">within</span>
            <NumberInput
              value={w.count?.withinSec ?? 20}
              min={1}
              width={64}
              label="Seconds"
              onChange={(v) => w.count && setWhen({ count: { n: w.count.n, withinSec: v ?? 20 } })}
            />
            <span className="small muted">s</span>
          </div>
        </Field>
        <Field label="A number it caught" hint="A number snippet against a value, as {N1} over 300. Blank: any number.">
          <div className="row tight">
            <select
              value={w.compare?.snippet ?? ''}
              aria-label="Number snippet"
              onChange={(e) => setWhen({ compare: e.target.value ? { snippet: e.target.value, op: w.compare?.op ?? '>', value: w.compare?.value ?? 0 } : undefined })}
            >
              <option value="">—</option>
              {['N', 'N1', 'N2', 'N3'].map((n) => (
                <option key={n} value={n}>{`{${n}}`}</option>
              ))}
            </select>
            <select
              value={w.compare?.op ?? '>'}
              aria-label="Compared how"
              disabled={!w.compare}
              onChange={(e) => w.compare && setWhen({ compare: { ...w.compare, op: e.target.value as TriggerCompare['op'] } })}
            >
              {OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <NumberInput value={w.compare?.value ?? 0} width={80} label="Value" onChange={(v) => w.compare && setWhen({ compare: { ...w.compare, value: v ?? 0 } })} />
          </div>
        </Field>
      </div>
    </details>
  )
}

function ActionEditor({ a, onChange, onRemove }: { a: TriggerAction; onChange: (a: TriggerAction) => void; onRemove: () => void }) {
  const overlays = useSettled((s) => s.settings.overlays)
  const [sounds, setSounds] = useState<string[]>([])
  useEffect(() => {
    if (a.type !== 'sound') return
    let live = true
    api.invoke('audio:sounds').then(
      (s) => live && setSounds(s),
      () => {}
    )
    return () => {
      live = false
    }
  }, [a.type])
  const head = { speak: 'Speak', sound: 'Play a sound', text: 'Show text', timer: 'Start a timer' }[a.type]
  return (
    <div className="action-card">
      <div className="row">
        <b>{head}</b>
        <span className="grow" />
        <button className="btn ghost small" aria-label={`Remove the ${head.toLowerCase()} action`} onClick={onRemove}>
          Remove
        </button>
      </div>
      {a.type === 'speak' && (
        <div className="row">
          <input className="grow" value={a.text} aria-label="Words to speak" onChange={(e) => onChange({ ...a, text: e.target.value })} placeholder="Tell from {S1}: {S2}" />
          <label className="check small">
            <input type="checkbox" checked={a.interrupt} onChange={(e) => onChange({ ...a, interrupt: e.target.checked })} /> Interrupt other speech
          </label>
          <HearButton text={a.text} />
        </div>
      )}
      {a.type === 'sound' && (
        <div className="row">
          <select className="grow" value={a.file} aria-label="Sound" onChange={(e) => onChange({ ...a, file: e.target.value })}>
            <option value="">Choose a sound…</option>
            {[...new Set([a.file, ...sounds])].filter(Boolean).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <span className="muted small">Volume</span>
          <input type="range" min={0} max={1} step={0.05} value={a.volume} aria-label="Volume" onChange={(e) => onChange({ ...a, volume: Number(e.target.value) })} />
          <button className="btn small" disabled={!a.file} title={a.file ? undefined : 'Choose a sound first'} onClick={() => void act('audio:sound', a.file)}>
            Play
          </button>
          {!a.file && <span className="faint small">choose a sound first</span>}
        </div>
      )}
      {a.type === 'text' && (
        <div className="row">
          <input className="grow" value={a.text} aria-label="Text to show" onChange={(e) => onChange({ ...a, text: e.target.value })} placeholder="INVIS DROPPING" />
          <input type="color" value={a.color} aria-label="Text colour" onChange={(e) => onChange({ ...a, color: e.target.value })} style={{ width: 44, height: 32, padding: 2 }} />
          <NumberInput value={a.durationSec} min={1} width={64} label="Seconds to show it" onChange={(v) => onChange({ ...a, durationSec: v ?? 5 })} />
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
              {overlays
                .filter((o) => o.kind === 'timers')
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Warn at (seconds left)">
            <NumberInput value={a.warnSec} min={0} onChange={(v) => onChange({ ...a, warnSec: v ?? 0 })} />
          </Field>
          <Field label="Warning speech">
            <div className="row tight">
              <input className="grow" value={a.warnSpeech} onChange={(e) => onChange({ ...a, warnSpeech: e.target.value })} placeholder="Mez ending" />
              <HearButton text={a.warnSpeech} />
            </div>
          </Field>
          <Field label="Ended speech">
            <div className="row tight">
              <input className="grow" value={a.endSpeech} onChange={(e) => onChange({ ...a, endSpeech: e.target.value })} placeholder="Mez off" />
              <HearButton text={a.endSpeech} />
            </div>
          </Field>
          <Field label="About" hint="What the bar is about, so a grouped overlay puts it under that mob. Blank: what the phrase caught as ${Target}, {S1} or {S}.">
            <input value={a.target ?? ''} onChange={(e) => onChange({ ...a, target: e.target.value || undefined })} placeholder="{S1}" />
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
          <Field
            label="End early when"
            hint="One phrase per line. ${Name} is fixed to what started this timer. A timer runs to its end and says its end speech unless one of these ends it: a mob's death ends spell timers on it, not this one, so add its death line (You have slain ${Name}!) to stop it then."
          >
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

/**
 * The Test card, the one place to try log lines (Live's and Spell Timers' "Try a log line" open it):
 * the last line is matched against the selected trigger, without running it; Run for real runs every
 * line through Spell Timers and every trigger as if just logged, their times moved to now.
 */
function TestPanel({ t, focus }: { t: Trigger | null; focus: boolean }) {
  const [lines, setLines] = useRemembered<string>(TRY_LINES, '')
  const last = useMemo(
    () =>
      lines
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .pop() ?? '',
    [lines]
  )
  const [result, setResult] = useState<TriggerTestResult | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  // Sent here to try a line: the card in view, the lines ready to type into.
  useEffect(() => {
    if (!focus) return
    card.current?.scrollIntoView?.({ block: 'start' })
    box.current?.focus()
  }, [focus])
  useEffect(() => {
    if (!t || !last) return setResult(null)
    let live = true
    const id = setTimeout(
      () =>
        api.invoke('triggers:test', t, last).then(
          (r) => live && setResult(r),
          (e) => live && setResult({ matched: false, phraseIndex: -1, captures: {}, outputs: [], error: errorMessage(e) })
        ),
      150
    )
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [last, t])
  return (
    <div className="card mt-16" ref={card}>
      <h2>Test</h2>
      <p className="muted small mt-0">
        Paste log lines.{' '}
        {t ? (
          <>
            The last is matched against <b>{t.name}</b>: which phrase, the captures and what it would do, without running it.
          </>
        ) : (
          'Select a trigger to see which of its phrases the last line matches.'
        )}{' '}
        <b>Run for real</b> runs them all through Spell Timers and every trigger, as if they had just been logged, with their times moved to now: you hear and see what they do.
      </p>
      <div className="stack gap-8">
        <textarea ref={box} className="mono" rows={4} value={lines} aria-label="Log lines to test" onChange={(e) => setLines(e.target.value)} placeholder={SAMPLE} />
        <div className="row">
          <button
            className="btn primary"
            disabled={!last}
            title="Run the lines through Spell Timers and every trigger, as if they had just been logged: you hear and see what they do"
            onClick={() => void actDone(ranLines, 'simulate', lines)}
          >
            Run for real
          </button>
          <button className="btn ghost" onClick={() => setLines(SAMPLE)}>
            Use example
          </button>
        </div>
      </div>
      {result && (
        <div style={{ marginTop: 10 }}>
          {result.error ? (
            <div className="notice bad">{result.error}</div>
          ) : result.matched ? (
            <div className="stack gap-8">
              <div className="row">
                <span className="chip ok">Matches phrase {result.phraseIndex + 1}</span>
                {Object.entries(result.captures).map(([k, v]) => (
                  <span key={k} className="chip mono">
                    {k} = {v}
                  </span>
                ))}
              </div>
              {result.outputs.map((o, i) => (
                <div key={i} className="mono small muted">
                  → {o}
                </div>
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
