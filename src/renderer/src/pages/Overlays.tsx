import { useActions, useSettled } from '../state'
import { act } from '../toast'
import { BUILTIN_OVERLAYS } from '../constants'
import { ConfirmButton, Field, Icon, NumberInput, Switch } from '../components/ui'
import type { MeterOverlayOptions, OverlayConfig } from '../../../shared/types'
import { DEFAULT_ACHIEVEMENT_OPTIONS, DEFAULT_METER_OPTIONS, defaultPlacement, minOpacity, newOverlaySpot, type WorkArea } from '../../../shared/overlays'

/** Where overlays can go on the screen this window is on. */
function thisScreen(): WorkArea {
  const sc = window.screen as Screen & { availLeft?: number; availTop?: number }
  return { x: sc.availLeft ?? 0, y: sc.availTop ?? 0, width: sc.availWidth, height: sc.availHeight }
}

/** The middle of the screen this window is on, sized to fit it. */
function bringOnScreen(o: OverlayConfig): Partial<OverlayConfig> {
  const a = thisScreen()
  const width = Math.min(o.width, a.width - 40)
  const height = Math.min(o.height, a.height - 40)
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height }
}

/** Typed edits to an overlay's place save once typing stops for this long. */
const TYPING_SAVE_MS = 300

/** The opacity slider saves once it stops moving for this long; the overlay follows it at once. */
const SLIDER_SAVE_MS = 150

function MeterOptions({ o, onChange }: { o: OverlayConfig; onChange: (m: Partial<MeterOverlayOptions>) => void }) {
  const m = { ...DEFAULT_METER_OPTIONS, ...o.meter }
  return (
    <>
      <div className="grid two">
        <Field label="Shows">
          <select value={m.mode} onChange={(e) => onChange({ mode: e.target.value as MeterOverlayOptions['mode'] })}>
            <option value="damage">Damage</option>
            <option value="incoming">Incoming</option>
            <option value="healing">Healing</option>
          </select>
        </Field>
        <Field label="Of">
          <select value={m.span} onChange={(e) => onChange({ span: e.target.value as MeterOverlayOptions['span'] })}>
            <option value="fight">Fight</option>
            <option value="session">Session</option>
          </select>
        </Field>
      </div>
      <div className="grid two">
        <Field label="Whose">
          <select value={m.scope} onChange={(e) => onChange({ scope: e.target.value as MeterOverlayOptions['scope'] })}>
            <option value="everyone">Everyone</option>
            <option value="group">Group</option>
            <option value="you">You</option>
          </select>
        </Field>
        <Field label="Rows at most">
          <NumberInput value={m.rows} min={1} max={50} onChange={(v) => onChange({ rows: v ?? 8 })} />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={m.combinePet} onChange={(e) => onChange({ combinePet: e.target.checked })} />
        Pets with their owners
        <span className="faint small">this overlay's own; the Damage Meter page has its own</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={m.header} onChange={(e) => onChange({ header: e.target.checked })} />
        Header with the fight name and controls
      </label>
      <p className="faint small m-0">
        Hover the header over the game for its controls: fight or session, what it lists, whose rows, a new session, and a pin to unlock the rows for clicking.
      </p>
    </>
  )
}

