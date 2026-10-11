import { useEffect, useMemo, useState } from 'react'
import { CharacterPicker } from '../../renderer/src/components/CharacterPicker'
import { ago, api } from '../../renderer/src/api'
import { useSettled } from '../../renderer/src/state'
import { useInvoke, useVisibleInterval } from '../../renderer/src/hooks'
import { usePickedCharacter } from '../../renderer/src/character'
import { useNow } from '../../renderer/src/components/TimerBars'
import { Disclosure, GameCommand, Info, NumberInput, Pending, Tip, ToggleChip } from '../../renderer/src/components/ui'
import { duration, num, who } from '../../core/format'
import {
  BANESTRIKE,
  DEFAULT_CHOICES,
  goalsInPlay,
  stepKills,
  planSlayer,
  type CampSource,
  type SlayerGoal,
  type SlayerPlanCamp,
  type SlayerPlanChoices,
  type SlayerStep
} from './core'

// Plan › Slayer: the Slayer achievements still open and where to kill for them quickest, step by
// step (core.ts plans it). Counts are the achievements export plus the kills the log has shown since,
// as on the Achievements page.

const SOURCE: Record<CampSource, { label: string; tip: string }> = {
  log: { label: 'your log', tip: 'The pace your own kills there kept: kills of these races an hour while you were killing in the zone' },
  play: { label: 'players', tip: 'What play has settled: the EQL Discord’s Slayer talk, or what you told the app' },
  wiki: { label: 'eqlwiki guess', tip: 'eqlwiki counts NPCs of the race in this zone; the pace is a guess from that count' }
}

const HOW = (
  <>
    <div>
      <b>Counts</b> are your achievements export (<code>/outputfile achievements</code>) plus every kill the log has shown since, placed by race as the Achievements page places
      them.
    </div>
    <div>
      <b>Pace</b> comes from your own logs first: every kill over your log and its archives (and your other characters’), and the time you spent killing in each zone. Where you
      have not hunted a race, what players have settled on stands in (the raid lockouts, the camps the EQL Discord agrees on), then eqlwiki’s count of the race’s NPCs in a zone, a
      guess.
    </div>
    <div>
      <b>The plan</b> takes the camp that does the most still-open work an hour, a kill counting once for every open achievement its race feeds, and stays until its first
      achievement is done; then again. Raid lockouts (Phinigel, Lady Vox, Lord Nagafen) are a few kills a day, so they run beside it.
    </div>
  </>
)

function useSlayerCharacter() {
  const characterKey = useSettled((s) => s.characterKey)
  const installDir = useSettled((s) => s.settings.installDir)
  const logFile = useSettled((s) => s.settings.logFile)
  const logsQ = useInvoke('logs:list', [], [installDir, logFile])
  const exportsQ = useInvoke('character:exports', [], [installDir])
  const [picked, setPicked] = usePickedCharacter()
  const available = useMemo(() => [...new Set([...(logsQ.data ?? []).map((l) => l.character), ...(exportsQ.data?.achievements ?? [])])].sort(), [logsQ.data, exportsQ.data])
  const character = picked && available.includes(picked) ? picked : characterKey || available[0] || ''
  return { available, character, setCharacter: setPicked, ready: !!logsQ.data, error: logsQ.error, reload: logsQ.reload }
}

const kills = (n: number) => num(Math.ceil(n))

/** A Banestrike tier's name: the meta whose achievements it is. */
const tierName = (tier: number) => BANESTRIKE[tier] ?? 'Not for Banestrike'

/** "Orc Stomp! 1,989 (done)" for each achievement a step moves. */
/** A few names, and the rest in a tooltip: a camp's log can hold a dozen kinds of gnoll. */
function Names({ names, shown = 3 }: { names: string[]; shown?: number }) {
  if (names.length <= shown) return <>{names.join(', ')}</>
  return (
    <>
      {names.slice(0, shown).join(', ')}, <Tip text={names.slice(shown).join(', ')}>and {names.length - shown} more</Tip>
    </>
  )
}

/**
 * What a step is there for: each achievement of its tier it moves, with how many and the mobs that
 * count toward it. What the same kills do for a later tier is in the tooltip, not the line.
 */
