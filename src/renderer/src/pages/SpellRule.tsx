import { useEffect, useState, useSyncExternalStore } from 'react'
import { useApp } from '../state'
import { markUnsaved } from '../unsaved'
import { api, errorMessage } from '../api'
import { act, showToast } from '../toast'
import { ConfirmButton, Field, NumberInput, SpellIcon, Switch } from '../components/ui'
import { type KnownSpell, type SpellRule } from '../../../shared/types'

// One spell's rule on Spell Timers: tracking, cues, speech, colour, overlay and a fixed duration.

const same = (a: SpellRule, b: SpellRule) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Edits not saved yet, by spell, with the saved rule they were made over: kept here rather than in
 * the editor, so opening another spell's row and coming back finds them as they were (LT-342), and
 * the sidebar marks Spell Timers while any are open.
 */
const drafts = new Map<string, { rule: SpellRule; base: SpellRule }>()
let draftNames: ReadonlySet<string> = new Set()
const draftListeners = new Set<() => void>()

function keepDraft(name: string, rule: SpellRule, base: SpellRule): void {
  const had = drafts.has(name)
  if (same(rule, base)) drafts.delete(name)
  else drafts.set(name, { rule, base })
  if (had === drafts.has(name)) return
  draftNames = new Set(drafts.keys())
  markUnsaved('spells', drafts.size > 0)
  for (const l of draftListeners) l()
}

/** The spells with edits not saved yet. */
export function useSpellDrafts(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      draftListeners.add(l)
      return () => draftListeners.delete(l)
    },
    () => draftNames
  )
}

export function RuleEditor({ k, onSaved }: { k: KnownSpell; onSaved: (list: KnownSpell[]) => void }) {
  const { state } = useApp()
  const [rule, setRule] = useState<SpellRule>(() => {
    const d = drafts.get(k.name)
    return d ? rebase(d.rule, d.base, k.rule) : k.rule
  })
  const [base, setBase] = useState<SpellRule>(k.rule)
  const [error, setError] = useState('')
  if (!same(base, k.rule)) {
    setRule((r) => rebase(r, base, k.rule))
    setBase(k.rule)
  }
  useEffect(() => keepDraft(k.name, rule, base), [k.name, rule, base])
  const dirty = !same(rule, base)
  const set = (patch: Partial<SpellRule>) => setRule((r) => ({ ...r, ...patch }))
  const save = async (r: SpellRule | null) => {
    setError('')
    try {
      onSaved(await api.invoke('spells:rule', k.name, r))
      if (!r) setRule({})
      showToast(r ? `Saved ${k.name}'s settings.` : `Cleared ${k.name}'s settings.`)
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
          {k.landOther && (
            <div>
              Lands on others: “<i>Name</i>
              {k.landOther}”
            </div>
          )}
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
            <input
              value={rule.warnSpeech ?? ''}
              placeholder={beneficial ? t.buffWarnSpeech : t.dotWarnSpeech}
              onChange={(e) => set({ warnSpeech: e.target.value === '' ? undefined : e.target.value })}
            />
          </Field>
          <Field label="Fade speech" hint="Leave blank for the default.">
            <input
              value={rule.fadeSpeech ?? ''}
              placeholder={beneficial ? t.buffFadeSpeech : t.dotFadeSpeech}
              onChange={(e) => set({ fadeSpeech: e.target.value === '' ? undefined : e.target.value })}
            />
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
          {dirty && (
            <button className="btn ghost" onClick={() => setRule(base)}>
              Discard changes
            </button>
          )}
          <button
            className="btn"
            onClick={() =>
              void act(
                'audio:test',
                (rule.warnSpeech ?? (beneficial ? t.buffWarnSpeech : t.dotWarnSpeech)).replace(/\{spell\}/gi, rule.alias || k.name).replace(/\{target\}/gi, 'a gnoll')
              )
            }
          >
            Hear warning
          </button>
          <span className="grow" />
          <ConfirmButton className="btn ghost" question="Clear every setting for this spell?" onConfirm={() => void save(null)}>
            Reset to defaults
          </ConfirmButton>
        </div>
        {dirty && <div className="small faint">Not saved yet: the changes stay here while you look at other spells.</div>}
        {error && (
          <div className="notice bad small" role="alert">
            Could not save: {error}
          </div>
        )}
      </div>
    </div>
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
