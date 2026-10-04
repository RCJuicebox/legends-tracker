import { Meter } from '../components/Meter'
import { Disclosure, Field, NumberInput, Switch } from '../components/ui'
import { useActions, useLive, useSettled } from '../state'
import { useRemembered } from '../remember'
import { actDone } from '../toast'
import type { Go } from '../nav'

export function DamageMeter({ go }: { go?: Go }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Damage Meter</h1>
          <p>
            Every fight the log can see, read from the last hour at start and live from then on: who dealt what, what hit your side, who healed, and what fired on its own. Fight or
            Session, for everyone, your group, or just you. When a fight ends, how much of the log is read back at start and whether a zone starts a new session are set under
            Fights and sessions, below the meter.
          </p>
        </div>
      </div>
      <Meter standalone />
      <FightSettings go={go} />
    </>
  )
}

/** What makes a fight and a session, set once: folded away under the meter until wanted. */
function FightSettings({ go }: { go?: Go }) {
  const { patchSettings } = useActions()
  const combat = useSettled((s) => s.settings.combat)
  const watching = useLive((l) => l.status.watching)
  const [open, setOpen] = useRemembered<boolean>('meter.settings', false)
  return (
    <div className="card stack gap-14 mt-16">
      <h2 className="m-0">
        <Disclosure className="head" open={open} onToggle={() => setOpen(!open)}>
          Fights and sessions
        </Disclosure>
      </h2>
      {open && (
        <>
          <div className="grid three">
            <Field label="A fight ends after" hint="Seconds without a blow between your side and an enemy. A fight also ends when the last enemy it engaged dies.">
              <NumberInput value={combat.fightGapSec} min={2} max={600} onChange={(v) => patchSettings((x) => ({ ...x, combat: { ...x.combat, fightGapSec: v ?? 10 } }))} />
            </Field>
            <Field label="Read back on start" hint="Minutes of the log read into the meter when watching starts, so the fights before the app opened are there. 0 reads nothing.">
              <NumberInput value={combat.historyMinutes} min={0} max={1440} onChange={(v) => patchSettings((x) => ({ ...x, combat: { ...x.combat, historyMinutes: v ?? 0 } }))} />
            </Field>
            <Field label="Rebuild" hint="Forgets every fight and reads that much of the log again.">
              <div>
                <button
                  className="btn"
                  onClick={() => void actDone(`Read the last ${combat.historyMinutes || 60} minutes of the log again.`, 'combat:rebuild', combat.historyMinutes || 60)}
                  disabled={!watching}
                  title={watching ? 'Forget every fight and read the log again' : 'Start watching first'}
                >
                  Read the log again
                </button>
                {!watching && <span className="faint small"> Start watching first.</span>}
              </div>
            </Field>
          </div>
          <label className="row">
            <Switch on={combat.newSessionOnZone} onChange={(v) => patchSettings((x) => ({ ...x, combat: { ...x.combat, newSessionOnZone: v } }))} />
            Entering a zone starts a new session
            <span className="faint small">the Session figures then cover one zone or instance at a time; New session on the meter splits by hand</span>
          </label>
          <p className="faint small m-0">
            Pets with their owners, charm pets and active DPS are set on the meter above; each meter overlay has its own on{' '}
            {go ? (
              <button className="link-button inline" onClick={() => go('settings', 'overlays')}>
                Settings › Overlays
              </button>
            ) : (
              'Settings › Overlays'
            )}
            .
          </p>
        </>
      )}
    </div>
  )
}
