import { Disclosure, Switch, Tip } from '../components/ui'
import { useApp } from '../state'
import { numExact as num } from '../../../core/format'
import { AchievementBook, achKey, compareNames, norm, placeOf, secKey, type AchObjective, type AchRef, type Achievement, type ObjRef } from '../../../core/achievements'
import { HUNT } from '../../../core/achievementHunt'
import type { SkillRow } from '../../../shared/tracking'

// The Achievements page's sections and rows: each achievement, its objectives and progress, the tracked bar and search results.

/** "Reach the maximum skill in Divination at level 50.": the skill. */
const SKILL_OBJECTIVE = /^Reach the maximum skill in (.+?) at level \d+\.?$/

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
  /** Slayer kills the log has shown since the export, and whether the game has said it is done, by lower-cased achievement name (the character being played only). */
  since: Map<string, { since: number; done: boolean }>
  /** The skill a skill objective wants, as the log last gave it and the cap to reach, by "achievement|skill" lower-cased (the character being played only). */
  skills: Map<string, SkillRow>
  /** Achievements kept on the achievements overlay, by achKey(). */
  tracked: Set<string>
  setTracked: (key: string, on: boolean) => void
}

interface Entry {
  ai: number
  a: Achievement
  rows: { c: AchObjective; ci: number }[]
  single: boolean
}

