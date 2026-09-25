import { SELF } from './combatLines'
import { durationMs, isFriend, nameKey } from './combatMeter'
import type { Defense, Entity, EntityKind, HealTally, MeterMode, MeterScope, Segment, SkillStat } from '../shared/types'

// What the damage meter shows, worked out from a segment: the same sums for the Live page and the
// overlay. Pure functions of the data, so they run in any window.

export interface Row {
  key: string
  name: string
  kind: EntityKind
  owner?: string
  total: number
  /** Over the segment's whole length. */
  dps: number
  /** Over the entity's own time in combat. */
  activeDps: number
  /** Of the top row, for the bar. */
  fill: number
  /** Of everything listed. */
  share: number
  hits: number
  crits: number
  misses: number
  max: number
  /** Pets folded into this row. */
  pets?: Row[]
}

export interface SkillRow {
  key: string
  name: string
  how: SkillStat['how'] | 'pet'
  total: number
  dps: number
  fill: number
  share: number
  hits: number
  crits: number
  misses: number
  resists: number
  max: number
  min: number
  avg: number
  mods: Record<string, number>
}

export interface HealRow {
  key: string
  name: string
  kind: EntityKind
  total: number
  raw: number
  /** Of what was cast, the part that was not needed. */
  overheal: number
  hps: number
  fill: number
  share: number
  count: number
  crits: number
  max: number
}

export interface ScopeInfo {
  /** Group members' pets by name, when the meter knows their owners. */
  otherPets?: Record<string, string>
}

export const durationSec = (seg: Segment): number => durationMs(seg) / 1000

/** Whether an entity's rows belong under the scope. */
export function inScope(e: Entity, scope: MeterScope): boolean {
  if (!isFriend(e.kind)) return false
  if (scope === 'everyone') return true
  const mine = e.kind === 'you' || (e.kind === 'pet' && e.owner === SELF)
  if (scope === 'you') return mine
  return mine || e.kind === 'group' || (e.kind === 'pet' && !!e.owner && e.owner !== SELF)
}

export function scoped(seg: Segment, scope: MeterScope): Entity[] {
  return Object.values(seg.entities).filter((e) => inScope(e, scope))
}

const rate = (total: number, ms: number) => (ms > 0 ? total / (ms / 1000) : 0)

function finish<T extends { total: number; fill: number; share: number }>(rows: T[]): T[] {
  rows.sort((a, b) => b.total - a.total)
  const top = rows[0]?.total ?? 0
  const sum = rows.reduce((s, r) => s + r.total, 0)
  for (const r of rows) {
    r.fill = top > 0 ? r.total / top : 0
    r.share = sum > 0 ? r.total / sum : 0
  }
  return rows
}

function entityRow(e: Entity, ms: number): Row {
  return {
    key: nameKey(e.name), name: e.name, kind: e.kind, ...(e.owner ? { owner: e.owner } : {}),
    total: e.out.total, dps: rate(e.out.total, ms), activeDps: rate(e.out.total, e.activeMs), fill: 0, share: 0,
    hits: e.out.hits, crits: e.out.crits, misses: Object.values(e.skills).reduce((s, k) => s + k.misses, 0), max: e.out.max
  }
}

/** Damage dealt, one row per entity in scope; pets fold into their owner's row when asked. */
export function damageRows(seg: Segment, scope: MeterScope, combinePet: boolean): Row[] {
  const ms = durationMs(seg)
  const ents = scoped(seg, scope).filter((e) => e.out.total > 0 || Object.values(e.skills).some((s) => s.misses > 0))
  if (!combinePet) return finish(ents.map((e) => entityRow(e, ms)))
  const rows = new Map<string, Row>()
  const orphans: Row[] = []
  for (const e of ents) if (e.kind !== 'pet') rows.set(nameKey(e.name), entityRow(e, ms))
  for (const e of ents) {
    if (e.kind !== 'pet') continue
    const owner = e.owner ? rows.get(nameKey(e.owner)) : undefined
    const pet = entityRow(e, ms)
    if (!owner) {
      orphans.push(pet)
      continue
    }
    owner.total += pet.total
    owner.dps = rate(owner.total, ms)
    owner.hits += pet.hits
    owner.crits += pet.crits
    owner.misses += pet.misses
    owner.max = Math.max(owner.max, pet.max)
    ;(owner.pets ??= []).push(pet)
  }
  return finish([...rows.values(), ...orphans])
}

/** The skills and spells behind one row, plus a lane per pet folded into it. */
export function skillRows(seg: Segment, row: Row): SkillRow[] {
  const ms = durationMs(seg)
  const e = seg.entities[row.key]
  const out: SkillRow[] = []
  for (const s of Object.values(e?.skills ?? {})) {
    out.push({
      key: `s:${s.name}`, name: s.name, how: s.how, total: s.total, dps: rate(s.total, ms), fill: 0, share: 0,
      hits: s.hits, crits: s.crits, misses: s.misses, resists: s.resists, max: s.max, min: s.min, avg: s.hits ? s.total / s.hits : 0, mods: s.mods
    })
  }
  for (const p of row.pets ?? []) {
    out.push({
      key: `p:${p.key}`, name: p.name, how: 'pet', total: p.total, dps: p.dps, fill: 0, share: 0,
      hits: p.hits, crits: p.crits, misses: p.misses, resists: 0, max: p.max, min: 0, avg: p.hits ? p.total / p.hits : 0, mods: {}
    })
  }
  return finish(out)
}

