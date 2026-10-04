import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ago, api } from '../../renderer/src/api'
import { showError } from '../../renderer/src/toast'
import { useAchievementTrack, useInvoke, useLatest, useSameContents, useVisibleInterval } from '../../renderer/src/hooks'
import { useActions, useSettled } from '../../renderer/src/state'
import { useCharacterRecord } from '../../renderer/src/character'
import { useNow } from '../../renderer/src/components/TimerBars'
import { ConfirmButton, Disclosure, GameCommand, Info, Pending, Segmented, Switch, Tip } from '../../renderer/src/components/ui'
import { duration, who, wikiUrl } from '../../core/format'
import { STANDING_MAX, standingBand, type FactionView } from './core'
import { runPlan } from './planRunner'
import { deityName } from '../../shared/game/deities'
import { playableRace } from '../../shared/game/races'
import type { PlanChoices, PlanGoal, PlanSettings } from '../../shared/settings'
import { classSwapOf, raceOfSwap } from './names'
import { DEFAULT_SETTINGS, NO_CHOICES } from './ways'
import type { FactionPlan, PlanInput, PlanShape, PlanStep, Unplanned } from './planTypes'
import { planFor, type FactionPlanData, type PlanFor } from './planner'
import { unlockGoals, type RaceUnlock } from './unlocks'
import { followedPlan } from './tracker'
import { Assumptions } from './plan/Assumptions'
import { NowCard } from './plan/NowCard'
import { Options } from './plan/Options'
import { Doing, listed, plain, signedPlain, theirLogs, TYPING_SAVE_MS } from './plan/parts'
import { Steps } from './plan/Steps'

// The Factions page's Plan tab: the quickest known way to finish every faction achievement still to
// do, step by step, and every way there is to raise each one, to lock one in (the plan is then built
// around it) or rule one out. The plan itself is worked out here (planner.ts) from what the main
// process gathers, so a change of choices or assumptions shows at once. The tab's parts are in plan/:
// the Now card, the steps, each achievement's ways, the assumptions, and what they share (parts.tsx).
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
      takes the stack at once, so what counts is getting the items: bought is quick, and so is a craft whose materials merchants sell (Tumpy Tonic); gathered takes the time you
      set, Bone Chips about 5 seconds; and what you hold is free.
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
    <div>
      <b>What a lost point costs</b> is what winning it back takes. A faction a hand-in of bought items raises (Red Wine, Bone Chips, Bat Wings, a stack at a time) comes back in
      moments, so the plan would rather sink that one than one only a slow camp raises, and brings it back with a quick step at the end; points off a maxed faction weigh the same
      way, lightly.
    </div>
  </>
)

/** The con's word for a standing with the modifiers added: "Indifferent", "Amiable". */
const standingWord = (con: number) => standingBand(con).word

/** The plan's assumptions the player changed, kept in settings.json for every character. */
function useAssumptions(): [Partial<PlanSettings>, (next: Partial<PlanSettings>, debounceMs?: number) => void] {
  const { patchSettings } = useActions()
  const factionPlan = useSettled((s) => s.settings.factionPlan)
  const stored = useSameContents(factionPlan.assumptions)
  const set = useCallback(
    (next: Partial<PlanSettings>, debounceMs?: number) => void patchSettings((s) => ({ ...s, factionPlan: { ...s.factionPlan, assumptions: next } }), { debounceMs }),
    [patchSettings]
  )
  return [stored, set]
}

/** The plan's assumptions as the Plan tab has them, for a page that only reads them. */
export function usePlanSettings(logPace: number | null): PlanSettings {
  const [stored] = useAssumptions()
  return useMemo(() => ({ ...DEFAULT_SETTINGS, killsPerHour: logPace ?? DEFAULT_SETTINGS.killsPerHour, ...stored }), [stored, logPace])
}

/** A character's locks, rule-outs and paces on the Plan tab, kept in settings.json. A number being typed saves once the typing stops. */
export function useChoices(character: string): [PlanChoices, (c: PlanChoices, debounceMs?: number) => void] {
  const { patchSettings } = useActions()
  const factionPlan = useSettled((s) => s.settings.factionPlan)
  const kept = factionPlan.choices
  const choices = useSameContents(Object.hasOwn(kept, character) ? kept[character] : NO_CHOICES)
  const set = useCallback(
    (c: PlanChoices, debounceMs?: number) =>
      void patchSettings(
        (s) => {
          const others = Object.fromEntries(Object.entries(s.factionPlan.choices).filter(([k]) => k !== character))
          const none = !Object.keys(c.locks).length && !c.excluded.length && !Object.keys(c.perHour).length
          return { ...s, factionPlan: { ...s.factionPlan, choices: none ? others : { ...others, [character]: c } } }
        },
        { debounceMs }
      ),
    [character, patchSettings]
  )
  return [choices, set]
}

