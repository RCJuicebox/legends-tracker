import { useMemo } from 'react'
import { useApp } from '../state'
import { roman } from '../api'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { CategoryChip, Info, NumberInput, Pending, SpellIcon } from '../components/ui'
import { num, roundPct } from '../format'
import { useStock } from './MotePlanner'
import { CLASS_NUMBER } from '../../../core/acModel'
import { MOTE_RANKS } from '../../../core/motes'
import { CLASS_NAMES } from '../../../shared/types'
import {
  DEFAULT_SPELL_WEIGHTS,
  RANK_BONUS,
  SECTIONS,
  UNIVERSAL,
  UTILITY_BONUS,
  WEIGHT_LABELS,
  castableByMine,
  spellUpgradeOptions,
  stockXp,
  type MyClass,
  type SectionKey,
  type SpellCastRow,
  type SpellUpgradeOption,
  type SpellWeights
} from '../../../core/spellMotes'

// Motes › Spell upgrades: which of the spells you cast to put motes into next.

interface Casts {
  rows: SpellCastRow[]
  unknown: { name: string; casts: number }[]
  window: { total: number; from: string; to: string } | null
  /** Your classes as the game names them, each with its level, from /who or the character sheet. */
  mine: MyClass[]
}

const short = (i: number) => MOTE_RANKS[i].name || 'Potential'
/** "Shadow Knight" → "SHD", the way /who abbreviates classes. */
const classId = (name: string) =>
  Object.entries(CLASS_NUMBER)
    .find(([, n]) => CLASS_NAMES[n - 1] === name)?.[0]
    .toUpperCase() ?? name.slice(0, 3)
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

const HOW =
  'Every spell and song you cast in the window, with what its next rank would give each cast, from the EQL spell upgrade (mote) guide: the per-rank ' +
  'table for its category, plus −2% recovery and reuse for every spell. A point is one cast made one percent better, weighed as set above, so a rank’s ' +
  'worth is casts × points per cast. A spell at rank N needs 2^N xp for the next rank, and on a spell every mote counts its xp whatever the rank ' +
  '(Infinitesimal 1, Minor 1, Lesser 2, Potential 4, Major 5 … Infinite 10): there is no tier limit as on items. Worth per xp is what to sort by. ' +
  'Pay with lists the cheapest motes in your stock for the step, lowest rank first, since each rank’s combine value doubles while its xp barely grows.'

/** The guide's per-rank line for a section. */
function sectionNote(key: SectionKey, tierPct: Record<string, number>): string {
  if (key === 'pet') return `Each rank adds a pet level (up to your level less one), with the cast and mana reductions of the spell's own category.`
  if (key === 'transport' || key === 'utility')
    return `Each rank: −${UTILITY_BONUS.cast}% cast time, −${UTILITY_BONUS.mana}% mana (${UTILITY_BONUS.caveat}). ${key === 'transport' ? 'Gates, ports, rings, circles and succors.' : 'Binds, cures, summoned items, resurrections and the like: spells with nothing to heal, hurt or lengthen.'}`
  const cat = key === 'cc' ? 'charm' : key
  const b = RANK_BONUS[cat as keyof typeof RANK_BONUS]
  const parts = [`−${b.cast}% cast time`, `−${b.mana}% mana`]
  const dur = tierPct[cat] ?? 0
  if (dur) parts.push(`+${dur}% duration`)
  if (b.power) parts.push(`+${b.power}% ${b.powerNote}`)
  if (b.level) parts.push('the highest level it works on rises')
  return `Each rank: ${parts.join(', ')}${b.caveat ? ` (${b.caveat})` : ''}.`
}

function Parts({ o }: { o: SpellUpgradeOption }) {
  return (
    <span className="small">
      {o.parts.map((p, i) => (
        <span key={p.key} className="nowrap" title={`${p.points} point${p.points === 1 ? '' : 's'} per cast`}>
          {i > 0 && ', '}
          {p.label}
        </span>
      ))}
    </span>
  )
}

