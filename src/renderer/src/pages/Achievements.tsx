import { type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { CharacterPicker } from '../components/CharacterPicker'
import { api } from '../api'
import { useRemembered } from '../remember'
import { GoContext } from '../nav'
import { useCharacterChoice } from '../character'
import { useAchievementTrack, useInvoke } from '../hooks'
import { planSlayer, type CampSource } from '../../../features/slayer/core'
import { RaceSayer } from '../../../features/slayer/RaceSayer'
import type { SlayerStepHint } from './AchievementRows'
import { showError, showToast } from '../toast'
import { Ago, FilterBox, GameCommand, Pending, Switch } from '../components/ui'
import { duration, numExact as num, who } from '../../../core/format'
import type { RoutePlanner, RouteZone } from '../../../core/route'
import { AchievementBook, norm, secKey, type AchMarks, type AchRef, type ObjRef } from '../../../core/achievements'
import type { AchievementsView } from '../../../shared/types'
import { SectionView, SearchResults, TrackedBar } from './AchievementRows'
import { Progress } from './AchievementProgress'

/** Open and closed blocks are remembered by name; at most this many, the newest kept. */
const OPEN_KEEP = 1000

function useAchievements() {
  // A character's first export joins the list as the game writes it (useCharacterChoice listens).
  const chars = useCharacterChoice('achievements')
  const { character, ready } = chars
  const viewQ = useInvoke(ready ? 'achievements:load' : null, [character])
  const setView = viewQ.setData
  useEffect(() => {
    if (!ready) return
    return api.on('state:achievements', (v: AchievementsView) => v.character === character && setView(v))
  }, [character, ready, setView])
  const retry = () => {
    chars.reload()
    viewQ.reload()
  }
  return { chars: ready ? chars : null, character, setCharacter: chars.setCharacter, view: viewQ.data, setView, error: chars.error || viewQ.error, retry }
}

/** Where a step's pace comes from, as Plan › Slayer labels it. */
const SLAYER_SOURCE: Record<CampSource, string> = { log: 'your log', play: 'players', spawns: 'spawn table', wiki: 'eqlwiki guess' }

export function Achievements() {
  const go = useContext(GoContext)
  const { chars, character, setCharacter, view, setView, error, retry } = useAchievements()
  const [cat, setCat] = useRemembered<string>('ach.cat', '')
  const [sec, setSec] = useRemembered<string>('ach.sec', '')
  const [remaining, setRemaining] = useRemembered<boolean>('ach.remaining', true)
  const [hideOpt, setHideOpt] = useRemembered<Record<string, boolean>>('ach.hideOpt', {})
  const [sort, setSort] = useRemembered<Record<string, { row?: number; blk?: number }>>('ach.sort', {})
  const [open, setOpen] = useRemembered<Record<string, boolean>>('ach.open', {})
  const [q, setQ] = useState('')
  // What was ticked since arriving on this section: a finished row stays put, ticked, instead of
  // dropping into the Complete list, until the section changes.
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState('')

  // A tick builds the next book to see what it finished; that one is kept and used here, not built
  // a second time (LT-407).
  const [built, setBuilt] = useState<{ sections: unknown; ticks: unknown; book: AchievementBook } | null>(null)
  const book = useMemo(() => {
    if (!view) return null
    if (built && built.sections === view.sections && built.ticks === view.marks.ticks) return built.book
    return new AchievementBook(view.sections, { ticks: view.marks.ticks, broken: [] })
  }, [view, built])
  // The Slayer counts move with every kill; the export only when it is written again.
  const track = useAchievementTrack()
  const since = useMemo(() => {
    const rows = track && view && track.character.toLowerCase() === view.character.toLowerCase() && track.slayer?.exportAt === view.modified ? track.slayer.rows : []
    return new Map(rows.filter((r) => r.since > 0 || r.done).map((r) => [r.name.toLowerCase(), { since: r.since, done: r.done }]))
  }, [track, view])
  const skills = useMemo(() => {
    const rows = track && view && track.character.toLowerCase() === view.character.toLowerCase() ? (track.skills?.rows ?? []) : []
    return new Map(rows.map((r) => [`${r.achievement}|${r.skill}`.toLowerCase(), r]))
  }, [track, view])
  // The places entered since the export, for the Exploration objectives the log ticks before the next export (LT-732).
  const visited = useMemo(() => (track && view && track.character.toLowerCase() === view.character.toLowerCase() && track.visited ? track.visited : {}), [track, view])
  // Plan › Slayer's step for each open Slayer achievement, drawn under it in place of eqlwiki's census (LT-654).
  const planQ = useInvoke(character ? 'slayer:plan' : null, [character])
  const steps = useMemo(() => {
    const out = new Map<string, SlayerStepHint>()
    if (!planQ.data || planQ.data.data.character !== character) return out
    const { data, choices } = planQ.data
    planSlayer(data, choices).steps.forEach((st, i) => {
      for (const g of st.focus) {
        const name = data.goals[g].name.toLowerCase()
        if (!out.has(name))
          out.set(name, { index: i, zone: st.camp.zone, seconds: st.seconds, ...(st.days !== undefined ? { days: st.days } : {}), source: SLAYER_SOURCE[st.camp.source] })
      }
    })
    return out
  }, [planQ.data, character])
  const cats = useMemo(() => book?.categories() ?? [], [book])
  // Nothing picked yet: General, where the everyday ones are. The export lists Untapped Potential
  // first, whose deity unlocks are the game's "Future Placeholder" rows.
  const curCat = cats.includes(cat) ? cat : cats.includes('General') ? 'General' : (cats[0] ?? '')
  const catSections = book ? book.sections.map((s, si) => ({ s, si })).filter((x) => x.s.cat === curCat) : []
  const cur = catSections.find((x) => secKey(x.s) === sec) ?? catSections[0]

  // Forget blocks no longer in the book, and keep the list from growing without end.
  // An export that failed to read has no sections; that is no reason to forget anything.
  const readFailed = !!view?.error
  const known = useMemo(() => (book && book.sections.length ? new Set(book.sections.flatMap((s) => s.ach.map((a) => `${secKey(s)} > ${a.n}`))) : null), [book])
  useEffect(() => {
    if (!known || readFailed) return
    const kept = Object.entries(open).filter(([k]) => known.has(k))
    const trimmed = kept.slice(-OPEN_KEEP)
    if (trimmed.length !== Object.keys(open).length) setOpen(Object.fromEntries(trimmed))
  }, [known, readFailed, open, setOpen])

  useEffect(() => {
    if (!flash) return
    document.getElementById(flash)?.scrollIntoView({ block: 'center' })
    const t = setTimeout(() => setFlash(''), 1400)
    return () => clearTimeout(t)
  }, [flash])

  if (!chars || !view) return <Pending what="your achievements" error={error} retry={retry} />

  const toast = (body: ReactNode) => showToast(body, { ms: 4200 })

  const saveMarks = (next: AchMarks) => {
    const marks: AchMarks = { ticks: next.ticks, broken: [], tracked: next.tracked ?? view.marks.tracked ?? [] }
    const before = book!
    const after = new AchievementBook(view.sections, marks)
    const newlyDone: string[] = []
    after.sections.forEach((s, si) => s.ach.forEach((a, ai) => after.achDone([si, ai]) && !before.achDone([si, ai]) && newlyDone.push(a.n)))
    // One toast for a tick that finishes several (a section's last objective): the names in one.
    const done = [...new Set(newlyDone)]
    if (done.length === 1)
      toast(
        <>
          You have completed the achievement: <b>{done[0]}</b>
        </>
      )
    else if (done.length > 1)
      toast(
        <>
          You have completed {done.length} achievements: <b>{done.slice(0, 3).join(', ')}</b>
          {done.length > 3 ? ` and ${done.length - 3} more` : ''}
        </>
      )
    setBuilt({ sections: view.sections, ticks: marks.ticks, book: after })
    setView({ ...view, marks })
    api.invoke('achievements:marks', view.character, marks).catch((e) => showError('Could not save your ticks', e))
  }

  const tick = (r: ObjRef, on: boolean) => {
    const targets = book!.tickTargets(r)
    setTouched((t) => new Set([...t, ...targets.map(([si, ai, ci]) => `${si}:${ai}:${ci}`), ...targets.map(([si, ai]) => `a:${si}:${ai}`)]))
    // No "You have slain" toast per tick (LT-468): the row strikes through, and finishing the list says so.
    saveMarks(book!.withTick(r, on, view.marks))
  }

  /** Keeps an achievement on the achievements overlay, or stops. */
  const setTracked = (key: string, on: boolean) => {
    const had = view.marks.tracked ?? []
    const tracked = on ? [...had.filter((k) => k !== key), key] : had.filter((k) => k !== key)
    const marks: AchMarks = { ...view.marks, broken: [], tracked }
    setView({ ...view, marks })
    api.invoke('achievements:marks', view.character, marks).catch((e) => showError('Could not save what you track', e))
  }

  const goTo = ([si, ai]: AchRef) => {
    const s = book!.sections[si]
    setQ('')
    setCat(s.cat)
    setSec(secKey(s))
    setOpen({ ...open, [`${secKey(s)} > ${s.ach[ai].n}`]: true })
    setTouched(new Set([`a:${si}:${ai}`]))
    setFlash(`ach-${si}-${ai}`)
  }

  const chooseSection = (key: string, category = curCat) => {
    setCat(category)
    setSec(key)
    setQ('')
    setTouched(new Set())
  }

  const header = (
    <div className="page-head">
      <div>
        <h1>Achievements</h1>
        <p>
          {view.modified ? (
            <>
              {who(view.character)} · from {view.file}, written by the game <Ago t={view.modified} />. Type <GameCommand cmd="/outputfile achievements" /> in game to refresh it;
              this page updates on its own.
            </>
          ) : (
            'Read from the achievements export the game writes into its folder.'
          )}
        </p>
      </div>
      <div className="actions">
        <CharacterPicker character={character} available={chars.available} onPick={setCharacter} />
      </div>
    </div>
  )

  if (view.error || !book) {
    return (
      <>
        {header}
        <div className="card empty">
          {view.error === 'missing' || !character ? (
            <>
              No achievements export for {character ? <b>{who(character)}</b> : 'this character'} yet.
              <br />
              In game, type <GameCommand cmd="/outputfile achievements" />. The game writes the file into its folder and this page picks it up within a few seconds.
            </>
          ) : (
            <>
              Could not read {view.file}: {view.error}
            </>
          )}
        </div>
      </>
    )
  }

  const t = book.totals()
  const pct = t.trackable ? Math.round((t.done / t.trackable) * 100) : 0
  const tracked = new Set(view.marks.tracked ?? [])
  const query = norm(q)

  return (
    <div className="ach">
      {header}

      <div className="card ach-summary">
        <div className="grid three">
          <div className="stat">
            <span className="label">Achievements</span>
            <span className="value">
              {num(t.done)} <small>/ {num(t.trackable)}</small>
            </span>
          </div>
          <div className="stat">
            <span className="label">Required objectives</span>
            <span className="value">
              {num(t.reqDone)} <small>/ {num(t.req)}</small>
            </span>
          </div>
          <div className="stat">
            <span className="label">Sections complete</span>
            <span className="value">
              {t.secsDone} <small>/ {t.secs}</small>
            </span>
          </div>
        </div>
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="small muted">
          <b>{num(t.open)}</b> still open
          {t.opt > 0 && ` · ${num(t.optDone)} of ${num(t.opt)} optional objectives taken`}
        </div>
      </div>

      {track?.route && track.character.toLowerCase() === view.character.toLowerCase() && <Tonight route={track.route} />}
      <Progress character={view.character} />

      {/* Tabs, as every other page's views are: one Tab stop, the arrows between them (LT-697). */}
      <div className="ach-tabs" role="tablist" aria-label="Category">
        {cats.map((c, i) => {
          const s = book.categoryStats(c)
          const open = (to: string) => {
            const first = book.sections.find((x) => x.cat === to)
            chooseSection(first ? secKey(first) : '', to)
          }
          return (
            <button
              key={c}
              role="tab"
              data-cat={c}
              className={`ach-tab${c === curCat && !query ? ' on' : ''}${s.trackable && s.done === s.trackable ? ' complete' : ''}`}
              aria-selected={c === curCat && !query}
              tabIndex={c === curCat ? 0 : -1}
              onClick={() => open(c)}
              onKeyDown={(e) => {
                const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? cats.length - 1 : null
                if (to === null) return
                e.preventDefault()
                const next = cats[(to + cats.length) % cats.length]
                open(next)
                const strip = e.currentTarget.parentElement
                requestAnimationFrame(() => strip?.querySelector<HTMLElement>(`[data-cat="${CSS.escape(next)}"]`)?.focus())
              }}
            >
              {c || 'Achievements'}
              <small>
                {s.done} / {s.trackable}
              </small>
            </button>
          )
        })}
      </div>

      {/* One Tab stop for the sections too: the arrows move between them, Enter or Space opens one (LT-697). */}
      <div className="ach-chips" role="toolbar" aria-label="Section">
        {catSections.map(({ s, si }, i) => {
          const st = book.sectionStats(si)
          const current = cur?.si === si || (!cur && i === 0)
          return (
            <button
              key={si}
              tabIndex={current ? 0 : -1}
              onKeyDown={(e) => {
                const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? catSections.length - 1 : null
                if (to === null) return
                e.preventDefault()
                const buttons = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('button')
                const next = buttons?.[(to + catSections.length) % catSections.length]
                if (!next) return
                e.currentTarget.tabIndex = -1
                next.tabIndex = 0
                next.focus()
              }}
              className={`ach-chip${cur?.si === si && !query ? ' on' : ''}${st.trackable && st.done === st.trackable ? ' complete' : ''}`}
              aria-pressed={cur?.si === si && !query}
              onClick={() => chooseSection(secKey(s))}
            >
              {s.name}
              <small>
                {st.done} / {st.trackable}
              </small>
            </button>
          )
        })}
      </div>

      <div className="row ach-controls">
        <FilterBox className="grow" placeholder="Filter achievements and objectives in every section…" label="Find an achievement or objective" value={q} onChange={setQ} />
        <label className="check">
          <Switch on={remaining} onChange={setRemaining} />
          Remaining only
        </label>
        <button
          className="btn ghost"
          disabled={query.length >= 2}
          title={query.length >= 2 ? 'Showing what the search finds: clear it to open or close a section' : undefined}
          onClick={() => cur && setOpen({ ...open, ...Object.fromEntries(cur.s.ach.map((a) => [`${secKey(cur.s)} > ${a.n}`, true])) })}
        >
          Expand section
        </button>
        <button
          className="btn ghost"
          disabled={query.length >= 2}
          title={query.length >= 2 ? 'Showing what the search finds: clear it to open or close a section' : undefined}
          onClick={() => cur && setOpen({ ...open, ...Object.fromEntries(cur.s.ach.map((a) => [`${secKey(cur.s)} > ${a.n}`, false])) })}
        >
          Collapse section
        </button>
      </div>

      {curCat === 'Slayer' && go && (
        <div className="notice row mb-16">
          <span className="grow">Where to kill for these quickest, step by step, with the raid lockouts beside: the Slayer page.</span>
          <button className="btn small" onClick={() => go('slayer')}>
            Plan these on Slayer
          </button>
        </div>
      )}

      {curCat === 'Slayer' && track?.slayer && track.character.toLowerCase() === view.character.toLowerCase() && <RaceSayer unplaced={track.slayer.unplaced} />}

      <TrackedBar book={book} tracked={view.marks.tracked ?? []} onUntrack={(k) => setTracked(k, false)} goTo={goTo} />

      {query.length >= 2 ? (
        <SearchResults
          book={book}
          query={query}
          ctx={{ remaining, hideOpt, sort, open, setOpen, touched, flash, tick, goTo, since, skills, visited, tracked, setTracked, steps }}
        />
      ) : cur ? (
        <SectionView
          si={cur.si}
          book={book}
          ctx={{ remaining, hideOpt, sort, open, setOpen, touched, flash, tick, goTo, since, skills, visited, tracked, setTracked, steps }}
          setHideOpt={setHideOpt}
          setSort={setSort}
        />
      ) : (
        <div className="empty">No sections in this export.</div>
      )}

      <p className="faint small mt-16">
        Optional objectives never count toward completion, the same way the game scores them. An objective that names another achievement follows that achievement; click it to jump
        there. Your ticks are kept when the game writes a new export.
      </p>
    </div>
  )
}

const PLANNER: Record<RoutePlanner, string> = { faction: 'Faction plan', slayer: 'Slayer', hunter: 'Hunter' }

/**
 * Where to go tonight (FEAT-031): the zones the faction plan you follow, the Slayer plan on your
 * overlay and the open Hunter achievements want, the zones more of them want first, with what each
 * wants there and about how long. Each planner keeps its own order: this is where they meet.
 */
function Tonight({ route }: { route: RouteZone[] }) {
  const [open, setOpen] = useRemembered('ach.tonight', false)
  const shared = route.filter((z) => z.planners > 1).length
  return (
    <details className="card mb-16" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <b>Where to go</b>{' '}
        <span className="faint small">
          {route.length} zone{route.length === 1 ? '' : 's'} your plans want{shared ? `, ${shared} by more than one` : ''}
        </span>
      </summary>
      <table className="table mt-8">
        <tbody>
          {route.map((z) => (
            <tr key={z.zone}>
              <td className="nowrap">
                <b>{z.zone}</b>
                {z.planners > 1 && <span className="chip ok small">{z.planners} plans</span>}
              </td>
              <td className="small">
                {z.parts.slice(0, 4).map((p) => (
                  <div key={`${p.planner}|${p.title}`}>
                    <span className="faint">{PLANNER[p.planner]}</span> · {p.title}
                  </div>
                ))}
                {z.parts.length > 4 && <div className="faint">+{z.parts.length - 4} more</div>}
              </td>
              <td className="mono nowrap faint">{z.seconds > 0 ? `≈ ${duration(z.seconds)}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
