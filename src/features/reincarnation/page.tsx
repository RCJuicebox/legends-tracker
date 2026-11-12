import { useMemo, useState } from 'react'
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
  REINC_RACES,
  REINC_RANKS,
  classKey,
  poolLeft,
  raceKey,
  reincarnationsLeft,
  reincClass,
  trioNotes,
  type LineRank,
  type ReincClass,
  type ReincKey,
  type ReincPlan,
  type ReincState
} from './core'

// Goals › Reincarnation (an optional module, Settings › Modules): Progress, a bar of three ranks for
// every class and race AA, read from the log or set by hand; Planner, the trios and races the player
// means to reincarnate as, built from what is left to place, each class and race coming off the list
// once its three ranks are all planned or done.

type View = 'progress' | 'plan'

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
  </>
)

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

/** How many open plans take each line. */
function plannedCounts(plans: readonly ReincPlan[]): Partial<Record<ReincKey, number>> {
  const out: Partial<Record<ReincKey, number>> = {}
  for (const p of plans) {
    for (const c of p.classes) out[classKey(c)] = (out[classKey(c)] ?? 0) + 1
    if (p.race) out[raceKey(p.race)] = (out[raceKey(p.race)] ?? 0) + 1
  }
  return out
}

const NO_RANK: LineRank = { rank: 0, from: 'none', logged: 0 }