/** Web notices put away this session, by what they said: the same failure stays away, a new one shows. */
const dismissedNotices = new Set<string>()

export function PlanTab({ character, view }: { character: string; view: FactionView | null }) {
  const { patchSettings } = useActions()
  const achievementCues = useSettled((s) => s.settings.achievementCues)
  const [stored, setSettings] = useAssumptions()
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
  const [, setDismissed] = useState(0)
  const dismissNotice = (key: string) => {
    dismissedNotices.add(key)
    setDismissed((n) => n + 1)
  }
  const [choices, setChoices] = useChoices(character)
  const [open, setOpen] = useState<string | null>(null)
  // The plan counts everyone as Agnostic; the character's own deity says whether it has a step to take first.
  const record = useCharacterRecord(character).record
  const deity = deityName(record?.deity ?? '')
  const ownRace = playableRace(record?.race ?? '')

  // New kills and hand-ins show up as the log grows; the catalog comes from caches after the first read.
  const reload = q.reload
  useVisibleInterval(reload, 60_000)
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
  // what its NPC wants; without the races' modifiers, the quests open now are what it goes by. Every race and pair counts: a
  // pair newly in the catalog (one that opens a quest now) can make an earlier step's kills to open that quest needless.
  const cons = data?.raceMods
    ? `${data.raceMods.own}|${(data.races ?? ['every race']).join(',')}|${JSON.stringify(data.raceMods.mods)}`
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

  // Race swaps: what they save against the same plan without them, worked out once asked for: a
  // second run of the planner at every change of the plan is a third of a second each (LT-425).
  const swapSteps = plan ? plan.steps.filter((st) => st.race).length : 0
  const [askSaves, setAskSaves] = useState(false)
  const swapKey = swapSteps && askSaves ? structure : ''
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
    st.race ? <SwapHint step={st} own={ownRace} unlocksKnown={!!data && data.races !== null} unlockedAt={unlockedAt.get(raceOfSwap(st.race))} /> : null
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
    setChoices({ ...choices, perHour: next }, TYPING_SAVE_MS)
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
      {/* What is missing, in one notice rather than one each above the plan for weeks (LT-455). */}
      {(!(view?.export ?? data.export) || !achievementsExport) && (
        <div className="notice mb-16">
          {!(view?.export ?? data.export) && !achievementsExport ? (
            <>
              No factions or achievements export for {who(character)} yet: every standing counts from 0, and an achievement counts as done only while its standing is at 2000. Type{' '}
              <GameCommand cmd="/outputfile faction" /> and <GameCommand cmd="/outputfile achievements" /> in game for a plan from where you really stand.
            </>
          ) : !(view?.export ?? data.export) ? (
            <>
              No factions export for {who(character)} yet, so every standing counts from 0. Type <GameCommand cmd="/outputfile faction" /> in game for a plan from where you really
              stand.
            </>
          ) : (
            <>
              No achievements export for {who(character)} yet, so an achievement counts as done only while its standing is at 2000. Type{' '}
              <GameCommand cmd="/outputfile achievements" /> in game to plan only what is really left.
            </>
          )}
        </div>
      )}
      {/* The web being out of reach is a passing state, not a fault: amber, and put away for the session (LT-455). */}
      {data.wiki.error && !dismissedNotices.has(`wiki:${data.wiki.error}`) && (
        <div className="notice warn row mb-16">
          <span className="grow">
            Could not read eqlwiki again ({data.wiki.error}); the pages read {ago(data.wiki.fetchedAt, now)} serve meanwhile.
          </span>
          <button className="btn small ghost" onClick={() => dismissNotice(`wiki:${data.wiki.error}`)}>
            Hide
          </button>
        </div>
      )}
      {data.alla.error && !dismissedNotices.has(`alla:${data.alla.error}`) && (
        <div className="notice warn row mb-16">
          <span className="grow">Could not read Allakhazam ({data.alla.error}); it is tried again in ten minutes, and the plan goes on without the pages not yet read.</span>
          <button className="btn small ghost" onClick={() => dismissNotice(`alla:${data.alla.error}`)}>
            Hide
          </button>
        </div>
      )}

      <NowCard
        character={character}
        track={tracked}
        hint={nowStep ? swapHint(nowStep) : null}
        cues={achievementCues}
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
            <span className="sub">{plan?.unplanned.length ? unplannedSummary(plan) : 'every one has a way'}</span>
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
            <div
              className="stat"
              title="Steps done as another race, or with another class in the trio, swapped to in Loadouts and back: a quest your own con keeps closed and theirs opens"
            >
              <span className="label">Loadout swaps</span>
              <span className="value">{swapSteps}</span>
              <span className="sub">
                {swapSaves ??
                  (askSaves ? (
                    'working out what they save…'
                  ) : (
                    <button className="link-button inline" onClick={() => setAskSaves(true)}>
                      What do they save?
                    </button>
                  ))}
              </span>
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
              <ConfirmButton
                className="btn small ghost"
                question={`Clear all ${chose} of your locks, rule-outs and paces?`}
                title="Clear every lock, rule-out and pace you set"
                onConfirm={() => setChoices(NO_CHOICES)}
              >
                Clear my choices ({chose})
              </ConfirmButton>
            )}
            <button className="btn small ghost" disabled={reading} onClick={() => void readAgain()} title="Read eqlwiki's faction and quest pages again (they are kept a week)">
              {reading ? 'Reading eqlwiki…' : 'Read eqlwiki again'}
            </button>
          </div>
        </div>
        <div className="faint small mt-10">
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
        </div>
        <LeftOut left={data.catalog.leftOut ?? []} />
        <Assumptions settings={settings} stored={stored} logPace={logPace} onChange={setSettings} />
        <Unmatched unmatched={data.wiki.unmatched} character={character} />
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
                          <Disclosure open={isOpen} onToggle={toggle} stop>
                            {t.achievement}
                          </Disclosure>
                          {t.achievement !== t.faction && <span className="faint small"> ({t.faction})</span>}
                          {lockedTo && (
                            <span
                              className="chip fp-lock"
                              title={
                                step && plan!.steps[step - 1].onTheWay[t.faction]
                                  ? `Locked in: ${lockedTo.title}, but step ${step} gets it to 2000 first`
                                  : `Locked in: ${lockedTo.title}`
                              }
                            >
                              {step && plan!.steps[step - 1].onTheWay[t.faction] ? 'locked · done on the way' : 'locked'}
                            </span>
                          )}
                        </td>
                        <td className="num mono">{plain(Math.round(t.standing))}</td>
                        <td className="num mono">{done ? '—' : Math.round(STANDING_MAX - t.standing).toLocaleString()}</td>
                        <td>
                          {done ? (
                            <Tip className="chip ok" text="At 2000 now: the achievement shows done at your next achievements export">
                              at 2000
                            </Tip>
                          ) : step ? (
                            <span>
                              <span className="fp-num-inline">{step}</span> <Doing a={plan!.steps[step - 1].activity} />
                            </span>
                          ) : (
                            <Tip className="chip warn" text={`${UNPLANNED[plan?.unplannedWhy[t.faction] ?? 'nothing known']}: open it for what there is`}>
                              not planned{plan?.unplannedWhy[t.faction] ? ` · ${plan.unplannedWhy[t.faction]}` : ''}
                            </Tip>
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

/**
 * The names eqlwiki and the character's factions do not share: a faction here has nothing from the
 * wiki in the plan, and a page here is not planned for. Mostly factions not met yet, sometimes one
 * thing named two ways.
 */
function Unmatched({ unmatched, character }: { unmatched: FactionPlanData['wiki']['unmatched']; character: string }) {
  if (!unmatched.pages.length && !unmatched.factions.length) return null
  return (
    <details className="fp-assume">
      <summary>Names the wiki does not match</summary>
      <p className="faint small">
        The plan joins a faction to its eqlwiki page by name. Where a faction and a page below are one thing named two ways, the plan misses what the page says: that pair is worth
        reporting.
      </p>
      {unmatched.factions.length > 0 && (
        <p className="small">
          <strong>
            {unmatched.factions.length} of {who(character)}&apos;s factions with no wiki page:
          </strong>{' '}
          {unmatched.factions.join(', ')}
        </p>
      )}
      {unmatched.pages.length > 0 && (
        <p className="small mb-0">
          <strong>{unmatched.pages.length} wiki pages that match none of them</strong> <span className="faint">(mostly factions not met yet)</span>: {unmatched.pages.join(', ')}
        </p>
      )}
    </details>
  )
}

/**
 * The named mobs no camp holds, by what eqlwiki says of them: not in Legends at all (Allakhazam lists
 * live EverQuest's), or far too tough to farm (Legends' unkillable guildmasters).
 */
function LeftOut({ left }: { left: NonNullable<FactionPlanData['catalog']['leftOut']> }) {
  if (!left.length) return null
  const tough = left.filter((l) => l.why === 'tough')
  const missing = left.filter((l) => l.why === 'missing')
  return (
    <details className="fp-assume">
      <summary>Mobs left out of the kill camps ({left.length})</summary>
      <p className="faint small">
        Allakhazam lists the NPCs of live EverQuest, and eqlwiki has a page for each named one Legends has. A named mob with no eqlwiki page is taken not to be in Legends, and one
        with more health than any raid boss of the era is no camp.
      </p>
      {tough.length > 0 && (
        <p className="small">
          <strong>Too tough to farm:</strong> {tough.map((l) => `${l.name} (${l.zone}, ${(l.hp ?? 0).toLocaleString()} HP)`).join(', ')}
        </p>
      )}
      {missing.length > 0 && (
        <p className="small mb-0">
          <strong>Not in Legends (no eqlwiki page):</strong> {missing.map((l) => `${l.name} (${l.zone})`).join(', ')}
        </p>
      )}
    </details>
  )
}

/** "a Wood Elf", "an Iksar". */
const withArticle = (w: string) => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`

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

/** Why the plan leaves an achievement undone, said in full. */
const UNPLANNED: Record<Unplanned, string> = {
  'nothing known': 'Nothing known raises it: no kill or hand-in in your log, eqlwiki or Allakhazam',
  'once only': 'Only quests done once raise it: lock one in to plan it',
  'ruled out': 'Every way that raises it is ruled out, or done once: allow one again, or lock one in',
  gated: 'Every way that raises it has an NPC wanting a con the plan cannot get you to, as your race or one you can swap to: lock one in to plan it anyway',
  'not reached': 'The ways the plan may use do not get it to 2000'
}

/** The reasons the plan leaves achievements undone, counted: "2 gated, 1 nothing known". */
function unplannedSummary(plan: FactionPlan): string {
  const n = new Map<Unplanned, number>()
  for (const f of plan.unplanned) {
    const why = plan.unplannedWhy[f] ?? 'nothing known'
    n.set(why, (n.get(why) ?? 0) + 1)
  }
  return [...n].map(([why, count]) => `${count} ${why}`).join(', ')
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
  const cls = classSwapOf(step.race ?? '')
  // A class swap keeps the race, or comes with a race swap ("Dwarf + Rogue").
  const race = raceOfSwap(step.race ?? '')
  const both = !!cls && race !== own
  const as = cls && !both ? 'with your classes' : `as ${withArticle(own || 'your race')}${both ? ' with your classes' : ''}`
  const why = step.why
    ? `${as} you would con ${standingWord(step.why.con)} (${plain(step.why.con)}) with ${step.why.faction} by then, and ${step.activity.npc ?? 'its NPC'} wants ${step.why.band}`
    : step.activity.blocked
      ? `${as}, it ${step.activity.blocked}`
      : ''
  const unlocked = cls && !both ? '' : unlockedAt ? `; the plan unlocks ${race} at step ${unlockedAt}` : unlocksKnown ? '' : '; if you have it unlocked'
  return (
    <div className="small fp-swap">
      <span className="chip warn">{both ? 'race and class swap' : cls ? 'class swap' : 'race swap'}</span>{' '}
      {both ? (
        step.swap > 0 ? (
          <>
            Swap to <b>{race}</b> and put <b>{cls}</b> in your classes in Loadouts for this step, then back (≈ {duration(step.swap)} in all{unlocked})
          </>
        ) : (
          <>
            Still {withArticle(race)} with <b>{cls}</b> in your classes, as for the step before{unlocked}
          </>
        )
      ) : cls ? (
        step.swap > 0 ? (
          <>
            Put <b>{cls}</b> in your classes in Loadouts for this step, in place of one {step.activity.npc ?? 'its NPC'} likes no better, then back (≈ {duration(step.swap)} in all)
          </>
        ) : (
          <>
            Still with <b>{cls}</b> in your classes, as for the step before
          </>
        )
      ) : step.swap > 0 ? (
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
