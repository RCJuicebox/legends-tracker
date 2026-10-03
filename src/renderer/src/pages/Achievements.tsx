import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CharacterPicker } from '../components/CharacterPicker'
import { api } from '../api'
import { useRemembered } from '../remember'
import { usePickedCharacter } from '../character'
import { useAchievementTrack, useInvoke } from '../hooks'
import { showError, showToast } from '../toast'
import { Ago, FilterBox, GameCommand, Pending } from '../components/ui'
import { numExact as num, who } from '../../../core/format'
import { AchievementBook, norm, secKey, type AchMarks, type AchRef, type ObjRef } from '../../../core/achievements'
import type { AchievementsView } from '../../../shared/types'
import { SectionView, SearchResults, TrackedBar } from './AchievementRows'

/** Open and closed blocks are remembered by name; at most this many, the newest kept. */
const OPEN_KEEP = 1000

function useAchievements() {
  const charsQ = useInvoke('achievements:characters')
  const chars = charsQ.data
  const reloadChars = charsQ.reload
  const [picked, setPicked] = usePickedCharacter()
  const character = picked && chars?.available.includes(picked) ? picked : chars?.current || chars?.available[0] || ''
  const viewQ = useInvoke(chars ? 'achievements:load' : null, [character])
  const setView = viewQ.setData
  useEffect(() => {
    if (!chars) return
    return api.on('state:achievements', (v: AchievementsView) => {
      if (v.character === character) setView(v)
      // A character's first export: it joins the list.
      if (!chars.available.includes(v.character)) reloadChars()
    })
  }, [character, chars, setView, reloadChars])
  const retry = () => {
    reloadChars()
    viewQ.reload()
  }
  return { chars, character, setCharacter: setPicked, view: viewQ.data, setView, error: charsQ.error || viewQ.error, retry }
}

export function Achievements() {
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
        <div className="ach-track">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="small muted">
          <b>{num(t.open)}</b> still open
          {t.opt > 0 && ` · ${num(t.optDone)} of ${num(t.opt)} optional objectives taken`}
        </div>
      </div>

      <div className="ach-tabs" role="group" aria-label="Category">
        {cats.map((c) => {
          const s = book.categoryStats(c)
          return (
            <button
              key={c}
              className={`ach-tab${c === curCat && !query ? ' on' : ''}${s.trackable && s.done === s.trackable ? ' complete' : ''}`}
              aria-pressed={c === curCat && !query}
              onClick={() => {
                const first = book.sections.find((x) => x.cat === c)
                chooseSection(first ? secKey(first) : '', c)
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

      <div className="ach-chips" role="group" aria-label="Section">
        {catSections.map(({ s, si }) => {
          const st = book.sectionStats(si)
          return (
            <button
              key={si}
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
        <button className={`btn${remaining ? ' on' : ' ghost'}`} aria-pressed={remaining} onClick={() => setRemaining(!remaining)}>
          Remaining only
        </button>
        <button className="btn ghost" onClick={() => cur && setOpen({ ...open, ...Object.fromEntries(cur.s.ach.map((a) => [`${secKey(cur.s)} > ${a.n}`, true])) })}>
          Expand all
        </button>
        <button className="btn ghost" onClick={() => cur && setOpen({ ...open, ...Object.fromEntries(cur.s.ach.map((a) => [`${secKey(cur.s)} > ${a.n}`, false])) })}>
          Collapse all
        </button>
      </div>

      <TrackedBar book={book} tracked={view.marks.tracked ?? []} onUntrack={(k) => setTracked(k, false)} goTo={goTo} />

      {query.length >= 2 ? (
        <SearchResults book={book} query={query} ctx={{ remaining, hideOpt, sort, open, setOpen, touched, flash, tick, goTo, since, skills, tracked, setTracked }} />
      ) : cur ? (
        <SectionView
          si={cur.si}
          book={book}
          ctx={{ remaining, hideOpt, sort, open, setOpen, touched, flash, tick, goTo, since, skills, tracked, setTracked }}
          setHideOpt={setHideOpt}
          setSort={setSort}
        />
      ) : (
        <div className="empty">No sections in this export.</div>
      )}

      <p className="faint small mt-18">
        Optional objectives never count toward completion, the same way the game scores them. An objective that names another achievement follows that achievement; click it to jump
        there. Your ticks are kept when the game writes a new export.
      </p>
    </div>
  )
}
