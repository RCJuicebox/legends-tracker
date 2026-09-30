import { useMemo } from 'react'
import { slotLabel } from '../../../core/inventory'
import { canWear, restrictions, type Restrictions } from '../../../core/upgrades'
import type { EffectWorth } from '../../../core/itemEffects'
import type { GearModel } from '../gear/useGearModel'
import { useRemembered } from '../remember'
import { num, wikiUrl } from '../../../core/format'
import { ItemIcon, source, whereText } from './gearBits'
import { Pending } from '../components/ui'

// The Gear page's worn effects and procs tabs: what each one on gear the character owns or could get
// does, what it is worth to them (melee from their own log, stats by their weights), and where to
// find it. The finder and the optimizer count the same worth.

export type EffectKind = 'worn' | 'proc'

interface Carrier {
  name: string
  where: string
  /** The classes it is for, "SHD MNK"; '' for all. */
  classes: string
  owned: boolean
  /** Worn now (a worn effect), or on a weapon in hand now (a proc). */
  active: boolean
  icon?: number
  title?: string
}

interface EffectRow {
  name: string
  worth: EffectWorth | null
  score: number
  statScore: number
  carriers: Carrier[]
}

const SHOWN_UNOWNED = 10
const classesOf = (r: Restrictions | null) => (!r || r.classes.includes('ALL') ? '' : r.classes.join(' '))

