import { useEffect, useMemo, useState } from 'react'
import { CharacterPicker } from '../../renderer/src/components/CharacterPicker'
import { ago, api } from '../../renderer/src/api'
import { useLive, useSettled } from '../../renderer/src/state'
import { useInvoke, useVisibleInterval } from '../../renderer/src/hooks'
import { usePickedCharacter } from '../../renderer/src/character'
import { useNow } from '../../renderer/src/components/TimerBars'
import { Disclosure, GameCommand, Info, NumberInput, Pending, Tip, ToggleChip } from '../../renderer/src/components/ui'
import { duration, num, who } from '../../core/format'
import {
  BANESTRIKE,
  campZone,
  clock,
  costsPlan,
  DEFAULT_CHOICES,
  goalsInPlay,
  guideTip,
  spotFor,
  spotTip,
  stepKills,
  planSlayer,
  type CampSource,
  type SlayerGoal,
  type SlayerPlanCamp,
  type SlayerPlanChoices,
  type SlayerStep
} from './core'
import { zoneKey } from '../../core/zones'
import { takeRequestedSlayerStep } from './jump'
import { SpawnMap } from './SpawnMap'
import type { MobSpawn } from './spawns'
import type { HunterZone } from '../hunter/core'

// Plan › Slayer: the Slayer achievements still open and where to kill for them quickest, step by
// step (core.ts plans it). Counts are the achievements export plus the kills the log has shown since,
// as on the Achievements page.

const SOURCE: Record<CampSource, { label: string; tip: string }> = {
  log: { label: 'your log', tip: 'The pace your own kills there kept: kills of these races an hour while you were killing in the zone' },
  play: { label: 'players', tip: 'What play has settled: the EQL Discord’s Slayer talk, or what you told the app' },
  spawns: {
    label: 'spawn table',
    tip: 'TAKP’s classic spawn table for the zone: its spots, on the respawn your log has timed there (else classic’s timers), at no more than your usual kills an hour'
  },
  wiki: { label: 'eqlwiki guess', tip: 'eqlwiki counts NPCs of the race in this zone; the pace is a guess from that count' }
}

const HOW = (
  <>
    <div>
      <b>Counts</b> are your achievements export (<code>/outputfile achievements</code>) plus every kill the log has shown since, placed by race as the Achievements page places
      them.
    </div>
    <div>
      <b>Pace</b> comes from your own logs first: every kill over your log and its archives (and your other characters’), and the time you spent killing in each zone, split by what
      you were killing: a stretch where a race was a quarter or more of what died is that race’s camp, its kills over its own time (an hour of granitebacks once says nothing of how
      quickly kejekan die now). Where you have not hunted a race, what players have settled on stands in (the raid lockouts, the camps the EQL Discord agrees on), then TAKP’s
      classic spawn tables: how many spots a zone has for the race and how quickly they pop, at no more than your usual kills an hour. The zones eqlwiki’s Slayer guide names for an
      achievement are camps of their own, paced the same way, with the guide’s words beside each step (“guide”). Legends’ respawns are its own: a zone’s spawns come back on one
      timer, quicker than classic’s, so a zone runs on the respawn your Respawns page has timed there (a spawn of one spot); a zone you have timed nothing in keeps the classic
      timers. Zones TAKP lacks fall back on eqlwiki’s count of a race’s NPCs, a guess.
    </div>
    <div>
      <b>Travel</b> is the way your log has seen you go between two zones: from a camp’s last kill to the next zone, then across each zone between, gates and ports included. Where
      your log knows no way, your minutes between camps stand in.
    </div>
    <div>
      <b>The plan</b> works through Banestrike’s tiers in turn (Progressive, Highly Decorated, A Force of Nature, then what Megadeath names besides), each done before the next is
      begun; within a tier, the achievement that can be finished soonest, travel counted, first, then the others whose best zone is the same while you are there. Each step is one
      achievement and kills only its own mobs (a zone’s races are seldom near each other); steps in the same zone sit under one heading. A kill still counts toward every open
      achievement its race feeds, a later tier’s too. Raid lockouts (Phinigel, Lady Vox, Lord Nagafen, Innoruuk, Cazic-Thule) are a few kills a day, so they run beside it. Rule out
      a camp, or a mob with the ✕ beside its name (one that takes a faction to spawn, say), and the plan finds the kills elsewhere.
    </div>
  </>
)

