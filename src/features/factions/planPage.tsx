import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ago, api } from '../../renderer/src/api'
import { showError } from '../../renderer/src/toast'
import { useAchievementTrack, useInvoke, useLatest } from '../../renderer/src/hooks'
import { useApp } from '../../renderer/src/state'
import { useRemembered } from '../../renderer/src/remember'
import { useCharacterRecord } from '../../renderer/src/character'
import { useNow } from '../../renderer/src/components/TimerBars'
import { GameCommand, Info, NumberInput, Pending, Segmented, Switch } from '../../renderer/src/components/ui'
import { duration, num1, who, wikiUrl } from '../../core/format'
import { fmtCoin } from '../../core/loot'
import { STANDING_MAX, standingBand, type FactionView } from './core'
import { runPlan } from './planRunner'
import { deityName } from '../../shared/game/deities'
import { playableRace } from '../../shared/game/races'
import {
  DEFAULT_SETTINGS,
  NO_CHOICES,
  planFor,
  plannable,
  type FactionPlan,
  type FactionPlanData,
  type PlanFor,
  type PlanGoal,
  type PlanInput,
  type PlanShape,
  type HandInItem,
  type PlanActivity,
  type PlanChoices,
  type PlanOption,
  type PlanSettings,
  type PlanStep
} from './planner'
import { unlockGoals, type RaceUnlock } from './unlocks'
import { followedPlan } from './tracker'
import type { FactionTrackView } from '../../shared/tracking'

// The Factions page's Plan tab: the quickest known way to finish every faction achievement still to
// do, step by step, and every way there is to raise each one, to lock one in (the plan is then built
// around it) or rule one out. The plan itself is worked out here (planner.ts) from what the main
// process gathers, so a change of choices or assumptions shows at once.
//
// What is still to do, and where each faction stands, is the Standings tab's own view of the
// character picked, read every ten seconds: the plan follows play, and plans for whichever character
// it is. The catalog of ways (the log's kills and hand-ins, eqlwiki) changes slowly and is read once a
// minute, or at once when an achievement it was not built for turns up.

const HOW = (
  <>
    <div>
      <b>Order.</b> An achievement is done the moment its standing reaches 2000, and stays done whatever the standing does after. So anything that lowers one still to do comes
      after it is done, where it costs nothing. Each step takes what does the most for the achievements left per hour, counting points it takes off another as work to do again;
      then other orders and other ways are tried, and any that save time are kept.
    </div>
    <div>
      <b>Ways.</b> From your own log first: every kill and hand-in that moved a faction, with the amounts Legends gives and your pace. Then eqlwiki (faction, quest and item pages)
      where your log has nothing; where the wiki says only “got better”, your log’s usual amount stands in, or typical Legends amounts when your log has too few.
    </div>
    <div>
      <b>Time.</b> Mobs are grouped into camps by zone: common ones at your kill pace, named ones at one a respawn, so a camp of one or two named mobs loses to a quest. A hand-in
      takes the stack at once, so what counts is getting the items: bought is quick, gathered takes the time you set, and what you hold is free.
    </div>
    <div>
      <b>Quests.</b> A step is repeatable when it wants one kind of item nobody in the walkthrough hands you; chain steps, big one-off rewards and hand-ins your log saw fewer than
      three times are listed but not planned, unless you lock one in. A quest whose NPC wants a con (Allakhazam lists them) opens as your standing gets there, as an Agnostic of
      your race and classes; the plan may add a step that raises a faction just far enough to open a quicker quest, or swap race in Loadouts for it.
    </div>
    <div>
      <b>Race unlocks</b> count too: each wants three of a race’s factions maxed, and once one is done the plan may swap to that race in the steps after. With Race unlocks first,
      they come before the rest, with what is quick to do on the way.
    </div>
    <div>
      <b>Goals.</b> Fastest takes every achievement in the least time. Most factions positive also counts each faction that ends at 0 or above, worth the hours you set, so it may
      take a slower way that keeps a faction up, or end with steps that bring factions back from below zero. Either way, only where a faction ends counts.
    </div>
  </>
)

const signed = (n: number) => (n > 0 ? `+${num1(n)}` : n < 0 ? `−${num1(-n)}` : '0')
/** The con's word for a standing with the modifiers added: "Indifferent", "Amiable". */
const standingWord = (con: number) => standingBand(con).word
const plain = (n: number) => (n < 0 ? `−${-n}` : String(n))
/** A standing with thousands separators and a true minus: "1,415", "−702". */
const signedPlain = (n: number) => (n < 0 ? `−${(-n).toLocaleString()}` : n.toLocaleString())

const KIND_LABEL: Record<PlanActivity['kind'], string> = { kill: 'Kill', turnin: 'Hand-in', quest: 'Quest' }

/** Where a hand-in's item comes from, in a few words. */
function itemSource(it: HandInItem): string {
  const where = it.where ? ` ${it.where}` : ''
  switch (it.how) {
    case 'coin':
      return 'coin'
    case 'bought':
      return `you bought it from${where}${it.each ? `, ${fmtCoin(Math.round(it.each))} each` : ''}`
    case 'vendor':
      return `sold by${where}`
    case 'crafted':
      return 'crafted'
    case 'drop':
      return it.named ? `from${where || ' a named mob'} (named: one a respawn)` : `drops${it.where ? ` from ${it.where}` : ''}${it.sec ? `, about ${duration(it.sec)} each` : ''}`
    default:
      return 'the wiki does not say where it comes from'
  }
}

/**
 * What a step's hand-ins take: all of it for `units` of them, with each one's share when it is more
 * than one, and what the NPC gives back to be handed back (`back`).
 */
function ItemsLine({ items, units, back }: { items: HandInItem[]; units?: number; back?: string }) {
  if (!items.length) return <span className="faint">The walkthrough does not say what goes in.</span>
  return (
    <>
      {items.map((it, i) => (
        <Fragment key={it.name + i}>
          {i > 0 && ', '}
          <span className="mono">{(units ? units * it.count : it.count).toLocaleString()}</span> {it.name}
          {it.to && <span className="faint"> to {it.to}</span>}
          {!!units && it.count > 1 && <span className="faint"> ({it.count} a hand-in)</span>}
          {it.makes && <span className="faint"> (combined into {it.makes})</span>}
          <span className="faint"> — {itemSource(it)}</span>
          {!!it.have && (
            <span className="ok-text">
              {' '}
              · you hold {it.have.toLocaleString()}
              {units ? ` (${Math.min(units, Math.floor(it.have / it.count)).toLocaleString()} hand-ins' worth)` : ''}
            </span>
          )}
        </Fragment>
      ))}
      {back && <span className="faint"> · then hand back the {back} you get for each, for as much again</span>}
    </>
  )
}

