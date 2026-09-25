import { useApp } from '../state'
import { act } from '../toast'
import { BUILTIN_OVERLAYS } from '../constants'
import { ConfirmButton, Field, Icon, NumberInput, Switch } from '../components/ui'
import type { OverlayConfig } from '../../../shared/types'

/** The opacity slider saves once it stops moving for this long; the overlay follows it at once. */
const SLIDER_SAVE_MS = 150

export function Overlays() {
  const { state, patchSettings } = useApp()
  const overlays = state.settings.overlays
  const update = (id: string, patch: Partial<OverlayConfig>, debounceMs?: number) =>
    patchSettings((s) => ({ ...s, overlays: s.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) }), { debounceMs })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overlays</h1>
          <p>
            Transparent windows over the game. They let clicks through and never take focus, so they never cost you a keypress
            mid-fight. The game must run in windowed or borderless mode for them to show over it.
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void act('overlays:demo')}>
            <Icon name="sparkle" /> Show demo timers
          </button>
          <button className={`btn ${state.arranging ? 'on' : 'primary'}`} aria-pressed={state.arranging} onClick={() => void act('overlays:arrange', !state.arranging)}>
            <Icon name="move" /> {state.arranging ? 'Done arranging' : 'Arrange on screen'}
          </button>
        </div>
      </div>

      <div className="card row mb-16">
        <Switch on={state.settings.overlaysOnlyWithGame} label="Only show overlays while the game has focus" onChange={(v) => patchSettings((s) => ({ ...s, overlaysOnlyWithGame: v }))} />
        <div className="grow">
          <div style={{ fontWeight: 600 }}>Only show overlays while the game has focus</div>
          <div className="muted small">
            They hide when you tab to anything else and come back as soon as the game is in front. They also show while this
            window has focus, so arranging and the demo still work. Audio cues play either way.
          </div>
        </div>
      </div>

      {state.arranging && (
        <div className="notice mb-16">
          Drag each outlined window where you want it and drag its edges to resize. Positions save as you go. Click
          <b> Done arranging</b> to make them click-through again.
        </div>
      )}

      <div className="grid three">
        {overlays.map((o) => (
          <div className="card" key={o.id}>
            <h2>
              {o.name} <span className="chip">{o.kind === 'timers' ? 'Timer bars' : 'Alert text'}</span>
              <span className="spacer" />
              <Switch on={o.visible} onChange={(v) => update(o.id, { visible: v })} title="Show this overlay" label={`Show ${o.name}`} />
            </h2>
            <div className="stack gap-12">
              <Field label="Name">
                <input value={o.name} onChange={(e) => update(o.id, { name: e.target.value })} />
              </Field>
              <div className="grid two">
                <Field label={o.kind === 'timers' ? 'Bar text size' : 'Text size'}>
                  <NumberInput value={o.fontSize} min={9} max={72} onChange={(v) => update(o.id, { fontSize: v ?? 15 })} />
                </Field>
                <Field label={`Opacity ${Math.round(o.opacity * 100)}%`}>
                  <input type="range" min={0.2} max={1} step={0.05} value={o.opacity} onChange={(e) => update(o.id, { opacity: Number(e.target.value) }, SLIDER_SAVE_MS)} />
                </Field>
              </div>
              {o.kind === 'timers' && (
                <label className="check">
                  <input type="checkbox" checked={o.groupByTarget} onChange={(e) => update(o.id, { groupByTarget: e.target.checked })} />
                  Group bars under each target's name
                </label>
              )}
              <div className="faint small mono">
                {o.width}×{o.height} at {o.x}, {o.y}
              </div>
              {!BUILTIN_OVERLAYS.includes(o.id) && (
                <ConfirmButton question={`Remove ${o.name}?`} onConfirm={() => void patchSettings((s) => ({ ...s, overlays: s.overlays.filter((x) => x.id !== o.id) }))}>
                  Remove overlay
                </ConfirmButton>
              )}
            </div>
          </div>
        ))}
        <div className="card empty" style={{ display: 'grid', placeItems: 'center', gap: 10 }}>
          <div>Another bar window, for spells or trigger timers you want kept apart — say, mez timers.</div>
          <button
            className="btn"
            onClick={() =>
              patchSettings((s) => ({
                ...s,
                overlays: [
                  ...s.overlays,
                  { id: `timers-${Date.now()}`, name: 'Extra timers', kind: 'timers', x: 200, y: 200, width: 320, height: 300, opacity: 1, fontSize: 15, visible: true, groupByTarget: false }
                ]
              }))
            }
          >
            <Icon name="plus" /> Add timer overlay
          </button>
        </div>
      </div>
    </>
  )
}
