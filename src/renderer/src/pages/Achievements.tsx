import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ago } from '../api'
import { useRemembered } from '../remember'
import { useInvoke } from '../hooks'
import { showError } from '../toast'
import { Pending } from '../components/ui'
import { numExact as num, who } from '../format'
import {
  AchievementBook,
  compareNames,
  norm,
  placeOf,
  secKey,
  type AchMarks,
  type AchObjective,
  type AchRef,
  type Achievement,
  type ObjRef
} from '../../../core/achievements'
import { HUNT } from '../../../core/achievementHunt'
import type { AchievementsView } from '../../../shared/types'

const isKill = (sectionName: string) => /hunter|raids/i.test(sectionName)

interface Toast {
  id: number
  body: ReactNode
}

/** Open and closed blocks are remembered by name; at most this many, the newest kept. */
const OPEN_KEEP = 1000

function useAchievements() {
  const charsQ = useInvoke<{ current: string; available: string[] }>('achievements:characters')
  const chars = charsQ.data
  const reloadChars = charsQ.reload
  const [picked, setPicked] = useRemembered<string>('ach.character', '')
  const character = picked && chars?.available.includes(picked) ? picked : chars?.current || chars?.available[0] || ''
  const viewQ = useInvoke<AchievementsView>(chars ? 'achievements:load' : null, [character])
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
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const book = useMemo(() => (view ? new AchievementBook(view.sections, { ticks: view.marks.ticks, broken: [] }) : null), [view])
  const cats = useMemo(() => book?.categories() ?? [], [book])
  const curCat = cats.includes(cat) ? cat : (cats[0] ?? '')
  const catSections = book ? book.sections.map((s, si) => ({ s, si })).filter((x) => x.s.cat === curCat) : []
  const cur = catSections.find((x) => secKey(x.s) === sec) ?? catSections[0]

  // Forget blocks no longer in the book, and keep the list from growing without end.
  // An export that failed to read has no sections; that is no reason to forget anything.
  const readFailed = !!view?.error
  const known = useMemo(
    () => (book && book.sections.length ? new Set(book.sections.flatMap((s) => s.ach.map((a) => `${secKey(s)} > ${a.n}`))) : null),
    [book]
  )
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

  const toast = (body: ReactNode) => {
    const id = ++toastId.current
    setToasts((t) => [...t.slice(-3), { id, body }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }

  const saveMarks = (next: AchMarks) => {
    const marks: AchMarks = { ticks: next.ticks, broken: [] }
    const before = book!
    const after = new AchievementBook(view.sections, marks)
    const newlyDone: string[] = []
    after.sections.forEach((s, si) => s.ach.forEach((a, ai) => after.achDone([si, ai]) && !before.achDone([si, ai]) && newlyDone.push(a.n)))
    for (const n of [...new Set(newlyDone)])
      toast(
        <>
          You have completed the achievement: <b>{n}</b>
        </>
      )
    setView({ ...view, marks })
    api.invoke('achievements:marks', view.character, marks).catch((e) => showError('Could not save your ticks', e))
  }

  const tick = (r: ObjRef, on: boolean) => {
    const targets = book!.tickTargets(r)
    setTouched((t) => new Set([...t, ...targets.map(([si, ai, ci]) => `${si}:${ai}:${ci}`), ...targets.map(([si, ai]) => `a:${si}:${ai}`)]))
    const c = book!.sections[r[0]].ach[r[1]].c[r[2]]
    if (on && isKill(book!.sections[r[0]].name))
      toast(
        <>
          You have slain <b>{c.t}</b>!
        </>
      )
    saveMarks(book!.withTick(r, on, view.marks))
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
          {view.modified
            ? `${who(view.character)} · from ${view.file}, written by the game ${ago(view.modified)}. Type /outputfile achievements in game to refresh it; this page updates on its own.`
            : 'Read from the achievements export the game writes into its folder.'}
        </p>
      </div>
      {chars.available.length > 1 && (
        <div className="actions">
          <select aria-label="Character" value={character} onChange={(e) => setCharacter(e.target.value)}>
            {chars.available.map((c) => (
              <option key={c} value={c}>
                {who(c)}
              </option>
            ))}
          </select>
        </div>
      )}
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
              In game, type <span className="mono">/outputfile achievements</span>. The game writes the file into its folder and this page picks it up within a few seconds.
            </>
          ) : (
            <>Could not read {view.file}: {view.error}</>
          )}
        </div>
      </>
    )
  }

  const t = book.totals()
  const pct = t.trackable ? Math.round((t.done / t.trackable) * 100) : 0
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
        <input className="grow" type="search" placeholder="Find an achievement or objective in any section" aria-label="Find an achievement or objective" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={`btn${remaining ? ' on' : ' ghost'}`} aria-pressed={remaining} onClick={() => setRemaining(!remaining)}>
          Remaining only
        </button>
        <button
          className="btn ghost"
          onClick={() => cur && setOpen({ ...open, ...Object.fromEntries(cur.s.ach.map((a) => [`${secKey(cur.s)} > ${a.n}`, true])) })}
        >
          Expand all
        </button>
        <button
          className="btn ghost"
          onClick={() => cur && setOpen({ ...open, ...Object.fromEntries(cur.s.ach.map((a) => [`${secKey(cur.s)} > ${a.n}`, false])) })}
        >
          Collapse all
        </button>
      </div>

      {query.length >= 2 ? (
        <SearchResults book={book} query={query} ctx={{ remaining, hideOpt, sort, open, setOpen, touched, flash, tick, goTo }} />
      ) : cur ? (
        <SectionView si={cur.si} book={book} ctx={{ remaining, hideOpt, sort, open, setOpen, touched, flash, tick, goTo }} setHideOpt={setHideOpt} setSort={setSort} />
      ) : (
        <div className="empty">No sections in this export.</div>
      )}

      <p className="faint small mt-18">
        Optional objectives never count toward completion, the same way the game scores them. An objective that names another
        achievement follows that achievement; click it to jump there. Your ticks are kept when the game writes a new export.
      </p>

      <div className="ach-toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className="ach-toast">
            {x.body}
          </div>
        ))}
      </div>
    </div>
  )
}

