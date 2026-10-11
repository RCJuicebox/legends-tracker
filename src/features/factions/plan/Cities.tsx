import { Fragment } from 'react'
import { Disclosure, Tip } from '../../../renderer/src/components/ui'
import type { PlanChoices } from '../../../shared/settings'
import { STANDING_MAX, standingBand } from '../core'
import type { CityGuards } from '../cities'
import type { FactionPlan, Unplanned } from '../planTypes'
import { Options } from './Options'
import { Doing, plain, withArticle } from './parts'

/**
 * The Cities plan's table: each starting city, the faction its guards fight for, how they con the
 * character now and how far that is from Indifferent, and the step that gets them there. Open one for
 * every way to raise its guards' faction, to lock one in or rule one out, as for an achievement.
 */
export function Cities({
  rows,
  plan,
  race,
  choices,
  swaps,
  why,
  open,
  onOpen,
  onLock,
  onExclude,
  onPace
}: {
  rows: CityGuards[]
  plan: FactionPlan | null
  /** The character's race, as the cons count it; '' when none is on record, and then how the guards con it is unknown. */
  race: string
  choices: PlanChoices
  swaps: boolean
  /** Why the plan leaves a faction undone, said in full. */
  why: Record<Unplanned, string>
  open: string | null
  onOpen: (key: string | null) => void
  onLock: (factions: string[], id: string | null) => void
  onExclude: (id: string, out: boolean) => void
  onPace: (id: string, perHour: number | undefined) => void
}) {
  // The step that first gets each faction there.
  const stepOf = new Map<string, number>()
  plan?.steps.forEach((st, i) => st.finishes.forEach((f) => !stepOf.has(f) && stepOf.set(f, i + 1)))
  const order = (r: CityGuards) => (r.to > STANDING_MAX ? 1000 : r.standing >= r.to ? 2000 : (stepOf.get(r.faction) ?? 999))
  const who = race ? withArticle(race) : 'your race'
  return (
    <div className="card mb-16" style={{ padding: 0 }}>
      <h2 style={{ padding: '14px 16px 0' }}>Cities</h2>
      <p className="faint small" style={{ padding: '0 16px' }}>
        Each starting city&apos;s guards con you on their faction&apos;s standing with your race&apos;s and your best class&apos;s modifiers added, as an Agnostic: at Indifferent
        or better, you walk in. Open one for every way to raise its guards&apos; faction; lock one in and the plan raises it with that, rule one out and the plan leaves it alone.
      </p>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>City</th>
              <th>Guards</th>
              <th className="num">Con now</th>
              <th className="num">To go</th>
              <th>In the plan</th>
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) => order(a) - order(b) || a.city.localeCompare(b.city))
              .map((r) => {
                const key = `city:${r.city}`
                const isOpen = open === key
                const toggle = () => onOpen(isOpen ? null : key)
                const con = Math.round(r.standing + r.mod)
                const band = standingBand(con)
                const fine = r.standing >= r.to
                const unreachable = r.to > STANDING_MAX
                const step = stepOf.get(r.faction)
                const unplanned = plan?.unplannedWhy[r.faction]
                return (
                  <Fragment key={r.city}>
                    <tr className={`clickable${isOpen ? ' selected' : ''}`} onClick={toggle}>
                      <td>
                        <Disclosure open={isOpen} onToggle={toggle} stop>
                          {r.city}
                        </Disclosure>
                      </td>
                      <td>{r.faction}</td>
                      <td className="num">
                        {race ? (
                          <Tip
                            className={`mono ${band.tone === 'bad' ? 'bad-text' : band.tone === 'warn' ? 'warn-text' : ''}`.trim()}
                            text={`Standing ${plain(Math.round(r.standing))}, ${r.mod >= 0 ? '+' : '−'}${Math.abs(r.mod)} for ${who} with your best class`}
                          >
                            {band.word} ({plain(con)})
                          </Tip>
                        ) : (
                          <Tip className="mono faint" text={`Standing ${plain(Math.round(r.standing))}; with no race on record, what race and class add is unknown`}>
                            unknown
                          </Tip>
                        )}
                      </td>
                      <td className="num mono">{fine || unreachable ? '—' : Math.ceil(r.to - r.standing).toLocaleString()}</td>
                      <td>
                        {unreachable ? (
                          <Tip className="chip bad" text={`Even at 2000, ${who} cons ${standingBand(STANDING_MAX + r.mod).word} here: swap race in Loadouts to walk in`}>
                            out of reach
                          </Tip>
                        ) : fine && !unplanned ? (
                          race ? (
                            <Tip className="chip ok" text="Its guards con you Indifferent or better now, and the plan keeps them there">
                              welcome
                            </Tip>
                          ) : (
                            <Tip className="chip" text="At 0 or above, and the plan keeps it there; how its guards con you depends on your race, which is not on record">
                              at 0 or above
                            </Tip>
                          )
                        ) : step ? (
                          <span>
                            <span className="fp-num-inline">{step}</span> <Doing a={plan!.steps[step - 1].activity} />
                          </span>
                        ) : (
                          <Tip className="chip warn" text={`${why[unplanned ?? 'nothing known']}: open it for what there is`}>
                            not planned{unplanned ? ` · ${unplanned}` : ''}
                          </Tip>
                        )}
                      </td>
                    </tr>
                    {isOpen && plan && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--bg-2)' }}>
                          {fine || unreachable ? (
                            <div className="faint small" style={{ padding: '6px 4px' }}>
                              {unreachable
                                ? `No standing makes ${r.city}'s guards con you Indifferent as you are: their faction's modifiers for your race and classes are ${plain(r.mod)}.`
                                : race
                                  ? `${r.city}'s guards con you ${band.word} already: the plan only keeps them there.`
                                  : `Its guards' faction is at 0 or above already: the plan only keeps it there.`}
                            </div>
                          ) : (
                            <Options
                              faction={r.faction}
                              options={plan.options[r.faction] ?? []}
                              choices={choices}
                              swaps={swaps}
                              onLock={onLock}
                              onExclude={onExclude}
                              onPace={onPace}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
