import { useActions, useSettled } from '../state'
import { act } from '../toast'
import { Field, NumberInput, Switch } from './ui'
import type { GroupHealthSettings } from '../../../shared/types'

const TYPING_MS = 300

/** The group health alert's switch and wording, on the Triggers page. */
export function GroupHealthCard() {
  const g = useSettled((s) => s.settings.groupHealth)
  const { patchSettings } = useActions()
  const set = (patch: Partial<GroupHealthSettings>, debounceMs?: number) => patchSettings((s) => ({ ...s, groupHealth: { ...s.groupHealth, ...patch } }), { debounceMs })
  return (
    <div className="card stack gap-12 mb-16">
      <label className="row">
        <Switch on={g.enabled} onChange={(v) => void set({ enabled: v })} label="Say when a group member's health is low" />
        <b>Say when a group member&apos;s health is low</b>
        {/* Unlike the triggers below, which wait for Save (LT-592). */}
        <span className="faint small">saved as you change it</span>
      </label>
      <p className="muted small m-0">
        The log never prints anyone&apos;s health, so this watches the health bars in JuiceboxUI&apos;s Group window on the screen, while the game runs. The window has to be in
        view. Each member is said once when they fall to the line, then again only after they are back 10% over it; a member at 0 (dead, or in another zone) is never said.
      </p>
      {g.enabled && (
        <div className="row gap-12" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Field label="At or under" hint="Percent of their health.">
            <NumberInput value={g.belowPct} min={5} max={80} width={80} onChange={(v) => void set({ belowPct: v ?? 25 })} label="Health line, percent" />
          </Field>
          <Field label="Say" hint="{name} and {pct} are filled in; names are read off the window." style={{ flex: 1, minWidth: 260 }}>
            <div className="row tight">
              <input className="grow" value={g.speech} onChange={(e) => void set({ speech: e.target.value }, TYPING_MS)} />
              <button type="button" className="btn small" onClick={() => void act('audio:test', g.speech.replace(/\{name\}/gi, 'Aldric').replace(/\{pct\}/gi, String(g.belowPct)))}>
                Hear
              </button>
            </div>
          </Field>
        </div>
      )}
      {g.enabled && (
        <div className="row gap-12" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Field label="Tank's line" hint="Members said at a line of their own: names as the window shows them, commas between.">
            <div className="row tight">
              <input
                style={{ width: 180 }}
                value={g.watchNames.join(', ')}
                placeholder="none"
                onChange={(e) =>
                  void set(
                    {
                      watchNames: e.target.value
                        .split(',')
                        .map((n) => n.trim())
                        .filter(Boolean)
                    },
                    TYPING_MS
                  )
                }
              />
              <NumberInput value={g.watchPct} min={5} max={90} width={70} onChange={(v) => void set({ watchPct: v ?? 40 })} label="Their health line, percent" />
            </div>
          </Field>
          <Field label="Low mana at" hint="Percent of their mana; 0 off. Members without mana are never said.">
            <NumberInput value={g.manaPct} min={0} max={80} width={70} onChange={(v) => void set({ manaPct: v ?? 0 })} label="Mana line, percent" />
          </Field>
          {g.manaPct > 0 && (
            <Field label="Say for mana" hint="{name} and {pct}." style={{ flex: 1, minWidth: 220 }}>
              <div className="row tight">
                <input className="grow" value={g.manaSpeech} onChange={(e) => void set({ manaSpeech: e.target.value }, TYPING_MS)} />
                <button
                  type="button"
                  className="btn small"
                  onClick={() => void act('audio:test', g.manaSpeech.replace(/\{name\}/gi, 'Aldric').replace(/\{pct\}/gi, String(g.manaPct)))}
                >
                  Hear
                </button>
              </div>
            </Field>
          )}
        </div>
      )}
    </div>
  )
}