interface Ctx {
  remaining: boolean
  hideOpt: Record<string, boolean>
  sort: Record<string, { row?: number; blk?: number }>
  open: Record<string, boolean>
  setOpen: (v: Record<string, boolean>) => void
  touched: Set<string>
  flash: string
  tick: (r: ObjRef, on: boolean) => void
  goTo: (r: AchRef) => void
}

interface Entry {
  ai: number
  a: Achievement
  rows: { c: AchObjective; ci: number }[]
  single: boolean
}

/** The blocks of one section, filtered by search, Remaining only and Hide optional, then sorted. */
function sectionBody(book: AchievementBook, si: number, query: string, ctx: Ctx) {
  const s = book.sections[si]
  const k = secKey(s)
  const hide = !!ctx.hideOpt[k]
  const sort = ctx.sort[k] ?? {}
  const done: string[] = []
  const broken: string[] = []
  const blocked: string[] = []
  const entries: Entry[] = []
  s.ach.forEach((a, ai) => {
    const state = book.state([si, ai])
    const touched = ctx.touched.has(`a:${si}:${ai}`)
    const achMatch = query && norm(a.n).includes(query)
    let rows = a.c.map((c, ci) => ({ c, ci }))
    if (query && !achMatch) rows = rows.filter((r) => norm(r.c.t).includes(query))
    if (query && !achMatch && !rows.length) return
    if (hide) {
      rows = rows.filter((r) => !r.c.o)
      if (!rows.length && a.c.length && a.c.every((c) => c.o)) return
    }
    if (ctx.remaining && !query && !touched && state !== 'open') {
      ;(state === 'done' ? done : state === 'broken' ? broken : blocked).push(a.n)
      return
    }
    if (ctx.remaining && !touched) rows = rows.filter((r) => !book.objDone([si, ai, r.ci]) || ctx.touched.has(`${si}:${ai}:${r.ci}`))
    if (sort.row) rows = [...rows].sort((x, y) => sort.row! * compareNames(x.c.t, y.c.t))
    entries.push({ ai, a, rows, single: a.c.length === 1 })
  })
  if (sort.blk) entries.sort((x, y) => sort.blk! * compareNames(placeOf(x.a) ?? x.a.n, placeOf(y.a) ?? y.a.n))
  return { entries, done, broken, blocked }
}