/** The character a Plan page is for: picked, or the one being played; any with a log or an achievements export. */
export function usePlanCharacter() {
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

/**
 * Each step's "+N" toward each achievement, so a goal's steps add up to what it needs: the running
 * total rounded up, each step the difference (LT-535), not every step rounded up on its own.
 */
function stepPluses(steps: SlayerStep[]): Record<number, number>[] {
  const ran: Record<number, number> = {}
  return steps.map((st) => {
    const out: Record<number, number> = {}
    for (const [k, n] of Object.entries(st.kills)) {
      const g = Number(k)
      const before = ran[g] ?? 0
      ran[g] = before + n
      out[g] = Math.ceil(ran[g] - 1e-9) - Math.ceil(before - 1e-9)
    }
    return out
  })
}

const TIMED: Record<MobSpawn['timerFrom'], string> = { timed: 'timed by your log', zone: 'the zone’s respawn as you timed it', classic: 'classic' }

/** What a mob's spawns allow, short: "12 spots · 6:00", and the rest in the tooltip. */
function SpawnHint({ spawn, bound }: { spawn: MobSpawn; bound?: boolean }) {
  const spots = spawn.spots === 1 ? '1 spot' : `${num(Math.round(spawn.spots))} spots`
  return (
    <Tip
      className="mono sl-spawn"
      text={`${spawn.name}, level ${spawn.lo === spawn.hi ? spawn.lo : `${spawn.lo}–${spawn.hi}`}: ${spots}, about ${num(Math.round(spawn.up * 10) / 10)} up at once, respawn ${clock(spawn.timer)} (${TIMED[spawn.timerFrom]}). At most ${num(Math.round(spawn.ceiling))} an hour.${bound ? ' Your pace there is up against that: the spawns are the limit.' : ''}`}
    >
      {' '}
      ({spots} · {clock(spawn.timer)}
      {bound ? ' · spawn-bound' : ''})
    </Tip>
  )
}

/** The plan's steps from..to, in runs of the same zone, by index: one zone heading for the steps done there together. */
function zoneRuns(steps: SlayerStep[], from: number, to: number): number[][] {
  const out: number[][] = []
  for (let i = from; i < to; i++) {
    const last = out.at(-1)
    if (last && zoneKey(steps[last[0]].camp.zone) === zoneKey(steps[i].camp.zone)) last.push(i)
    else out.push([i])
  }
  return out
}

/** A Banestrike tier's name: the meta whose achievements it is. */
const tierName = (tier: number) => BANESTRIKE[tier] ?? 'Not for Banestrike'

/** "Orc Stomp! 1,989 (done)" for each achievement a step moves. */
/** A few names, and the rest in a tooltip: a camp's log can hold a dozen kinds of gnoll. */
function Names({ names, shown = 3, onOut }: { names: { name: string; n: number; spawn?: MobSpawn; bound?: boolean }[]; shown?: number; onOut: (mob: string) => void }) {
  const one = (k: { name: string; n: number; spawn?: MobSpawn; bound?: boolean }, i: number) => (
    <span key={k.name}>
      {i > 0 && ', '}
      {k.name} ×{kills(k.n)}
      {k.spawn && <SpawnHint spawn={k.spawn} bound={k.bound} />}
      <button className="btn small ghost sl-out" onClick={() => onOut(k.name)} title={`Rule out ${k.name}: the plan finds the kills elsewhere`} aria-label={`Rule out ${k.name}`}>
        ✕
      </button>
    </span>
  )
  if (names.length <= shown) return <>{names.map(one)}</>
  const rest = names.slice(shown)
  return (
    <>
      {names.slice(0, shown).map(one)}, <Tip text={rest.map((k) => `${k.name} ×${kills(k.n)}`).join(', ')}>and {rest.length} more</Tip>
    </>
  )
}

/**
 * What a step is there for: each achievement of its tier it moves, with how many and the mobs that
 * count toward it. What the same kills do for a later tier is in the tooltip, not the line.
 */
function StepWork({
  step,
  plus,
  since,
  goals,
  choices,
  onOut
}: {
  step: SlayerStep
  /** The step's "+N" toward each goal (stepPluses). */
  plus: Record<number, number>
  /** Whether the counts have the kills since the export. */
  since: boolean
  goals: SlayerGoal[]
  choices: SlayerPlanChoices
  onOut: (mob: string) => void
}) {
  const done = new Set(step.finishes)
  const killed = stepKills(step, choices)
  const besides = Object.keys(step.kills)
    .map(Number)
    .filter((g) => !step.focus.includes(g))
  return (
    <div className="small">
      {step.focus.map((g) => {
        const tip = guideTip(goals[g].name)
        const { count, max } = goals[g]
        return (
          <div key={g}>
            <b>{goals[g].name}</b>{' '}
            <Tip className="mono" text={`${num(count)} of ${num(max)} so far: your achievements export${since ? ' plus the kills since' : ''}`}>
              {num(count)} / {num(max)}
            </Tip>
            <span className="sl-count-bar" aria-hidden="true">
              <i style={{ width: `${Math.round((Math.min(count, max) / Math.max(1, max)) * 100)}%` }} />
            </span>
            <Tip className="mono" text="What this step adds">
              +{num(plus[g] ?? 0)}
            </Tip>
            {done.has(g) && <b> done</b>}
            <span className="faint">
              {' '}
              · <Names names={killed.filter((k) => k.goals.includes(g))} onOut={onOut} />
            </span>
            {tip && (
              <Tip className="faint sl-guide" text={`eqlwiki’s Slayer guide: ${tip}`}>
                {' '}
                · guide
              </Tip>
            )}
          </div>
        )
      })}
      {besides.length > 0 && (
        <Tip
          className="faint"
          text={`The same kills count toward these too: ${besides.map((g) => `${goals[g].name} +${num(plus[g] ?? 0)}${done.has(g) ? ' (done)' : ''}`).join(', ')}`}
        >
          also counts toward {besides.length} more
        </Tip>
      )}
    </div>
  )
}

/** What holds a spawn-paced camp back: its spawns, or the player's own pace where they allow more. */
function Limit({ camp }: { camp: SlayerPlanCamp }) {
  if (!camp.limit || camp.ceiling === undefined) return null
  return camp.limit === 'you' ? (
    <Tip className="small faint" text="The spawns there allow more than your usual kills an hour, so the plan counts your usual pace: kill quicker and it goes quicker.">
      your pace is the limit (spawns allow {num(Math.round(camp.ceiling))}/h)
    </Tip>
  ) : (
    <Tip className="small faint" text="Killing each mob as it pops, this is all the spawns there give: bring something else to kill between pops.">
      the spawns are the limit ({num(Math.round(camp.ceiling * 10) / 10)}/h)
    </Tip>
  )
}

/** The Hunter named still to kill in a step's zone: one trip does both. */
function HunterHere({ hunter }: { hunter: HunterZone[] }) {
  if (!hunter.length) return null
  return (
    <div className="small">
      {hunter.map((h) => (
        <div key={h.achievement}>
          <span className="chip fp-kind quest">Hunter</span> <b>{h.achievement}</b>
          <span className="faint">
            {' '}
            ·{' '}
            {h.left.map((n, i) => (
              <span key={n.name}>
                {i > 0 && ', '}
                {n.spawn ? (
                  <Tip
                    text={`Classic (TAKP): ${n.spawn.spots === 1 ? 'one spot' : `${num(n.spawn.spots)} spots`}, up ${num(Math.round(n.spawn.up * 100))}% of the time, respawn ${clock(n.spawn.timer)} (${TIMED[n.spawn.timerFrom]})`}
                  >
                    {n.name}
                  </Tip>
                ) : (
                  n.name
                )}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

function FactionCost({ camp, raising }: { camp: SlayerPlanCamp; raising: readonly string[] }) {
  const worst = (camp.factions ?? []).filter((f) => f.perHour < 0).slice(0, 3)
  if (!worst.length) return null
  const up = new Set(costsPlan(camp, raising))
  return (
    <Tip
      className="small faint"
      text={`What the faction lines after your kills there did, an hour at this pace. Feign death and let a pet land the kill, players say, and there is no hit.${
        up.size ? ` Your faction plan (Factions › Plan) is raising ${[...up].join(' and ')}: turn on "Avoid my faction plan’s factions" to leave such camps out.` : ''
      }`}
    >
      costs{' '}
      {worst.map((f, i) => (
        <span key={f.faction} className={up.has(f.faction) ? 'bad-text' : undefined}>
          {i > 0 && ', '}
          {f.faction} {num(Math.round(f.perHour))}
        </span>
      ))}{' '}
      an hour
    </Tip>
  )
}

export function Slayer() {
  const chars = usePlanCharacter()
  const character = chars.character
  const q = useInvoke(character ? 'slayer:plan' : null, [character])
  useVisibleInterval(q.reload, 60_000)
  const now = useNow(30_000)
  const [choices, setChoicesState] = useState<SlayerPlanChoices>(DEFAULT_CHOICES)
  const [openGoals, setOpenGoals] = useState(false)
  const [openOut, setOpenOut] = useState(false)
  const [openTimes, setOpenTimes] = useState(false)
  const [reading, setReading] = useState(false)
  // Built afresh, not the build the last 30 s share (LT-537): a kill just made or a new export shows.
  const readAgain = () => {
    setReading(true)
    void api
      .invoke('slayer:plan', character, true)
      .then(
        () => q.reload(),
        () => q.reload()
      )
      .finally(() => setReading(false))
  }
  /** The steps whose map is shown, by index. */
  const [maps, setMaps] = useState<Set<number>>(new Set())
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
  const pluses = useMemo(() => stepPluses(plan?.steps ?? []), [plan])
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
  const ruleOutMob = (mob: string, out: boolean) => {
    const m = mob.toLowerCase()
    setChoices({ ...choices, outMobs: out ? [...choices.outMobs.filter((x) => x !== m), m] : choices.outMobs.filter((x) => x !== m) })
  }
  // The headline's kills are the steps' own (a kill feeding two achievements once), the lockouts' beside them;
  // what the plan leaves out is said apart (LT-563).
  const stepTotal = plan ? plan.steps.reduce((s, st) => s + stepKills(st, choices).reduce((t, k) => t + k.n, 0), 0) : 0
  const lockoutKills = plan ? [...new Set(plan.daily.flatMap((d) => d.goals))].reduce((s, g) => s + (data!.goals[g].max - data!.goals[g].count), 0) : 0
  const unplannedKills = plan ? plan.unplanned.reduce((s, g) => s + (data!.goals[g].max - data!.goals[g].count), 0) : 0
  const optionalOut = data ? data.goals.filter((g) => g.optional && g.count < g.max && !choices.included.includes(g.name.toLowerCase())).length : 0
  const hunterAt = (zone: string) => (data?.hunter ?? []).filter((h) => zoneKey(h.zone) === zoneKey(zone))
  // Where the player is: the steps in that zone are marked, and the first is a click away.
  const zoneNow = useLive((l) => l.status.zone)
  const hereKey = zoneNow ? zoneKey(campZone(zoneNow)) : ''
  const isHere = (zone: string) => !!hereKey && zoneKey(zone) === hereKey
  const hereStep = plan?.steps.findIndex((st) => isHere(st.camp.zone)) ?? -1
  const hereDaily = plan?.daily.some((d) => isHere(d.camp.zone)) ?? false
  const jumpTo = (index: number) => document.getElementById(`sl-step-${index + 1}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  const jumpHere = () => jumpTo(hereStep)
  // Sent here from another page for a step (the Achievements page's "Step 4 · Lake Rathetear"): shown once the plan is drawn.
  useEffect(() => {
    if (!plan) return
    const wanted = takeRequestedSlayerStep()
    if (wanted !== null) jumpTo(wanted)
  }, [plan])
  const raising = useMemo(() => data?.raising ?? [], [data])
  // Camps the choice rules out for costing a faction the faction plan raises, with the factions.
  const autoOut = useMemo(
    () => (choices.avoidPlanFactions && data ? data.camps.flatMap((c) => ((f) => (f.length ? [{ camp: c, factions: f }] : []))(costsPlan(c, raising))) : []),
    [choices.avoidPlanFactions, data, raising]
  )
  const toggleMap = (i: number) => setMaps((m) => (m.has(i) ? new Set([...m].filter((x) => x !== i)) : new Set([...m, i])))
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Slayer</h1>
          <div className="lead">
            {data?.export ? (
              <>
                The Slayer achievements {who(character) || 'your character'} still has to do, and where to kill for them quickest. Counts are {data.export.file} (written by the
                game {ago(data.export.modified, now)})
                {data.sinceKills ? ' plus your kills since' : `, without the kills since: those count while you play ${who(character) || 'the character'}`}; type{' '}
                <GameCommand cmd="/outputfile achievements" /> in game to refresh it.
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
                <b>{plan.goals.length}</b> achievement{plan.goals.length === 1 ? '' : 's'} to go, <b>{kills(stepTotal)}</b> kills in the steps
                {lockoutKills > 0 && `, ${num(lockoutKills)} by the lockouts`}
              </span>
              <span className="faint">·</span>
              <span>
                about <b>{duration(plan.seconds)}</b> of hunting
              </span>
              {(unplannedKills > 0 || optionalOut > 0) && (
                <Tip
                  className="faint small"
                  text={`${unplannedKills > 0 ? `${num(unplannedKills)} kills for achievements nothing known feeds (Not planned, below). ` : ''}${
                    optionalOut > 0 ? `${optionalOut} optional achievement${optionalOut === 1 ? '' : 's'} (out of era) left out: take them in under Achievements in the plan.` : ''
                  }`}
                >
                  {[unplannedKills > 0 ? `${num(unplannedKills)} not planned` : '', optionalOut > 0 ? `${optionalOut} optional left out` : ''].filter(Boolean).join(' · ')}
                </Tip>
              )}
              {plan.daily.length > 0 && (
                <>
                  <span className="faint">·</span>
                  <span>
                    and {plan.daily.length} raid lockout{plan.daily.length === 1 ? '' : 's'} a day, for up to {Math.max(...plan.daily.map((d) => d.days))} days
                  </span>
                </>
              )}
              {zoneNow && (
                <>
                  <span className="faint">·</span>
                  {hereStep >= 0 ? (
                    <button className="btn small ghost" onClick={jumpHere} title={`You are in ${zoneNow}: go to its step`}>
                      You are here: step {hereStep + 1}
                    </button>
                  ) : (
                    <span className="faint">{hereDaily ? `You are here: ${zoneNow}, a raid lockout` : `You are in ${zoneNow}: no step there`}</span>
                  )}
                </>
              )}
              <span className="spacer" />
              {data.pending > 0 && <span className="faint small">Looking up {num(data.pending)} mobs’ races on eqlwiki…</span>}
              <ToggleChip
                on={choices.overlay}
                onChange={(on) => setChoices({ ...choices, overlay: on })}
                title="Show the step you are on (the one in your zone, else the one to head to) and the next on the achievements overlay, counting down as you kill"
              >
                On the overlay
              </ToggleChip>
            </div>

            {plan.daily.length > 0 && (
              <div className="card mb-16">
                <h2>
                  Every day <Info label="About raid lockouts" text="One kill a difficulty (0 to 4) a day: start these on day one, beside the plan, or they hold the rest up." />
                </h2>
                <ul className="fp-steps">
                  {plan.daily.map((d) => (
                    <li key={d.camp.id} className={`fp-step${isHere(d.camp.zone) ? ' now' : ''}`}>
                      <Tip className="fp-num" text="A raid lockout: every day">
                        ↻
                      </Tip>
                      <div className="fp-body">
                        <div className="fp-head">
                          <span className="fp-zone">{d.camp.zone}</span>
                          {isHere(d.camp.zone) && <span className="chip fp-now-chip">You are here</span>}
                          <span className="small">{d.camp.kinds.map((k) => k.name).join(', ')}</span>
                          <span className="spacer" />
                          <span className="mono fp-time">
                            {Math.max(...d.goals.map((g) => d.camp.pace[g] ?? 0))} a day · {d.days} days
                            {d.camp.today !== undefined && (
                              <Tip text="Kills of its mobs your log has seen since midnight (the live counts, since your export)">
                                {' '}
                                · {d.camp.today} of {Math.max(...d.goals.map((g) => d.camp.pace[g] ?? 0))} today
                              </Tip>
                            )}
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
                      {zoneRuns(plan.steps, from, to).map((run) => {
                        const first = plan.steps[run[0]]
                        const zone = first.camp.zone
                        const total = run.reduce((t, i) => t + plan.steps[i].seconds + plan.steps[i].travel, 0)
                        return (
                          <li key={first.camp.id + run[0]} id={`sl-run-${run[0] + 1}`} className={`fp-step${isHere(zone) ? ' now' : ''}`}>
                            <span className="fp-num">{run[0] + 1}</span>
                            <div className="fp-body">
                              <div className="fp-head">
                                <span className="fp-zone">{zone}</span>
                                {isHere(zone) && (
                                  <Tip className="chip fp-now-chip" text="The zone you are in">
                                    You are here
                                  </Tip>
                                )}
                                {first.travel > 0 && (
                                  <Tip className="faint small" text={first.via?.length ? `By ${first.via.join(', ')}, as your log has gone` : 'Your minutes between camps'}>
                                    {duration(first.travel)} to get there
                                  </Tip>
                                )}
                                <span className="spacer" />
                                <Tip className="mono fp-time" text={run.length > 1 ? 'The steps here together, getting there included' : 'Getting there and killing there'}>
                                  {duration(total)}
                                </Tip>
                              </div>
                              {run.map((i) => {
                                const st = plan.steps[i]
                                const killed = stepKills(st, choices)
                                return (
                                  <div key={i} id={`sl-step-${i + 1}`} className="sl-substep">
                                    <div className="sl-sub-head">
                                      {run.length > 1 && <span className="mono faint">{i + 1}.</span>}
                                      <div className="sl-sub-work">
                                        <StepWork
                                          step={st}
                                          plus={pluses[i]}
                                          since={!!data.sinceKills}
                                          goals={data.goals}
                                          choices={choices}
                                          onOut={(mob) => ruleOutMob(mob, true)}
                                        />
                                      </div>
                                      <Tip className={`chip sl-src ${st.camp.source}`} text={SOURCE[st.camp.source].tip}>
                                        {SOURCE[st.camp.source].label}
                                      </Tip>
                                      <Tip className="mono" text={`What you kill there: ${killed.map((k) => `${k.name} ×${kills(k.n)}`).join(', ')}`}>
                                        ×{kills(killed.reduce((t, k) => t + k.n, 0))}
                                      </Tip>
                                      <Tip className="mono small" text="Time killing for it">
                                        {duration(st.seconds)}
                                      </Tip>
                                    </div>
                                    <div className="row tight fp-effects">
                                      <Limit camp={st.camp} />
                                      <FactionCost camp={st.camp} raising={raising} />
                                      {(st.camp.note ?? spotTip(zone, data.goals[st.focus[0]]?.name ?? '')) && (
                                        <span className="faint small">{st.camp.note ?? spotTip(zone, data.goals[st.focus[0]]?.name ?? '')}</span>
                                      )}
                                      <span className="spacer" />
                                      <span className="faint small">
                                        {st.camp.source === 'log' && st.camp.hours
                                          ? `${num(st.camp.kills ?? 0)} kills in ${duration(st.camp.hours * 3600)} there`
                                          : st.camp.said && `said by ${st.camp.said}`}
                                      </span>
                                      <button
                                        className="btn small ghost"
                                        onClick={() => toggleMap(i)}
                                        title="Where its mobs spawn, on the game’s own map of the zone"
                                        aria-expanded={maps.has(i)}
                                      >
                                        Map
                                      </button>
                                      <button className="btn small ghost" onClick={() => ruleOut(st.camp.id, true)} title="Leave this camp out of the plan">
                                        Rule out
                                      </button>
                                    </div>
                                    {maps.has(i) && (
                                      <SpawnMap
                                        zone={zone}
                                        mobs={killed.map((k) => k.name)}
                                        stand={(() => {
                                          const s = spotFor(zone, data.goals[st.focus[0]]?.name ?? '')
                                          return s?.at ? { at: s.at, label: `${s.tip} (${s.said})` } : undefined
                                        })()}
                                      />
                                    )}
                                  </div>
                                )
                              })}
                              <HunterHere hunter={hunterAt(zone)} />
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
                    {guideTip(data.goals[g].name) && <span className="faint"> · eqlwiki’s guide: {guideTip(data.goals[g].name)}</span>}
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
                              title={`${data.goals[g].races} ${num(data.goals[g].count)}/${num(data.goals[g].max)}${guideTip(data.goals[g].name) ? `\neqlwiki’s guide: ${guideTip(data.goals[g].name)}` : ''}`}
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

            {choices.outCamps.length + choices.outMobs.length + autoOut.length > 0 && (
              <div className="card mb-16">
                <Disclosure open={openOut} onToggle={() => setOpenOut(!openOut)} label="Ruled out">
                  <h2>
                    Ruled out <span className="faint small">{choices.outCamps.length + choices.outMobs.length + autoOut.length}</span>
                  </h2>
                </Disclosure>
                {openOut && (
                  <>
                    {choices.outCamps.map((id) => (
                      <div key={id} className="row tight small">
                        <span>{data.camps.find((c) => c.id === id)?.zone ?? id.replace(/^\w+:/, '')}</span>
                        <button className="btn small ghost" onClick={() => ruleOut(id, false)}>
                          Bring back
                        </button>
                      </div>
                    ))}
                    {autoOut.map(({ camp, factions }) => (
                      <div key={camp.id} className="row tight small">
                        <span>
                          {camp.zone}: {camp.kinds.map((k) => k.name).join(', ')}
                        </span>
                        <span className="faint">costs {factions.join(' and ')}, which your faction plan raises</span>
                      </div>
                    ))}
                    {choices.outMobs.map((m) => (
                      <div key={m} className="row tight small">
                        <span>{m}, wherever it is</span>
                        <button className="btn small ghost" onClick={() => ruleOutMob(m, false)}>
                          Bring back
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {data.timings.length > 0 && (
              <div className="card mb-16">
                <Disclosure open={openTimes} onToggle={() => setOpenTimes(!openTimes)} label="Zone respawns">
                  <h2>
                    Zone respawns <span className="faint small">{data.timings.length}</span>
                  </h2>
                </Disclosure>
                {openTimes && (
                  <>
                    <div className="faint small mb-8">
                      The spawns your Respawns page has timed (one spawn, a few gaps seen), beside TAKP’s classic timer: a zone’s spawn-table pace runs on the timer of those the
                      tables give one spot.
                    </div>
                    {data.timings.map((t) => (
                      <div key={t.zone} className="small">
                        <b>{t.zone}</b> <span className="mono">{t.timer === null ? 'no timer' : clock(t.timer)}</span>{' '}
                        <span className="faint">· {t.timed.map((x) => `${x.name} ${clock(x.legends)}${x.classic ? ` (classic ${clock(x.classic)})` : ''}`).join(', ')}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            <div className="card row mb-16">
              <label className="row tight small">
                Minutes between camps
                <NumberInput value={choices.travelMin} min={0} max={120} width={64} onChange={(v) => setChoices({ ...choices, travelMin: v ?? DEFAULT_CHOICES.travelMin })} />
              </label>
              <label className="row tight small">
                <Tip text="For a camp players name without a number and no spawn table knows: kills an hour while there">Kills an hour where nothing gives a number</Tip>
                <NumberInput value={choices.pace} min={1} max={2000} width={72} onChange={(v) => setChoices({ ...choices, pace: v ?? DEFAULT_CHOICES.pace })} />
              </label>
              {data.killSpeed !== null && (
                <Tip className="small faint" text="The middle of your kills an hour over the zones you have hunted an hour or more: a spawn-table camp gives no more than this">
                  your usual pace {num(Math.round(data.killSpeed))}/h
                </Tip>
              )}
              {raising.length > 0 && (
                <ToggleChip
                  on={choices.avoidPlanFactions}
                  onChange={(on) => setChoices({ ...choices, avoidPlanFactions: on })}
                  title={`Rule out camps whose kills cost a faction your faction plan (Factions › Plan) is raising: ${raising.join(', ')}. They are listed under Ruled out.`}
                >
                  Avoid my faction plan’s factions
                </ToggleChip>
              )}
              <span className="spacer" />
              <button className="btn small ghost" disabled={reading} onClick={readAgain}>
                {reading ? 'Reading…' : 'Read again'}
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