function Progress({ s, onRank }: { s: ReincState; onRank: (key: ReincKey, rank: number | null) => void }) {
  const planned = useMemo(() => plannedCounts(s.plans), [s.plans])
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

/** A trio's stances and mana, said plainly. */
function TrioSummary({ classes }: { classes: readonly ClassId[] }) {
  if (!classes.length) return null
  const n = trioNotes(classes)
  const names = (ids: ClassId[]) => ids.map((id) => reincClass(id).name).join(', ')
  return (
    <div className="rc-summary small">
      <span className={n.evasive.length ? 'ok-text' : 'faint'}>{n.evasive.length ? `Evasive stance: ${names(n.evasive)}` : 'No evasive stance'}</span>
      <span className={n.defensive.length ? 'ok-text' : 'faint'}>{n.defensive.length ? `Defensive stance: ${names(n.defensive)}` : 'No defensive stance'}</span>
      <span>
        {n.wis.length || n.int.length ? [n.wis.length ? `WIS: ${names(n.wis)}` : '', n.int.length ? `INT: ${names(n.int)}` : ''].filter(Boolean).join(' · ') : 'No mana: all melee'}
      </span>
      {n.mixed && <span className="warn-text">Mixes WIS and INT casters: each takes its mana from its own stat, so gear for one does less for the other.</span>}
    </div>
  )
}

const newId = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`

function Planner({ s, onPlans, onDone }: { s: ReincState; onPlans: (plans: ReincPlan[]) => void; onDone: (id: string) => void }) {
  const [trio, setTrio] = useState<ClassId[]>([])
  const [race, setRace] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  // The pool leaves out the plan being edited, and counts what the builder holds.
  const others = useMemo(() => s.plans.filter((p) => p.id !== editing), [s.plans, editing])
  const pool = useMemo(() => poolLeft(s.ranks, [...others, { id: 'draft', classes: trio, race, since: 0 }]), [s.ranks, others, trio, race])
  const left = reincarnationsLeft(s.ranks)
  const placedClasses = REINC_CLASSES.filter((c) => pool.classes[c.id] <= 0 && !trio.includes(c.id))
  const placedRaces = REINC_RACES.filter((r) => pool.races[r.race] <= 0 && r.race !== race)
  const over = [...REINC_CLASSES.filter((c) => pool.classes[c.id] < 0).map((c) => c.name), ...REINC_RACES.filter((r) => pool.races[r.race] < 0).map((r) => r.race)]

  const clear = () => {
    setTrio([])
    setRace('')
    setEditing(null)
  }
  const save = () => {
    if (trio.length !== 3) return
    const plan: ReincPlan = { id: editing ?? newId(), classes: trio, race, since: Date.now() }
    onPlans(editing ? s.plans.map((p) => (p.id === editing ? plan : p)) : [...s.plans, plan])
    clear()
  }
  const edit = (p: ReincPlan) => {
    setEditing(p.id)
    setTrio([...p.classes])
    setRace(p.race)
  }
  // A copy goes in under the trio it copies. Every class needs a rank left to plan; the race comes along
  // while it has one too, and is left to choose otherwise.
  const planned = useMemo(() => poolLeft(s.ranks, s.plans), [s.ranks, s.plans])
  const full = (p: ReincPlan) => p.classes.filter((c) => planned.classes[c] <= 0).map((c) => reincClass(c).name)
  const copy = (i: number) => {
    const p = s.plans[i]
    const next = [...s.plans]
    next.splice(i + 1, 0, { id: newId(), classes: [...p.classes], race: p.race && planned.races[p.race] > 0 ? p.race : '', since: Date.now() })
    onPlans(next)
  }
  const move = (i: number, by: number) => {
    const next = [...s.plans]
    const [p] = next.splice(i, 1)
    next.splice(i + by, 0, p)
    onPlans(next)
  }

  return (
    <div className="stack gap-16">
      <div className="card">
        <h3>{editing ? `Change plan ${s.plans.findIndex((p) => p.id === editing) + 1}` : 'Build a trio'}</h3>
        <div className="rc-slots">
          {[0, 1, 2].map((i) => {
            const id = trio[i]
            return id ? (
              <button key={i} className="rc-slot filled" onClick={() => setTrio(trio.filter((x) => x !== id))} title="Take it out of the trio">
                {reincClass(id).name} ✕
              </button>
            ) : (
              <span key={i} className="rc-slot">
                Class {i + 1}
              </span>
            )
          })}
          {race ? (
            <button className="rc-slot filled race" onClick={() => setRace('')} title="Take the race out">
              {race} ✕
            </button>
          ) : (
            <span className="rc-slot race">Race</span>
          )}
        </div>
        <TrioSummary classes={trio} />
        <div className="rc-pick-head small faint">Classes left to place (each three times)</div>
        <div className="rc-pick">
          {REINC_CLASSES.filter((c) => pool.classes[c.id] > 0 || trio.includes(c.id)).map((c) => {
            const inTrio = trio.includes(c.id)
            return (
              <button
                key={c.id}
                className={`rc-chip${inTrio ? ' on' : ''}`}
                disabled={!inTrio && trio.length >= 3}
                onClick={() => setTrio(inTrio ? trio.filter((x) => x !== c.id) : [...trio, c.id])}
                title={`${c.passive} (${c.first} at rank 1). Rank 3 adds ${c.active.name}.`}
              >
                <span>
                  {c.name} <span className="mono faint">×{Math.max(0, pool.classes[c.id])}</span>
                </span>
                <ClassTags c={c} />
              </button>
            )
          })}
        </div>
        {placedClasses.length > 0 && <div className="small faint rc-gap">All three ranks planned or done: {placedClasses.map((c) => c.name).join(', ')}.</div>}
        <div className="rc-pick-head small faint">Races left to place</div>
        <div className="rc-pick">
          {REINC_RACES.filter((r) => pool.races[r.race] > 0 || r.race === race).map((r) => (
            <button
              key={r.race}
              className={`rc-chip${r.race === race ? ' on' : ''}`}
              onClick={() => setRace(r.race === race ? '' : r.race)}
              title={`${r.passive} (${r.first} at rank 1)`}
            >
              <span>
                {r.race} <span className="mono faint">×{Math.max(0, pool.races[r.race])}</span>
              </span>
            </button>
          ))}
        </div>
        {placedRaces.length > 0 && <div className="small faint rc-gap">All three ranks planned or done: {placedRaces.map((r) => r.race).join(', ')}.</div>}
        {over.length > 0 && <div className="warn-text small rc-gap">Planned more than three times, ranks done included: {over.join(', ')}.</div>}
        <div className="row mt-16">
          <button className="btn" disabled={trio.length !== 3} onClick={save}>
            {editing ? 'Save the change' : 'Add to the plan'}
          </button>
          {(trio.length > 0 || race || editing) && (
            <button className="btn ghost" onClick={clear}>
              {editing ? 'Cancel' : 'Clear'}
            </button>
          )}
          <span className="small faint">{trio.length < 3 ? `Pick ${3 - trio.length} more ${trio.length === 2 ? 'class' : 'classes'}.` : race ? '' : 'The race can wait.'}</span>
        </div>
      </div>

      <div className="card">
        <h3>The plan</h3>
        <div className="small faint mb-8">
          {num(s.plans.length)} planned. Every class at rank 3 takes {num(left.classes)} more {left.classes === 1 ? 'reincarnation' : 'reincarnations'} (three class ranks each);
          every race at rank 3 takes {num(left.races)} (one race rank each). A trio comes off the plan when your log shows it reincarnated, or when you say so.
        </div>
        {s.plans.length ? (
          <ol className="rc-plans">
            {s.plans.map((p, i) => {
              const n = trioNotes(p.classes)
              const noCopy = full(p)
              return (
                <li key={p.id} className={`rc-plan${p.id === editing ? ' editing' : ''}`}>
                  <span className="mono faint">{i + 1}</span>
                  <span className="rc-plan-what">
                    <b>{p.classes.map((c) => reincClass(c).name).join(' · ')}</b>
                    <span className={p.race ? '' : 'faint'}>{p.race || 'race not chosen'}</span>
                  </span>
                  <span className="rc-tags">
                    <Tip className={`chip pill rc-tag ${n.evasive.length ? 'evasive' : 'none'}`} text={n.evasive.length ? 'Has evasive stance' : 'No evasive stance'}>
                      {n.evasive.length ? 'Evasive' : 'No evasive'}
                    </Tip>
                    <Tip className={`chip pill rc-tag ${n.defensive.length ? 'defensive' : 'none'}`} text={n.defensive.length ? 'Has defensive stance' : 'No defensive stance'}>
                      {n.defensive.length ? 'Defensive' : 'No defensive'}
                    </Tip>
                    {n.wis.length > 0 && <span className="chip pill rc-tag wis">WIS ×{n.wis.length}</span>}
                    {n.int.length > 0 && <span className="chip pill rc-tag int">INT ×{n.int.length}</span>}
                  </span>
                  <span className="row tight">
                    <button className="btn small ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move it up">
                      ▲
                    </button>
                    <button className="btn small ghost" disabled={i === s.plans.length - 1} onClick={() => move(i, 1)} aria-label="Move it down">
                      ▼
                    </button>
                    <button className="btn small ghost" onClick={() => edit(p)}>
                      Change
                    </button>
                    <button
                      className="btn small ghost"
                      disabled={noCopy.length > 0}
                      onClick={() => copy(i)}
                      title={
                        noCopy.length
                          ? `All three ranks of ${noCopy.join(', ').replace(/, ([^,]*)$/, ' and $1')} are planned or done already.`
                          : p.race && planned.races[p.race] <= 0
                            ? `Plan this trio again, just under it. All three ${p.race} ranks are planned, so the copy's race is left to choose.`
                            : 'Plan this trio again, just under it: each trio can be done three times.'
                      }
                    >
                      Copy
                    </button>
                    <ConfirmButton className="btn small" question="Reincarnated as this? Each of its AAs goes up a rank, and it comes off the plan." onConfirm={() => onDone(p.id)}>
                      Reincarnated
                    </ConfirmButton>
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        if (editing === p.id) clear()
                        onPlans(s.plans.filter((x) => x !== p))
                      }}
                      aria-label="Take it off the plan"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              )
            })}
          </ol>
        ) : (
          <div className="empty">Nothing planned yet: pick three classes and a race above.</div>
        )}
      </div>

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
function Status({ s }: { s: ReincState }) {
  const lo = s.loadout
  const ready = lo.classes.length === 3 && lo.classes.every((c) => c.level >= LEVEL_CAP)
  const next = s.plans[0]
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
          {isNext && <span className="ok-text"> · your next plan</span>}
        </span>
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
            Every class and race Reincarnation AA, three ranks each, and your plan of which trio and race come next. <Info label="How it is worked out" text={HOW} />
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
              ['plan', s.plans.length ? `Planner (${s.plans.length})` : 'Planner']
            ]}
          />
          <Status s={s} />
          {view === 'progress' ? (
            <Progress s={s} onRank={(key, rank) => void save(() => api.invoke('reincarnation:rank', character, key, rank))} />
          ) : (
            <Planner
              s={s}
              onPlans={(plans) => void save(() => api.invoke('reincarnation:plans', character, plans))}
              onDone={(id) => void save(() => api.invoke('reincarnation:done', character, id))}
            />
          )}
        </>
      )}
    </>
  )
}
