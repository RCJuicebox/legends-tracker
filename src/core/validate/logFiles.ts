import { type MoteStock, type SpellRule } from '../../shared/types'
import { SPOT_WITHIN, type RespawnRecords, type RespawnTimerSpec, type SpawnLink, type SpawnSpot } from '../respawns'
import { MOTE_RANKS, type MoteSession, type MoteState } from '../motes'
import type { ActiveBuff, BuffsFile, Person } from '../buffs'
import { DAY } from './triggers'
import { bool, num, numbers, oneOf, str } from './settings'
import { isCharacterKey, isObj, stringsArg } from './args'

// The files the log keeps: respawns, buffs, spell rules, motes and their stock, casts.

/** respawns.json as read back: records with a name and a zone, every field in range. */
export function sanitizeRespawns(v: unknown): RespawnRecords {
  const out: RespawnRecords = {}
  if (!isObj(v)) return out
  for (const [key, r] of Object.entries(v)) {
    if (!isObj(r) || typeof r.name !== 'string' || !r.name || typeof r.zone !== 'string') continue
    out[key] = {
      zone: r.zone,
      name: r.name,
      kills: num(r.kills, 0, 0, 1e9),
      lastDeath: num(r.lastDeath, 0, 0, 1e15),
      pendingSince: num(r.pendingSince, 0, 0, 1e15),
      gaps: numbers(r.gaps).filter((g) => g >= 0),
      shared: bool(r.shared, false)
    }
    const names = stringsArg(r.names, MAX_SPAWN_NAMES)
    if (names.length) out[key].names = names
    const spot = names.length ? spawnSpot(r.spot) : null
    if (spot) out[key].spot = spot
  }
  return out
}

/** The most mobs one spawn point can pop, as far as a link goes. */
export const MAX_SPAWN_NAMES = 12

/** A spawn point's spot: two or three numbers in the /loc order, and how near; null otherwise. */
function spawnSpot(v: unknown): SpawnSpot | null {
  if (!isObj(v) || !Array.isArray(v.at) || v.at.length < 2 || v.at.length > 3) return null
  if (!v.at.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e6)) return null
  return { at: [...v.at] as SpawnSpot['at'], within: Math.round(num(v.within, SPOT_WITHIN, 1, 5000)) }
}

/** A spawn point as the Respawns page links it: a zone, its own name and at least two mobs, or one pinned to a spot; null otherwise. */
export function sanitizeSpawnLink(v: unknown): SpawnLink | null {
  if (!isObj(v) || typeof v.zone !== 'string' || !v.zone.trim() || typeof v.name !== 'string' || !v.name.trim()) return null
  const names = [
    ...new Map(
      stringsArg(v.names, MAX_SPAWN_NAMES, 100)
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => [n.toLowerCase(), n])
    ).values()
  ]
  const spot = v.spot === undefined ? null : spawnSpot(v.spot)
  if (v.spot !== undefined && !spot) return null
  if (names.length < (spot ? 1 : 2)) return null
  return { zone: v.zone.trim(), name: v.name.trim().slice(0, 100), names, ...(spot ? { spot } : {}) }
}

/** A respawn timer as the Respawns page asks for it; null without a name or a length. */
export function sanitizeRespawnTimer(v: unknown): RespawnTimerSpec | null {
  if (!isObj(v) || typeof v.name !== 'string' || !v.name.trim() || typeof v.seconds !== 'number') return null
  return {
    name: v.name.trim().slice(0, 100),
    seconds: Math.round(num(v.seconds, 0, 1, DAY)),
    overlay: str(v.overlay, 'respawns'),
    warnSec: Math.round(num(v.warnSec, 0, 0, 3600)),
    announce: bool(v.announce, true)
  }
}

