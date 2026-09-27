import { useMemo } from 'react'
import { slotLabel } from '../../../core/inventory'
import { canWear, restrictions } from '../../../core/upgrades'
import { effectScore, type EffectWorth } from '../../../core/itemEffects'
import type { GearModel } from '../gear/useGearModel'
import { num, wikiUrl } from '../format'
import { ItemIcon, source, whereText } from './gearBits'

// The Gear page's worn effects and procs: what each one on gear the character owns or could wear does,
// what it adds to their melee (from their own log), and where to find it. The finder and the optimizer
// count the same worth.

type Kind = 'worn' | 'proc'

interface Carrier {
  name: string
  where: string
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
  carriers: Carrier[]
}

const SHOWN_UNOWNED = 10

export function EffectsTab({ m }: { m: GearModel }) {
  const fx = m.effects
  const profile = fx.profile
  const { pieces, exaltations, catalog, effectsOfItem, wearer } = m
  const ratio = m.weights.ratio
  const rows = useMemo(() => {
    const out: Record<Kind, Map<string, EffectRow>> = { worn: new Map(), proc: new Map() }
    const row = (kind: Kind, name: string) => {
      let r = out[kind].get(name)
      if (!r) {
        const worth = kind === 'worn' ? fx.wornWorth(name) : fx.procWorth(name)
        const score = worth && profile ? effectScore(worth.dpm, profile, ratio) : 0
        out[kind].set(name, (r = { name, worth, score, carriers: [] }))
      }
      return r
    }
    // What the character owns: worn, carried, banked, in Storage, on the pet, and exaltations kept.
    for (const p of pieces) {
      const where = p.from === 'worn' ? `worn in ${slotLabel(p.item.location)}` : whereText(p.from, p.item)
      for (const n of p.worn ?? []) row('worn', n).carriers.push({ name: p.item.name, where, owned: true, active: p.from === 'worn' })
      const inHand = p.from === 'worn' && (p.item.location === 'Primary' || p.item.location === 'Secondary')
      for (const n of p.procs ?? []) row('proc', n).carriers.push({ name: p.item.name, where, owned: true, active: inHand })
    }
    for (const e of exaltations) {
      if (e.worn) row('worn', e.worn).carriers.push({ name: e.item.name, where: 'in Storage › Exaltations, for a worn slot', owned: true, active: false })
      if (e.proc) row('proc', e.proc).carriers.push({ name: e.item.name, where: 'in Storage › Exaltations, for a proc slot', owned: true, active: false })
    }
    // What there is to get: pieces the character could wear (weapons in hand, for a proc).
    for (const c of catalog) {
      const own = effectsOfItem(c.title)
      if (!own?.worn && !own?.proc) continue
      if (/^Summoned:/i.test(c.title)) continue
      const r = restrictions(c.statsblock)
      const base = { name: c.title, where: `${r.slots.map((s) => s.toLowerCase()).join(' ')}${c.era ? ` · ${c.era}` : ''}`, owned: false, active: false, icon: c.icon, title: source(c) }
      if (own.worn && canWear(r, wearer, 'Any Slot')) {
        const rw = row('worn', own.worn)
        if (!rw.carriers.some((x) => x.owned && x.name.startsWith(c.title))) rw.carriers.push(base)
      }
      if (own.proc && (canWear(r, wearer, 'Primary') || canWear(r, wearer, 'Secondary'))) {
        const rp = row('proc', own.proc)
        if (!rp.carriers.some((x) => x.owned && x.name.startsWith(c.title))) rp.carriers.push(base)
      }
    }
    const sorted = (k: Kind) => [...out[k].values()].sort((a, b) => (b.worth?.dpm ?? 0) - (a.worth?.dpm ?? 0) || a.name.localeCompare(b.name))
    return { worn: sorted('worn'), proc: sorted('proc') }
  }, [pieces, exaltations, catalog, effectsOfItem, wearer, ratio, fx, profile])

  const topSkills = profile
    ? Object.entries(profile.skills)
        .sort((a, b) => b[1].damage - a[1].damage)
        .slice(0, 5)
        .map(([name, s]) => `${name} ${((s.hits + s.misses) / Math.max(profile.activeMin, 1e-9)).toFixed(1)}/min`)
    : []

  return (
    <div className="stack gap-12">
      <div className="card stack gap-8">
        <h2 style={{ margin: 0 }}>Worn effects and procs</h2>
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
            {fx.loading
              ? 'Reading your log…'
              : profile && profile.dpm > 0
                ? `${num(Math.round(profile.dpm))} melee damage a minute over ${num(Math.round(profile.activeMin))} minutes swinging, ${profile.from} to ${profile.to}: ${topSkills.join(' · ')}`
                : 'No melee of yours in the log for these days, so worn effects and procs cannot be weighed.'}
          </span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Each is worth the damage a minute it adds to your melee, as a share of the melee damage you do now: 1% more is worth your role's Weapon damage (1%) weight (
          {num(m.weights.ratio)}) in the finder and the optimizer. A worn effect works in any slot and counts once however many pieces carry it; a proc fires only from a
          weapon in your hands. Exaltations bring theirs to a piece of their own kind: a worn exaltation its worn effect, a proc exaltation its proc.
        </p>
      </div>
      <EffectSection title="Worn effects" kind="worn" rows={rows.worn} />
      <EffectSection title="Procs" kind="proc" rows={rows.proc} />
      <p className="faint small">
        Valued now: +damage to a skill's hits (Unrighteous Bash's +15 to bash), a skill ready sooner (counted only for a skill you already use about as often as it
        can be), +% damage to a skill, and procs that do damage. A proc's rate is your log's when you have fired it (shared between the weapons in hand that carry it),
        else EQEmu's 2 a minute raised 0.075% a point of DEX ({num(fx.dex)}); its damage is your log's, or the spell file's at your level (a damage-over-time proc
        counts every tick). Stuns, debuffs, buffs and bashing with a two-hander are listed but not valued.
      </p>
    </div>
  )
}