export function EffectsTab({ m, kind }: { m: GearModel; kind: EffectKind }) {
  const fx = m.effects
  const profile = fx.profile
  const [who, setWho] = useRemembered<'yours' | 'all'>('effects.classes', 'yours')
  const { pieces, exaltations, storedExaltations, catalog, effectsOfItem, wearer, eraHidden } = m
  const rows = useMemo(() => {
    const out = new Map<string, EffectRow>()
    const row = (name: string) => {
      let r = out.get(name)
      if (!r) {
        const worth = kind === 'worn' ? fx.wornWorth(name) : fx.procWorth(name)
        const score = kind === 'worn' ? fx.wornScore(name) : fx.procScore(name)
        out.set(name, (r = { name, worth, score, statScore: kind === 'worn' ? fx.wornStatScore(name) : 0, carriers: [] }))
      }
      return r
    }
    // For the character's classes: one of them may wear it (in the hands, for a proc).
    const forYou = (r: Restrictions) => (kind === 'worn' ? canWear(r, wearer, 'Any Slot') : canWear(r, wearer, 'Primary') || canWear(r, wearer, 'Secondary'))
    // What the character owns: worn, carried, banked, in Storage, on the pet, and exaltations kept.
    for (const p of pieces) {
      if (who === 'yours' && p.from !== 'worn' && p.r && !forYou(p.r)) continue
      const names = kind === 'worn' ? (p.worn ?? []) : (p.procs ?? [])
      if (!names.length) continue
      const where = p.from === 'worn' ? `worn in ${slotLabel(p.item.location)}` : whereText(p.from, p.item)
      const active = p.from === 'worn' && (kind === 'worn' || p.item.location === 'Primary' || p.item.location === 'Secondary')
      for (const n of names) row(n).carriers.push({ name: p.item.name, where, classes: classesOf(p.r), owned: true, active })
    }
    for (const e of who === 'yours' ? exaltations : storedExaltations) {
      const n = kind === 'worn' ? e.worn : e.proc
      if (n) row(n).carriers.push({ name: e.item.name, where: `in Storage › Exaltations, for a ${kind} slot`, classes: classesOf(e.r), owned: true, active: false })
    }
    // What there is to get.
    for (const c of catalog) {
      const own = effectsOfItem(c.title)
      const n = kind === 'worn' ? own?.worn : own?.proc
      if (!n || /^Summoned:/i.test(c.title) || eraHidden(c)) continue
      const r = restrictions(c.statsblock)
      if (who === 'yours' && !forYou(r)) continue
      const rw = row(n)
      if (rw.carriers.some((x) => x.owned && x.name.startsWith(c.title))) continue
      rw.carriers.push({
        name: c.title,
        where: `${r.slots.map((s) => s.toLowerCase()).join(' ')}${c.era ? ` · ${c.era}` : ''}`,
        classes: classesOf(r),
        owned: false,
        active: false,
        icon: c.icon,
        title: source(c)
      })
    }
    return [...out.values()].sort((a, b) => b.score - a.score || (b.worth?.dpm ?? 0) - (a.worth?.dpm ?? 0) || a.name.localeCompare(b.name))
  }, [kind, who, pieces, exaltations, storedExaltations, catalog, effectsOfItem, wearer, eraHidden, fx])

  const sections =
    kind === 'worn'
      ? [
          { title: 'In combat', note: 'What they add to your melee.', rows: rows.filter((r) => (r.worth?.dpm ?? 0) > 0), all: false },
          {
            title: 'Stats',
            note: 'Priced by your stat weights, as the same stats on an item would be.',
            rows: rows.filter((r) => !(r.worth?.dpm ?? 0) && r.statScore > 0),
            all: false
          },
          { title: 'Utility', note: 'Not valued: what they are worth is up to you.', rows: rows.filter((r) => !(r.worth?.dpm ?? 0) && r.statScore <= 0), all: true }
        ]
      : [
          { title: 'Damage', note: 'What they add to your melee.', rows: rows.filter((r) => (r.worth?.dpm ?? 0) > 0), all: false },
          {
            title: 'Other',
            note: 'Not valued: stuns, debuffs, buffs, and procs that land only on undead or summoned creatures.',
            rows: rows.filter((r) => !(r.worth?.dpm ?? 0)),
            all: false
          }
        ]

  const topSkills = profile
    ? Object.entries(profile.skills)
        .sort((a, b) => b[1].damage - a[1].damage)
        .slice(0, 5)
        .map(([name, s]) => `${name} ${((s.hits + s.misses) / Math.max(profile.activeMin, 1e-9)).toFixed(1)}/min`)
    : []

  return (
    <div className="stack gap-12">
      <div className="card stack gap-8">
        <h2 style={{ margin: 0 }}>{kind === 'worn' ? 'Worn effects' : 'Procs'}</h2>
        <div className="row small">
          <b>Judged on your melee</b>
          <span className="lt-seg" role="group" aria-label="Judged on your melee">
            {(
              [
                [7, '7 days'],
                [14, '14 days'],
                [30, '30 days'],
                [0, 'All logs']
              ] as const
            ).map(([d, label]) => (
              <button key={d} className={m.days === d ? 'on' : ''} aria-pressed={m.days === d} onClick={() => m.setDays(d)}>
                {label}
              </button>
            ))}
          </span>
          <span className="muted">
            {fx.loading ? (
              <Pending inline doing="Reading your log" />
            ) : profile && profile.dpm > 0 ? (
              `${num(Math.round(profile.dpm))} melee damage a minute over ${num(Math.round(profile.activeMin))} minutes swinging, ${profile.from} to ${profile.to}: ${topSkills.join(' · ')}`
            ) : (
              'No melee of yours in the log for these days, so nothing counts for your melee.'
            )}
          </span>
        </div>
        <div className="row small">
          <b>Gear for</b>
          <span className="lt-seg" role="group" aria-label="Gear for">
            {(
              [
                ['yours', `Your classes (${m.classes.map((c) => c.toUpperCase()).join(' ')})`],
                ['all', 'All classes']
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={who === k ? 'on' : ''} aria-pressed={who === k} onClick={() => setWho(k)}>
                {label}
              </button>
            ))}
          </span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {kind === 'worn'
            ? 'A worn effect works in any slot and counts once however many pieces carry it. What it adds to your melee is worth your role’s Weapon damage (1%) weight for each 1% of the melee damage you do now; the stats it gives count as they would on an item. A worn exaltation (slot 9) brings its item’s worn effect in place of the host’s.'
            : 'A proc fires only from a weapon in your hands. What it adds to your melee is worth your role’s Weapon damage (1%) weight for each 1% of the melee damage you do now. A proc exaltation (slot 10) brings its item’s proc in place of the host’s.'}{' '}
          The finder and the optimizer count the same worth ({num(m.weights.ratio)} for each 1% of melee).
        </p>
      </div>
      {sections.map((s) => (
        <EffectSection key={s.title} title={s.title} note={s.note} rows={s.rows} kind={kind} all={s.all} />
      ))}
      <p className="faint small">
        {kind === 'worn'
          ? 'Valued for your melee: +damage to a skill’s hits (Unrighteous Bash’s +15 to bash), a skill ready sooner (counted only for a skill you already use about as often as it can be, and no more often than its cooldown allows), and +% damage to a skill.'
          : `A proc's rate is your log's when you have fired it (shared between the weapons in hand that carry it), else EQEmu's 2 a minute raised 0.075% a point of DEX (${num(fx.dex)}). Its damage is your log's, or the spell file's at your level; one that lasts counts every tick, but no more than kept up the whole time, since a new firing refreshes it.`}
      </p>
    </div>
  )
}

