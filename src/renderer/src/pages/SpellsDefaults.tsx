import { useActions, useSettled } from '../state'
import { Field, NumberInput, Switch } from '../components/ui'
import type { TrackingSettings } from '../../../shared/types'

/** A phrase is saved once typing stops, not at every key (LT-393): each save reconfigures the engine. */
const TYPING_MS = 300

/** What Spell Timers tracks and says unless a spell's own rule says otherwise. */
export function SpellDefaults() {
  const { patchSettings } = useActions()
  const t = useSettled((s) => s.settings.tracking)
  const setT = (patch: Partial<TrackingSettings>, debounceMs?: number) => patchSettings((x) => ({ ...x, tracking: { ...x.tracking, ...patch } }), { debounceMs })
  return (
    <>
      <div className="card stack gap-14">
        <h2>Tracked by default</h2>
        <div className="grid two">
          <label className="row">
            <Switch on={t.enabled} onChange={(v) => setT({ enabled: v })} /> Track spells I cast
          </label>
          <span />
          <label className="row">
            <Switch on={t.selfBuffs} onChange={(v) => setT({ selfBuffs: v })} /> Buffs on me
          </label>
          <label className="row">
            <Switch on={t.otherBuffs} onChange={(v) => setT({ otherBuffs: v })} /> Buffs I cast on others
          </label>
          <label className="row">
            <Switch on={t.groupBuffs} onChange={(v) => setT({ groupBuffs: v })} /> Buffs from my group on the overlays
            <span className="faint small">timers for their buffs on me, and whom to ask, on the overlays</span>
          </label>
          <label className="row">
            <Switch on={t.dots} onChange={(v) => setT({ dots: v })} /> DoTs
          </label>
          <label className="row">
            <Switch on={t.debuffs} onChange={(v) => setT({ debuffs: v })} /> Debuffs, mez and charm
          </label>
        </div>
        <p className="muted small m-0">These are the defaults. Any spell above can override them: with buffs off, set a buff you want to "Always track".</p>
      </div>

      <div className="grid two">
        <div className="card stack gap-12">
          <h2>Buff announcements</h2>
          <Field
            label="Warn before a buff on me ends"
            hint="Seconds; 0 turns it off. Buff ends are known to within one 6-second tick, so this counts from the earliest they could end."
          >
            <NumberInput value={t.buffWarnSec} min={0} onChange={(v) => setT({ buffWarnSec: v ?? 0 })} />
          </Field>
          <Field label="Warning" hint="{spell} and {target} are filled in.">
            <input value={t.buffWarnSpeech} onChange={(e) => setT({ buffWarnSpeech: e.target.value }, TYPING_MS)} />
          </Field>
          <Field label="When it fades" hint="Blank for silence.">
            <input value={t.buffFadeSpeech} onChange={(e) => setT({ buffFadeSpeech: e.target.value }, TYPING_MS)} />
          </Field>
          <label className="row">
            <Switch on={t.announceOtherBuffFades} onChange={(v) => setT({ announceOtherBuffFades: v })} />
            Also announce buffs fading from other players
          </label>
        </div>
        <div className="card stack gap-12">
          <h2>DoT announcements</h2>
          <Field label="Warn before a DoT ends" hint="Seconds; 0 turns it off. Exact to the second once the DoT has ticked.">
            <NumberInput value={t.dotWarnSec} min={0} onChange={(v) => setT({ dotWarnSec: v ?? 0 })} />
          </Field>
          <Field label="Warning">
            <input value={t.dotWarnSpeech} onChange={(e) => setT({ dotWarnSpeech: e.target.value }, TYPING_MS)} />
          </Field>
          <Field label="When it wears off" hint="Blank for silence.">
            <input value={t.dotFadeSpeech} onChange={(e) => setT({ dotFadeSpeech: e.target.value }, TYPING_MS)} />
          </Field>
        </div>
      </div>
    </>
  )
}
