import { Fragment, useMemo, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { CharacterPicker } from '../../renderer/src/components/CharacterPicker'
import { api } from '../../renderer/src/api'
import { useInvoke, useVisibleInterval } from '../../renderer/src/hooks'
import { Ago, ConfirmButton, Info, Pending, SettingsLink, Tabs, Tip } from '../../renderer/src/components/ui'
import { useRemembered } from '../../renderer/src/remember'
import { showToast } from '../../renderer/src/toast'
import { useCharacterChoice } from '../../renderer/src/character'
import { day, num, who } from '../../core/format'
import { LEVEL_CAP } from '../../shared/game/levels'
import type { ClassId } from '../../shared/game/classes'
import {
  COMPLETIONIST,
  REINC_CLASSES,
  REINC_KEYS,
  REINC_RACES,
  REINC_RANKS,
  XP_PENALTY_LEVELS,
  XP_PENALTY_PER_RANK,
  classKey,
  makePlan,
  raceKey,
  reincarnationsLeft,
  reincClass,
  trioNotes,
  xpPenalty,
  type ClassLevel,
  type LevelRun,
  type LineRank,
  type PlanStage,
  type PlannedReinc,
  type PriorityEntry,
  type ReincClass,
  type ReincKey,
  type ReincState
} from './core'

// Goals › Reincarnation (an optional module, Settings › Modules): Progress, a bar of three ranks for
// every class and race AA, read from the log or set by hand; Setup, the player's priority list and
// levelling choices; Planner, the plan made from them: the reincarnations the list asks for, and before
// each the trios to level as, chosen for the least XP penalty (core.ts's makePlan).

type View = 'progress' | 'setup' | 'plan'

const HOW = (
  <>
    <div>
      <b>Reincarnating</b> takes a Token of Reincarnation and a three-class loadout at level {LEVEL_CAP}. It sets the race and the three classes back to level 1 and gives a rank in
      each one’s Reincarnation AA. Each AA has three ranks; a class’s third adds an activated ability (they all share one timer). Completionist goes up a rank each time every class
      AA reaches the next one. The first reincarnation also turns the hard caps on the seven stats into soft caps (the 2026-11-10 patch notes, and the game’s own window).
    </div>
    <div>
      <b>Ranks</b> are read from your log as the game writes them (“You have gained the ability …”, “You have improved …”), the same lines Stats › AAs reads. Click a bar’s parts to
      set a rank by hand; a rank the log sees later wins over yours.
    </div>
    <div>
      <b>What each AA does</b> is the game’s text at rank 1, shortened. The patch notes say ranks 2 and 3 are stronger but not by how much. Stances are eqlwiki’s Stances &amp;
      Invocations table; a class’s mana stat is the Stats page’s rule (WIS for priests, Paladin, Ranger and Beastlord; INT for the other classes with mana).
    </div>
    <div>
      <b>The plan</b> is made from your class and race lists (on Setup) each time the page draws, so a reincarnation your log shows (or you say you made) moves it on by itself.
      Levelling trios keep the class you choose, take the classes the next reincarnation needs at level {LEVEL_CAP}, and fill the places left without raising the XP penalty:
      evasive stance first, defensive when no evasive class fits, then the reincarnated classes below {LEVEL_CAP} with the most ranks. Which classes are at {LEVEL_CAP} comes from
      /who while you play them and from what you say: the log’s level lines do not name the class.
    </div>
    <div>
      <b>The XP penalty</b>: levels 1–{XP_PENALTY_LEVELS} take {XP_PENALTY_PER_RANK}% more experience for each Reincarnation rank, only while you play the classes and race that
      hold it. Measured from a log, the same mob at the same level kill for kill: a trio and race’s first reincarnation cost {XP_PENALTY_PER_RANK}% and the second{' '}
      {2 * XP_PENALTY_PER_RANK}%, not four times that, so the four ranks do not add up. This page counts the highest rank among the classes and race you play. A loadout whose ranks
      differ would show whether the game takes the highest or an average.
    </div>
  </>
)

/** A loadout or plan's XP penalty as a chip, with what it means. */
function PenaltyTag({ pct, raceOpen }: { pct: number; raceOpen?: boolean }) {
  const text = pct
    ? `Levels 1–${XP_PENALTY_LEVELS} take ${pct}% more experience: the highest Reincarnation rank among these classes and race, ${XP_PENALTY_PER_RANK}% a rank.${raceOpen ? ' The race is not chosen yet, so it could be more.' : ''}`
    : `No Reincarnation ranks among these${raceOpen ? ' classes yet (the race is not chosen)' : ' classes and race'}, so no XP penalty.`
  return (
    <Tip className={`chip pill rc-tag ${pct ? 'xp' : 'none'}`} text={text}>
      {pct ? `XP ${raceOpen ? '≥ ' : ''}+${pct}%` : raceOpen ? 'No class XP penalty' : 'No XP penalty'}
    </Tip>
  )
}

const STANCE_TIP = {
  evasive: 'Evasive stance: a 95% chance to evade attacks, paid for in endurance.',
  defensive: 'Defensive stance: half the melee damage and a fifth less spell damage, paid for in endurance.'
} as const

/** A class's notes as chips: its stances and its mana stat. */
function ClassTags({ c }: { c: ReincClass }) {
  return (
    <span className="rc-tags">
      {c.stances.map((s) => (
        <Tip key={s} className={`chip pill rc-tag ${s}`} text={STANCE_TIP[s]}>
          {s === 'evasive' ? 'Evasive' : 'Defensive'}
        </Tip>
      ))}
      {c.mana && (
        <Tip className={`chip pill rc-tag ${c.mana.toLowerCase()}`} text={`Its mana comes from ${c.mana === 'WIS' ? 'wisdom' : 'intelligence'}.`}>
          {c.mana}
        </Tip>
      )}
    </span>
  )
}

/** Three parts: done, planned, still open. Clicking part n sets the rank to n (or n − 1 when it already is n). */
function RankBar({ name, rank, planned, onRank }: { name: string; rank: LineRank; planned: number; onRank: (rank: number | null) => void }) {
  const parts = Array.from({ length: REINC_RANKS }, (_, i) => (i < rank.rank ? 'done' : i < rank.rank + planned ? 'planned' : 'open'))
  return (
    <span className="rc-bar" role="group" aria-label={`${name}: rank ${rank.rank} of ${REINC_RANKS}`}>
      {parts.map((p, i) => {
        const n = i + 1
        const next = rank.rank === n ? n - 1 : n
        return (
          <button
            key={i}
            className={`rc-part ${p}`}
            onClick={() => onRank(next)}
            aria-label={`Set ${name} to rank ${next}`}
            title={`Rank ${n}: ${p === 'done' ? 'done' : p === 'planned' ? 'planned' : 'not yet'}. Click to set rank ${next} by hand.`}
          />
        )
      })}
    </span>
  )
}

/** Where a rank comes from, when it is not plain: set by hand over the log's, with a way back. */
function RankFrom({ rank, onRank }: { rank: LineRank; onRank: (rank: number | null) => void }) {
  if (rank.from !== 'hand') return <span />
  return (
    <button className="link-button small faint" onClick={() => onRank(null)} title={`Set by hand. Your log says rank ${rank.logged}: click to go back to it.`}>
      by hand ↺
    </button>
  )
}

/** How many of the plan's reincarnations take each line. */
function plannedCounts(stages: readonly PlanStage[]): Partial<Record<ReincKey, number>> {
  const out: Partial<Record<ReincKey, number>> = {}
  for (const { reinc: p } of stages) {
    if (!p) continue
    for (const c of p.classes) out[classKey(c)] = (out[classKey(c)] ?? 0) + 1
    if (p.race) out[raceKey(p.race)] = (out[raceKey(p.race)] ?? 0) + 1
  }
  return out
}

const NO_RANK: LineRank = { rank: 0, from: 'none', logged: 0 }

function Progress({ s, stages, onRank }: { s: ReincState; stages: PlanStage[]; onRank: (key: ReincKey, rank: number | null) => void }) {
  const planned = useMemo(() => plannedCounts(stages), [stages])
  const left = (k: ReincKey) => Math.max(0, Math.min(planned[k] ?? 0, REINC_RANKS - (s.ranks[k]?.rank ?? 0)))
  return (
    <div className="stack gap-16">
      <div className="card row">
        <b>{COMPLETIONIST.name.replace('Reincarnation: ', '')}</b>
        <span className="rc-bar static" aria-label={`Completionist: rank ${s.completionist} of ${REINC_RANKS}`}>
          {Array.from({ length: REINC_RANKS }, (_, i) => (
            <span key={i} className={`rc-part ${i < s.completionist ? 'done' : 'open'}`} />
          ))}
        </span>
        <span className="small faint">
          {COMPLETIONIST.passive} ({COMPLETIONIST.first} at rank 1); it also brings {COMPLETIONIST.active}.
        </span>
      </div>
      <div className="rc-cols">
        <div className="card">
          <h3>Classes</h3>
          <div className="rc-list">
            {REINC_CLASSES.map((c) => {
              const k = classKey(c.id)
              const r = s.ranks[k] ?? NO_RANK
              return (
                <div className="rc-row" key={c.id}>
                  <span className="rc-name">
                    <Tip text={`${c.passive}: ${c.first} at rank 1. Rank 3 adds ${c.active.name}: ${c.active.does}`}>{c.name}</Tip>
                  </span>
                  <ClassTags c={c} />
                  <RankBar name={c.name} rank={r} planned={left(k)} onRank={(n) => onRank(k, n)} />
                  <span className="rc-note small faint">
                    {c.passive} <span className="mono">({c.first})</span>
                    {r.rank >= REINC_RANKS ? ` · ${c.active.name}` : ''}
                  </span>
                  <RankFrom rank={r} onRank={(n) => onRank(k, n)} />
                </div>
              )
            })}
          </div>
        </div>
        <div className="card">
          <h3>Races</h3>
          <div className="rc-list races">
            {REINC_RACES.map((x) => {
              const k = raceKey(x.race)
              const r = s.ranks[k] ?? NO_RANK
              return (
                <div className="rc-row" key={x.race}>
                  <span className="rc-name">{x.race}</span>
                  <RankBar name={x.race} rank={r} planned={left(k)} onRank={(n) => onRank(k, n)} />
                  <span className="rc-note small faint">
                    {x.passive} {x.first !== '—' && <span className="mono">({x.first})</span>}
                  </span>
                  <RankFrom rank={r} onRank={(n) => onRank(k, n)} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="small faint">
        <span className="rc-part done inline" /> done <span className="rc-part planned inline" /> planned <span className="rc-part open inline" /> not yet
      </div>
    </div>
  )
}

/** A line's name: the class's, or the race. */
const lineName = (k: ReincKey) => (k.startsWith('class:') ? reincClass(k.slice(6) as ClassId).name : k.slice(5))

/** The priority list as one list per kind, each line once (an older list's repeats take their first place and highest rank). */
function splitPriority(list: readonly PriorityEntry[]): { classes: PriorityEntry[]; races: PriorityEntry[] } {
  const out: PriorityEntry[] = []
  for (const e of list) {
    const had = out.find((x) => x.key === e.key)
    if (had) had.rank = Math.max(had.rank, e.rank)
    else out.push({ ...e })
  }
  return { classes: out.filter((e) => e.key.startsWith('class:')), races: out.filter((e) => e.key.startsWith('race:')) }
}

/** What a tile is dragged from: its line, and whether it was on the list or among those not on it. */
type Dragging = { key: ReincKey; from: 'list' | 'pool' } | null

/**
 * One priority list as tiles: those on it in order, numbered, and those not on it below. Drag a tile
 * to its place, or from one part to the other; click one not on it to add it at the end. A tile on the
 * list moves with Ctrl+arrows and comes off with Delete, for the keyboard.
 */
function TileList({
  title,
  hint,
  list,
  all,
  rankOf,
  tags,
  trios = false,
  onChange
}: {
  title: string
  hint: string
  list: PriorityEntry[]
  all: ReincKey[]
  rankOf: (k: ReincKey) => number
  tags?: (k: ReincKey) => ReactNode
  /** Show the list as trios, three tiles a row. */
  trios?: boolean
  onChange: (list: PriorityEntry[]) => void
}) {
  const [drag, setDrag] = useState<Dragging>(null)
  const [over, setOver] = useState<number | 'end' | 'pool' | null>(null)
  const on = new Set(list.map((e) => e.key))
  const pool = all.filter((k) => !on.has(k))
  const open = pool.filter((k) => rankOf(k) < REINC_RANKS)

  const place = (key: ReincKey, at: number) => {
    const had = list.find((e) => e.key === key)
    const rest = list.filter((e) => e.key !== key)
    const from = list.findIndex((e) => e.key === key)
    // Taking a tile out ahead of where it goes moves that place up one.
    const i = Math.max(0, Math.min(rest.length, from >= 0 && from < at ? at - 1 : at))
    onChange([...rest.slice(0, i), had ?? { key, rank: REINC_RANKS }, ...rest.slice(i)])
  }
  const remove = (key: ReincKey) => onChange(list.filter((e) => e.key !== key))
  const end = () => {
    setDrag(null)
    setOver(null)
  }
  const dropOn = (at: number | 'end' | 'pool') => (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (drag) {
      if (at === 'pool') {
        if (drag.from === 'list') remove(drag.key)
      } else place(drag.key, at === 'end' ? list.length : at)
    }
    end()
  }
  const overOn = (at: number | 'end' | 'pool') => (e: DragEvent) => {
    if (!drag) return
    e.preventDefault()
    e.stopPropagation()
    if (over !== at) setOver(at)
  }
  const keys = (i: number, key: ReincKey) => (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Delete' || e.key === 'Backspace') remove(key)
    else if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp') && i > 0) place(key, i - 1)
    else if (e.ctrlKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown') && i < list.length - 1) place(key, i + 2)
    else return
    e.preventDefault()
  }

  return (
    <div className="card">
      <div className="row">
        <h3>{title}</h3>
        <span className="small faint">
          {num(list.length)} on the list, {num(open.length)} not
        </span>
        <span className="row tight rc-tiles-acts">
          {open.length > 0 && (
            <button className="btn small ghost" onClick={() => onChange([...list, ...open.map((key) => ({ key, rank: REINC_RANKS }))])}>
              Add the rest
            </button>
          )}
          {list.length > 0 && (
            <ConfirmButton className="btn small ghost" question={`Take every ${title.toLowerCase().replace(/s$/, '')} off?`} onConfirm={() => onChange([])}>
              Clear
            </ConfirmButton>
          )}
        </span>
      </div>
      <div className="small faint mb-8">{hint}</div>
      <ol className={`rc-tiles${trios ? ' trios' : ''}${over === 'end' ? ' drop-end' : ''}`} onDragOver={overOn('end')} onDrop={dropOn('end')} aria-label={`${title}, in order`}>
        {list.map((e, i) => {
          const held = rankOf(e.key)
          const done = held >= REINC_RANKS
          const trio = list.slice(i, i + 3)
          const tile = (
            <li
              key={e.key}
              className={`rc-tile${drag?.key === e.key ? ' dragging' : ''}${over === i ? ' drop-before' : ''}${done ? ' done' : ''}`}
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.effectAllowed = 'move'
                ev.dataTransfer.setData('text/plain', e.key)
                setDrag({ key: e.key, from: 'list' })
              }}
              onDragEnd={end}
              onDragOver={overOn(i)}
              onDrop={dropOn(i)}
              title="Drag to move it."
            >
              <button
                className="rc-tile-num mono"
                onKeyDown={keys(i, e.key)}
                aria-label={`${lineName(e.key)}, ${i + 1} of ${list.length}: Ctrl+arrows move it, Delete takes it off`}
                title="Drag the tile to move it; or focus this and use Ctrl+arrows, and Delete to take it off."
              >
                {i + 1}
              </button>
              <span className="rc-tile-body">
                <b>{lineName(e.key)}</b>
                <span className="small faint">
                  rank {held}
                  {done ? ', done' : ''}
                </span>
                {tags?.(e.key)}
              </span>
              <span className="rc-tile-acts">
                <button className="link-button faint" onClick={() => remove(e.key)} aria-label={`Take ${lineName(e.key)} off the list`} title="Take it off the list">
                  ✕
                </button>
              </span>
            </li>
          )
          if (!trios || i % 3) return tile
          return (
            <Fragment key={e.key}>
              <li className="rc-trio-label small faint" onDragOver={overOn(i)} onDrop={dropOn(i)}>
                Trio {i / 3 + 1}
                {trio.every((x) => rankOf(x.key) >= REINC_RANKS) ? ', done' : trio.length < 3 ? `: the plan adds ${3 - trio.length}` : ''}
              </li>
              {tile}
            </Fragment>
          )
        })}
        {!list.length && <li className="rc-tile-empty faint">Drag tiles here, or click them below, in the order you want them.</li>}
      </ol>
      <div className="rc-pick-head small faint">Not on the list: click to add at the end, or drag into place</div>
      <div className={`rc-pick rc-pool${over === 'pool' ? ' drop-here' : ''}`} onDragOver={overOn('pool')} onDrop={dropOn('pool')}>
        {pool.map((k) => {
          const full = rankOf(k) >= REINC_RANKS
          return (
            <button
              key={k}
              className="rc-chip"
              disabled={full}
              draggable={!full}
              onDragStart={(ev) => {
                ev.dataTransfer.effectAllowed = 'move'
                ev.dataTransfer.setData('text/plain', k)
                setDrag({ key: k, from: 'pool' })
              }}
              onDragEnd={end}
              onClick={() => onChange([...list, { key: k, rank: REINC_RANKS }])}
              title={full ? 'All three ranks done.' : 'Click to add it at the end, or drag it into place.'}
            >
              <span>
                {lineName(k)} <span className="mono faint">R{rankOf(k)}</span>
              </span>
              {tags?.(k)}
            </button>
          )
        })}
        {!pool.length && <span className="small faint">All of them are on the list. Drag one here to take it off.</span>}
      </div>
    </div>
  )
}

/** The two priority lists, classes and races; the plan reads them as one. */
function PriorityLists({ s, onPriority }: { s: ReincState; onPriority: (list: PriorityEntry[]) => void }) {
  const { classes, races } = useMemo(() => splitPriority(s.priority), [s.priority])
  const left = reincarnationsLeft(s.ranks)
  const rankOfLine = (k: ReincKey) => s.ranks[k]?.rank ?? 0
  return (
    <>
      <TileList
        title="Classes"
        hint={`Every three classes in a row are a trio, reincarnated together until all three reach rank 3 (three times from rank 0), then the next trio. A last trio short of three is made up from classes at level ${LEVEL_CAP} with the fewest ranks. Every class at rank 3 takes ${num(left.classes)} more ${left.classes === 1 ? 'reincarnation' : 'reincarnations'}.`}
        list={classes}
        all={REINC_CLASSES.map((c) => classKey(c.id))}
        rankOf={rankOfLine}
        tags={(k) => <ClassTags c={reincClass(k.slice(6) as ClassId)} />}
        trios
        onChange={(list) => onPriority([...list, ...races])}
      />
      <TileList
        title="Races"
        hint="Each race in turn until it reaches rank 3 (three reincarnations from rank 0), then the next. With none left on the list, the race you play then takes the rank."
        list={races}
        all={REINC_RACES.map((r) => raceKey(r.race))}
        rankOf={rankOfLine}
        onChange={(list) => onPriority([...classes, ...list])}
      />
    </>
  )
}

const LEVEL_FROM: Record<ClassLevel['from'], string> = {
  who: 'your /who said so while you played it',
  hand: 'you said so',
  reincarnated: 'reincarnated since: back to level 1',
  none: 'not known: the plan takes it as below the cap until you say'
}

/** The levelling choices: the class every trio keeps, and which classes are at the cap. */
function Levelling({ s, onAnchor, onCapped }: { s: ReincState; onAnchor: (id: ClassId | '') => void; onCapped: (id: ClassId, capped: boolean) => void }) {
  return (
    <div className="card">
      <h3>Levelling</h3>
      <div className="row">
        <label className="row tight">
          Every levelling trio keeps
          <select value={s.anchor} onChange={(e) => onAnchor(e.target.value as ClassId | '')} aria-label="Class every levelling trio keeps">
            <option value="">no class in particular</option>
            {REINC_CLASSES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="rc-pick-head small faint">At level {LEVEL_CAP}? Click a class to say it is, or is not</div>
      <div className="rc-pick">
        {REINC_CLASSES.map((c) => {
          const l = s.levels[c.id]
          return (
            <button
              key={c.id}
              className={`rc-chip${l.capped ? ' on' : ''}`}
              aria-pressed={l.capped === true}
              onClick={() => onCapped(c.id, l.capped !== true)}
              title={`${c.name}: ${l.capped ? `at ${LEVEL_CAP}` : l.capped === false ? `below ${LEVEL_CAP}` : 'not known'} (${LEVEL_FROM[l.from]}). Click to say it ${l.capped ? 'is not' : 'is'}.`}
            >
              {c.name} <span className="mono faint">{l.capped ? LEVEL_CAP : l.capped === false ? `<${LEVEL_CAP}` : '?'}</span>
            </button>
          )
        })}
      </div>
      <div className="small faint rc-gap">
        Your log never says which class a level went to, so the page keeps what /who shows of the classes you play, and what you say here. A reincarnation sets its classes back to
        level 1.
      </div>
    </div>
  )
}

/** A trio's stance as one chip: evasive if it has it, else defensive, else none. */
function StanceTag({ classes }: { classes: readonly ClassId[] }) {
  const n = trioNotes(classes)
  const s = n.evasive.length ? 'evasive' : n.defensive.length ? 'defensive' : null
  return s ? (
    <Tip className={`chip pill rc-tag ${s}`} text={`${STANCE_TIP[s]} From ${(s === 'evasive' ? n.evasive : n.defensive).map((c) => reincClass(c).name).join(', ')}.`}>
      {s === 'evasive' ? 'Evasive' : 'Defensive'}
    </Tip>
  ) : (
    <Tip className="chip pill rc-tag none" text="No class with evasive or defensive stance fits without a higher XP penalty.">
      No stance
    </Tip>
  )
}

/** A levelling trio: the classes that level, those along at the cap, and the penalty. */
function RunStep({ r, unknown }: { r: LevelRun; unknown: (c: ClassId) => boolean }) {
  const floor = r.penalty / XP_PENALTY_PER_RANK
  return (
    <div className="rc-step">
      <span className="rc-kind level">Level</span>
      <span className="rc-plan-what">
        {r.classes.map((c) => {
          const levels = r.levels.includes(c)
          return (
            <span
              key={c}
              className={levels ? '' : 'faint'}
              title={levels ? (unknown(c) ? `Not known to be at ${LEVEL_CAP}: levels if it is not` : `Below ${LEVEL_CAP}: levels`) : `At ${LEVEL_CAP} already: along for the trio`}
            >
              {levels ? <b>{reincClass(c).name}</b> : reincClass(c).name}
              {levels ? (unknown(c) ? ' ?' : '') : ` (${LEVEL_CAP})`}
            </span>
          )
        })}
        {r.open > 0 && (
          <span className="faint">
            + {r.open === 1 ? 'any class' : `any ${r.open} classes`} at rank {floor} or lower
          </span>
        )}
        {r.race && <span className="faint">as {r.race}</span>}
      </span>
      <span className="rc-tags">
        <StanceTag classes={r.classes} />
        <PenaltyTag pct={r.penalty} raceOpen={!r.race} />
      </span>
      {r.penalty > r.classPenalty && (
        <span className="small warn-text rc-step-note">
          {r.race}’s rank makes it +{r.penalty}%: as a race at rank {r.classPenalty / XP_PENALTY_PER_RANK} or lower it would be +{r.classPenalty}%.
        </span>
      )}
    </div>
  )
}

/** A reincarnation in the plan: the trio and race, the ranks they reach, and, for the next one, a way to say it is made. */
function ReincStep({ r, n, after, onDone }: { r: PlannedReinc; n: number; after: (k: ReincKey) => number; onDone?: () => void }) {
  const made = (k: ReincKey) => r.extra.includes(k)
  const MADE_UP = 'Not on your list: it makes up the reincarnation (classes at the cap with the fewest ranks first, so there is less to level).'
  return (
    <div className="rc-step reinc">
      <span className="rc-kind reinc">Reincarnate {n}</span>
      <span className="rc-plan-what">
        {r.classes.map((c) =>
          made(classKey(c)) ? (
            <Tip key={c} className="faint" text={MADE_UP}>
              {reincClass(c).name} → {after(classKey(c))}
            </Tip>
          ) : (
            <b key={c}>
              {reincClass(c).name} → {after(classKey(c))}
            </b>
          )
        )}
        {r.race ? (
          made(raceKey(r.race)) ? (
            <Tip className="faint" text="No race on your list: the race you play then takes the rank.">
              {r.race} → {after(raceKey(r.race))}
            </Tip>
          ) : (
            <span>
              {r.race} → {after(raceKey(r.race))}
            </span>
          )
        ) : (
          <span className="faint">the race you play then</span>
        )}
      </span>
      <span className="rc-tags">
        <StanceTag classes={r.classes} />
      </span>
      {onDone && (
        <ConfirmButton className="btn small" question="Reincarnated as this? Each of its AAs goes up a rank, and its classes go back to level 1." onConfirm={onDone}>
          Reincarnated
        </ConfirmButton>
      )}
    </div>
  )
}

/** "3 trios and 4 races": what the lists hold. */
function listed(priority: readonly PriorityEntry[]): string {
  const { classes, races } = splitPriority(priority)
  const trios = Math.ceil(classes.length / 3)
  return `${num(trios)} ${trios === 1 ? 'trio' : 'trios'} and ${num(races.length)} ${races.length === 1 ? 'race' : 'races'}`
}

/** The plan: before each reincarnation the trios to level as, then it; after the last, the levelling left. */
function ThePlan({ s, stages, onDone, onSetup }: { s: ReincState; stages: PlanStage[]; onDone: (r: PlannedReinc) => void; onSetup: () => void }) {
  // The rank each reincarnation takes its lines to, counting the ones before it.
  const afters = useMemo(() => {
    const got: Partial<Record<ReincKey, number>> = {}
    for (const k of REINC_KEYS) got[k] = s.ranks[k]?.rank ?? 0
    return stages.map((st) => {
      if (!st.reinc) return { ...got }
      const keys = [...st.reinc.classes.map(classKey), ...(st.reinc.race ? [raceKey(st.reinc.race)] : [])]
      for (const k of keys) got[k] = Math.min(REINC_RANKS, got[k]! + 1)
      return { ...got }
    })
  }, [s.ranks, stages])
  const reincs = stages.filter((st) => st.reinc).length
  const runs = stages.reduce((n, st) => n + st.runs.length, 0)
  const unknown = (c: ClassId) => s.levels[c].capped === null
  let n = 0
  return (
    <div className="card">
      <h3>The plan</h3>
      <div className="small mb-8">
        {s.priority.length ? `Made from your ${listed(s.priority)}, ` : 'Your class and race lists are empty, '}
        levelling with {s.anchor ? reincClass(s.anchor).name : 'no class in particular'} in every trio.{' '}
        <button className="link-button" onClick={onSetup}>
          {s.priority.length ? 'Change them on Setup' : 'Fill them in on Setup'}
        </button>
      </div>
      {stages.length ? (
        <>
          <div className="small faint mb-8">
            {num(reincs)} {reincs === 1 ? 'reincarnation' : 'reincarnations'} from your list, and {num(runs)} levelling {runs === 1 ? 'trio' : 'trios'}. A levelling trio takes the
            classes that must reach level {LEVEL_CAP}, the highest ranks together, then fills its other places without raising the XP penalty: a class with evasive stance (or
            defensive, when no evasive one fits), then the reincarnated classes below {LEVEL_CAP} with the most ranks. <b>Bold</b> classes level; the others are at {LEVEL_CAP}{' '}
            already; “?” is a class not known to be.
          </div>
          <ol className="rc-stages">
            {stages.map((st, i) => {
              if (st.reinc) n++
              return (
                <li key={i} className="rc-stage">
                  <div className="rc-stage-head small faint">
                    {st.reinc
                      ? st.runs.length
                        ? `Before reincarnation ${n}`
                        : `Reincarnation ${n}: its classes are at level ${LEVEL_CAP} already`
                      : 'After the last reincarnation'}
                  </div>
                  {st.runs.map((r, j) => (
                    <RunStep key={j} r={r} unknown={i === 0 ? unknown : () => false} />
                  ))}
                  {st.reinc && <ReincStep r={st.reinc} n={n} after={(k) => afters[i][k] ?? 0} onDone={n === 1 ? () => onDone(st.reinc!) : undefined} />}
                </li>
              )
            })}
          </ol>
        </>
      ) : (
        <div className="empty">
          Nothing to plan yet. On <b>Setup</b>, list the classes and races you want ranks in, in order; any reincarnated class below level {LEVEL_CAP} shows here to level too.
        </div>
      )}
    </div>
  )
}

/** Setup: the class and race priority lists the plan is made from, and the levelling choices. */
function Setup({
  s,
  onPriority,
  onAnchor,
  onCapped
}: {
  s: ReincState
  onPriority: (list: PriorityEntry[]) => void
  onAnchor: (id: ClassId | '') => void
  onCapped: (id: ClassId, capped: boolean) => void
}) {
  return (
    <div className="stack gap-16">
      <PriorityLists s={s} onPriority={onPriority} />
      <Levelling s={s} onAnchor={onAnchor} onCapped={onCapped} />
    </div>
  )
}

function Planner({ s, stages, onDone, onSetup }: { s: ReincState; stages: PlanStage[]; onDone: (r: PlannedReinc) => void; onSetup: () => void }) {
  return (
    <div className="stack gap-16">
      <ThePlan s={s} stages={stages} onDone={onDone} onSetup={onSetup} />
      {s.history.length > 0 && (
        <div className="card">
          <h3>Reincarnations made</h3>
          <ul className="rc-history small">
            {s.history.map((h, i) => (
              <li key={i}>
                <span className="mono faint">{day(h.at)}</span> {h.classes.map((c) => reincClass(c).name).join(' · ')}
                {h.race ? `, ${h.race}` : ''}
                {h.by === 'hand' ? <span className="faint"> (you said)</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** The tokens held and whether the loadout can reincarnate now. */
function Status({ s, next }: { s: ReincState; next: PlannedReinc | undefined }) {
  const lo = s.loadout
  const ready = lo.classes.length === 3 && lo.classes.every((c) => c.level >= LEVEL_CAP)
  const isNext = !!next && lo.classes.length === 3 && lo.classes.every((c) => next.classes.includes(c.id)) && (!next.race || next.race === lo.race)
  return (
    <div className="card row mb-16 rc-status">
      <span>
        {s.tokens ? (
          <>
            <b>{num(s.tokens.count)}</b> {s.tokens.count === 1 ? 'Token' : 'Tokens'} of Reincarnation{' '}
            <span className="small faint">
              (inventory export, <Ago t={s.tokens.modified} />)
            </span>
          </>
        ) : (
          <span className="faint">No inventory export to count tokens from (/outputfile inventory).</span>
        )}
      </span>
      {lo.classes.length > 0 && (
        <span>
          Now: {lo.race || 'race not known'} · {lo.classes.map((c) => `${reincClass(c.id).name} ${c.level}`).join(' · ')}
          {ready ? <span className="ok-text"> · ready to reincarnate</span> : <span className="faint"> · each class needs level {LEVEL_CAP}</span>}
          {isNext && <span className="ok-text"> · your next reincarnation</span>}
        </span>
      )}
      {lo.classes.length > 0 && (
        <PenaltyTag
          pct={xpPenalty(
            s.ranks,
            lo.classes.map((c) => c.id),
            lo.race
          )}
          raceOpen={!lo.race}
        />
      )}
    </div>
  )
}

export function Reincarnation() {
  const chars = useCharacterChoice('inventory', { withLogs: true })
  const character = chars.character
  const q = useInvoke(character ? 'reincarnation:state' : null, [character])
  useVisibleInterval(q.reload, 60_000)
  const [view, setView] = useRemembered<View>('reinc.view', 'progress')
  const s = q.data
  const stages = useMemo(
    () =>
      s
        ? makePlan({
            ranks: s.ranks,
            priority: s.priority,
            capped: Object.fromEntries(REINC_CLASSES.map((c) => [c.id, s.levels[c.id].capped])),
            anchor: s.anchor,
            race: s.loadout.race
          })
        : [],
    [s]
  )

  /** Calls one of the module's channels and shows the state it answers with. */
  const save = async (call: () => Promise<ReincState>) => {
    try {
      q.setData(await call())
    } catch (e) {
      showToast(`Could not save that: ${e instanceof Error ? e.message : String(e)}`, { tone: 'bad' })
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reincarnation</h1>
          <div className="lead">
            Every class and race Reincarnation AA, three ranks each, and a plan made from your priority list: what to reincarnate as, and what to level as between.{' '}
            <Info label="How it is worked out" text={HOW} />
          </div>
        </div>
        <div className="actions">
          <CharacterPicker character={character} available={chars.available} onPick={chars.setCharacter} />
        </div>
      </div>

      {!chars.ready ? (
        <Pending error={chars.error} retry={chars.reload} what="your characters" />
      ) : !character ? (
        <div className="card empty">
          No character yet. Choose the game folder on <SettingsLink tab="general">Settings › General</SettingsLink>, then play with logging on (/log on).
        </div>
      ) : !s ? (
        <Pending error={q.error} retry={q.reload} doing={`Reading ${who(character)}’s log`} />
      ) : (
        <>
          <Tabs
            className="mb-16"
            label="Reincarnation view"
            value={view}
            onChange={setView}
            tabs={[
              ['progress', 'Progress'],
              ['setup', s.priority.length ? 'Setup' : 'Setup (start here)'],
              ['plan', 'Planner']
            ]}
          />
          <Status s={s} next={stages.find((st) => st.reinc)?.reinc ?? undefined} />
          {view === 'progress' ? (
            <Progress s={s} stages={stages} onRank={(key, rank) => void save(() => api.invoke('reincarnation:rank', character, key, rank))} />
          ) : view === 'setup' ? (
            <Setup
              s={s}
              onPriority={(list) => void save(() => api.invoke('reincarnation:priority', character, list))}
              onAnchor={(id) => void save(() => api.invoke('reincarnation:anchor', character, id))}
              onCapped={(id, capped) => void save(() => api.invoke('reincarnation:capped', character, id, capped))}
            />
          ) : (
            <Planner s={s} stages={stages} onDone={(r) => void save(() => api.invoke('reincarnation:done', character, r.classes, r.race))} onSetup={() => setView('setup')} />
          )}
        </>
      )}
    </>
  )
}
