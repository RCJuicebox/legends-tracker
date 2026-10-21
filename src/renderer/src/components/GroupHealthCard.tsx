import { useState } from 'react'
import { useActions, useSettled } from '../state'
import { useInvoke } from '../hooks'
import { act, showToast } from '../toast'
import { Field, NumberInput, Switch } from './ui'
import type { GroupHealthSettings } from '../../../shared/types'
import { COLOUR_KEYS, type GroupColours } from '../../../core/groupHealth'

const TYPING_MS = 300

const COLOUR_NAMES: Record<keyof GroupColours, string> = { outline: 'Outline', empty: 'Empty', hp: 'Health', mana: 'Mana', end: 'Endurance' }

/** The colours sampled for a skin, as small swatches. */
function Swatches({ colours }: { colours: GroupColours }) {
  return (
    <span className="row tight" aria-label="Sampled colours">
      {COLOUR_KEYS.map((k) => (
        <span
          key={k}
          title={`${COLOUR_NAMES[k]}: ${colours[k].join(', ')}`}
          style={{ display: 'inline-block', width: 14, height: 14, border: '1px solid var(--line)', background: `rgb(${colours[k].join(',')})` }}
        />
      ))}
    </span>
  )
}

/** The group health alert's switch and wording, on the Triggers page. */
export function GroupHealthCard() {
  const g = useSettled((s) => s.settings.groupHealth)
  const { patchSettings } = useActions()
  const set = (patch: Partial<GroupHealthSettings>, debounceMs?: number) => patchSettings((s) => ({ ...s, groupHealth: { ...s.groupHealth, ...patch } }), { debounceMs })
  const watching = g.enabled || g.myManaPct > 0
  const skins = useInvoke(watching ? 'skins:list' : null)
  const [sampling, setSampling] = useState(false)
  const sampled = g.calibrated[g.skin]
  const skinNames = [...new Set([g.skin, 'JBUI', ...(skins.data ?? []).map((s) => s.skin)])].sort((a, b) => a.localeCompare(b))
  const hasProfile = (skin: string) => skins.data?.some((s) => s.skin === skin && s.profile)

  const calibrate = async () => {
    setSampling(true)
    const r = await act('groupHealth:calibrate')
    setSampling(false)
    if (!r) return
    if (!r.rows) {
      showToast('No Group window was found on the screen. Show it with a member or two in the group, then try again.', { tone: 'bad', ms: 9000 })
      return
    }
    const skin = g.skin
    void patchSettings((s) => ({ ...s, groupHealth: { ...s.groupHealth, calibrated: { ...s.groupHealth.calibrated, [skin]: r.colours } } }))
    const missed = COLOUR_KEYS.filter((k) => !r.seen.includes(k)).map((k) => COLOUR_NAMES[k].toLowerCase())
    showToast(`Sampled ${r.rows} row${r.rows === 1 ? '' : 's'} of the Group window for ${skin}.${missed.length ? ` Not seen, kept as they were: ${missed.join(', ')}.` : ''}`)
  }
  const forget = () => {
    const skin = g.skin
    void patchSettings((s) => {
      const { [skin]: _gone, ...rest } = s.groupHealth.calibrated
      return { ...s, groupHealth: { ...s.groupHealth, calibrated: rest } }
    })
  }

  return (
    <div className="card stack gap-12 mb-16">
      <label className="row">
        <Switch on={g.enabled} onChange={(v) => void set({ enabled: v })} label="Say when a group member's health is low" />
        <b>Say when a group member&apos;s health is low</b>
        {/* Unlike the triggers below, which wait for Save (LT-592). */}
        <span className="faint small">saved as you change it</span>
      </label>
      <p className="muted small m-0">
        The log never prints anyone&apos;s health, so this watches the health bars in the Group window on the screen, while the game runs. The window has to be in view. Each member
        is said once when they fall to the line, then again only after they are back 10% over it; a member at 0 (dead, or in another zone) is never said. It reads JuiceboxUI&apos;s
        flat bars; another skin with flat bars in a 1-pixel outline can say how it draws them in its legends-tracker.json, or have its colours sampled below. The stock skin&apos;s
        textured gauges cannot be read.
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
      <label className="row">
        <Switch on={g.myManaPct > 0} onChange={(v) => void set({ myManaPct: v ? 20 : 0 })} label="Say when your own mana is low" />
        <b>Say when your own mana is low</b>
        <span className="faint small">read off the Player window&apos;s mana bar, solo or grouped; not while a cast bar covers it</span>
      </label>
      {g.myManaPct > 0 && (
        <div className="row gap-12" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Field label="At or under" hint="Percent of your mana; said again once it is 10% back over.">
            <NumberInput value={g.myManaPct} min={1} max={80} width={80} onChange={(v) => void set({ myManaPct: v ?? 20 })} label="Your mana line, percent" />
          </Field>
          <Field label="Say" hint="{pct} is filled in." style={{ flex: 1, minWidth: 260 }}>
            <div className="row tight">
              <input className="grow" value={g.myManaSpeech} onChange={(e) => void set({ myManaSpeech: e.target.value }, TYPING_MS)} />
              <button
                type="button"
                className="btn small"
                onClick={() => void act('audio:test', g.myManaSpeech.replace(/\{name\}/gi, 'You').replace(/\{pct\}/gi, String(g.myManaPct)))}
              >
                Hear
              </button>
            </div>
          </Field>
        </div>
      )}
      {watching && (
        <div className="row gap-12" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Field label="Skin" hint={hasProfile(g.skin) ? 'Read as its legends-tracker.json says.' : "Read with JuiceboxUI's colours and shapes."}>
            <select aria-label="Skin the game shows" value={g.skin} onChange={(e) => void set({ skin: e.target.value })}>
              {skinNames.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Colours" hint="Press, then show the game with the Group window and a member or two in it: sampled as soon as the game is in front.">
            <div className="row tight">
              <button type="button" className="btn small" disabled={sampling} onClick={() => void calibrate()}>
                {sampling ? 'Waiting for the game…' : 'Calibrate from the screen'}
              </button>
              {sampled && <Swatches colours={sampled} />}
              {sampled && (
                <button type="button" className="btn small" onClick={forget} title={`Read ${g.skin} with its own colours again`}>
                  Forget sampled
                </button>
              )}
            </div>
          </Field>
        </div>
      )}
    </div>
  )
}