function Blocks({ book, si, entries, query, ctx }: { book: AchievementBook; si: number; entries: Entry[]; query: string; ctx: Ctx }) {
  // Single-objective achievements sit together in a compact grid, between the full blocks.
  const out: React.ReactNode[] = []
  let singles: React.ReactNode[] = []
  const flush = () => {
    if (singles.length) out.push(<div key={`s${out.length}`} className="ach-singles">{singles}</div>)
    singles = []
  }
  for (const e of entries) {
    if (e.single) {
      if (e.rows.length) singles.push(<SingleRow key={e.ai} book={book} r={[si, e.ai]} ctx={ctx} />)
      continue
    }
    flush()
    out.push(<Block key={e.ai} book={book} r={[si, e.ai]} rows={e.rows} query={query} ctx={ctx} />)
  }
  flush()
  return <>{out}</>
}

function SectionView({
  book,
  si,
  ctx,
  setHideOpt,
  setSort
}: {
  book: AchievementBook
  si: number
  ctx: Ctx
  setHideOpt: (v: Record<string, boolean>) => void
  setSort: (v: Record<string, { row?: number; blk?: number }>) => void
}) {
  const s = book.sections[si]
  const k = secKey(s)
  const st = book.sectionStats(si)
  const body = sectionBody(book, si, '', ctx)
  const sort = ctx.sort[k] ?? {}
  const zoned = s.ach.some((_, ai) => book.hasZoneColumn([si, ai]))
  const sortBtn = (which: 'row' | 'blk', label: string) => {
    const d = sort[which] ?? 0
    return (
      <button
        className={`btn small${d ? ' on' : ' ghost'}`}
        aria-pressed={!!d}
        title={`Sort by ${label}, then reverse, then back to the game's own order`}
        onClick={() => setSort({ ...ctx.sort, [k]: { ...sort, [which]: d === 1 ? -1 : d === -1 ? 0 : 1 } })}
      >
        {label} {d === 1 ? '▲' : d === -1 ? '▼' : ''}
      </button>
    )
  }
  return (
    <section className={`card ach-section${st.trackable > 0 && st.done === st.trackable ? ' complete' : ''}`}>
      <div className="ach-sechead">
        <div>
          <div className="faint small">{s.cat || 'Achievements'}</div>
          <h2>{s.name}</h2>
        </div>
        <div className="small muted">
          {st.done} / {st.trackable} achievements
          <br />
          {num(st.reqDone)} / {num(st.req)} objectives{st.opt ? ` · ${st.optDone} / ${st.opt} optional` : ''}
        </div>
        <span className="grow" />
        <span className="faint small">Sort</span>
        {sortBtn('row', zoned ? 'Named' : 'Objective')}
        {sortBtn('blk', zoned ? 'Zone' : 'Achievement')}
        <button
          className={`btn small${ctx.hideOpt[k] ? ' on' : ' ghost'}`}
          aria-pressed={!!ctx.hideOpt[k]}
          disabled={!st.opt}
          title={st.opt ? '' : 'No optional objectives in this section'}
          onClick={() => setHideOpt({ ...ctx.hideOpt, [k]: !ctx.hideOpt[k] })}
        >
          {st.opt ? 'Hide optional' : 'No optional'}
        </button>
      </div>
      {body.entries.length ? (
        <Blocks book={book} si={si} entries={body.entries} query="" ctx={ctx} />
      ) : (
        <div className="empty">{ctx.remaining ? 'Nothing open here.' : 'Nothing to show.'}</div>
      )}
      <NamesLine label="Complete" names={body.done} />
    </section>
  )
}