/** Damage dealt by the rows in scope, per target. */
export function targetRows(seg: Segment, scope: MeterScope): Row[] {
  const ms = durationMs(seg)
  const sums = new Map<string, Row>()
  for (const e of scoped(seg, scope)) {
    for (const [name, t] of Object.entries(e.targets)) {
      const k = nameKey(name)
      const r = sums.get(k) ?? { key: k, name: seg.entities[k]?.name ?? name, kind: seg.entities[k]?.kind ?? 'npc', total: 0, dps: 0, activeDps: 0, fill: 0, share: 0, hits: 0, crits: 0, misses: 0, max: 0 }
      r.total += t.total
      r.hits += t.hits
      r.crits += t.crits
      r.max = Math.max(r.max, t.max)
      sums.set(k, r)
    }
  }
  for (const r of sums.values()) r.dps = rate(r.total, ms)
  return finish([...sums.values()])
}

/** Damage dealt to one target by the rows in scope. */
export function sourcesFor(seg: Segment, scope: MeterScope, target: string): Row[] {
  const ms = durationMs(seg)
  const rows: Row[] = []
  for (const e of scoped(seg, scope)) {
    const t = e.targets[target] ?? e.targets[seg.entities[nameKey(target)]?.name ?? target]
    if (!t) continue
    rows.push({ ...entityRow(e, ms), total: t.total, dps: rate(t.total, ms), activeDps: rate(t.total, e.activeMs), hits: t.hits, crits: t.crits, misses: 0, max: t.max })
  }
  return finish(rows)
}

/** Who hit the rows in scope, and for how much. */
export function attackerRows(seg: Segment, scope: MeterScope): Row[] {
  const ms = durationMs(seg)
  const sums = new Map<string, Row>()
  for (const e of scoped(seg, scope)) {
    for (const [name, t] of Object.entries(e.attackers)) {
      const k = nameKey(name)
      const a = seg.entities[k]
      const r = sums.get(k) ?? { key: k, name: a?.name ?? name, kind: a?.kind ?? 'npc', total: 0, dps: 0, activeDps: 0, fill: 0, share: 0, hits: 0, crits: 0, misses: 0, max: 0 }
      r.total += t.total
      r.hits += t.hits
      r.crits += t.crits
      r.max = Math.max(r.max, t.max)
      sums.set(k, r)
    }
  }
  for (const r of sums.values()) {
    r.dps = rate(r.total, ms)
    r.activeDps = rate(r.total, seg.entities[r.key]?.activeMs ?? 0)
  }
  return finish([...sums.values()])
}

/** What one attacker hit the rows in scope with. */
export function attackerSkillRows(seg: Segment, scope: MeterScope, attacker: string): SkillRow[] {
  const ms = durationMs(seg)
  const a = seg.entities[nameKey(attacker)]
  if (!a) return []
  const wanted = new Set(scoped(seg, scope).map((e) => nameKey(e.name)))
  // The attacker's skills, less what it did to entities out of scope; the log carries no
  // per-target skill split, so the whole skill is shown when every target is in scope.
  const allInScope = Object.keys(a.targets).every((t) => wanted.has(nameKey(t)))
  const out: SkillRow[] = []
  for (const s of Object.values(a.skills)) {
    out.push({
      key: `s:${s.name}`, name: allInScope ? s.name : `${s.name} (all targets)`, how: s.how, total: s.total, dps: rate(s.total, ms), fill: 0, share: 0,
      hits: s.hits, crits: s.crits, misses: s.misses, resists: s.resists, max: s.max, min: s.min, avg: s.hits ? s.total / s.hits : 0, mods: s.mods
    })
  }
  return finish(out)
}

/** The rows in scope by damage taken. */
export function takenRows(seg: Segment, scope: MeterScope): Row[] {
  const ms = durationMs(seg)
  const rows = scoped(seg, scope)
    .filter((e) => e.in.total > 0 || e.defense.swings > 0)
    .map((e) => ({ ...entityRow(e, ms), total: e.in.total, dps: rate(e.in.total, ms), activeDps: 0, hits: e.in.hits, crits: e.in.crits, misses: 0, max: e.in.max }))
  return finish(rows)
}

/** Swings aimed at the rows in scope, summed. */
export function defenseOf(seg: Segment, scope: MeterScope): Defense {
  const d: Defense = { swings: 0, hit: 0, miss: 0, dodge: 0, parry: 0, block: 0, riposte: 0, absorb: 0 }
  for (const e of scoped(seg, scope)) for (const k of Object.keys(d) as (keyof Defense)[]) d[k] += e.defense[k]
  return d
}