function StepWork({ step, goals, choices }: { step: SlayerStep; goals: SlayerGoal[]; choices: SlayerPlanChoices }) {
  const done = new Set(step.finishes)
  const killed = stepKills(step, choices)
  const besides = Object.keys(step.kills)
    .map(Number)
    .filter((g) => !step.focus.includes(g))
  return (
    <div className="small">
      {step.focus.map((g) => (
        <div key={g}>
          <b>{goals[g].name}</b> <span className="mono">+{kills(step.kills[g] ?? 0)}</span>
          {done.has(g) && <b> done</b>}
          <span className="faint">
            {' '}
            · <Names names={killed.filter((k) => k.goals.includes(g)).map((k) => `${k.name} ×${kills(k.n)}`)} />
          </span>
        </div>
      ))}
      {besides.length > 0 && (
        <Tip
          className="faint"
          text={`The same kills count toward these too: ${besides.map((g) => `${goals[g].name} +${kills(step.kills[g])}${done.has(g) ? ' (done)' : ''}`).join(', ')}`}
        >
          also counts toward {besides.length} more
        </Tip>
      )}
    </div>
  )
}

function FactionCost({ camp }: { camp: SlayerPlanCamp }) {
  const worst = (camp.factions ?? []).filter((f) => f.perHour < 0).slice(0, 3)
  if (!worst.length) return null
  return (
    <Tip
      className="small faint"
      text="What the faction lines after your kills there did, an hour at this pace. Feign death and let a pet land the kill, players say, and there is no hit."
    >
      costs {worst.map((f) => `${f.faction} ${num(Math.round(f.perHour))}`).join(', ')} an hour
    </Tip>
  )
}