/** "Kill A gnoll, A gnoll guardsman and 19 more", "Hand in to Lashun Novashine", "Bone Chips (Kaladim)". */
export function Doing({ a }: { a: PlanActivity }) {
  const link = a.page ? (
    <a href={wikiUrl(a.page)} target="_blank" rel="noreferrer" title="Open on eqlwiki" onClick={(e) => e.stopPropagation()}>
      {a.kind === 'quest' ? a.title : '↗'}
    </a>
  ) : null
  if (a.kind === 'kill')
    return (
      <span title={a.mobs?.join(', ')}>
        Kill <b>{a.title}</b> {a.page && link}
      </span>
    )
  if (a.kind === 'turnin')
    return (
      <span>
        Hand in to <b>{a.npc ?? a.title}</b>
      </span>
    )
  return (
    <span>
      <b>{link ?? a.title}</b>
      {a.npc ? <span className="faint"> — hand in to {a.npc}</span> : null}
    </span>
  )
}

/** Other characters' names for a sentence: "Kelwyn's", "Kelwyn's and Aldric's". */
const theirLogs = (keys: string[]) => keys.map((k) => `${k.split('_')[0]}'s`).join(' and ')

/** Where a figure came from. */
export function sourceNote(a: PlanActivity): string {
  if (a.source === 'log') {
    const n = `${(a.seen ?? 0).toLocaleString()} ${a.kind === 'kill' ? 'kills' : 'hand-ins'}`
    if (a.theirs && a.others?.length) return `from ${theirLogs(a.others)} log (${n})`
    if (a.others?.length) return `from your log and ${theirLogs(a.others)} (${n})`
    return `from your log (${n})`
  }
  const site = a.site ?? 'eqlwiki'
  return a.guessed?.length ? `from ${site}, amounts guessed` : `from ${site}`
}

/** What could make a step slower or rougher than planned: said on the step and on each way to raise an achievement. */
export function Flags({ a }: { a: PlanActivity }) {
  const flags: { tone: string; label: string; why: string }[] = []
  if (a.city)
    flags.push({
      tone: 'warn',
      label: 'city NPCs',
      why: "A city's people: its guards may join in, and the city's own factions drop."
    })
  if (a.blocked)
    flags.push({
      tone: 'warn',
      label: `needs ${a.needs ?? 'better faction'}`,
      why: a.swap?.length
        ? `Your race's con keeps it closed now: it ${a.blocked}. As ${listed(a.swap)} it is open, so the plan may swap race for it (Assumptions), or raise the faction first; or lock it in.`
        : `Closed now: it ${a.blocked}. The plan may raise the faction first, where that is quicker than the other ways, or swap to a race it unlocks; or lock it in.`
    })
  if (a.source === 'wiki' && a.guessed?.length)
    flags.push({ tone: '', label: 'amounts guessed', why: 'eqlwiki names the factions but not the amounts: a typical amount stands in until your log measures it.' })
  if (a.items?.some((it) => it.how === 'unknown'))
    flags.push({ tone: 'warn', label: 'item source unknown', why: 'Nothing says where its item comes from, so the time to get it is a guess.' })
  if (a.kind === 'kill' && !a.common && (a.named ?? 0) > 0 && !a.measured)
    flags.push({ tone: '', label: 'named only', why: 'Named or single mobs only: one kill each per respawn.' })
  return (
    <>
      {flags.map((f) => (
        <span key={f.label} className={`chip fp-flag ${f.tone}`.trim()} title={f.why}>
          {f.label}
        </span>
      ))}
    </>
  )
}

/** The plan's assumptions as the Plan tab has them, for a page that only reads them. */
export function usePlanSettings(logPace: number | null): PlanSettings {
  const [stored] = useRemembered<Partial<PlanSettings>>('factions.plan.settings', {})
  return useMemo(() => ({ ...DEFAULT_SETTINGS, killsPerHour: logPace ?? DEFAULT_SETTINGS.killsPerHour, ...stored }), [stored, logPace])
}

/** A character's locks, rule-outs and paces on the Plan tab. */
export function useChoices(character: string): [PlanChoices, (c: PlanChoices) => void] {
  const [stored, set] = useRemembered<PlanChoices>(`factions.plan.${character}`, NO_CHOICES)
  const choices = useMemo<PlanChoices>(() => ({ locks: stored?.locks ?? {}, excluded: stored?.excluded ?? [], perHour: stored?.perHour ?? {} }), [stored])
  return [choices, set]
}