function EffectSection({ title, kind, rows }: { title: string; kind: Kind; rows: EffectRow[] }) {
  const owned = rows.filter((r) => r.carriers.some((c) => c.owned))
  const others = rows.filter((r) => !r.carriers.some((c) => c.owned) && (r.worth?.dpm ?? 0) > 0)
  const shown = [...owned, ...others.slice(0, SHOWN_UNOWNED)]
  return (
    <div className="card lt-focus">
      <div className="lt-subhead">{title}</div>
      {shown.length ? (
        shown.map((r) => <EffectLine key={r.name} r={r} kind={kind} />)
      ) : (
        <p className="faint small">None on gear you own or could wear.</p>
      )}
      {others.length > SHOWN_UNOWNED && <p className="faint small">and {others.length - SHOWN_UNOWNED} more you do not own, worth less.</p>}
    </div>
  )
}

function EffectLine({ r, kind }: { r: EffectRow; kind: Kind }) {
  const w = r.worth
  const mine = r.carriers.filter((c) => c.owned)
  const toGet = r.carriers.filter((c) => !c.owned)
  const active = mine.some((c) => c.active)
  const chip = active ? { label: kind === 'worn' ? 'Wearing it' : 'In hand', tone: 'good' } : mine.length ? { label: 'Owned, not in use', tone: 'warn' } : null
  return (
    <div className="lt-focus-row lt-effect-row">
      <div className="lt-focus-line">
        <b>{r.name}</b>
        {w?.does.length ? <div className="small muted">{w.does.join(' · ')}</div> : <div className="faint small">Not in the spell file</div>}
        {w?.basis && <div className="faint small">{w.basis}</div>}
      </div>
      <div className="lt-focus-col">
        <div className="lt-focus-cap">Worth to you</div>
        {w && w.dpm > 0 ? (
          <div>
            <b>+{num(Math.round(w.dpm))}</b> <span className="muted">a minute</span> <span className="faint small">· worth {num(r.score)}</span>
          </div>
        ) : (
          <span className="faint small">Nothing it does is valued</span>
        )}
      </div>
      <div className="lt-focus-col">
        <div className="lt-focus-cap">
          You have {chip && <span className={`lt-chip ${chip.tone}`}>{chip.label}</span>}
        </div>
        {mine.slice(0, 3).map((c) => (
          <div key={c.name + c.where} className="small">
            {c.name} <span className="faint">{c.where}</span>
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
                <span className="faint">{c.where}</span>
              </div>
            ))}
            {toGet.length > 3 && <div className="faint small">and {toGet.length - 3} more</div>}
          </>
        )}
      </div>
    </div>
  )
}