export function Slayer() {
  const chars = useSlayerCharacter()
  const character = chars.character
  const q = useInvoke(character ? 'slayer:plan' : null, [character])
  useVisibleInterval(q.reload, 60_000)
  const now = useNow(30_000)
  const [choices, setChoicesState] = useState<SlayerPlanChoices>(DEFAULT_CHOICES)
  const [openGoals, setOpenGoals] = useState(false)
  const [openOut, setOpenOut] = useState(false)
  // The choices kept for the character, taken once its first answer comes: not on every reload, which would undo a change not yet saved.
  const kept = q.data?.choices
  const [keptFor, setKeptFor] = useState('')
  useEffect(() => {
    if (!kept || keptFor === character || q.data?.data.character !== character) return
    setChoicesState(kept)
    setKeptFor(character)
  }, [kept, keptFor, character, q.data])
  const setChoices = (next: SlayerPlanChoices) => {
    setChoicesState(next)
    void api.invoke('slayer:choices', character, next)
  }
  const data = q.data?.data
  const plan = useMemo(() => (data ? planSlayer(data, choices) : null), [data, choices])
  // The steps by Banestrike tier, in the plan's order: where each tier's run starts and ends, and its time.
  const tiers = useMemo(() => {
    const out: { tier: number; from: number; to: number; seconds: number }[] = []
    plan?.steps.forEach((st, i) => {
      const last = out.at(-1)
      if (last && last.tier === st.tier) {
        last.to = i + 1
        last.seconds += st.seconds + st.travel
      } else out.push({ tier: st.tier, from: i, to: i + 1, seconds: st.seconds + st.travel })
    })
    return out
  }, [plan])
  const inPlay = useMemo(() => new Set(data ? goalsInPlay(data.goals, choices) : []), [data, choices])
  const sections = useMemo(() => {
    const by = new Map<string, number[]>()
    data?.goals.forEach((g, i) => by.set(g.section, [...(by.get(g.section) ?? []), i]))
    return [...by]
  }, [data])
  const toggleGoal = (g: SlayerGoal, on: boolean) => {
    const n = g.name.toLowerCase()
    const without = (l: string[]) => l.filter((x) => x !== n)
    setChoices(
      g.optional
        ? { ...choices, included: on ? [...without(choices.included), n] : without(choices.included) }
        : { ...choices, excluded: on ? without(choices.excluded) : [...without(choices.excluded), n] }
    )
  }
  const ruleOut = (id: string, out: boolean) => setChoices({ ...choices, outCamps: out ? [...choices.outCamps, id] : choices.outCamps.filter((x) => x !== id) })
  const left = plan ? plan.goals.reduce((s, g) => s + (data!.goals[g].max - data!.goals[g].count), 0) : 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Slayer</h1>
          <div className="lead">
            {data?.export ? (
              <>
                The Slayer achievements {who(character) || 'your character'} still has to do, and where to kill for them quickest. Counts are {data.export.file} (written by the
                game {ago(data.export.modified, now)}) plus your kills since; type <GameCommand cmd="/outputfile achievements" /> in game to refresh it.
              </>
            ) : (
              <>
                Where to kill for the Slayer achievements still to do. Type <GameCommand cmd="/outputfile achievements" /> in game so the app knows which they are and how far
                along.
              </>
            )}{' '}
            <Info label="How it is planned" text={HOW} />
          </div>
        </div>
        <div className="actions">
          <CharacterPicker character={character} available={chars.available} onPick={chars.setCharacter} />
        </div>
      </div>

      {!chars.ready ? (
        <Pending error={chars.error} retry={chars.reload} what="your characters" />
      ) : !character ? (
        <div className="card empty">No character yet. Choose the game folder on the Settings page, then play with logging on (/log on).</div>
      ) : !q.data ? (
        <Pending error={q.error} retry={q.reload} doing="Reading every kill in your logs" />
      ) : !data?.export ? (
        <div className="card empty">
          No achievements export for {who(character)} yet. Type <GameCommand cmd="/outputfile achievements" /> in game.
        </div>
      ) : (
        plan && (
          <>
            <div className="card row mb-16">
              <span>
                <b>{plan.goals.length}</b> achievement{plan.goals.length === 1 ? '' : 's'} to go, <b>{num(left)}</b> kills
              </span>
              <span className="faint">·</span>
              <span>
                about <b>{duration(plan.seconds)}</b> of hunting
              </span>
              {plan.daily.length > 0 && (
                <>
                  <span className="faint">·</span>
                  <span>
                    and {plan.daily.length} raid lockout{plan.daily.length === 1 ? '' : 's'} a day, for up to {Math.max(...plan.daily.map((d) => d.days))} days
                  </span>
                </>
              )}
              <span className="spacer" />
              {data.pending > 0 && <span className="faint small">Looking up {num(data.pending)} mobs’ races on eqlwiki…</span>}
            </div>

            {plan.daily.length > 0 && (
              <div className="card mb-16">
                <h2>
                  Every day <Info label="About raid lockouts" text="One kill a difficulty (0 to 4) a day: start these on day one, beside the plan, or they hold the rest up." />
                </h2>
                <ul className="fp-steps">
                  {plan.daily.map((d) => (
                    <li key={d.camp.id} className="fp-step">
                      <Tip className="fp-num" text="A raid lockout: every day">
                        ↻
                      </Tip>
                      <div className="fp-body">
                        <div className="fp-head">
                          <span className="fp-zone">{d.camp.zone}</span>
                          <span className="small">{d.camp.kinds.map((k) => k.name).join(', ')}</span>
                          <span className="spacer" />
                          <span className="mono fp-time">
                            {Math.max(...d.goals.map((g) => d.camp.pace[g] ?? 0))} a day · {d.days} days
                          </span>
                        </div>
                        <div className="small">
                          {d.goals.map((g) => (
                            <span key={g}>
                              {data.goals[g].name}{' '}
                              <span className="mono">
                                {num(data.goals[g].count)}/{num(data.goals[g].max)}
                              </span>{' '}
                              <span className="faint">({tierName(data.goals[g].tier)})</span>
                            </span>
                          ))}
                        </div>
                        {d.camp.note && (
                          <div className="faint small">
                            {d.camp.note} ({d.camp.said})
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.steps.length > 0 ? (
              <div className="card mb-16">
                <h2>
                  The plan, step by step
                  <span className="spacer" />
                  <span className="faint small mono">≈ {duration(plan.seconds)}</span>
                </h2>
                {tiers.map(({ tier, from, to, seconds }) => (
                  <div key={tier} className="mb-8">
                    <h3 className="row tight">
                      {tierName(tier)}
                      {tier < BANESTRIKE.length - 1 && <span className="faint small">Banestrike rank {tier + 2}</span>}
                      <span className="spacer" />
                      <span className="faint small mono">≈ {duration(seconds)}</span>
                    </h3>
                    <ol className="fp-steps" start={from + 1}>
                      {plan.steps.slice(from, to).map((st, j) => {
                        const i = from + j
                        return (
                          <li key={st.camp.id + i} className="fp-step">
                            <span className="fp-num">{i + 1}</span>
                            <div className="fp-body">
                              <div className="fp-head">
                                <span className="fp-zone">{st.camp.zone}</span>
                                <Tip className={`chip fp-kind ${st.camp.source === 'log' ? 'kill' : 'quest'}`} text={SOURCE[st.camp.source].tip}>
                                  {SOURCE[st.camp.source].label}
                                </Tip>
                                <span className="spacer" />
                                <Tip
                                  className="mono"
                                  text={`What you kill there: ${stepKills(st, choices)
                                    .map((k) => `${k.name} ×${kills(k.n)}`)
                                    .join(', ')}`}
                                >
                                  ×{kills(stepKills(st, choices).reduce((t, k) => t + k.n, 0))}
                                </Tip>
                                <Tip className="mono fp-time" text={st.travel ? `Including ${duration(st.travel)} to get there` : 'Time killing there'}>
                                  {duration(st.seconds + st.travel)}
                                </Tip>
                              </div>
                              <StepWork step={st} goals={data.goals} choices={choices} />
                              <div className="row tight fp-effects">
                                <FactionCost camp={st.camp} />
                                {st.camp.note && <span className="faint small">{st.camp.note}</span>}
                                <span className="spacer" />
                                <span className="faint small">
                                  {st.camp.source === 'log' && st.camp.hours
                                    ? `${num(st.camp.kills ?? 0)} kills in ${duration(st.camp.hours * 3600)} there`
                                    : st.camp.said && `said by ${st.camp.said}`}
                                </span>
                                <button className="btn small ghost" onClick={() => ruleOut(st.camp.id, true)} title="Leave this camp out of the plan">
                                  Rule out
                                </button>
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                ))}
              </div>
            ) : (
              <div className="card empty mb-16">
                {plan.goals.length ? 'Nothing the planner knows feeds the achievements left.' : 'Every Slayer achievement in the plan is done.'}
              </div>
            )}

            {plan.unplanned.length > 0 && (
              <div className="card mb-16">
                <h2>Not planned</h2>
                <div className="faint small mb-8">
                  Neither your logs, nor what players have settled, nor eqlwiki knows where these races die. Kill some anywhere and the plan learns the pace.
                </div>
                {plan.unplanned.map((g) => (
                  <div key={g} className="small">
                    {data.goals[g].name} <span className="faint">({data.goals[g].races})</span>{' '}
                    <span className="mono">
                      {num(data.goals[g].count)}/{num(data.goals[g].max)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="card mb-16">
              <Disclosure open={openGoals} onToggle={() => setOpenGoals(!openGoals)} label="Achievements in the plan">
                <h2>
                  Achievements in the plan <span className="faint small">{plan.goals.length}</span>
                </h2>
              </Disclosure>
              {openGoals && (
                <>
                  <div className="faint small mb-8">
                    Off: left out of the plan. The optional ones are out of era (Banestrike does not need them), and off unless you turn them on.
                  </div>
                  {sections.map(([sec, list]) => (
                    <div key={sec} className="mb-8">
                      <div className="small">
                        <b>{sec}</b>
                      </div>
                      <div className="row tight wrap">
                        {list
                          .filter((g) => data.goals[g].count < data.goals[g].max)
                          .map((g) => (
                            <ToggleChip
                              key={g}
                              on={inPlay.has(g)}
                              onChange={(on) => toggleGoal(data.goals[g], on)}
                              title={`${data.goals[g].races} ${num(data.goals[g].count)}/${num(data.goals[g].max)}`}
                            >
                              {data.goals[g].name}
                              {data.goals[g].optional ? ' (optional)' : ''}
                            </ToggleChip>
                          ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {choices.outCamps.length > 0 && (
              <div className="card mb-16">
                <Disclosure open={openOut} onToggle={() => setOpenOut(!openOut)} label="Ruled out">
                  <h2>
                    Ruled out <span className="faint small">{choices.outCamps.length}</span>
                  </h2>
                </Disclosure>
                {openOut &&
                  choices.outCamps.map((id) => (
                    <div key={id} className="row tight small">
                      <span>{data.camps.find((c) => c.id === id)?.zone ?? id.replace(/^\w+:/, '')}</span>
                      <button className="btn small ghost" onClick={() => ruleOut(id, false)}>
                        Bring back
                      </button>
                    </div>
                  ))}
              </div>
            )}

            <div className="card row mb-16">
              <label className="row tight small">
                Minutes between camps
                <NumberInput value={choices.travelMin} min={0} max={120} width={64} onChange={(v) => setChoices({ ...choices, travelMin: v ?? DEFAULT_CHOICES.travelMin })} />
              </label>
              <label className="row tight small">
                <Tip text="For a camp players name without a number: kills an hour while there">Kills an hour where players give no number</Tip>
                <NumberInput value={choices.pace} min={1} max={2000} width={72} onChange={(v) => setChoices({ ...choices, pace: v ?? DEFAULT_CHOICES.pace })} />
              </label>
              <span className="spacer" />
              <button className="btn small ghost" onClick={() => q.reload()}>
                Read again
              </button>
            </div>

            {data.unplaced.length > 0 && (
              <div className="card mb-16 small">
                <b>Kills no race was found for</b> <span className="faint">(eqlwiki has no race for them and the name gives none, so they count toward nothing here):</span>{' '}
                {data.unplaced.map((u) => `${u.name} ×${num(u.n)}`).join(', ')}
              </div>
            )}
          </>
        )
      )}
    </>
  )
}
