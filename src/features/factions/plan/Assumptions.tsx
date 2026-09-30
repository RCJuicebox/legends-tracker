import { NumberInput, Switch } from '../../../renderer/src/components/ui'
import type { PlanSettings } from '../../../shared/settings'
import { DEFAULT_SETTINGS } from '../ways'
import { TYPING_SAVE_MS } from './parts'

/** The settings that are numbers, typed into the Assumptions. */
type NumberSetting = { [K in keyof PlanSettings]: PlanSettings[K] extends number ? K : never }[keyof PlanSettings]

/** The Assumptions under the plan's figures: the times and paces it counts with, the player's own in place of the defaults. */
export function Assumptions({
  settings,
  stored,
  logPace,
  onChange
}: {
  settings: PlanSettings
  stored: Partial<PlanSettings>
  logPace: number | null
  onChange: (s: Partial<PlanSettings>, debounceMs?: number) => void
}) {
  const set = (k: NumberSetting) => (v: number | undefined) => {
    const next = { ...stored }
    if (v === undefined || !(v >= 0)) delete next[k]
    else next[k] = v
    onChange(next, TYPING_SAVE_MS)
  }
  // The goal and race unlocks first are set at the top of the tab, not here.
  const top = new Set<keyof PlanSettings>(['goal', 'unlocksFirst'])
  const kept = (s: Partial<PlanSettings>): Partial<PlanSettings> => Object.fromEntries(Object.entries(s).filter(([k]) => top.has(k as keyof PlanSettings)))
  const changed = Object.keys(stored).some((k) => !top.has(k as keyof PlanSettings))
  return (
    <details className="fp-assume">
      <summary>Assumptions</summary>
      <div className="fp-assume-grid">
        <label>
          <span>Getting to a new zone (min)</span>
          <NumberInput value={stored.travelMin} placeholder={String(DEFAULT_SETTINGS.travelMin)} min={0} max={120} width={80} onChange={set('travelMin')} />
        </label>
        <label>
          <span>Kills an hour, common mobs</span>
          <NumberInput value={stored.killsPerHour} placeholder={String(logPace ?? DEFAULT_SETTINGS.killsPerHour)} min={1} max={1000} width={80} onChange={set('killsPerHour')} />
          <span className="faint small">{logPace ? `${logPace} is your log's pace` : 'your log has too few kills to say'}</span>
        </label>
        <label>
          <span>A named mob comes back every (min)</span>
          <NumberInput value={stored.namedRespawnMin} placeholder={String(DEFAULT_SETTINGS.namedRespawnMin)} min={1} max={600} width={80} onChange={set('namedRespawnMin')} />
        </label>
        <label>
          <span>A hand-in (s)</span>
          <NumberInput value={stored.handInSec} placeholder={String(DEFAULT_SETTINGS.handInSec)} min={0} max={600} width={80} onChange={set('handInSec')} />
          <span className="faint small">where your log has not timed one</span>
        </label>
        <label>
          <span>Gathering one item (s)</span>
          <NumberInput value={stored.gatherSec} placeholder={String(DEFAULT_SETTINGS.gatherSec)} min={0} max={3600} width={80} onChange={set('gatherSec')} />
          <span className="faint small">a drop from common mobs, foraged or crafted</span>
        </label>
        <label>
          <span>A hand-in no one says the items of (s)</span>
          <NumberInput value={stored.unknownSec} placeholder={String(DEFAULT_SETTINGS.unknownSec)} min={0} max={3600} width={80} onChange={set('unknownSec')} />
        </label>
        <label>
          <span>Swap race or class for a quest</span>
          <Switch
            on={settings.raceSwaps}
            label="Plan Loadout swaps"
            onChange={(on) => {
              const next = { ...stored }
              if (on === DEFAULT_SETTINGS.raceSwaps) delete next.raceSwaps
              else next.raceSwaps = on
              onChange(next)
            }}
          />
          <span className="faint small">in Loadouts, for a quest your race's con keeps closed and another race's opens</span>
        </label>
        <label>
          <span>A swap, there and back (min)</span>
          <NumberInput value={stored.swapMin} placeholder={String(DEFAULT_SETTINGS.swapMin)} min={0} max={120} width={80} onChange={set('swapMin')} />
        </label>
        <label>
          <span>A faction kept at 0 or above is worth (h)</span>
          <NumberInput value={stored.positiveHours} placeholder={String(settings.positiveHours)} min={0} max={100} step={0.5} width={80} onChange={set('positiveHours')} />
          <span className="faint small">Most factions positive: the most extra time it spends on one</span>
        </label>
      </div>
      {changed && (
        <button className="btn small ghost mt-10" onClick={() => onChange(kept(stored))}>
          Back to the defaults
        </button>
      )}
    </details>
  )
}
