import { useEffect, useMemo, useState } from 'react'
import { duration } from '../../../core/format'
import { api, clock } from '../api'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { act } from '../toast'
import { useNow } from '../components/TimerBars'
import { ConfirmButton, Disclosure, FilterBox, Info, Pending, Segmented, Switch, Tip } from '../components/ui'
import { useApp } from '../state'
import { wikiUrl } from '../../../core/format'
import { CLASSES, className } from '../../../shared/game/classes'
import {
  askText,
  canCast,
  castOrder,
  LINE_LABELS,
  MIN_ASK_VALUE,
  MIN_BUFF_SEC,
  offersFor,
  YOU,
  type BuffLine,
  type BuffOffer,
  type BuffPlan,
  type BuffView
} from '../../../core/buffs'

// What the group can buff you with: who is in it (and their classes, from /who), what is on you
// now, what to ask for, and the list of every class's buffs to pick the wanted ones from.

const LINE_ORDER: BuffLine[] = ['hpac', 'haste', 'spellHaste', 'manaRegen', 'hpRegen', 'ds', 'rune', 'attack', 'proc', 'stats', 'mana', 'resist', 'move', 'other']

function useBuffs() {
  const q = useInvoke('buffs:get')
  const setData = q.setData
  useEffect(() => api.on('state:buffs', (v: BuffView) => setData(v)), [setData])
  return q
}

const code = (c: string) => c.toUpperCase()
const effectText = (o: BuffOffer) => o.effects.map((e) => `${e.label}${e.value ? ` ${e.value}` : ''}`).join(', ')

const casters = (o: BuffOffer) =>
  Object.entries(o.classes)
    .sort((a, b) => a[1] - b[1])
    .map(([c, l]) => `${className(c)} ${l}`)
    .join(', ')

const HOW = (
  <>
    <div>
      <b>Who can cast what</b> comes from /who: <code>/who &lt;name&gt;</code> for anyone in the group the tracker does not know yet, <code>/who &lt;your name&gt;</code> for
      yourself. Whatever your own classes can cast is yours to keep up, group or no group: its reminder says “Cast …”. Self-only buffs, permanent procs and utility buffs (combat
      innates, poisons, Breath of the Dead; not vision) are listed too. Songs and buffs under {MIN_BUFF_SEC / 60} minutes are left out.
    </div>
    <div>
      <b>On you</b> from its “you feel…” line, matched to the cast just before it, until its fade line or your death. Someone else’s buff is timed at their /who level without their
      focus, so it can last longer than shown; the fade line is what counts.
    </div>
    <div>
      <b>What to ask for</b> is the set worth the most that stacks, by the game’s own rules, among the buffs you pick that your group can cast and what is on you already. The order
      can matter (a level-50 Strength stays on under Harnessing of Spirit, not the other way round), and the set says when it does.
    </div>
    <div>
      <b>Worth</b>: its HP, plus 2 a point of AC, 1.5 of STA, 1 of other stats, nothing for CHA. Buffs worth under {MIN_ASK_VALUE} are not asked for.
    </div>
  </>
)