function PayWith({ o }: { o: SpellUpgradeOption }) {
  if (o.maxed) return <span className="chip">rank X: done</span>
  const s = o.spend
  const list = s.motes.map((m) => `${m.n} ${short(m.m)}`).join(' + ')
  const title = s.short ? `${s.short} xp short of ${o.need}` : `${s.xp} xp from motes worth ${num(s.worth)} Infinitesimal${s.over ? `; ${s.over} xp over` : ''}`
  return (
    <>
      <span className={`chip ${s.short ? 'warn' : 'ok'}`} title={title}>
        {list || 'no motes'}
        {s.short > 0 && ` · ${s.short} xp short`}
      </span>
      {!s.short && <div className="faint">worth {num(s.worth)}</div>}
    </>
  )
}

export function MoteSpells() {
  const { state } = useApp()
  const [days, setDays] = useRemembered<number>('spellmotes.days', 14)
  const [section, setSection] = useRemembered<SectionKey | 'all'>('spellmotes.section', 'all')
  const [sortBy, setSortBy] = useRemembered<'rate' | 'worth' | 'casts'>('spellmotes.sort', 'rate')
  const [onlyAffordable, setOnlyAffordable] = useRemembered<boolean>('spellmotes.affordable', false)
  const [showMaxed, setShowMaxed] = useRemembered<boolean>('spellmotes.maxed', false)
  const [showIgnored, setShowIgnored] = useRemembered<boolean>('spellmotes.showIgnored', false)
  // Spells the player will never put motes into, by name, kept per character.
  const [ignored, setIgnored] = useRemembered<string[]>(`spellmotes.ignored.${state.characterKey || 'none'}`, [])
  const ignore = (name: string, on: boolean) => setIgnored(on ? [...new Set([...ignored, name])] : ignored.filter((n) => n !== name))
  const [whose, setWhose] = useRemembered<'mine' | 'all'>('spellmotes.whose', 'mine')
  const [weights, setWeights] = useRemembered<SpellWeights>('spellmotes.weights', DEFAULT_SPELL_WEIGHTS)
  const tierPct = state.settings.tracking.tierDurationPct
  const q = useInvoke<Casts | null>('motes:spellCasts', [state.characterKey, days], [state.characterKey, days, state.status.spellsLoaded])
  const stockQ = useStock()
  const stock = stockQ.data?.counts

  const data = q.data
  const mine = useMemo(() => data?.mine ?? [], [data])
  const options = useMemo(() => {
    // Legends characters change classes: "your classes" is what /who last said, so a spell from a class you left is left out.
    const rows = whose === 'mine' && mine.length ? (data?.rows ?? []).filter((r) => castableByMine(r, mine)) : (data?.rows ?? [])
    const all = spellUpgradeOptions({ rows, tierPct, weights, stock })
    if (sortBy === 'worth') return [...all].sort((a, b) => Number(a.maxed) - Number(b.maxed) || b.worth - a.worth || a.need - b.need)
    if (sortBy === 'casts') return [...all].sort((a, b) => Number(a.maxed) - Number(b.maxed) || b.row.casts - a.row.casts)
    return all
  }, [data, tierPct, weights, stock, sortBy, whose, mine])

  if (!q.data) return q.error ? <Pending what="your casts" error={q.error} retry={q.reload} /> : <Pending what="your casts" />
  if (q.data === null) return <div className="card empty">The spell file is not loaded yet: check the game folder in Settings.</div>

  // The section chips count what the checkboxes leave, so a chip's number is its table's.
  const isIgnored = (o: SpellUpgradeOption) => ignored.includes(o.row.name)
  const kept = options.filter((o) => (showMaxed || !o.maxed) && (!onlyAffordable || o.affordable) && (showIgnored || !isIgnored(o)))
  const counts = new Map<SectionKey, number>()
  for (const o of kept) counts.set(o.section, (counts.get(o.section) ?? 0) + 1)
  const sections = SECTIONS.filter((s) => counts.get(s.key))
  const shown = kept.filter((o) => section === 'all' || o.section === section)
  const maxed = options.filter((o) => o.maxed).length
  const ignoredCount = options.filter(isIgnored).length
  const xp = stock ? stockXp(stock) : 0
  const w = q.data.window
  const unknown = q.data.unknown

  return (
    <div className="stack gap-12">
      <div className="card stack gap-10">
        <div className="row">
          <b>Judged on what you cast</b>
          <span className="lt-seg" role="group" aria-label="Judged on what you cast">
            {(
              [
                [7, '7 days'],
                [14, '14 days'],
                [30, '30 days'],
                [0, 'All logs']
              ] as const
            ).map(([d, label]) => (
              <button key={d} className={days === d ? 'on' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>
                {label}
              </button>
            ))}
          </span>
          <Info label="How spell upgrades are judged" text={HOW} />
          <span className="grow" />
          <b>Order by</b>
          <span className="lt-seg" role="group" aria-label="Order by">
            <button
              className={sortBy === 'rate' ? 'on' : ''}
              aria-pressed={sortBy === 'rate'}
              onClick={() => setSortBy('rate')}
              title="The most gained per xp spent"
            >
              Worth per xp
            </button>
            <button
              className={sortBy === 'worth' ? 'on' : ''}
              aria-pressed={sortBy === 'worth'}
              onClick={() => setSortBy('worth')}
              title="The biggest gain, whatever it costs"
            >
              Worth
            </button>
            <button className={sortBy === 'casts' ? 'on' : ''} aria-pressed={sortBy === 'casts'} onClick={() => setSortBy('casts')} title="Most cast first">
              Casts
            </button>
          </span>
        </div>
        <div className="row small">
          <b>A cast is worth more when it gets</b>
          {(Object.keys(WEIGHT_LABELS) as (keyof SpellWeights)[]).map((k) => (
            <label
              key={k}
              className="row tight"
              title={
                k === 'level'
                  ? 'A pet level, or a level on the highest target a charm or mez takes, counts as this many percent'
                  : `Points per percent of ${WEIGHT_LABELS[k].toLowerCase()}`
              }
            >
              <span className="muted">{WEIGHT_LABELS[k]}</span>
              <NumberInput
                value={weights[k]}
                min={0}
                step={0.25}
                width={58}
                label={`${WEIGHT_LABELS[k]} weight`}
                onChange={(v) => setWeights({ ...weights, [k]: v ?? 0 })}
              />
            </label>
          ))}
          <button className="btn ghost small" onClick={() => setWeights(DEFAULT_SPELL_WEIGHTS)}>
            Defaults
          </button>
        </div>
        <p className="muted small m-0">
          {w && w.total > 0
            ? `${num(w.total)} casts from ${w.from} to ${w.to}, ${options.length} spell${options.length === 1 ? '' : 's'}${maxed ? `, ${maxed} at rank X already` : ''}${ignoredCount ? `, ${ignoredCount} ignored` : ''}.`
            : 'No casts in your log for this window.'}{' '}
          {stock ? `Your motes are worth ${num(xp)} xp on spells.` : 'Motes on hand are not loaded yet, so nothing is marked affordable.'} Spend the low ranks
          here: on an item a mote only works at its own tier, but on a spell it always counts its xp. Every rank also takes −{UNIVERSAL.recovery}% recovery, −
          {UNIVERSAL.reuse}% reuse and −{UNIVERSAL.resist} off the resist modifier of resistable spells.
          {unknown.length > 0 &&
            ` Not spell-book spells (clickies, potions, abilities), so left out: ${unknown
              .slice(0, 5)
              .map((u) => `${u.name} (${u.casts})`)
              .join(', ')}${unknown.length > 5 ? '…' : ''}.`}
        </p>
        <div className="row">
          <b>Spells of</b>
          <span
            className="lt-seg"
            role="group"
            aria-label="Spells of"
            title={
              mine.length
                ? `Your trio: ${mine.map((m) => `${m.name} ${m.level}`).join(', ')}. A spell counts when one of them has it at their level.`
                : 'Your classes are not known yet: type /who in game, or set class levels on the Spell Timers page'
            }
          >
            <button className={whose === 'mine' ? 'on' : ''} aria-pressed={whose === 'mine'} onClick={() => setWhose('mine')} disabled={!mine.length}>
              Your trio{mine.length > 0 && <small>{mine.map((m) => classId(m.name)).join('/')}</small>}
            </button>
            <button className={whose === 'all' ? 'on' : ''} aria-pressed={whose === 'all'} onClick={() => setWhose('all')}>
              Every class you have cast as
            </button>
          </span>
          <span className="muted small">
            {whose === 'mine' && mine.length
              ? 'Only spells one of your classes has at its level now: a spell a Necromancer gets at 39 is not the Shadow Knight’s until 49.'
              : 'Everything cast in the window, whatever class you were.'}
          </span>
        </div>
        <div className="row">
          <span className="lt-seg" role="group" aria-label="Section">
            <button className={section === 'all' ? 'on' : ''} aria-pressed={section === 'all'} onClick={() => setSection('all')}>
              All <small>{kept.length}</small>
            </button>
            {sections.map((s) => (
              <button key={s.key} className={section === s.key ? 'on' : ''} aria-pressed={section === s.key} onClick={() => setSection(s.key)}>
                {s.label} <small>{counts.get(s.key)}</small>
              </button>
            ))}
          </span>
          <span className="grow" />
          <label className="row tight">
            <input type="checkbox" checked={onlyAffordable} onChange={(e) => setOnlyAffordable(e.target.checked)} />
            Only what your motes cover
          </label>
          <label className="row tight">
            <input type="checkbox" checked={showMaxed} onChange={(e) => setShowMaxed(e.target.checked)} />
            Show rank X spells
          </label>
          {ignoredCount > 0 && (
            <label className="row tight">
              <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} />
              Show ignored ({ignoredCount})
            </label>
          )}
        </div>
      </div>

      {!shown.length ? (
        <div className="card empty">
          {options.length ? 'Nothing to show with these filters.' : 'No spells cast in this window. Cast something, or widen the window.'}
        </div>
      ) : (
        SECTIONS.filter((s) => shown.some((o) => o.section === s.key)).map((s) => (
          <div key={s.key} className="card">
            <h2>
              {s.label} <span className="chip">{shown.filter((o) => o.section === s.key).length}</span>
            </h2>
            <p className="muted small mt-0">{sectionNote(s.key, tierPct)}</p>
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>Spell</th>
                  <th className="num">Casts</th>
                  <th>Rank</th>
                  <th>Next rank gives</th>
                  <th className="num" title="Points per cast × casts in the window">
                    Worth
                  </th>
                  <th className="num" title="XP the next rank needs: 2^rank">
                    XP
                  </th>
                  <th className="num" title="Worth per xp: the value of the upgrade">
                    Per xp
                  </th>
                  <th title="The cheapest motes in your stock for it, lowest rank first">Pay with</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown
                  .filter((o) => o.section === s.key)
                  .map((o) => (
                    <tr key={o.row.name} className={o.maxed || isIgnored(o) || (!o.affordable && stock) ? 'faint' : ''}>
                      <td>
                        <SpellIcon icon={o.row.icon} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>
                          {o.row.name}
                          {o.row.rank > 0 && <span className="muted"> {roman(o.row.rank)}</span>}
                        </div>
                        <div className="row tight small">
                          <CategoryChip category={o.row.category} />
                          {o.row.song && <span className="chip">song</span>}
                          {o.row.pet && <span className="chip">pet</span>}
                          <span className="faint">{o.row.classes}</span>
                        </div>
                      </td>
                      <td className="mono num" title={`${roundPct(o.share * 100)} of your casts`}>
                        {num(o.row.casts)}
                        <div className="faint small">{roundPct(o.share * 100)}</div>
                      </td>
                      <td className="mono nowrap">{o.maxed ? 'X' : `${o.rank} → ${o.next}`}</td>
                      <td>
                        <Parts o={o} />
                        <div className="faint small">{fmt(o.benefit)} points per cast</div>
                      </td>
                      <td className="mono num">{num(o.worth)}</td>
                      <td className="mono num">{o.maxed ? '—' : num(o.need)}</td>
                      <td className="mono num">{o.maxed ? '—' : fmt(o.rate)}</td>
                      <td className="small">
                        <PayWith o={o} />
                      </td>
                      <td>
                        {isIgnored(o) ? (
                          <button className="btn ghost small" onClick={() => ignore(o.row.name, false)} title="Put it back in the list">
                            Restore
                          </button>
                        ) : (
                          <button
                            className="btn ghost small"
                            onClick={() => ignore(o.row.name, true)}
                            title="Leave this spell out: you will not put motes into it"
                          >
                            Ignore
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  )
}