/** buffs.json as read back: people with a name and classes, wanted lists of names, active buffs with times. */
export function sanitizeBuffs(v: unknown): BuffsFile {
  const out: BuffsFile = { people: {}, wanted: {}, active: {} }
  if (!isObj(v)) return out
  if (isObj(v.people)) {
    for (const [k, p] of Object.entries(v.people)) {
      if (!isObj(p) || typeof p.name !== 'string' || !Array.isArray(p.classes)) continue
      const person: Person = {
        name: p.name,
        classes: p.classes.filter((c): c is string => typeof c === 'string'),
        level: num(p.level, 1, 1, 100),
        race: str(p.race, ''),
        at: num(p.at, 0, 0, 1e15)
      }
      out.people[k.toLowerCase()] = person
    }
  }
  if (isObj(v.lasts)) {
    const lasts: NonNullable<BuffsFile['lasts']> = {}
    for (const [caster, spells] of Object.entries(v.lasts)) {
      if (!isObj(spells)) continue
      for (const [spell, list] of Object.entries(spells)) {
        if (!Array.isArray(list)) continue
        const kept = list.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0).slice(-9)
        if (kept.length) (lasts[caster.toLowerCase()] ??= {})[spell] = kept
      }
    }
    if (Object.keys(lasts).length) out.lasts = lasts
  }
  if (isObj(v.wanted)) {
    for (const [k, list] of Object.entries(v.wanted)) {
      if (isCharacterKey(k) && Array.isArray(list)) out.wanted[k] = list.filter((x): x is string => typeof x === 'string')
    }
  }
  if (isObj(v.active)) {
    for (const [k, list] of Object.entries(v.active)) {
      if (!isCharacterKey(k) || !Array.isArray(list)) continue
      out.active[k] = list.flatMap((b): ActiveBuff[] =>
        isObj(b) && typeof b.spell === 'string' && typeof b.line === 'string'
          ? [
              {
                spell: b.spell,
                ranked: str(b.ranked, b.spell),
                line: b.line as ActiveBuff['line'],
                caster: str(b.caster, ''),
                landedAt: num(b.landedAt, 0, 0, 1e15),
                endsAt: b.endsAt === null ? null : num(b.endsAt, 0, 0, 1e15)
              }
            ]
          : []
      )
    }
  }
  return out
}

/** A spell's own settings from the Spell Timers page: known fields only, each of its own kind; null when not an object. */
export function sanitizeSpellRule(v: unknown): SpellRule | null {
  if (!isObj(v)) return null
  const out: SpellRule = {}
  for (const k of ['track', 'recastCue', 'fadeCue', 'others'] as const) if (typeof v[k] === 'boolean') out[k] = v[k] as boolean
  for (const k of ['alias', 'warnSpeech', 'fadeSpeech', 'othersSpeech', 'color', 'overlay'] as const) if (typeof v[k] === 'string') out[k] = (v[k] as string).slice(0, 500)
  if (typeof v.warnSec === 'number' && Number.isFinite(v.warnSec)) out.warnSec = num(v.warnSec, 0, 0, 3600)
  if (typeof v.durationOverrideSec === 'number' && Number.isFinite(v.durationOverrideSec)) out.durationOverrideSec = num(v.durationOverrideSec, 0, 0, 7 * DAY)
  if (typeof v.extraFocusPct === 'number' && Number.isFinite(v.extraFocusPct)) out.extraFocusPct = num(v.extraFocusPct, 0, -100, 1000)
  return out
}

/** Motes on hand as the planner sends them: known ranks only, whole numbers from 0. */
export function sanitizeStockCounts(v: unknown): MoteStock['counts'] {
  const out: MoteStock['counts'] = {}
  if (!isObj(v)) return out
  for (const { key } of MOTE_RANKS) if (typeof v[key] === 'number' && Number.isFinite(v[key])) out[key] = Math.round(num(v[key], 0, 0, 1e9))
  return out
}

/** The item being planned; null when it is not an object. */
export function sanitizeStockItem(v: unknown): MoteStock['item'] | null {
  if (!isObj(v)) return null
  return { name: str(v.name, '').slice(0, 200), lvl: Math.round(num(v.lvl, 0, 0, 100)), xp: num(v.xp, 0, 0, 1e9), to: Math.round(num(v.to, 1, 0, 100)) }
}