/** The blocks of one section, filtered by search, Remaining only and Hide optional, then sorted. */
export function sectionBody(book: AchievementBook, si: number, query: string, ctx: Ctx) {
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

export function Blocks({ book, si, entries, query, ctx }: { book: AchievementBook; si: number; entries: Entry[]; query: string; ctx: Ctx }) {
  // Single-objective achievements sit together in a compact grid, between the full blocks.
  const out: React.ReactNode[] = []
  let singles: React.ReactNode[] = []
  const flush = () => {
    if (singles.length)
      out.push(
        <div key={`s${out.length}`} className="ach-singles">
          {singles}
        </div>
      )
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

export function SectionView({
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
          title={st.opt ? undefined : 'No optional objectives in this section'}
          onClick={() => setHideOpt({ ...ctx.hideOpt, [k]: !ctx.hideOpt[k] })}
        >
          Hide optional
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

export function SearchResults({ book, query, ctx }: { book: AchievementBook; query: string; ctx: Ctx }) {
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

export function NamesLine({ label, names }: { label: string; names: string[] }) {
  if (!names.length) return null
  return (
    <p className="small muted ach-names">
      {label}:{' '}
      {names.map((n, i) => (
        <span key={i}>
          {i > 0 && ', '}
          <b>{n}</b>
        </span>
      ))}
    </p>
  )
}

export function Block({ book, r, rows, query, ctx }: { book: AchievementBook; r: AchRef; rows: { c: AchObjective; ci: number }[]; query: string; ctx: Ctx }) {
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
        {st.opt > 0 && (
          <em>
            {' '}
            · {st.optDone} / {st.opt} opt
          </em>
        )}
        {st.ign > 0 && <em> · {st.ign} broken</em>}
        {state === 'blocked' && <em> · blocked</em>}
      </>
    )
  return (
    <div id={`ach-${si}-${ai}`} className={`ach-blk ${state}${isOpen ? ' open' : ''}${ctx.flash === `ach-${si}-${ai}` ? ' flash' : ''}`}>
      <div className="ach-blkhead">
        <Disclosure className="ach-open" open={isOpen} onToggle={() => ctx.setOpen({ ...ctx.open, [key]: !isOpen })}>
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
        </Disclosure>
        <span className="ach-count">{count}</span>
        <span className="ach-bar">
          <i style={{ width: `${pct}%` }} />
        </span>
        <TrackStar k={achKey(s, a)} name={a.n} ctx={ctx} />
      </div>
      {isOpen && (
        <div className={`ach-objs${book.hasZoneColumn(r) ? ' zoned' : ''}`}>
          {rows.length ? (
            rows.map(({ c, ci }) => <ObjectiveRow key={ci} book={book} r={[si, ai, ci]} c={c} label={c.t} ctx={ctx} />)
          ) : (
            <div className="faint small p-8">{ctx.remaining && !query ? 'Nothing left here.' : 'No matches.'}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function SingleRow({ book, r, ctx }: { book: AchievementBook; r: AchRef; ctx: Ctx }) {
  const a = book.ach(r)
  const c = a.c[0]
  const state = book.state(r)
  const sub = norm(c.t) === norm(a.n) ? undefined : c.t
  const done = book.objDone([...r, 0])
  const hunt = HUNT[norm(a.n)]
  return (
    <div id={`ach-${r[0]}-${r[1]}`} className={`ach-single ${state}${ctx.flash === `ach-${r[0]}-${r[1]}` ? ' flash' : ''}`}>
      <ObjectiveRow book={book} r={[...r, 0]} c={c} label={a.n} sub={sub} ctx={ctx} single />
      <TrackStar k={achKey(book.sections[r[0]], a)} name={a.n} ctx={ctx} />
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

export function ObjectiveRow({
  book,
  r,
  c,
  label,
  sub,
  ctx,
  single
}: {
  book: AchievementBook
  r: ObjRef
  c: AchObjective
  label: string
  sub?: string
  ctx: Ctx
  single?: boolean
}) {
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
    const tip = !others.length
      ? ''
      : kin
        ? `One kill counts for ${others.join(', ')} too. Ticking it here ticks it there.`
        : `Also listed in ${others.join(', ')}, but that is a separate kill.`
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
  // A Slayer count goes on with the kills since the export, as the log shows them; one the game said is done is done.
  const live = c.p && !c.d ? ctx.since.get(book.ach([r[0], r[1]]).n.toLowerCase()) : undefined
  const more = live?.since ?? 0
  const count = c.p ? (live?.done ? c.p[1] : Math.min(c.p[1], c.p[0] + more)) : 0
  const liveTitle = live?.done
    ? 'The game said this was completed since your achievements export. Type /outputfile achievements in game to record it.'
    : more && c.p
      ? `${num(c.p[0])} at your achievements export, and ${num(more)} kills since that the log shows (yours, your pet's and your group's)`
      : undefined
  // A skill objective ("Reach the maximum skill in Divination at level 50.") shows the skill as the log last gave it, against the cap to reach.
  const skillGoal = SKILL_OBJECTIVE.exec(c.t)
  const skill = skillGoal ? ctx.skills.get(`${book.ach([r[0], r[1]]).n}|${skillGoal[1]}`.toLowerCase()) : undefined
  const skillProg =
    skill && skill.target > 0 ? (
      skill.value === null ? (
        <Tip className="chip" text={`No skill-up for ${skill.skill} in your logs: raise it once and it shows here. One raised at a guildmaster prints no line.`}>
          not in your logs
        </Tip>
      ) : (
        <Tip
          className="ach-prog"
          text={`${skill.skill} ${num(skill.value)} when the log last saw it go up; ${num(skill.target)} is the best cap of your classes at level ${skill.level}. One raised at a guildmaster prints no line, so it may be higher.`}
        >
          <span>
            {num(skill.value)} / {num(skill.target)}
            {skill.value >= skill.target && <b className="ach-more"> ✓</b>}
          </span>
          <i style={{ width: `${Math.min(100, Math.round((skill.value / skill.target) * 100))}%` }} />
        </Tip>
      )
    ) : null
  const bar = (
    <>
      <span>
        {num(count)} / {num(c.p?.[1] ?? 0)}
        {live?.done ? <b className="ach-more"> ✓ done</b> : more > 0 && <b className="ach-more"> +{num(more)}</b>}
      </span>
      <i style={{ width: `${Math.min(100, Math.round((count / Math.max(1, c.p?.[1] ?? 1)) * 100))}%` }} />
    </>
  )
  const prog = c.p ? (
    liveTitle ? (
      <Tip className="ach-prog" text={liveTitle}>
        {bar}
      </Tip>
    ) : (
      <span className="ach-prog">{bar}</span>
    )
  ) : null
  return (
    <label className={`ach-obj${done ? ' done' : ''}${single ? ' single' : ''}${fromGame ? ' recorded' : ''}`} title={fromGame ? 'The game has recorded this one.' : undefined}>
      <input type="checkbox" checked={done} disabled={fromGame} onChange={(e) => ctx.tick(r, e.target.checked)} />
      <span className="ach-box" />
      {name}
      {optional}
      {prog ?? skillProg}
      {zone}
    </label>
  )
}

/** The star that keeps an achievement on the achievements overlay. */
export function TrackStar({ k, name, ctx }: { k: string; name: string; ctx: Ctx }) {
  const on = ctx.tracked.has(k)
  return (
    <button
      className={`ach-star${on ? ' on' : ''}`}
      aria-pressed={on}
      aria-label={on ? `Stop tracking ${name}` : `Track ${name}`}
      title={on ? 'Tracked: on the achievements overlay with its progress. Click to stop.' : 'Track: keep it on the achievements overlay with its progress'}
      onClick={() => ctx.setTracked(k, !on)}
    >
      {on ? '★' : '☆'}
    </button>
  )
}

/**
 * What is tracked, at the top of the page: a click goes to one, ✕ stops tracking it. With the
 * achievements overlay's switch, since what is tracked shows there.
 */
export function TrackedBar({ book, tracked, onUntrack, goTo }: { book: AchievementBook; tracked: string[]; onUntrack: (k: string) => void; goTo: (r: AchRef) => void }) {
  const { state, patchSettings } = useApp()
  if (!tracked.length) return null
  const where = new Map<string, AchRef>()
  book.sections.forEach((s, si) => s.ach.forEach((a, ai) => where.set(achKey(s, a), [si, ai])))
  const overlay = state.settings.overlays.find((o) => o.kind === 'achievements')
  return (
    <div className="card row ach-tracked">
      <span className="faint small">Tracked</span>
      {tracked.map((k) => {
        const r = where.get(k)
        const name = r ? book.ach(r).n : k.slice(k.indexOf(' > ') + 3)
        return (
          <span
            key={k}
            className={`chip ach-tracked-chip${r ? '' : ' gone'}`}
            title={r ? `${k.slice(0, k.indexOf(' > '))}: click to go there` : 'Not in this export: done, or gone'}
          >
            {r ? (
              <button className="link-button" onClick={() => goTo(r)}>
                {name}
              </button>
            ) : (
              <span>{name}</span>
            )}
            <button className="ach-untrack" aria-label={`Stop tracking ${name}`} title="Stop tracking" onClick={() => onUntrack(k)}>
              ✕
            </button>
          </span>
        )
      })}
      <span className="spacer" />
      {overlay && (
        <label className="row tight small faint" title="The achievements overlay, over the game: what you track, with its progress">
          <Switch
            on={overlay.visible}
            label="Show the achievements overlay"
            onChange={(on) => void patchSettings((s) => ({ ...s, overlays: s.overlays.map((o) => (o.kind === 'achievements' ? { ...o, visible: on } : o)) }))}
          />
          Show on the game
        </label>
      )}
    </div>
  )
}
