import { useEffect, useMemo, useState } from 'react'
import { api, clock } from '../api'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { act } from '../toast'
import { useNow } from '../components/TimerBars'
import { Info, Pending } from '../components/ui'
import { wikiUrl } from '../format'
import { CLASSES } from '../../../core/acModel'
import { askText, LINE_LABELS, MIN_BUFF_SEC, offersFor, type BuffLine, type BuffOffer, type BuffView } from '../../../core/buffs'

// What the group can buff you with: who is in it (and their classes, from /who), what is on you
// now, what to ask for, and the list of every class's buffs to pick the wanted ones from.

const LINE_ORDER: BuffLine[] = ['hpac', 'haste', 'spellHaste', 'manaRegen', 'hpRegen', 'ds', 'rune', 'attack', 'stats', 'mana', 'resist', 'move']

function useBuffs() {
  const q = useInvoke<BuffView>('buffs:get')
  const setData = q.setData
  useEffect(() => api.on('state:buffs', (v: BuffView) => setData(v)), [setData])
  return q
}

const code = (c: string) => c.toUpperCase()
const minutes = (sec: number) => (Number.isFinite(sec) ? (sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m` : `${Math.round(sec / 60)}m`) : 'permanent')
const effectText = (o: BuffOffer) => o.effects.map((e) => `${e.label}${e.value ? ` ${e.value}` : ''}`).join(', ')

const HOW =
  'Classes come from /who: type /who <name> for anyone in the group the tracker does not know yet. A buff counts as on you from its ' +
  `"you feel…" line, matched to the cast just before it, until its fade line (or death). Songs and buffs under ${MIN_BUFF_SEC / 60} minutes are left ` +
  'out. One buff of a line on you covers the line: the game will not stack two HP & AC buffs anyway. Durations of other people’s buffs are ' +
  'worked out at their /who level without their focus, so the real end can come later; the fade line is what counts.'

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
          {!v.group.length ? (
            <p className="muted" style={{ margin: 0 }}>
              Not in a group. Join one and each member shows here with what they could buff you with.
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

      <div className="card stack gap-10">
        <div className="row">
          <h2 style={{ margin: 0 }}>Buffs you want</h2>
          <span className="faint small">{v.wanted.length} picked</span>
          <span className="spacer" />
          <input placeholder="Filter by name or effect…" aria-label="Filter buffs" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 220 }} />
          {!v.defaults && (
            <button className="btn small" onClick={() => void setWanted(null)} title="Each class's best HP & AC, haste, spell haste and mana regen">
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
