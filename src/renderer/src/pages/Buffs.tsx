import { useEffect, useMemo, useState } from 'react'
import { api, clock } from '../api'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { act } from '../toast'
import { useNow } from '../components/TimerBars'
import { Info, Pending } from '../components/ui'
import { wikiUrl } from '../format'
import { CLASSES } from '../../../core/acModel'
import { askText, canCast, LINE_LABELS, MIN_ASK_VALUE, MIN_BUFF_SEC, offersFor, YOU, type BuffLine, type BuffOffer, type BuffPlan, type BuffView } from '../../../core/buffs'

// What the group can buff you with: who is in it (and their classes, from /who), what is on you
// now, what to ask for, and the list of every class's buffs to pick the wanted ones from.

const LINE_ORDER: BuffLine[] = ['hpac', 'haste', 'spellHaste', 'manaRegen', 'hpRegen', 'ds', 'rune', 'attack', 'proc', 'stats', 'mana', 'resist', 'move', 'other']

function useBuffs() {
  const q = useInvoke<BuffView>('buffs:get')
  const setData = q.setData
  useEffect(() => api.on('state:buffs', (v: BuffView) => setData(v)), [setData])
  return q
}

const code = (c: string) => c.toUpperCase()
const minutes = (sec: number) => (Number.isFinite(sec) ? (sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m` : `${Math.round(sec / 60)}m`) : 'permanent')
const effectText = (o: BuffOffer) => o.effects.map((e) => `${e.label}${e.value ? ` ${e.value}` : ''}`).join(', ')

const CLASS_LABEL = new Map<string, string>(CLASSES.map(([id, label]) => [id, label]))
const casters = (o: BuffOffer) =>
  Object.entries(o.classes)
    .sort((a, b) => a[1] - b[1])
    .map(([c, l]) => `${CLASS_LABEL.get(c) ?? c} ${l}`)
    .join(', ')

const HOW =
  'Classes come from /who: type /who <name> for anyone in the group the tracker does not know yet, and /who <your name> for your own. Self-only ' +
  'buffs are listed too (marked self), as are permanent procs and utility buffs (combat innates, poisons, Breath of the Dead; not vision): whatever ' +
  'your own classes can cast is yours to keep up, group or no group, and the reminder says "Cast …" for it. A buff counts as on you from its ' +
  `"you feel…" line, matched to the cast just before it, until its fade line (or death). Songs and buffs under ${MIN_BUFF_SEC / 60} minutes are left ` +
  'out. What to ask for is the best combination that stacks, by the game’s own stacking rules: two buffs with the same effect in the same ' +
  'slot do not stack and the stronger holds; some block or overwrite others below a set strength, worked out at the caster’s level, so the order ' +
  'they land in can matter (a level-50 Strength stays on under Harnessing of Spirit, but not the other way round), and the combination says ' +
  'when it does. Of the buffs you pick that your group can cast, and what is on you already, it is the set worth the most. A buff is worth its ' +
  `HP plus 2 a point of AC, 1.5 of STA, 1 of other stats, nothing for CHA; buffs worth under ${MIN_ASK_VALUE} are not asked for. Durations of ` +
  'other people’s buffs are worked out at their /who level without their focus, so the real end can come later; the fade line is what counts.'

export function Buffs() {
  const q = useBuffs()
  const v = q.data
  const now = useNow(1000, !!v?.active.length)
  const [filter, setFilter] = useState('')
  const [openClasses, setOpenClasses] = useRemembered<string[]>('buffs.openClasses', [])

  const groupClasses = useMemo(() => [...new Set((v?.group ?? []).flatMap((g) => g.person?.classes ?? []))], [v])
  const classOrder = useMemo(() => [...CLASSES].sort((a, b) => Number(groupClasses.includes(b[0])) - Number(groupClasses.includes(a[0]))), [groupClasses])

  if (!v) return <Pending what="the buffs" error={q.error} retry={q.reload} />

  const wanted = new Set(v.wanted)
  const setWanted = async (next: string[] | null) => {
    const r = await act<BuffView>('buffs:setWanted', next)
    if (r) q.setData(r)
  }
  const toggle = (spell: string) => void setWanted(wanted.has(spell) ? v.wanted.filter((s) => s !== spell) : [...v.wanted, spell])
  const f = filter.trim().toLowerCase()
  const isOpen = (c: string) => !!f || openClasses.includes(c) || (groupClasses.includes(c) && !openClasses.includes(`-${c}`))
  const flip = (c: string) => {
    const open = isOpen(c)
    const rest = openClasses.filter((x) => x !== c && x !== `-${c}`)
    // Group classes start open, so closing one is what gets remembered.
    setOpenClasses(open ? (groupClasses.includes(c) ? [...rest, `-${c}`] : rest) : [...rest, c])
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Buffs</h1>
          <p>
            What your group can buff you with, what is on you now, and when to ask. Pick the buffs you want below; the tracker says whom to ask when one is
            missing, and warns before one fades. <Info label="How it works" text={HOW} />
          </p>
        </div>
      </div>

      {!v.spellsLoaded && <div className="notice bad mb-16">The spell file is not loaded yet: set the game folder in Settings.</div>}

      <div className="grid two mb-16" style={{ alignItems: 'start' }}>
        <div className="card stack gap-8">
          <h2 style={{ margin: 0 }}>Your group</h2>
          <div className="stack" style={{ gap: 2 }}>
            <div className="row gap-8">
              <b>You</b>
              {v.me ? (
                <span className="small muted">
                  {v.me.classes.map(code).join('/')} {v.me.level}
                </span>
              ) : (
                <span className="small lt-chip warn">
                  type <span className="mono">/who</span> in game so the tracker knows your classes
                </span>
              )}
            </div>
            {v.me && (
              <div className="small">
                {(() => {
                  const me = v.me
                  const own = v.offers.filter((o) => wanted.has(o.spell) && canCast(o, me))
                  return own.length ? own.map((o) => o.spell).join(', ') : <span className="faint">none of the buffs you want</span>
                })()}
              </div>
            )}
          </div>
          {!v.group.length ? (
            <p className="muted" style={{ margin: 0 }}>
              Not in a group: the combination below is what you can cast yourself. Join one and each member shows here with what they could buff you with.
            </p>
          ) : (
            v.group.map((g) => {
              const can = g.person ? offersFor(v.offers, g.person.classes, g.person.level).filter((o) => wanted.has(o.spell)) : []
              return (
                <div key={g.name} className="stack" style={{ gap: 2 }}>
                  <div className="row gap-8">
                    <b>{g.name}</b>
                    {g.person ? (
                      <span className="small muted">
                        {g.person.classes.map(code).join('/')} {g.person.level}
                      </span>
                    ) : (
                      <span className="small lt-chip warn">
                        type <span className="mono">/who {g.name}</span> in game
                      </span>
                    )}
                  </div>
                  {g.person && (
                    <div className="small">
                      {can.length ? can.map((o) => o.spell).join(', ') : <span className="faint">none of the buffs you want</span>}
                    </div>
                  )}
                </div>
              )
            })
          )}
          <div className="small" style={{ marginTop: 4 }}>
            {v.needs.length ? (
              <>
                <b>To ask for:</b> {askText(v.needs)}.
                {v.needs.some((n) => n.replaces || n.clickOff.length) && (
                  <span className="muted">
                    {' '}
                    (
                    {v.needs
                      .filter((n) => n.replaces || n.clickOff.length)
                      .map((n) => [n.replaces && `${n.spell} would replace ${n.replaces}`, n.clickOff.length && `${n.spell} needs ${n.clickOff.join(', ')} clicked off first`].filter(Boolean).join('; '))
                      .join('; ')}
                    )
                  </span>
                )}
              </>
            ) : (
              <span className="muted">Nothing to ask for.</span>
            )}
          </div>
        </div>

        <div className="card stack gap-8">
          <h2 style={{ margin: 0 }}>On you</h2>
          {!v.active.length ? (
            <p className="muted" style={{ margin: 0 }}>
              No buffs from others seen on you.
            </p>
          ) : (
            v.active
              .slice()
              .sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity))
              .map((b) => (
                <div key={b.spell} className="row gap-8">
                  <b>{b.ranked}</b>
                  <span className="small muted">
                    {LINE_LABELS[b.line]}
                    {b.caster ? ` · from ${b.caster}` : ''}
                  </span>
                  <span className="spacer" />
                  <span className="mono small" title="The earliest it can fade; its fade line ends it">
                    {b.endsAt === null ? 'until it fades' : b.endsAt > now ? `~${clock((b.endsAt - now) / 1000)}` : 'fading…'}
                  </span>
                </div>
              ))
          )}
        </div>
      </div>

      <BestCombination view={v} unpick={toggle} />

      <div className="card stack gap-10">
        <div className="row">
          <h2 style={{ margin: 0 }}>Buffs you want</h2>
          <span className="faint small">{v.wanted.length} picked</span>
          <span className="spacer" />
          <input placeholder="Filter by name or effect…" aria-label="Filter buffs" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 220 }} />
          {!v.defaults && (
            <button className="btn small" onClick={() => void setWanted(null)} title="Every HP & AC, haste, spell haste, mana regen and stat buff worth something">
              Back to the defaults
            </button>
          )}
        </div>
        {classOrder.map(([c, label]) => {
          const list = v.offers
            .filter((o) => o.classes[c] !== undefined)
            .filter((o) => !f || o.spell.toLowerCase().includes(f) || effectText(o).toLowerCase().includes(f) || LINE_LABELS[o.line].toLowerCase().includes(f))
            .sort((a, b) => LINE_ORDER.indexOf(a.line) - LINE_ORDER.indexOf(b.line) || b.classes[c] - a.classes[c])
          if (!list.length) return null
          const open = isOpen(c)
          const picked = list.filter((o) => wanted.has(o.spell)).length
          return (
            <div key={c} className="stack" style={{ gap: 4 }}>
              <div className="row gap-8">
                <button
                  className="btn small ghost"
                  aria-expanded={open}
                  aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
                  onClick={() => flip(c)}
                  style={{ width: 28 }}
                >
                  {open ? '▾' : '▸'}
                </button>
                <b>{label}</b>
                <span className="small muted">
                  {list.length} buffs{picked ? `, ${picked} picked` : ''}
                </span>
                {groupClasses.includes(c) && <span className="lt-chip good">in your group</span>}
              </div>
              {open && (
                <table className="table">
                  <tbody>
                    {list.map((o) => (
                      <tr key={o.spell}>
                        <td style={{ width: 28 }}>
                          <input type="checkbox" checked={wanted.has(o.spell)} aria-label={`Want ${o.spell}`} onChange={() => toggle(o.spell)} />
                        </td>
                        <td>
                          <a href={wikiUrl(o.spell)} target="_blank" rel="noreferrer">
                            {o.spell}
                          </a>
                          {o.group && <span className="lt-chip" style={{ marginLeft: 6 }}>group</span>}
                          {o.self && (
                            <span className="lt-chip" style={{ marginLeft: 6 }} title="Only the caster can have it: yours to cast when your classes can">
                              self
                            </span>
                          )}
                        </td>
                        <td className="small muted nowrap">{LINE_LABELS[o.line]}</td>
                        <td className="small">{effectText(o)}</td>
                        <td className="small mono nowrap">level {o.classes[c]}</td>
                        <td className="small mono nowrap">{minutes(o.seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

/** The best set of buffs that stacks, with this group or with anyone; and what was left out, and why. */
function BestCombination({ view, unpick }: { view: BuffView; unpick: (spell: string) => void }) {
  const [scope, setScope] = useRemembered<'group' | 'anyone'>('buffs.planScope', 'group')
  const [leftOpen, setLeftOpen] = useRemembered<boolean>('buffs.leftOutOpen', false)
  const plan: BuffPlan = scope === 'group' ? view.plan : view.planAnyone
  const total = plan.chosen.reduce((t, c) => t + c.value, 0)
  const byName = new Map(view.offers.map((o) => [o.spell, o]))
  const stacked = plan.leftOut.filter((l) => l.reason === 'stack')
  return (
    <div className="card stack gap-10 mb-16">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Best combination</h2>
        <span className="lt-seg" role="group" aria-label="Whose buffs">
          <button className={scope === 'group' ? 'on' : ''} aria-pressed={scope === 'group'} onClick={() => setScope('group')}>
            With your group
          </button>
          <button className={scope === 'anyone' ? 'on' : ''} aria-pressed={scope === 'anyone'} onClick={() => setScope('anyone')}>
            With anyone
          </button>
        </span>
        <span className="small muted">
          {scope === 'group' ? 'From what your group and you can cast, and what is on you.' : 'From every class at level 50, and your own self-only buffs, to plan with.'} Worth {total.toLocaleString()} in all.
        </span>
      </div>
      {!plan.chosen.length ? (
        <p className="muted" style={{ margin: 0 }}>
          {scope === 'group' ? 'Nothing: nobody in your group casts any of your picks, and nothing is on you.' : 'Nothing picked.'}
        </p>
      ) : (
        LINE_ORDER.map((line) => {
          const rows = plan.chosen.filter((c) => c.line === line)
          if (!rows.length) return null
          return (
            <div key={line} className="stack" style={{ gap: 2 }}>
              <b className="small">{LINE_LABELS[line]}</b>
              {rows.map((c) => {
                const o = byName.get(c.spell)
                return (
                  <div key={c.spell} className="row gap-8 small">
                    <span style={{ minWidth: 200 }} title={o ? `Cast by ${casters(o)}` : undefined}>
                      <b>{c.spell}</b>
                    </span>
                    <span className="muted" style={{ minWidth: 200 }}>
                      {o ? effectText(o) : ''}
                    </span>
                    {c.on ? <span className="lt-chip good">on you</span> : c.from === YOU ? <span className="lt-chip warn">cast it yourself</span> : <span className="lt-chip warn">ask {c.from}</span>}
                    {c.after.length > 0 && (
                      <span className="faint" title="By the stacking rules it holds only when it lands after these">
                        after {c.after.join(', ')}
                      </span>
                    )}
                    <span className="spacer" />
                    <span className="faint mono">{c.value.toLocaleString()}</span>
                  </div>
                )
              })}
            </div>
          )
        })
      )}
      {stacked.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          <div className="row gap-8">
            <button className="btn small ghost" aria-expanded={leftOpen} aria-label={leftOpen ? 'Collapse left out' : 'Expand left out'} onClick={() => setLeftOpen(!leftOpen)} style={{ width: 28 }}>
              {leftOpen ? '▾' : '▸'}
            </button>
            <b className="small">Left out: {stacked.length} that do not stack with the combination</b>
          </div>
          {leftOpen && stacked.map((l) => (
            <div key={l.spell} className="row gap-8 small">
              <span style={{ minWidth: 200 }} className="muted">
                {l.spell}
              </span>
              <span className="faint">blocked by {l.blockedBy.join(', ') || 'the rest'}</span>
              <span className="spacer" />
              <span className="faint mono">{l.value.toLocaleString()}</span>
              <button className="btn small ghost" aria-label={`Stop wanting ${l.spell}`} title="Stop wanting it" onClick={() => unpick(l.spell)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