function EffectSection({ title, note, rows, kind, all }: { title: string; note: string; rows: EffectRow[]; kind: EffectKind; all: boolean }) {
  if (!rows.length) return null
  const owned = rows.filter((r) => r.carriers.some((c) => c.owned))
  const others = rows.filter((r) => !r.carriers.some((c) => c.owned))
  const shown = all ? [...owned, ...others] : [...owned, ...others.slice(0, SHOWN_UNOWNED)]
  return (
    <div className="card lt-focus">
      <div className="row">
        <div className="lt-subhead">{title}</div>
        <span className="faint small">{note}</span>
      </div>
      {shown.map((r) => (
        <EffectLine key={r.name} r={r} kind={kind} />
      ))}
      {shown.length < rows.length && <p className="faint small">and {rows.length - shown.length} more you do not own, worth less.</p>}
    </div>
  )
}

function EffectLine({ r, kind }: { r: EffectRow; kind: EffectKind }) {
  const w = r.worth
  const mine = r.carriers.filter((c) => c.owned)
  const toGet = r.carriers.filter((c) => !c.owned)
  const active = mine.some((c) => c.active)
  const chip = active ? { label: kind === 'worn' ? 'Wearing it' : 'In hand', tone: 'good' } : mine.length ? { label: 'Owned, not in use', tone: 'warn' } : null
  const dpm = w?.dpm ?? 0
  return (
    <div className="lt-focus-row lt-effect-row">
      <div className="lt-focus-line">
        <b>{r.name}</b>
        {w?.does.length ? <div className="small muted">{w.does.join(' · ')}</div> : <div className="faint small">Not in the spell file</div>}
        {w?.basis && <div className="faint small">{w.basis}</div>}
      </div>
      <div className="lt-focus-col">
        <div className="lt-focus-cap">Worth to you</div>
        {r.score > 0 ? (
          <div>
            {dpm > 0 && (
              <>
                <b>+{num(Math.round(dpm))}</b> <span className="muted">a minute</span>{' '}
              </>
            )}
            <span className={dpm > 0 ? 'faint small' : ''}>
              {dpm > 0 ? '· ' : ''}worth {num(r.score)}
              {r.statScore > 0 && dpm > 0 ? ` (${num(r.statScore)} of it stats)` : ''}
            </span>
          </div>
        ) : (
          <span className="faint small">Not valued</span>
        )}
      </div>
      <div className="lt-focus-col">
        <div className="lt-focus-cap">You have {chip && <span className={`lt-chip ${chip.tone}`}>{chip.label}</span>}</div>
        {mine.slice(0, 3).map((c) => (
          <div key={c.name + c.where} className="small">
            {c.name} <span className="faint">{c.where}</span>
            {c.classes && <span className="faint"> · {c.classes}</span>}
          </div>
        ))}
        {!mine.length && <span className="faint small">None</span>}
        {toGet.length > 0 && (
          <>
            <div className="lt-focus-cap" style={{ marginTop: 6 }}>
              To get
            </div>
            {toGet.slice(0, 3).map((c) => (
              <div key={c.name} className="lt-focus-item" title={c.title}>
                <ItemIcon icon={c.icon} size={20} />
                <a href={wikiUrl(c.name)} target="_blank" rel="noreferrer">
                  {c.name}
                </a>
                <span className="faint">
                  {c.where}
                  {c.classes ? ` · ${c.classes}` : ''}
                </span>
              </div>
            ))}
            {toGet.length > 3 && <div className="faint small">and {toGet.length - 3} more</div>}
          </>
        )}
      </div>
    </div>
  )
}