function SearchResults({ book, query, ctx }: { book: AchievementBook; query: string; ctx: Ctx }) {
  let hits = 0
  for (const s of book.sections) for (const a of s.ach) if (norm(a.n).includes(query) || a.c.some((c) => norm(c.t).includes(query))) hits++
  if (!hits) return <div className="empty">Nothing matches "{query}".</div>
  if (hits > 250) return <div className="empty">{num(hits)} achievements match. Keep typing to narrow it down.</div>
  return (
    <>
      {book.sections.map((s, si) => {
        const body = sectionBody(book, si, query, ctx)
        if (!body.entries.length) return null
        return (
          <section key={si} className="card ach-section">
            <h3 className="ach-grp">{secKey(s)}</h3>
            <Blocks book={book} si={si} entries={body.entries} query={query} ctx={ctx} />
          </section>
        )
      })}
    </>
  )
}

function NamesLine({ label, names }: { label: string; names: string[] }) {
  if (!names.length) return null
  return (
    <p className="small muted ach-names">
      {label}: {names.map((n, i) => (
        <span key={i}>
          {i > 0 && ', '}
          <b>{n}</b>
        </span>
      ))}
    </p>
  )
}

function Block({ book, r, rows, query, ctx }: { book: AchievementBook; r: AchRef; rows: { c: AchObjective; ci: number }[]; query: string; ctx: Ctx }) {
  const [si, ai] = r
  const s = book.sections[si]
  const a = book.ach(r)
  const st = book.counts(r)
  const state = book.state(r)
  const key = `${secKey(s)} > ${a.n}`
  const isOpen = query ? true : (ctx.open[key] ?? state !== 'done')
  const pct = st.req ? Math.round((st.done / st.req) * 100) : state === 'done' ? 100 : 0
  const twins = book.twinsOf(r)
  let count: React.ReactNode
  if (state === 'broken') count = 'broken'
  else if (!(st.req + st.opt + st.ign)) count = state === 'done' ? 'complete' : '—'
  else
    count = (
      <>
        {st.done} / {st.req}
        {st.opt > 0 && <em> · {st.optDone} / {st.opt} opt</em>}
        {st.ign > 0 && <em> · {st.ign} broken</em>}
        {state === 'blocked' && <em> · blocked</em>}
      </>
    )
  return (
    <div id={`ach-${si}-${ai}`} className={`ach-blk ${state}${isOpen ? ' open' : ''}${ctx.flash === `ach-${si}-${ai}` ? ' flash' : ''}`}>
      <div className="ach-blkhead">
        <button className="ach-open" aria-expanded={isOpen} onClick={() => ctx.setOpen({ ...ctx.open, [key]: !isOpen })}>
          <span className="caret" />
          <span className="ach-name">{a.n}</span>
          {twins && (
            <span
              className="chip"
              title={`Also listed under ${twins
                .filter((p) => p[0] !== si)
                .map((p) => secKey(book.sections[p[0]]))
                .join(', ')}. One tick covers both.`}
            >
              twin
            </span>
          )}
        </button>
        <span className="ach-count">{count}</span>
        <span className="ach-bar">
          <i style={{ width: `${pct}%` }} />
        </span>
      </div>
      {isOpen && (
        <div className={`ach-objs${book.hasZoneColumn(r) ? ' zoned' : ''}`}>
          {rows.length ? (
            rows.map(({ c, ci }) => <ObjectiveRow key={ci} book={book} r={[si, ai, ci]} c={c} label={c.t} ctx={ctx} />)
          ) : (
            <div className="faint small p-8">
              {ctx.remaining && !query ? 'Nothing left here.' : 'No matches.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SingleRow({ book, r, ctx }: { book: AchievementBook; r: AchRef; ctx: Ctx }) {
  const a = book.ach(r)
  const c = a.c[0]
  const state = book.state(r)
  const sub = norm(c.t) === norm(a.n) ? undefined : c.t
  const done = book.objDone([...r, 0])
  const hunt = HUNT[norm(a.n)]
  return (
    <div id={`ach-${r[0]}-${r[1]}`} className={`ach-single ${state}${ctx.flash === `ach-${r[0]}-${r[1]}` ? ' flash' : ''}`}>
      <ObjectiveRow book={book} r={[...r, 0]} c={c} label={a.n} sub={sub} ctx={ctx} single />
      {!done && hunt && (
        <div className="ach-hunt">
          <span>Try</span>{' '}
          {hunt.length
            ? hunt.map(([zone, , lo, hi], i) => (
                <span key={zone}>
                  {i > 0 && ' · '}
                  <b>{zone}</b>
                  {lo !== undefined && (
                    <em>
                      {' '}
                      L{lo}
                      {hi !== undefined && hi !== lo ? `–${hi}` : ''}
                    </em>
                  )}
                </span>
              ))
            : 'nowhere yet: the wiki lists these only in zones not live on EverQuest Legends.'}
        </div>
      )}
    </div>
  )
}

function ObjectiveRow({ book, r, c, label, sub, ctx, single }: { book: AchievementBook; r: ObjRef; c: AchObjective; label: string; sub?: string; ctx: Ctx; single?: boolean }) {
  const done = book.objDone(r)
  const ignored = !done && book.objIgnored(r)
  const to = book.link(r)
  const name = (
    <span className="ach-objname">
      {label}
      {sub && <span className="ach-sub">{sub}</span>}
    </span>
  )
  const optional = c.o ? <span className="chip">optional</span> : null
  if (to) {
    const ts = book.state(to)
    return (
      <button
        className={`ach-obj linked${done ? ' done' : ''}${ignored ? ' ign' : ''}${single ? ' single' : ''}`}
        title={`Follows "${book.ach(to).n}". Click to go there.`}
        onClick={() => ctx.goTo(to)}
      >
        <span className="ach-box" />
        {name}
        {optional}
        <span className="chip">{ts === 'broken' ? 'broken' : ts === 'blocked' ? 'blocked' : 'linked'}</span>
      </button>
    )
  }
  const fromGame = book.fromGame(r)
  let zone: React.ReactNode = null
  const place = single ? null : placeOf(book.ach([r[0], r[1]]))
  if (place) {
    const others = book.otherPlaces(c, place)
    const kin = book.kinOf(r).length > 0
    const tip = !others.length ? '' : kin ? `One kill counts for ${others.join(', ')} too. Ticking it here ticks it there.` : `Also listed in ${others.join(', ')}, but that is a separate kill.`
    zone = (
      <span className={`ach-zone${kin ? ' kin' : ''}`} title={tip}>
        {place}
        {others.length > 0 && (
          <b>
            {' '}
            {kin ? '=' : '+'}
            {others.length}
          </b>
        )}
      </span>
    )
  }
  const prog = c.p ? (
    <span className="ach-prog">
      <span>
        {num(c.p[0])} / {num(c.p[1])}
      </span>
      <i style={{ width: `${Math.min(100, Math.round((c.p[0] / Math.max(1, c.p[1])) * 100))}%` }} />
    </span>
  ) : null
  return (
    <label className={`ach-obj${done ? ' done' : ''}${single ? ' single' : ''}${fromGame ? ' recorded' : ''}`} title={fromGame ? 'The game has recorded this one.' : undefined}>
      <input type="checkbox" checked={done} disabled={fromGame} onChange={(e) => ctx.tick(r, e.target.checked)} />
      <span className="ach-box" />
      {name}
      {optional}
      {prog}
      {zone}
    </label>
  )
}