function healRow(key: string, name: string, kind: EntityKind, h: HealTally, ms: number): HealRow {
  return {
    key, name, kind, total: h.total, raw: h.raw, overheal: h.raw > 0 ? (h.raw - h.total) / h.raw : 0,
    hps: rate(h.total, ms), fill: 0, share: 0, count: h.count, crits: h.crits, max: h.max
  }
}

export function healerRows(seg: Segment, scope: MeterScope): HealRow[] {
  const ms = durationMs(seg)
  return finish(scoped(seg, scope).filter((e) => e.healOut.count > 0).map((e) => healRow(nameKey(e.name), e.name, e.kind, e.healOut, ms)))
}

export function healSpellRows(seg: Segment, healer: string): HealRow[] {
  const ms = durationMs(seg)
  const e = seg.entities[nameKey(healer)]
  return finish(Object.entries(e?.healSpells ?? {}).map(([name, h]) => healRow(`h:${name}`, name, e!.kind, h, ms)))
}

export function healTargetRows(seg: Segment, healer: string): HealRow[] {
  const ms = durationMs(seg)
  const e = seg.entities[nameKey(healer)]
  return finish(Object.entries(e?.healTargets ?? {}).map(([name, h]) => healRow(nameKey(name), name, seg.entities[nameKey(name)]?.kind ?? 'player', h, ms)))
}

/** Who was healed, across the healers in scope. */
export function healedRows(seg: Segment, scope: MeterScope): HealRow[] {
  const ms = durationMs(seg)
  const sums = new Map<string, HealTally>()
  for (const e of scoped(seg, scope)) {
    for (const [name, h] of Object.entries(e.healTargets)) {
      const k = nameKey(name)
      const s = sums.get(k) ?? { total: 0, raw: 0, count: 0, crits: 0, max: 0 }
      s.total += h.total
      s.raw += h.raw
      s.count += h.count
      s.crits += h.crits
      s.max = Math.max(s.max, h.max)
      sums.set(k, s)
    }
  }
  return finish([...sums].map(([k, h]) => healRow(k, seg.entities[k]?.name ?? k, seg.entities[k]?.kind ?? 'player', h, ms)))
}

export interface Totals {
  total: number
  dps: number
  activeDps: number
  activeSec: number
}

/** The headline: what the listed rows add up to. Active time is the segment's own. */
export function totalsOf(seg: Segment, rows: { total: number }[]): Totals {
  const total = rows.reduce((s, r) => s + r.total, 0)
  return { total, dps: rate(total, durationMs(seg)), activeDps: rate(total, seg.activeMs), activeSec: seg.activeMs / 1000 }
}

export function healTotals(seg: Segment, rows: HealRow[]): Totals & { raw: number } {
  const t = totalsOf(seg, rows)
  return { ...t, raw: rows.reduce((s, r) => s + r.raw, 0) }
}

/** Damage per second over a rolling window, per timeline series, for the chart. */
export function rolling(series: number[], seconds: number, windowSec: number): number[] {
  const out = new Array<number>(seconds).fill(0)
  let sum = 0
  for (let i = 0; i < seconds; i++) {
    sum += series[i] ?? 0
    if (i >= windowSec) sum -= series[i - windowSec] ?? 0
    out[i] = sum / Math.min(i + 1, windowSec)
  }
  return out
}

export const fmtNum = (n: number): string => Math.round(n).toLocaleString()
export const fmtRate = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : n >= 100 ? String(Math.round(n)) : n.toFixed(n >= 10 ? 0 : 1))
export const fmtPct = (x: number): string => `${Math.round(x * 100)}%`

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}

export const KIND_LABEL: Record<EntityKind, string> = { you: '', pet: 'pet', group: 'group', player: '', npc: '', npcpet: 'pet', unknown: '?' }

/** A plain-text table of a meter, for pasting into chat or a note. */
export function copyText(seg: Segment, mode: MeterMode, scope: MeterScope, rows: Row[] | HealRow[], name: string): string {
  const dur = fmtClock(durationSec(seg))
  const head = mode === 'healing' ? healTotals(seg, rows as HealRow[]) : totalsOf(seg, rows)
  const what = mode === 'damage' ? 'Damage' : mode === 'incoming' ? 'Incoming' : 'Healing'
  const per = mode === 'healing' ? 'HPS' : 'DPS'
  const lines = [`${name} · ${dur} · ${what} ${fmtNum(head.total)} · ${fmtNum(head.dps)} ${per} · ${scope}`]
  rows.slice(0, 15).forEach((r, i) => {
    const tag = KIND_LABEL[r.kind] ? ` (${KIND_LABEL[r.kind]})` : ''
    const rateOf = 'hps' in r ? r.hps : r.dps
    lines.push(`${i + 1}. ${r.name}${tag}  ${fmtNum(r.total)} (${fmtPct(r.share)})  ${fmtNum(rateOf)} ${per}`)
  })
  return lines.join('\n')
}
