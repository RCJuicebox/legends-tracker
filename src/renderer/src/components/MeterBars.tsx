import type { CSSProperties, ReactNode } from 'react'
import { fmtNum, fmtPct, fmtRate, type HealRow, type Row, type SkillRow } from '../../../core/combatView'
import type { EntityKind } from '../../../shared/types'

// The bars a damage meter is made of, in the Live page and in the overlay alike: a name, a fill
// showing its share of the top row, and the figures on the right. The overlay gives them a
// smaller, darker skin through its own class on the list.

export const KIND_COLOR: Record<EntityKind, string> = {
  you: 'var(--accent)',
  pet: 'var(--violet)',
  group: 'var(--teal)',
  player: '#6f8fd6',
  npc: 'var(--red)',
  npcpet: '#d67f6f',
  unknown: 'var(--text-3)'
}

export const HOW_COLOR: Record<SkillRow['how'], string> = {
  melee: 'var(--accent)',
  spell: '#e07a4a',
  dot: 'var(--violet)',
  ds: '#8fb5e0',
  pet: 'var(--violet)'
}

export const HEAL_COLOR = 'var(--green)'

/** "pet", "group" after a name; nothing for you, players and mobs. */
export function kindTag(kind: EntityKind, owner?: string): string {
  if (kind === 'pet') return owner && owner !== 'You' ? `pet of ${owner}` : 'pet'
  if (kind === 'group') return 'group'
  if (kind === 'npcpet') return 'pet'
  if (kind === 'unknown') return '?'
  return ''
}

export function Bar({
  color,
  fill,
  rank,
  name,
  tag,
  stat,
  right,
  onClick,
  selected,
  title
}: {
  color: string
  fill: number
  rank?: number
  name: ReactNode
  tag?: string
  /** Small figures after the name. */
  stat?: ReactNode
  right: ReactNode
  onClick?: () => void
  selected?: boolean
  title?: string
}) {
  const style = { ['--c' as string]: color, ['--fill' as string]: `${Math.max(1.5, fill * 100)}%` } as CSSProperties
  const body = (
    <>
      <span className="dm-fill" />
      {rank !== undefined && <span className="dm-rank">{rank}</span>}
      <span className="dm-name">
        {name}
        {tag ? <em className="dm-tag">{tag}</em> : null}
        {stat ? <span className="dm-stat">{stat}</span> : null}
      </span>
      <span className="dm-right">{right}</span>
    </>
  )
  const cls = `dm-bar${selected ? ' selected' : ''}${onClick ? ' clickable' : ''}`
  return onClick ? (
    <button type="button" className={cls} style={style} onClick={onClick} title={title} aria-pressed={selected}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style} title={title}>
      {body}
    </div>
  )
}

/** Damage rows: name, share, and DPS · total. */
export function EntityBar({ r, rank, onClick, selected, activeDps }: { r: Row; rank?: number; onClick?: () => void; selected?: boolean; activeDps?: boolean }) {
  const pets = r.pets?.length ? ` +${r.pets.map((p) => p.name).join(', ')}` : ''
  return (
    <Bar
      color={KIND_COLOR[r.kind]}
      fill={r.fill}
      rank={rank}
      name={r.name}
      tag={kindTag(r.kind, r.owner) + pets}
      stat={r.hits ? `${fmtPct(r.share)}` : undefined}
      right={
        <>
          <b>{fmtRate(activeDps ? r.activeDps : r.dps)}</b> · {fmtNum(r.total)}
        </>
      }
      onClick={onClick}
      selected={selected}
      title={`${fmtNum(r.total)} damage, ${fmtNum(r.dps)} per second over the whole ${r.activeDps ? 'time; ' + fmtNum(r.activeDps) + ' while striking' : 'time'}; ${r.hits} hits, ${r.crits} critical, ${r.misses} missed, best ${fmtNum(r.max)}`}
    />
  )
}

/** One skill or spell under an entity, with its figures. */
export function SkillBar({ s, rank, onClick, per }: { s: SkillRow; rank?: number; onClick?: () => void; per?: string }) {
  const swings = s.hits + s.misses
  const bits: string[] = []
  if (s.hits) bits.push(`${s.hits} hit${s.hits === 1 ? '' : 's'}`)
  if (s.crits) bits.push(`${Math.round((s.crits / Math.max(1, s.hits)) * 100)}% crit`)
  if (s.misses) bits.push(`${Math.round((s.hits / Math.max(1, swings)) * 100)}% landed`)
  if (s.resists) bits.push(`${s.resists} resisted`)
  if (s.hits) bits.push(`avg ${fmtNum(s.avg)} · max ${fmtNum(s.max)}`)
  const extras = Object.entries(s.mods)
    .filter(([m]) => m !== 'critical')
    .map(([m, n]) => `${n} ${m}`)
    .join(', ')
  return (
    <Bar
      color={HOW_COLOR[s.how]}
      fill={s.fill}
      rank={rank}
      name={s.name}
      tag={s.how === 'pet' ? 'pet' : s.how === 'dot' ? 'DoT' : s.how === 'ds' ? 'shield' : s.how === 'spell' ? 'spell' : ''}
      stat={bits.join(' · ')}
      right={
        <>
          <b>{fmtRate(s.dps)}</b> · {fmtNum(s.total)}
          {per ? ` ${per}` : ''}
        </>
      }
      onClick={onClick}
      title={extras ? `Also: ${extras}` : undefined}
    />
  )
}

export function HealBar({ h, rank, onClick, selected }: { h: HealRow; rank?: number; onClick?: () => void; selected?: boolean }) {
  return (
    <Bar
      color={HEAL_COLOR}
      fill={h.fill}
      rank={rank}
      name={h.name}
      tag={kindTag(h.kind)}
      stat={`${h.count} heal${h.count === 1 ? '' : 's'}${h.overheal > 0 ? ` · ${fmtPct(h.overheal)} over` : ''}${h.crits ? ` · ${h.crits} crit` : ''}`}
      right={
        <>
          <b>{fmtRate(h.hps)}</b> · {fmtNum(h.total)}
        </>
      }
      onClick={onClick}
      selected={selected}
      title={`${fmtNum(h.total)} healed of ${fmtNum(h.raw)} cast; biggest ${fmtNum(h.max)}`}
    />
  )
}