export function Buffs() {
  const q = useBuffs()
  const v = q.data
  const { state, patchSettings } = useApp()
  const groupBuffs = state.settings.tracking.groupBuffs
  const now = useNow(1000, !!v?.active.length)
  const [filter, setFilter] = useState('')
  const [openClasses, setOpenClasses] = useRemembered<string[]>('buffs.openClasses', [])

  const groupClasses = useMemo(() => [...new Set((v?.group ?? []).flatMap((g) => g.person?.classes ?? []))], [v])
  const classOrder = useMemo(() => [...CLASSES].sort((a, b) => Number(groupClasses.includes(b[0])) - Number(groupClasses.includes(a[0]))), [groupClasses])
  // Each class's buffs, filtered and sorted when the buffs or the filter change, not at every tick of
  // the clock the buffs on you count down by (LT-401).
  const offers = v?.offers
  const classLists = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return classOrder.map(
      ([c, label]) =>
        [
          c,
          label,
          (offers ?? [])
            .filter((o) => o.classes[c] !== undefined)
            .filter((o) => !f || o.spell.toLowerCase().includes(f) || effectText(o).toLowerCase().includes(f) || LINE_LABELS[o.line].toLowerCase().includes(f))
            .sort((a, b) => LINE_ORDER.indexOf(a.line) - LINE_ORDER.indexOf(b.line) || b.classes[c] - a.classes[c])
        ] as const
    )
  }, [offers, filter, classOrder])

  if (!v) return <Pending what="the buffs" error={q.error} retry={q.reload} />

  const wanted = new Set(v.wanted)
  const setWanted = async (next: string[] | null) => {
    const r = await act('buffs:setWanted', next)
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
          <div className="lead">
            What your group can buff you with, what is on you now, and when to ask. Pick the buffs you want below; the tracker shows whom to ask when one is missing, and warns
            before one fades. <Info label="How it works" text={HOW} />
          </div>
        </div>
        <label className="row" title="Timers for buffs others cast on you, and whom to ask for a missing one, on the overlays. Off, this page still shows both.">
          <Switch on={groupBuffs} onChange={(v) => patchSettings((x) => ({ ...x, tracking: { ...x.tracking, groupBuffs: v } }))} label="Buffs from my group on the overlays" />
          Buffs from my group on the overlays
        </label>
      </div>

      {!v.spellsLoaded && <div className="notice bad mb-16">The spell file is not loaded yet: set the game folder in Settings.</div>}

      <div className="grid two mb-16" style={{ alignItems: 'start' }}>
        <div className="card stack gap-8">
          <div className="row gap-8" style={{ justifyContent: 'space-between' }}>
            <h2 className="m-0">Your group</h2>
            {v.group.length > 0 && (
              <ConfirmButton
                className="btn ghost small"
                question="Forget everyone in the group?"
                title="Forget everyone; the log fills the group again as people join, or add them on the Damage Meter page"
                onConfirm={() => void act('combat:clearGroup').then(() => q.reload())}
              >
                Reset group
              </ConfirmButton>
            )}
          </div>
          <div className="stack gap-2">
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
            <p className="muted m-0">
              Not in a group: the combination below is what you can cast yourself. Join one and each member shows here with what they could buff you with.
            </p>
          ) : (
            v.group.map((g) => {
              const can = g.person ? offersFor(v.offers, g.person.classes, g.person.level).filter((o) => wanted.has(o.spell)) : []
              return (
                <div key={g.name} className="stack gap-2">
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
                  {g.person && <div className="small">{can.length ? can.map((o) => o.spell).join(', ') : <span className="faint">none of the buffs you want</span>}</div>}
                </div>
              )
            })
          )}
          <div className="small mt-4">
            {v.needs.length ? (
              <>
                <b>To ask for:</b> {askText(v.needs, false)}.{v.needs.some((n) => n.after.length > 0) && ' In the order under Best combination.'}
                {v.needs.some((n) => n.replaces || n.clickOff.length) && (
                  <span className="muted">
                    {' '}
                    (
                    {v.needs
                      .filter((n) => n.replaces || n.clickOff.length)
                      .map((n) =>
                        [n.replaces && `${n.spell} would replace ${n.replaces}`, n.clickOff.length && `${n.spell} needs ${n.clickOff.join(', ')} clicked off first`]
                          .filter(Boolean)
                          .join('; ')
                      )
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
          <h2 className="m-0">On you</h2>
          {!v.active.length ? (
            <p className="muted m-0">No buffs from others seen on you.</p>
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
                  <Tip className="mono small" text="The earliest it can fade; its fade line ends it">
                    {b.endsAt === null ? 'until it fades' : b.endsAt > now ? `~${clock((b.endsAt - now) / 1000)}` : 'fading…'}
                  </Tip>
                </div>
              ))
          )}
        </div>
      </div>

      <BestCombination view={v} unpick={toggle} />

      <div className="card stack gap-10">
        <div className="row">
          <h2 className="m-0">Buffs you want</h2>
          <span className="faint small">{v.wanted.length} picked</span>
          <span className="spacer" />
          <FilterBox placeholder="Filter by name or effect…" label="Filter buffs" value={filter} onChange={setFilter} />
          {!v.defaults && (
            <button className="btn small" onClick={() => void setWanted(null)} title="Every HP & AC, haste, spell haste, mana regen and stat buff worth something">
              Back to the defaults
            </button>
          )}
        </div>
        {classLists.map(([c, label, list]) => {
          if (!list.length) return null
          const open = isOpen(c)
          const picked = list.filter((o) => wanted.has(o.spell)).length
          return (
            <div key={c} className="stack gap-4">
              <div className="row gap-8">
                <Disclosure open={open} onToggle={() => flip(c)}>
                  {label}
                </Disclosure>
                <span className="small muted">
                  {list.length} buffs{picked ? `, ${picked} picked` : ''}
                </span>
                {groupClasses.includes(c) && <span className="lt-chip good">in your group</span>}
              </div>
              {open && (
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Want</th>
                        <th>Buff</th>
                        <th>Line</th>
                        <th>Effects</th>
                        <th>Level</th>
                        <th>Lasts</th>
                      </tr>
                    </thead>
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
                            {o.group && <span className="lt-chip ml-6">group</span>}
                            {o.self && (
                              <Tip className="lt-chip ml-6" text="Only the caster can have it: yours to cast when your classes can">
                                self
                              </Tip>
                            )}
                          </td>
                          <td className="small muted nowrap">{LINE_LABELS[o.line]}</td>
                          <td className="small">{effectText(o)}</td>
                          <td className="small mono nowrap">level {o.classes[c]}</td>
                          <td className="small mono nowrap">{duration(o.seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
  const order = castOrder(plan.chosen)
  return (
    <div className="card stack gap-10 mb-16">
      <div className="row wrap">
        <h2 className="m-0">Best combination</h2>
        <Segmented
          label="Whose buffs"
          value={scope}
          onChange={setScope}
          options={[
            ['group', 'With your group'],
            ['anyone', 'With anyone']
          ]}
        />
        <span className="small muted">
          {scope === 'group' ? 'From what your group and you can cast, and what is on you.' : 'From every class at level 50, and your own self-only buffs, to plan with.'} Worth{' '}
          {total.toLocaleString()} in all.
        </span>
      </div>
      {order.length > 1 && (
        <p className="small m-0">
          <b>Cast order:</b> {order.join(', then ')}. By the stacking rules each holds only when it lands after the ones before it; the rest go in any order.
        </p>
      )}
      {!plan.chosen.length ? (
        <p className="muted m-0">{scope === 'group' ? 'Nothing: nobody in your group casts any of your picks, and nothing is on you.' : 'Nothing picked.'}</p>
      ) : (
        LINE_ORDER.map((line) => {
          const rows = plan.chosen.filter((c) => c.line === line)
          if (!rows.length) return null
          return (
            <div key={line} className="stack gap-2">
              <b className="small">{LINE_LABELS[line]}</b>
              {rows.map((c) => {
                const o = byName.get(c.spell)
                return (
                  <div key={c.spell} className="row gap-8 small">
                    {o ? (
                      <Tip style={{ minWidth: 200 }} text={`Cast by ${casters(o)}`}>
                        <b>{c.spell}</b>
                      </Tip>
                    ) : (
                      <span style={{ minWidth: 200 }}>
                        <b>{c.spell}</b>
                      </span>
                    )}
                    <span className="muted" style={{ minWidth: 200 }}>
                      {o ? effectText(o) : ''}
                    </span>
                    {c.on ? (
                      <span className="lt-chip good">on you</span>
                    ) : c.from === YOU ? (
                      <span className="lt-chip warn">cast it yourself</span>
                    ) : (
                      <span className="lt-chip warn">ask {c.from}</span>
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
        <div className="stack gap-2">
          <div className="row gap-8">
            <Disclosure className="small" open={leftOpen} onToggle={() => setLeftOpen(!leftOpen)}>
              Left out: {stacked.length} that do not stack with the combination
            </Disclosure>
          </div>
          {leftOpen &&
            stacked.map((l) => (
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