/** mote-stock.json as read back: the planner's counts and item, with the loot-line mark it counts from. */
export function sanitizeMoteStock(v: unknown): MoteStock {
  const o = isObj(v) ? v : {}
  const out: MoteStock = {
    counts: sanitizeStockCounts(o.counts),
    item: sanitizeStockItem(o.item) ?? { name: '', lvl: 0, xp: 0, to: 1 },
    autoAdd: bool(o.autoAdd, true)
  }
  if (typeof o.seenUntil === 'number' && Number.isFinite(o.seenUntil)) out.seenUntil = o.seenUntil
  if (typeof o.seenAtSecond === 'number' && Number.isFinite(o.seenAtSecond)) out.seenAtSecond = Math.max(0, Math.round(o.seenAtSecond))
  if (Array.isArray(o.merges))
    out.merges = o.merges
      .filter((m): m is { name: string; at: number } => isObj(m) && typeof m.name === 'string' && typeof m.at === 'number' && Number.isFinite(m.at))
      .map((m) => ({ name: m.name.slice(0, 200), at: m.at }))
      .slice(-50)
  return out
}

export const SESSION_KINDS = ['instance', 'crawl', 'manual'] as const
export const SESSION_OUTCOMES = ['active', 'completed', 'abandoned', 'stopped', 'game closed'] as const
export const time = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function moteSession(v: unknown): MoteSession | null {
  if (!isObj(v) || typeof v.id !== 'string' || time(v.startedAt) === null) return null
  const s: MoteSession = {
    id: v.id,
    kind: oneOf(v.kind, SESSION_KINDS, 'instance'),
    name: str(v.name, ''),
    startedAt: v.startedAt as number,
    endedAt: time(v.endedAt),
    outcome: oneOf(v.outcome, SESSION_OUTCOMES, 'stopped'),
    motes: sanitizeStockCounts(v.motes),
    outsideSince: time(v.outsideSince),
    outsideMs: num(v.outsideMs, 0, 0, 1e12)
  }
  if (v.byHand === true) s.byHand = true
  if ('pausedSince' in v) s.pausedSince = time(v.pausedSince)
  if ('pausedMs' in v) s.pausedMs = num(v.pausedMs, 0, 0, 1e12)
  return s
}

/**
 * motes.json as read back. Null when its outline is wrong (no session list, no daily counts): the
 * history is then rebuilt from the logs, which hold all of it. Otherwise broken runs and days are
 * dropped and the rest kept.
 */
export function sanitizeMotes(v: unknown): MoteState | null {
  if (!isObj(v) || !Array.isArray(v.sessions) || !isObj(v.daily)) return null
  const daily: MoteState['daily'] = {}
  for (const [day, counts] of Object.entries(v.daily)) if (/^\d{4}-\d{2}-\d{2}$/.test(day) && isObj(counts)) daily[day] = sanitizeStockCounts(counts)
  const out: MoteState = {
    active: v.active === null ? null : moteSession(v.active),
    sessions: v.sessions.map(moteSession).filter((s): s is MoteSession => !!s),
    daily
  }
  const seen = time(v.seenUntil)
  if (seen !== null) out.seenUntil = seen
  if (isObj(v.marks)) {
    const marks: NonNullable<MoteState['marks']> = {}
    for (const [k, kind] of Object.entries(v.marks)) if (kind === 'crawl' || kind === 'instance') marks[k] = kind
    out.marks = marks
  }
  return out
}

export type KnownCasts = Record<string, { rankedName: string; lastCast: number; count: number }>

/**
 * casts.json as read back: by character key (`''` for casts kept before they were per character),
 * each spell's ranked name, last cast and count. Entries of another shape are dropped.
 */
export function sanitizeCasts(v: unknown): Record<string, KnownCasts> {
  const out: Record<string, KnownCasts> = {}
  if (!isObj(v)) return out
  for (const [key, casts] of Object.entries(v)) {
    if (!isObj(casts) || (key !== '' && !isCharacterKey(key))) continue
    const mine: KnownCasts = {}
    for (const [name, c] of Object.entries(casts)) {
      if (!isObj(c) || typeof c.rankedName !== 'string') continue
      mine[name] = { rankedName: c.rankedName, lastCast: num(c.lastCast, 0, 0, 1e15), count: Math.round(num(c.count, 0, 0, 1e9)) }
    }
    if (Object.keys(mine).length) out[key] = mine
  }
  return out
}