export function Overlays() {
  const { patchSettings } = useActions()
  const arranging = useSettled((s) => s.arranging)
  const achievementCues = useSettled((s) => s.settings.achievementCues)
  const overlays = useSettled((s) => s.settings.overlays)
  const overlaysOnlyWithGame = useSettled((s) => s.settings.overlaysOnlyWithGame)
  const update = (id: string, patch: Partial<OverlayConfig>, debounceMs?: number) =>
    patchSettings((s) => ({ ...s, overlays: s.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) }), { debounceMs })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overlays</h1>
          <p>
            Transparent windows over the game. They let clicks through and never take focus, so they never cost you a keypress mid-fight. The game must run in windowed or
            borderless mode for them to show over it.
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void act('overlays:demo')}>
            <Icon name="sparkle" /> Show demo timers
          </button>
          <ConfirmButton
            className="btn"
            question="Put the built-in overlays back where they start, on this screen?"
            title="Where a new install puts them, sized for this screen: the overlays you added stay where they are"
            onConfirm={() => {
              const place = defaultPlacement(thisScreen())
              void patchSettings((s) => ({ ...s, overlays: s.overlays.map((o) => (place[o.id] ? { ...o, ...place[o.id] } : o)) }))
            }}
          >
            Reset layout
          </ConfirmButton>
          <button className={`btn ${arranging ? 'on' : 'primary'}`} aria-pressed={arranging} onClick={() => void act('overlays:arrange', !arranging)}>
            <Icon name="move" /> {arranging ? 'Lock overlays' : 'Arrange overlays'}
          </button>
        </div>
      </div>

      <label className="card row mb-16">
        <Switch on={overlaysOnlyWithGame} label="Only show overlays while the game has focus" onChange={(v) => patchSettings((s) => ({ ...s, overlaysOnlyWithGame: v }))} />
        <div className="grow">
          <div style={{ fontWeight: 600 }}>Only show overlays while the game has focus</div>
          <div className="muted small">
            They hide when you tab to anything else and come back as soon as the game is in front. They also show while this window has focus, so arranging and the demo still work.
            Audio cues play either way.
          </div>
        </div>
      </label>

      {arranging && (
        <div className="notice mb-16">
          Drag each outlined window where you want it and drag its edges to resize. Positions save as you go. Click
          <b> Lock overlays</b> to make them click-through again.
        </div>
      )}

      <div className="grid three">
        {overlays.map((o) => (
          <div className="card" key={o.id}>
            <h2>
              {o.name}{' '}
              <span className="chip">{o.kind === 'timers' ? 'Timer bars' : o.kind === 'meter' ? 'Damage meter' : o.kind === 'achievements' ? 'Achievements' : 'Alert text'}</span>
              <span className="spacer" />
              <Switch on={o.visible} onChange={(v) => update(o.id, { visible: v })} title="Show this overlay" label={`Show ${o.name}`} />
            </h2>
            <div className="stack gap-12">
              <Field label="Name">
                <input value={o.name} onChange={(e) => update(o.id, { name: e.target.value }, TYPING_SAVE_MS)} />
              </Field>
              <div className="grid two">
                <Field label={o.kind === 'timers' ? 'Bar text size' : 'Text size'}>
                  <NumberInput value={o.fontSize} min={9} max={72} onChange={(v) => update(o.id, { fontSize: v ?? 15 })} />
                </Field>
                <Field label={`${o.kind === 'alerts' ? 'Opacity' : 'Background'} ${Math.round(o.opacity * 100)}%`}>
                  <input
                    type="range"
                    min={minOpacity(o.kind)}
                    max={1}
                    step={0.05}
                    value={o.opacity}
                    title={o.kind === 'alerts' ? 'Fades the alert text' : 'Fades the dark panel behind the text, down to none; the text stays as it is'}
                    onChange={(e) => update(o.id, { opacity: Number(e.target.value) }, SLIDER_SAVE_MS)}
                  />
                </Field>
              </div>
              {o.kind === 'timers' && (
                <label className="check">
                  <input type="checkbox" checked={o.groupByTarget} onChange={(e) => update(o.id, { groupByTarget: e.target.checked })} />
                  Group bars under each target's name
                </label>
              )}
              {o.kind === 'meter' && <MeterOptions o={o} onChange={(m) => update(o.id, { meter: { ...DEFAULT_METER_OPTIONS, ...o.meter, ...m } })} />}
              {o.kind === 'achievements' && (
                <>
                  <label className="row">
                    <Switch
                      on={(o.achievements ?? DEFAULT_ACHIEVEMENT_OPTIONS).factionPlan}
                      onChange={(v) => update(o.id, { achievements: { ...DEFAULT_ACHIEVEMENT_OPTIONS, ...o.achievements, factionPlan: v } })}
                      label="Show the faction plan"
                    />
                    Show the faction plan
                    <span className="faint small">off hides its step here; the plan is still followed, and still spoken if that is on</span>
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={achievementCues} onChange={(e) => patchSettings((s) => ({ ...s, achievementCues: e.target.checked }))} />
                    Say when a step is done
                    <span className="faint small">the faction plan's, as on the Plan tab's Now card; each achievement it finishes flashes on the alerts overlay</span>
                  </label>
                  <p className="faint small m-0">
                    The step of the faction plan you follow (Factions › Plan), counting down as your factions move; the Slayer achievements your last half hour of kills counted
                    toward, on top of your achievements export; and the skills your skill achievements want that went up in that time. It shows nothing when there is nothing to
                    show.
                  </p>
                </>
              )}
              <div className="overlay-place">
                {(
                  [
                    ['x', 'Left'],
                    ['y', 'Top'],
                    ['width', 'Width'],
                    ['height', 'Height']
                  ] as const
                ).map(([k, label]) => (
                  <Field key={k} label={label}>
                    <NumberInput
                      value={Math.round(o[k])}
                      min={k === 'width' || k === 'height' ? 40 : undefined}
                      onChange={(v) => v !== undefined && update(o.id, { [k]: k === 'width' || k === 'height' ? Math.max(40, v) : v }, TYPING_SAVE_MS)}
                    />
                  </Field>
                ))}
                <button
                  className="btn small ghost"
                  title="Moves it to the middle of the screen this window is on: for an overlay lost off screen after a monitor change"
                  onClick={() => update(o.id, bringOnScreen(o))}
                >
                  Bring on screen
                </button>
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
          <div>Another damage meter window: say, one for the fight and one for the whole session, or one for healing.</div>
          <button
            className="btn"
            onClick={() =>
              patchSettings((s) => ({
                ...s,
                overlays: [
                  ...s.overlays,
                  {
                    id: `meter-${Date.now()}`,
                    name: 'Meter',
                    kind: 'meter',
                    ...newOverlaySpot({ x: 440, y: 560 }, s.overlays),
                    width: 380,
                    height: 300,
                    opacity: 1,
                    fontSize: 13,
                    visible: true,
                    groupByTarget: false,
                    meter: { ...DEFAULT_METER_OPTIONS }
                  }
                ]
              }))
            }
          >
            <Icon name="plus" /> Add meter overlay
          </button>
        </div>
        <div className="card empty" style={{ display: 'grid', placeItems: 'center', gap: 10 }}>
          <div>Another bar window, for spells or trigger timers you want kept apart — say, mez timers.</div>
          <button
            className="btn"
            onClick={() =>
              patchSettings((s) => ({
                ...s,
                overlays: [
                  ...s.overlays,
                  {
                    id: `timers-${Date.now()}`,
                    name: 'Extra timers',
                    kind: 'timers',
                    ...newOverlaySpot({ x: 200, y: 200 }, s.overlays),
                    width: 320,
                    height: 300,
                    opacity: 1,
                    fontSize: 15,
                    visible: true,
                    groupByTarget: false
                  }
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