export function PlanTab({ character, view }: { character: string; view: FactionView | null }) {
  const [stored, setSettings] = useRemembered<Partial<PlanSettings>>('factions.plan.settings', {})
  const aim: PlanGoal = stored.goal === 'positive' ? 'positive' : 'fastest'
  // Most factions positive wants the ways to raise every faction, not only the achievements.
  const wide = aim === 'positive'
  const q = useInvoke(character ? 'factions:plan' : null, [character, false, wide])
  const data = q.data
  // Every ten seconds brings a new view: the plan is worked out again only when what it is for changed.
  const liveKey = useMemo(() => (view ? JSON.stringify(planFor(view)) : ''), [view])
  const live = useMemo<PlanFor | null>(() => (liveKey ? (JSON.parse(liveKey) as PlanFor) : null), [liveKey])
  const todo: PlanFor | null = live ?? data
  const [reading, setReading] = useState(false)
  // Reads eqlwiki's pages again, once: the reloads each minute go on from the pages kept.
  const readAgain = async () => {
    setReading(true)
    try {
      q.setData(await api.invoke('factions:plan', character, true, wide))
    } catch (e) {
      showError("Could not read eqlwiki's faction pages again", e)
    } finally {
      setReading(false)
    }
  }
  const now = useNow(30_000)
  const [choices, setChoices] = useChoices(character)
  const [open, setOpen] = useState<string | null>(null)
  // The plan counts everyone as Agnostic; the character's own deity says whether it has a step to take first.
  const record = useCharacterRecord(character).record
  const deity = deityName(record?.deity ?? '')
  const ownRace = playableRace(record?.race ?? '')

  // New kills and hand-ins show up as the log grows; the catalog comes from caches after the first read.
  const reload = q.reload
  useEffect(() => {
    const t = setInterval(reload, 60_000)
    return () => clearInterval(t)
  }, [reload])
  // An achievement the catalog was not built for (one fallen back below 2000 with no achievements export): read it again now.
  const unknown = !!live && !!data && live.targets.some((t) => !data.targets.some((d) => d.faction === t.faction))
  useEffect(() => {
    if (unknown) reload()
  }, [unknown, reload])

  const logPace = data?.catalog.killsPerHour ?? null
  const settings = useMemo<PlanSettings>(() => ({ ...DEFAULT_SETTINGS, killsPerHour: logPace ?? DEFAULT_SETTINGS.killsPerHour, ...stored }), [stored, logPace])
  const deferredSettings = useDeferredValue(settings)
  const deferredChoices = useDeferredValue(choices)
  // The order is kept while only the standings move, so the steps are not reshuffled mid-grind. An
  // achievement done, a change of choices or assumptions, or Plan afresh searches for the order again.
  const [afresh, setAfresh] = useState(0)
  const openSet = todo ? todo.targets.flatMap((t) => (t.standing < STANDING_MAX ? [t.faction] : [])).join('|') : ''
  // The race unlocks still to do, and what each race adds to the cons, as the catalog came with them.
  const extras = useMemo(() => planExtras(data), [data])
  // A catalog with other ways in it (the wider one Most factions positive reads, or a hand-in newly seen three times) plans afresh
  // too, and so does a change of con: a race or class change, a race unlocked. The plan sees a quest open as a standing reaches
  // what its NPC wants; without the races' modifiers, the quests open now are what it goes by.
  const cons = data?.raceMods
    ? `${data.raceMods.own}|${(data.races ?? ['every race']).join(',')}|${JSON.stringify(data.raceMods.mods[data.raceMods.own] ?? {})}`
    : data
      ? data.catalog.activities.flatMap((a) => (a.blocked ? [a.id] : [])).join('|')
      : ''
  const unlocksKey = extras.unlocks.map((g) => `${g.achievement}:${g.factions.join(',')}`).join('|')
  // Which ways there are, not how many: one page read may add a camp as another drops one. The kill
  // pace read from the log moves with every kill, so only a pace the player set searches again.
  const ways = useMemo(
    () =>
      data
        ? data.catalog.activities
            .map((a) => a.id)
            .sort()
            .join('|')
        : '',
    [data]
  )
  const keySettings = stored.killsPerHour === undefined ? { ...deferredSettings, killsPerHour: 0 } : deferredSettings
  const structure = JSON.stringify([openSet, keySettings, deferredChoices, afresh, ways, cons, unlocksKey])
  const keptShape = useRef<{ key: string; shape: PlanShape } | null>(null)
  // Worked out in a worker (planRunner.ts), so a search does not freeze the page; the plan shown
  // stays until the next one arrives, and a plan overtaken by newer inputs is dropped.
  const [plan, setPlan] = useState<FactionPlan | null>(null)
  useEffect(() => {
    if (!data || !todo) return
    let current = true
    const keep = keptShape.current?.key === structure ? keptShape.current.shape : undefined
    runPlan({ targets: todo.targets, maxed: todo.maxed, standings: todo.standings, activities: data.catalog.activities, ...extras }, deferredSettings, deferredChoices, keep).then(
      (p) => {
        if (!current) return
        keptShape.current = { key: structure, shape: p.shape }
        // The order kept and the counts the same: the plan shown stays, and its hundred rows are not drawn again.
        setPlan((old) => (old && JSON.stringify(old) === JSON.stringify(p) ? old : p))
      },
      (e: unknown) => current && showError('Could not work out the faction plan', e)
    )
    return () => {
      current = false
    }
  }, [data, todo, extras, deferredSettings, deferredChoices, structure])

  // The plan shown is the one followed while this character is played: it goes to the main process
  // whenever its steps change, for the achievements overlay and its cues.
  const followKey = plan ? JSON.stringify(plan.steps.map((st) => [st.activity.id, st.finishes, st.lifts, st.reaches])) : ''
  const following = useLatest({ plan, todo })
  useEffect(() => {
    const { plan: p, todo: t } = following.current
    if (!followKey || !p || !t) return
    const timer = setTimeout(
      () => void api.invoke('factions:follow', character, followedPlan(p, t.targets)).catch((e: unknown) => showError('Could not hand the plan to the achievements overlay', e)),
      400
    )
    return () => clearTimeout(timer)
  }, [followKey, character, following])
  const track = useAchievementTrack()
  const tracked = track && track.character.toLowerCase() === character.toLowerCase() ? track.faction : null
  const { state: app, patchSettings } = useApp()
  const overlay = app.settings.overlays.find((o) => o.kind === 'achievements')

  // Race swaps: what they save against the same plan without them, worked out once the plan shows.
  const swapSteps = plan ? plan.steps.filter((st) => st.race).length : 0
  const swapKey = swapSteps ? structure : ''
  const [noSwap, setNoSwap] = useState<{ key: string; seconds: number; unplanned: number } | null>(null)
  useEffect(() => {
    if (!swapKey || !data || !todo || noSwap?.key === swapKey) return
    let current = true
    // Without swaps: every quest as the character's own race, when its standing gets there. A lock on one only another race opens now is dropped.
    const needSwap = new Set(data.catalog.activities.flatMap((a) => (a.blocked && a.swap?.length ? [a.id] : [])))
    runPlan(
      { targets: todo.targets, maxed: todo.maxed, standings: todo.standings, activities: data.catalog.activities, ...extras },
      { ...deferredSettings, raceSwaps: false },
      {
        ...deferredChoices,
        locks: Object.fromEntries(Object.entries(deferredChoices.locks).filter(([, id]) => !needSwap.has(id))),
        excluded: extras.races ? deferredChoices.excluded : [...deferredChoices.excluded, ...needSwap]
      }
    ).then(
      (p) => current && setNoSwap({ key: swapKey, seconds: p.seconds, unplanned: p.unplanned.length }),
      () => undefined
    )
    return () => {
      current = false
    }
  }, [swapKey, data, todo, extras, deferredSettings, deferredChoices, noSwap?.key])
  const swapSaves = plan && noSwap && noSwap.key === swapKey ? savedBySwaps(plan, noSwap) : null
  // The step each race is unlocked at, for a swap to a race the plan unlocks first.
  const unlockedAt = useMemo(() => {
    const at = new Map<string, number>()
    const raceOf = new Map((data?.unlocks ?? []).map((u) => [u.achievement, u.race]))
    plan?.steps.forEach((st, i) => st.unlocks.forEach((u) => !at.has(raceOf.get(u) ?? '') && at.set(raceOf.get(u) ?? '', i + 1)))
    return at
  }, [plan, data])
  /** Under a step done as another race: the race, and why the character's own will not do there. */
  const swapHint = (st: PlanStep): ReactNode =>
    st.race ? <SwapHint step={st} own={ownRace} unlocksKnown={!!data && data.races !== null} unlockedAt={unlockedAt.get(st.race)} /> : null
  const nowStep = plan && tracked?.current && plan.steps[tracked.current.index]?.activity.id === tracked.current.id ? plan.steps[tracked.current.index] : null

  if (!data)
    return (
      <Pending
        error={q.error}
        retry={q.reload}
        what="the plan"
        hint="The first plan for a character reads its whole log and eqlwiki's faction, quest and item pages; it can take a minute."
      />
    )

  const { targets, achievementsExport } = todo ?? data
  const toDo = targets.filter((t) => t.standing < STANDING_MAX)
  const openUnlocks = (data.unlocks ?? []).filter((u) => u.done !== true)
  // The step that does each race unlock.
  const unlockStep = new Map<string, number>()
  plan?.steps.forEach((st, i) => st.unlocks.forEach((u) => unlockStep.set(u, i + 1)))
  if (data.noAchievementList)
    return (
      <div className="card empty">
        No faction achievements to plan: the game folder set on the Settings page has no achievement list (Resources/Achievements/AchievementsClient.txt). Check that it is the
        EverQuest Legends folder.
      </div>
    )
  if (!targets.length)
    return (
      <div className="card empty">
        Every faction achievement is done for {who(character)}. Type <GameCommand cmd="/outputfile achievements" /> in game if that is not so: this page goes by the achievements
        export.
      </div>
    )

  /** Locks achievements to an activity, or unlocks them (null), in one change. */
  const lock = (factions: string[], id: string | null) => {
    const locks = { ...choices.locks }
    for (const f of factions) {
      if (id) locks[f] = id
      else delete locks[f]
    }
    setChoices({ ...choices, locks, excluded: id ? choices.excluded.filter((x) => x !== id) : choices.excluded })
  }
  const exclude = (id: string, out: boolean) => {
    const locks = Object.fromEntries(Object.entries(choices.locks).filter(([, v]) => !out || v !== id))
    setChoices({ ...choices, locks, excluded: out ? [...new Set([...choices.excluded, id])] : choices.excluded.filter((x) => x !== id) })
  }
  const pace = (id: string, perHour: number | undefined) => {
    const next = { ...choices.perHour }
    if (perHour && perHour > 0) next[id] = perHour
    else delete next[id]
    setChoices({ ...choices, perHour: next })
  }
  /** The step the Now card and the overlay follow, picked here: until the kills or hand-ins go toward another. */
  const workOn = (index: number) => void api.invoke('factions:follow-step', character, index).catch((e: unknown) => showError('Could not pick that step', e))
  const chose = Object.keys(choices.locks).length + choices.excluded.length + Object.keys(choices.perHour).length
  const byId = new Map(data.catalog.activities.map((a) => [a.id, a]))
  const stepOf = new Map<string, number>()
  plan?.steps.forEach((st, i) => st.finishes.forEach((f) => stepOf.set(f, i + 1)))

  return (
    <>
      {deity !== 'Agnostic' && (
        <div className="notice mb-16">
          This plan counts {who(character)} as Agnostic, the deity with no faction modifiers: renouncing your faith is the first step.{' '}
          {deity ? `${who(character)} worships ${deity}. ` : 'No deity is set on the Stats page. '}
          {data.agnostic ? (
            'Agnostic is unlocked: pick it in Loadouts.'
          ) : (
            <>
              {data.agnostic === false ? 'Unlock Agnostic' : 'If Agnostic is not unlocked yet, unlock it'} with{' '}
              <a href={wikiUrl('Renouncing Your Faith')} target="_blank" rel="noreferrer">
                Renouncing Your Faith
              </a>{' '}
              (level 46 and up: the Emissary of Zebuxoruk in the Oasis of Marr, then defeat Cazic Thule in the Plane of Fear and Innoruuk in the Plane of Hate), then pick it in
              Loadouts.
            </>
          )}
        </div>
      )}
      {!(view?.export ?? data.export) && (
        <div className="notice mb-16">
          No factions export for {who(character)} yet, so every standing counts from 0. Type <GameCommand cmd="/outputfile faction" /> in game for a plan from where you really
          stand.
        </div>
      )}
      {!achievementsExport && (
        <div className="notice mb-16">
          No achievements export for {who(character)} yet, so an achievement counts as done only while its standing is at 2000: any finished and then fallen back from are planned
          again. Type <GameCommand cmd="/outputfile achievements" /> in game to plan only what is really left.
        </div>
      )}
      {data.wiki.error && (
        <div className="notice bad mb-16">
          Could not read eqlwiki again ({data.wiki.error}); the pages read {ago(data.wiki.fetchedAt, now)} serve meanwhile.
        </div>
      )}
      {data.alla.error && (
        <div className="notice bad mb-16">
          Could not read Allakhazam ({data.alla.error}); it is tried again in ten minutes, and the plan goes on without the pages not yet read.
        </div>
      )}

      <NowCard
        character={character}
        track={tracked}
        hint={nowStep ? swapHint(nowStep) : null}
        overlayShown={!!overlay?.visible}
        cues={app.settings.achievementCues}
        onOverlay={(on) => void patchSettings((s) => ({ ...s, overlays: s.overlays.map((o) => (o.kind === 'achievements' ? { ...o, visible: on } : o)) }))}
        onCues={(on) => void patchSettings((s) => ({ ...s, achievementCues: on }))}
        onFirst={() => workOn(0)}
      />

      <div className="card mb-16">
        <div className="row mb-12">
          <Segmented
            label="What the plan aims for"
            value={aim}
            onChange={(g) => setSettings({ ...stored, goal: g })}
            options={[
              ['fastest', 'Fastest'],
              ['positive', 'Most factions positive']
            ]}
          />
          <span className="faint small">
            {aim === 'positive'
              ? `Every achievement, ending with as many factions at 0 or above as is worth the time (${settings.positiveHours} h each; set in Assumptions)`
              : 'Every achievement in the least time'}
          </span>
          <span className="spacer" />
          <label
            className="row tight small"
            title="Do the race unlocks before the rest, and what is quick to do on the way: each one done lets you pick that race in Loadouts, and the plan may swap to it in the steps after"
          >
            <Switch
              on={settings.unlocksFirst}
              label="Race unlocks first"
              onChange={(on) => {
                const next = { ...stored }
                if (on === DEFAULT_SETTINGS.unlocksFirst) delete next.unlocksFirst
                else next.unlocksFirst = on
                setSettings(next)
              }}
            />{' '}
            Race unlocks first
            <span className="faint"> ({openUnlocks.length ? `${openUnlocks.length} to do` : data.unlocks?.length ? 'every one done' : 'none known'})</span>
          </label>
        </div>
        <div className="fp-stats">
          <div className="stat">
            <span className="label">Achievements to do</span>
            <span className="value">{toDo.length}</span>
          </div>
          <div className="stat">
            <span className="label">Plan</span>
            <span className="value">{plan ? `≈ ${duration(plan.seconds)}` : '…'}</span>
            <span className="sub">{plan ? `${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}` : ''}</span>
          </div>
          <div className="stat">
            <span className="label">Not planned</span>
            <span className="value">{plan?.unplanned.length ?? 0}</span>
            <span className="sub">{plan?.unplanned.length ? 'nothing repeatable known' : 'every one has a way'}</span>
          </div>
          <div className="stat">
            <span className="label">Below zero at the end</span>
            <span className="value">{plan ? plan.belowZero.after : '…'}</span>
            <span className="sub">{plan ? `${plan.belowZero.now} now` : ''}</span>
          </div>
          <div className="stat">
            <span className="label">Off maxed factions</span>
            <span className="value">{plan ? Math.round(plan.maxedLost).toLocaleString() : '…'}</span>
            <span className="sub">points by the end; achievements kept</span>
          </div>
          {openUnlocks.length > 0 && (
            <div className="stat" title="Race unlocks still to do: each wants three of a race's factions maxed">
              <span className="label">Race unlocks</span>
              <span className="value">{openUnlocks.length}</span>
              <span className="sub">{unlocksNote(openUnlocks, unlockStep)}</span>
            </div>
          )}
          {swapSteps > 0 && (
            <div className="stat" title="Steps done as another race, swapped to in Loadouts and back: a quest your race's con keeps closed and another race's opens">
              <span className="label">Race swaps</span>
              <span className="value">{swapSteps}</span>
              <span className="sub">{swapSaves ?? 'working out what they save…'}</span>
            </div>
          )}
          <span className="spacer" />
          <div className="stack gap-6" style={{ alignItems: 'flex-end' }}>
            {plan?.kept && (
              <button
                className="btn small ghost"
                onClick={() => setAfresh((n) => n + 1)}
                title="The order is kept while you play, with the counts kept up to date; this searches for the quickest order again from where you stand now"
              >
                Plan afresh
              </button>
            )}
            {chose > 0 && (
              <button className="btn small ghost" onClick={() => setChoices(NO_CHOICES)} title="Clear every lock, rule-out and pace you set">
                Clear my choices ({chose})
              </button>
            )}
            <button className="btn small ghost" disabled={reading} onClick={() => void readAgain()} title="Read eqlwiki's faction and quest pages again (they are kept a week)">
              {reading ? 'Reading eqlwiki…' : 'Read eqlwiki again'}
            </button>
          </div>
        </div>
        <p className="faint small mb-0">
          For the achievements {who(character)} has still to do, from that character&apos;s log ({data.log.handIns.toLocaleString()} hand-ins and {data.log.kills.toLocaleString()}{' '}
          kills that moved a faction)
          {data.shared.characters.length > 0 &&
            `, ${theirLogs(data.shared.characters)} ${data.shared.characters.length === 1 ? 'log' : 'logs'} (${data.shared.handIns.toLocaleString()} hand-ins and ${data.shared.kills.toLocaleString()} kills: what a kill or hand-in gives is the same for every character; kill pace stays this one's)`}
          {data.export ? `, ${data.export.file} (written ${ago(data.export.modified, now)})` : ''}
          {data.inventory ? `, what you hold at ${data.inventory.file} (written ${ago(data.inventory.modified, now)})` : ''}, eqlwiki ({data.wiki.pages} faction pages,{' '}
          {data.wiki.quests} quests, read {ago(data.wiki.fetchedAt, now)})
          {data.alla.wanted > 0 &&
            ` and Allakhazam (${data.alla.read} of ${data.alla.wanted} faction pages${data.alla.read < data.alla.wanted ? ', the rest coming a page every twenty seconds as the site asks' : ''})`}
          . <Info label="How the plan is made" text={HOW} />
        </p>
        <Assumptions settings={settings} stored={stored} logPace={logPace} onChange={setSettings} />
      </div>

      {plan && plan.staleLocks.length > 0 && (
        <div className="notice mb-16">
          {plan.staleLocks.length === 1 ? 'A lock' : 'Some locks'} no longer {plan.staleLocks.length === 1 ? 'fits' : 'fit'}: {plan.staleLocks.join(', ')}. What was locked in is
          gone or no longer raises it, so the plan chooses again.{' '}
          <button className="link-button" onClick={() => lock(plan.staleLocks, null)}>
            Clear {plan.staleLocks.length === 1 ? 'it' : 'them'}
          </button>
        </div>
      )}

      {plan && <Steps plan={plan} choices={choices} onLock={lock} onExclude={exclude} onWork={workOn} now={tracked?.current ?? null} hint={swapHint} />}

      {openUnlocks.length > 0 && (
        <div className="card mb-16" style={{ padding: 0 }}>
          <h2 style={{ padding: '14px 16px 0' }}>Race unlocks to do</h2>
          <p className="faint small" style={{ padding: '0 16px' }}>
            Each one done lets {who(character)} pick that race in Loadouts, and the plan may swap to it for a quest its own race&apos;s con keeps closed. Each wants three of the
            race&apos;s factions maxed, one at a time: a faction that falls back after reaching 2000 stays done for it.{' '}
            {settings.unlocksFirst ? 'The plan does them first.' : 'Switch on Race unlocks first to do them before the rest.'}
          </p>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Race unlock</th>
                  <th>What it wants</th>
                  <th>In the plan</th>
                </tr>
              </thead>
              <tbody>
                {openUnlocks.map((u) => {
                  const step = unlockStep.get(u.achievement)
                  return (
                    <tr key={u.achievement}>
                      <td>{u.achievement.replace(/^Race Unlock - /, '')}</td>
                      <td className="small">
                        <UnlockParts u={u} standings={todo?.standings ?? {}} />
                      </td>
                      <td>
                        {step ? (
                          <span>
                            <span className="fp-num-inline">{step}</span> done there
                          </span>
                        ) : (
                          <span
                            className="chip warn"
                            title={u.other ? 'Done some other way than factions: not the plan’s to do' : 'Nothing the planner may use raises one of its factions to 2000'}
                          >
                            not planned
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card mb-16" style={{ padding: 0 }}>
        <h2 style={{ padding: '14px 16px 0' }}>Achievements to do</h2>
        <p className="faint small" style={{ padding: '0 16px' }}>
          Open one for every way to raise it. Lock one in and the plan finishes that achievement with it, and is built around it; rule one out and the plan leaves it alone.
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Achievement</th>
                <th className="num">Standing</th>
                <th className="num">To go</th>
                <th>In the plan</th>
              </tr>
            </thead>
            <tbody>
              {[...targets]
                .sort((a, b) => (stepOf.get(a.faction) ?? 999) - (stepOf.get(b.faction) ?? 999) || a.faction.localeCompare(b.faction))
                .map((t) => {
                  const isOpen = open === t.faction
                  const toggle = () => setOpen(isOpen ? null : t.faction)
                  const step = stepOf.get(t.faction)
                  const lockedTo = choices.locks[t.faction] ? byId.get(choices.locks[t.faction]) : undefined
                  const done = t.standing >= STANDING_MAX
                  return (
                    <Fragment key={t.faction}>
                      <tr className={`clickable${isOpen ? ' selected' : ''}`} onClick={toggle}>
                        <td>
                          <button className="link-button" aria-expanded={isOpen} onClick={(e) => (e.stopPropagation(), toggle())}>
                            {t.achievement}
                          </button>
                          {t.achievement !== t.faction && <span className="faint small"> ({t.faction})</span>}
                          {lockedTo && (
                            <span className="chip fp-lock" title={`Locked in: ${lockedTo.title}`}>
                              locked
                            </span>
                          )}
                        </td>
                        <td className="num mono">{plain(Math.round(t.standing))}</td>
                        <td className="num mono">{done ? '—' : Math.round(STANDING_MAX - t.standing).toLocaleString()}</td>
                        <td>
                          {done ? (
                            <span className="chip ok" title="At 2000 now: the achievement shows done at your next achievements export">
                              at 2000
                            </span>
                          ) : step ? (
                            <span>
                              <span className="fp-num-inline">{step}</span> <Doing a={plan!.steps[step - 1].activity} />
                            </span>
                          ) : (
                            <span className="chip warn" title="Nothing the planner may use raises it: open it for what there is">
                              not planned
                            </span>
                          )}
                        </td>
                      </tr>
                      {isOpen && !done && plan && (
                        <tr>
                          <td colSpan={4} style={{ background: 'var(--bg-2)' }}>
                            <Options
                              faction={t.faction}
                              options={plan.options[t.faction] ?? []}
                              choices={choices}
                              swaps={settings.raceSwaps}
                              onLock={lock}
                              onExclude={exclude}
                              onPace={pace}
                            />
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

      {choices.excluded.length > 0 && (
        <div className="card mb-16">
          <h2>Ruled out</h2>
          <div className="stack gap-6">
            {choices.excluded.map((id) => {
              const a = byId.get(id)
              return (
                <div key={id} className="row tight">
                  <button className="btn small ghost" onClick={() => exclude(id, false)}>
                    Allow again
                  </button>
                  {a ? (
                    <>
                      <Doing a={a} /> <span className="faint small">{a.zone}</span>
                    </>
                  ) : (
                    <span className="faint">Something no longer on offer ({id})</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

/** The settings that are numbers, typed into the Assumptions. */
type NumberSetting = { [K in keyof PlanSettings]: PlanSettings[K] extends number ? K : never }[keyof PlanSettings]

function Assumptions({
  settings,
  stored,
  logPace,
  onChange
}: {
  settings: PlanSettings
  stored: Partial<PlanSettings>
  logPace: number | null
  onChange: (s: Partial<PlanSettings>) => void
}) {
  const set = (k: NumberSetting) => (v: number | undefined) => {
    const next = { ...stored }
    if (v === undefined || !(v >= 0)) delete next[k]
    else next[k] = v
    onChange(next)
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
          <span>Swap race for a quest</span>
          <Switch
            on={settings.raceSwaps}
            label="Plan race swaps"
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
          <span>A race swap, there and back (min)</span>
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

/** What a step does to the achievements: done here, raised on the way, lowered, and what it takes off maxed factions. */
function Effects({ step }: { step: PlanStep }) {
  const also = Object.entries(step.raises).filter(([f]) => !step.finishes.includes(f) && !step.reaches.some((r) => r.faction === f))
  const lowers = Object.entries(step.lowers)
  const maxed = Object.entries(step.maxedLowered)
  return (
    <>
      {step.unlocks.map((u) => (
        <span key={u} className="chip ok fp-unlock" title={`${u}: done here, so you can pick the race in Loadouts, and the plan may swap to it after`}>
          {u.replace(/^Race Unlock - /, '')} unlocked
        </span>
      ))}
      {step.finishes.map((f) => (
        <span key={f} className="chip ok" title={step.locked.includes(f) ? 'Done here, as you locked in' : 'Done here'}>
          {f}
          {step.locked.includes(f) ? ' (locked)' : ''}
        </span>
      ))}
      {step.reaches.map((r) => (
        <span
          key={`reach ${r.faction} ${r.opens}`}
          className="chip fp-reach"
          title={`Raised to ${r.to.toLocaleString()}, where ${r.opens}'s NPC takes it (${r.band}): a quicker way than going on with this`}
        >
          {r.faction} to {plain(r.to)} → opens {r.opens}
        </span>
      ))}
      {also.map(([f, v]) => (
        <span key={f} className="chip" title="Raised on the way; finished in a later step">
          {f} {signed(v)}
        </span>
      ))}
      {lowers.map(([f, v]) => (
        <span key={f} className="chip warn" title="Lowered while still to do: the plan makes these points up later">
          {f} {signed(-v)}
        </span>
      ))}
      {step.lifts.map((f) => (
        <span key={`up ${f}`} className="chip ok" title="Brought back from below zero here">
          {f} back to 0+
        </span>
      ))}
      {step.sinks.map((f) => (
        <span key={`down ${f}`} className="chip bad" title="Taken below zero here">
          {f} below 0
        </span>
      ))}
      {maxed.length > 0 && (
        <span
          className="faint small"
          title={maxed
            .sort((a, b) => b[1] - a[1])
            .map(([f, v]) => `${f} ${signed(-v)}`)
            .join('\n')}
        >
          {maxed.length <= 2
            ? `takes ${maxed.map(([f, v]) => `${Math.round(v).toLocaleString()} off ${f}`).join(' and ')} (maxed)`
            : `takes ${Math.round(maxed.reduce((n, [, v]) => n + v, 0)).toLocaleString()} off ${maxed.length} maxed factions`}
        </span>
      )}
    </>
  )
}

function Steps({
  plan,
  choices,
  onLock,
  onExclude,
  onWork,
  now,
  hint
}: {
  plan: FactionPlan
  choices: PlanChoices
  onLock: (factions: string[], id: string | null) => void
  onExclude: (id: string, out: boolean) => void
  /** Makes a step the one the Now card and the overlay follow. */
  onWork: (index: number) => void
  /** The step the character being played is on, as the achievements overlay follows it. */
  now: FactionTrackView['current']
  /** Anything to do first for a step, such as a race swap. */
  hint: (st: PlanStep) => ReactNode
}) {
  if (!plan.steps.length) return <div className="card empty mb-16">Nothing the planner knows raises the achievements left. Open each one below for what there is.</div>
  return (
    <div className="card mb-16">
      <h2>
        The plan, step by step<span className="spacer"></span>
        <span className="faint small mono">≈ {duration(plan.seconds)}</span>
      </h2>
      <ol className="fp-steps">
        {plan.steps.map((st, i) => {
          const a = st.activity
          const lockable = st.finishes.filter((f) => choices.locks[f] !== a.id)
          const isNow = !!now && now.index === i && now.id === a.id
          return (
            <li key={a.id + i} className={`fp-step${isNow ? ' now' : ''}`}>
              <span className="fp-num">{i + 1}</span>
              <div className="fp-body">
                <div className="fp-head">
                  <span className="fp-zone">{a.zone || 'Somewhere'}</span>
                  <span className={`chip fp-kind ${a.kind}`}>{KIND_LABEL[a.kind]}</span>
                  {st.restores && (
                    <span className="chip fp-restore" title="It finishes no achievement: it brings factions back to 0 or above">
                      restore
                    </span>
                  )}
                  {st.reaches.length > 0 && !st.finishes.length && (
                    <span className="chip fp-restore" title="It finishes no achievement itself: it raises a faction to where a quicker quest's NPC takes it">
                      opens a way
                    </span>
                  )}
                  {isNow && (
                    <span className="chip fp-now-chip" title="The step you are on: the achievements overlay follows it">
                      now
                    </span>
                  )}
                  <Doing a={a} />
                  <Flags a={a} />
                  <span className="spacer" />
                  <span className="mono" title={`${st.units.toLocaleString()} ${a.kind === 'kill' ? 'kills' : 'hand-ins'}`}>
                    ×{st.units.toLocaleString()}
                  </span>
                  <span className="mono fp-time" title={timeNote(st)}>
                    {duration(st.seconds)}
                  </span>
                </div>
                {hint(st)}
                {a.kind === 'quest' && a.line && <div className="faint small">“{a.line}”</div>}
                {a.items && a.items.length > 0 && (
                  <div className="small">
                    <ItemsLine items={a.items} units={st.units} back={a.back} />
                    {st.copper > 0 && <span className="faint"> · about {fmtCoin(Math.round(st.copper))} to buy</span>}
                  </div>
                )}
                {a.kind === 'kill' && a.mobs && a.mobs.length > 2 && <div className="faint small fp-mobs">{a.mobs.join(', ')}</div>}
                <div className="row tight fp-effects">
                  <Effects step={st} />
                  <span className="spacer" />
                  <span className="faint small">{sourceNote(a)}</span>
                  {!isNow && (
                    <button
                      className="btn small ghost"
                      onClick={() => onWork(i)}
                      title="Follow this step now, on the Now card and the overlay, until your kills or hand-ins go toward another"
                    >
                      Work on this
                    </button>
                  )}
                  {lockable.length > 0 && (
                    <button className="btn small ghost" onClick={() => onLock(lockable, a.id)} title={`Keep this for ${lockable.join(', ')}: the plan is built around it`}>
                      Lock in
                    </button>
                  )}
                  {st.locked.length === 0 && (
                    <button className="btn small ghost" onClick={() => onExclude(a.id, true)} title="Leave this out of the plan">
                      Rule out
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const SHOWN = 8

function Options({
  faction,
  options,
  choices,
  swaps,
  onLock,
  onExclude,
  onPace
}: {
  faction: string
  options: PlanOption[]
  choices: PlanChoices
  /** Whether the plan swaps race for a quest another race opens. */
  swaps: boolean
  onLock: (factions: string[], id: string | null) => void
  onExclude: (id: string, out: boolean) => void
  onPace: (id: string, perHour: number | undefined) => void
}) {
  const [all, setAll] = useState(false)
  if (!options.length)
    return (
      <div className="faint small" style={{ padding: '6px 4px' }}>
        Neither your log nor eqlwiki knows anything that raises {faction}.{' '}
        <a href={wikiUrl(faction)} target="_blank" rel="noreferrer">
          eqlwiki
        </a>
      </div>
    )
  const shown = all ? options : options.slice(0, SHOWN)
  return (
    <div className="stack gap-6 fp-options">
      {shown.map((o) => {
        const a = o.activity
        const locked = choices.locks[faction] === a.id
        const out = choices.excluded.includes(a.id)
        const usable = plannable(a, choices, swaps)
        const h = a.hits[faction]
        return (
          <div key={a.id} className={`fp-opt${locked ? ' locked' : ''}${usable ? '' : ' unusable'}`}>
            <div className="row tight">
              <span className={`chip fp-kind ${a.kind}`}>{KIND_LABEL[a.kind]}</span>
              <Doing a={a} />
              <span className="faint small">{a.zone}</span>
              {o.chosen && <span className="chip ok">in the plan</span>}
              {!o.chosen && o.used && <span className="chip">in the plan for others</span>}
              {a.once && !locked && (
                <span className="chip warn" title={`Taken to be once only: ${a.once}. Lock it in if you know it repeats.`}>
                  one-time?
                </span>
              )}
              <Flags a={a} />
              <span className="spacer" />
              <span
                className="mono small"
                title={a.guessed?.includes(faction) ? 'Amount guessed: the usual one in your log, or a typical Legends amount when it has too few' : undefined}
              >
                {signed(h)}
                {a.guessed?.includes(faction) ? '?' : ''} each
              </span>
              <span className="mono small">
                ×{o.units.toLocaleString()} ≈ {duration(o.seconds)}
              </span>
            </div>
            {a.items && a.items.length > 0 && (
              <div className="small">
                <ItemsLine items={a.items} units={o.units} back={a.back} />
              </div>
            )}
            {a.line && a.kind === 'quest' && <div className="faint small">“{a.line}”</div>}
            <div className="row tight">
              <span className="faint small">
                {sourceNote(a)}; {o.rateFrom === 'yours' ? 'your pace' : o.rateFrom === 'log' ? 'the pace from your log' : 'an estimated pace'}, {duration(o.unitSeconds)} a{' '}
                {a.kind === 'kill' ? 'kill' : 'hand-in'}
                {a.once ? `; once only? ${a.once}` : ''}
                {a.blocked ? `; ${a.blocked}` : ''}
                {a.note ? `; ${a.note}` : ''}
              </span>
              {o.lowersOpen.length > 0 && <span className="warn-text small">lowers {o.lowersOpen.join(', ')}</span>}
              <span className="spacer" />
              <label className="row tight small faint" title={`Your own ${a.kind === 'kill' ? 'kills' : 'hand-ins'} an hour, when you know better than the estimate`}>
                per hour
                <NumberInput value={choices.perHour[a.id]} placeholder={String(Math.round(3600 / o.unitSeconds))} min={0} width={70} onChange={(v) => onPace(a.id, v)} />
              </label>
              {locked ? (
                <button className="btn small on" onClick={() => onLock([faction], null)} title="Let the plan choose again">
                  Locked in ✕
                </button>
              ) : (
                <button className="btn small ghost" onClick={() => onLock([faction], a.id)} title={`Finish ${faction} with this, and build the plan around it`}>
                  Lock in
                </button>
              )}
              {!locked && (
                <button className="btn small ghost" onClick={() => onExclude(a.id, !out)} title={out ? 'Let the plan use it again' : 'Leave it out of the plan'}>
                  {out ? 'Allow' : 'Rule out'}
                </button>
              )}
            </div>
          </div>
        )
      })}
      {options.length > SHOWN && (
        <button className="link-button small" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${options.length}`}
        </button>
      )}
    </div>
  )
}

const UNIT_WORDS: Record<PlanActivity['kind'], [string, string]> = { kill: ['kill', 'kills'], turnin: ['hand-in', 'hand-ins'], quest: ['hand-in', 'hand-ins'] }

/**
 * Where the character being played is in this plan, as the achievements overlay follows it: the step
 * it is on, counting down as the factions move, and the next. With the switches for the overlay and
 * its cues. For a character not being played it says what it will do.
 */
/** "Human", "Human or Erudite", "Human, Erudite or Gnome". */
const listed = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`)

/** "a Wood Elf", "an Iksar". */
const withArticle = (w: string) => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`

/** What a step's time holds besides the kills or hand-ins. */
function timeNote(st: PlanStep): string | undefined {
  const parts = [st.travel ? `${duration(st.travel)} to get there` : '', st.swap ? `${duration(st.swap)} to swap race and back` : ''].filter(Boolean)
  return parts.length ? `Including ${parts.join(' and ')}` : undefined
}

/** How the race unlocks still to do fare in the plan: all done by some step, or how many it does not get to. */
function unlocksNote(open: RaceUnlock[], at: Map<string, number>): string {
  const planned = open.filter((u) => at.has(u.achievement))
  const left = open.length - planned.length
  if (!planned.length) return 'not planned'
  const last = Math.max(...planned.map((u) => at.get(u.achievement) ?? 0))
  return `${left ? planned.length : 'all'} done by step ${last}${left ? `; ${left} not planned` : ''}`
}

/** What a race unlock wants: its factions, each done or where it stands; another race's unlock; or a task. */
function UnlockParts({ u, standings }: { u: RaceUnlock; standings: Record<string, number> }) {
  if (u.other) return <span className="faint">{u.other}</span>
  if (u.withRaces) return <span className="faint">Comes with {listed(u.withRaces.map((r) => `${r}’s`))} unlock</span>
  return (
    <>
      {u.factions.map((f, i) => (
        <Fragment key={f.faction}>
          {i > 0 && ' · '}
          {f.faction}{' '}
          {f.done ? (
            <span className="ok-text" title="Done for it">
              ✓
            </span>
          ) : (
            <span className="mono faint">{signedPlain(Math.round(standings[f.faction] ?? 0))}</span>
          )}
        </Fragment>
      ))}
    </>
  )
}

/** What the plan takes from its catalog besides the ways: the race unlocks still to do, and what each race adds to the cons. */
function planExtras(data: FactionPlanData | null): Pick<PlanInput, 'races'> & { unlocks: NonNullable<PlanInput['unlocks']> } {
  if (!data) return { unlocks: [] }
  return {
    unlocks: unlockGoals(data.unlocks ?? []),
    ...(data.raceMods ? { races: { own: data.raceMods.own, unlocked: data.races, mods: data.raceMods.mods } } : {})
  }
}

/** What the race swaps do against the same plan without them: achievements only they open, or the time they save. */
function savedBySwaps(plan: FactionPlan, without: { seconds: number; unplanned: number }): string {
  const opened = without.unplanned - plan.unplanned.length
  if (opened > 0) return `open ${opened} achievement${opened === 1 ? '' : 's'} nothing else plans`
  const saved = without.seconds - plan.seconds
  // One locked in can cost time.
  return saved >= 60 ? `save ≈ ${duration(saved)}` : saved <= -60 ? `cost ≈ ${duration(-saved)} more` : 'no time saved'
}

/**
 * Under a step done as another race: the race to swap to in Loadouts (or stay, swapped to for the step
 * before), and why the character's own will not do there. `unlockedAt` is the step that unlocks the race,
 * when the plan does.
 */
function SwapHint({ step, own, unlocksKnown, unlockedAt }: { step: PlanStep; own: string; unlocksKnown: boolean; unlockedAt?: number }) {
  const race = step.race ?? ''
  const as = withArticle(own || 'your race')
  const why = step.why
    ? `as ${as} you would con ${standingWord(step.why.con)} (${plain(step.why.con)}) with ${step.why.faction} by then, and ${step.activity.npc ?? 'its NPC'} wants ${step.why.band}`
    : step.activity.blocked
      ? `as ${as}, it ${step.activity.blocked}`
      : ''
  const unlocked = unlockedAt ? `; the plan unlocks ${race} at step ${unlockedAt}` : unlocksKnown ? '' : '; if you have it unlocked'
  return (
    <div className="small fp-swap">
      <span className="chip warn">race swap</span>{' '}
      {step.swap > 0 ? (
        <>
          Swap to <b>{race}</b> in Loadouts for this step, then back (≈ {duration(step.swap)} in all{unlocked})
        </>
      ) : (
        <>
          Still <b>{withArticle(race)}</b>, as for the step before{unlocked}
        </>
      )}
      {why ? `: ${why}.` : '.'}
    </div>
  )
}

function NowCard({
  character,
  track,
  hint,
  overlayShown,
  cues,
  onOverlay,
  onCues,
  onFirst
}: {
  character: string
  track: FactionTrackView | null
  /** Anything to do first for the step, such as a race swap. */
  hint?: ReactNode
  overlayShown: boolean
  cues: boolean
  onOverlay: (on: boolean) => void
  onCues: (on: boolean) => void
  /** Makes the plan's first step the one followed. */
  onFirst: () => void
}) {
  const step = track?.current ?? null
  return (
    <div className={`card mb-16 fp-now${step ? ' live' : ''}`}>
      <div className="row">
        <h2 className="m-0">
          {step ? 'Now' : track ? 'Every step is done' : 'In game'}
          {step && track && (
            <span className="faint small">
              {' '}
              step {step.index + 1} of {track.steps}
              {track.done ? `, ${track.done} done` : ''}
            </span>
          )}
        </h2>
        {step && step.index > 0 && (
          <button
            className="btn small ghost"
            onClick={onFirst}
            title="Follow the plan's first step again, on this card and the overlay, until your kills or hand-ins go toward another (or pick any step with Work on this)"
          >
            Back to step 1
          </button>
        )}
        <span className="spacer" />
        <label className="row tight small" title="The achievements overlay: this step and your Slayer counts, over the game">
          <Switch on={overlayShown} onChange={onOverlay} label="Show the achievements overlay" /> Show on the game
        </label>
        <label className="row tight small" title="Said aloud when a step is done, with the next; each achievement it finishes flashes on the alerts overlay">
          <Switch on={cues} onChange={onCues} label="Say when a step is done" /> Say when a step is done
        </label>
      </div>
      {step && track ? (
        <div className="stack gap-6 mt-10">
          <div className="fp-head">
            <span className="fp-zone">{step.zone || 'Somewhere'}</span>
            <span className={`chip fp-kind ${step.kind}`}>{KIND_LABEL[step.kind]}</span>
            <b>{step.kind === 'turnin' ? (step.npc ?? step.title) : step.title}</b>
            <span className="spacer" />
            <span className="mono">
              {step.unitsLeft.toLocaleString()} {UNIT_WORDS[step.kind][step.unitsLeft === 1 ? 0 : 1]} left
            </span>
            <span className="mono fp-time">{duration(step.secondsLeft)}</span>
          </div>
          {hint}
          <div className="fp-now-bar" title={`${Math.round(step.progress * 100)}% of the way since you started this step`}>
            <i style={{ width: `${Math.round(step.progress * 100)}%` }} />
          </div>
          <div className="row tight fp-effects">
            {step.goals.map((g) => (
              <span
                key={g.faction}
                className={`chip ${g.done ? 'ok' : ''}`.trim()}
                title={g.to === STANDING_MAX ? 'An achievement, done at 2000' : g.to === 0 ? 'Brought back to 0 or above' : 'Raised to where a later step’s NPC takes it'}
              >
                {g.achievement ?? g.faction} {signedPlain(Math.round(g.standing))} / {g.to.toLocaleString()}
              </span>
            ))}
            <span className="spacer" />
            {track.next && (
              <span className="faint small">
                Next, step {track.next.index + 1}: {track.next.kind === 'turnin' ? (track.next.npc ?? track.next.title) : track.next.title}
                {track.next.zone ? ` · ${track.next.zone}` : ''}
              </span>
            )}
          </div>
          <span className="faint small">About {duration(track.secondsLeft)} of steps left, as planned.</span>
        </div>
      ) : !track ? (
        <p className="faint small mb-0 mt-10">
          Play {who(character)} and this follows the plan as your factions move: the step you are on (the one your kills and hand-ins go the way of, or the first left in your
          zone), what it still wants, and the next. The achievements overlay shows the same over the game, with your Slayer counts.
        </p>
      ) : null}
    </div>
  )
}
