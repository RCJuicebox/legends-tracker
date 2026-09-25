// The game's achievements export (/outputfile achievements), and the rules for reading it:
//   Heading line      "Category: Section"                (no tabs)
//   Achievement line  "C<tab>Name"                       (C complete, I incomplete)
//   Objective line    "I<tab><tab>Text[<tab>cur/max]"    ("(Optional) " marks an optional one)
//
// On top of the export the player can tick objectives the export does not show yet, and mark an
// achievement Broken: one the game cannot complete. Broken ones stop counting, and anything that needs
// one shows as Blocked instead of open. Those marks are kept by name, so they survive a new export.

export interface AchObjective {
  t: string
  /** Complete. */
  d?: boolean
  /** Optional: never counts toward completion, as the game scores it. */
  o?: boolean
  /** Progress, [current, max]. */
  p?: [number, number]
}

export interface Achievement {
  n: string
  d?: boolean
  c: AchObjective[]
}

export interface AchSection {
  cat: string
  name: string
  ach: Achievement[]
}

export interface AchParseStats {
  sections: number
  ach: number
  achDone: number
  comp: number
  compDone: number
}

/** What the player added on top of the export, kept by name. */
export interface AchMarks {
  /** Objectives ticked by hand: objKey(). */
  ticks: string[]
  /** Achievements marked Broken: achKey(). */
  broken: string[]
}

const PROG = /^(\d+)\s*\/\s*(\d+)$/

export function parseAchievements(text: string): { sections: AchSection[]; stats: AchParseStats } {
  const lines = String(text).replace(/^﻿/, '').replace(/\r/g, '').split('\n')
  const sections: AchSection[] = []
  const stats: AchParseStats = { sections: 0, ach: 0, achDone: 0, comp: 0, compDone: 0 }
  let sec: AchSection | null = null
  let ach: Achievement | null = null
  for (const raw of lines) {
    if (!raw.trim()) continue
    const tab = raw.indexOf('\t')
    if (tab < 0) {
      const line = raw.trim()
      const ix = line.indexOf(': ')
      sec = { cat: ix > 0 ? line.slice(0, ix) : '', name: ix > 0 ? line.slice(ix + 2) : line, ach: [] }
      sections.push(sec)
      ach = null
      stats.sections++
      continue
    }
    const status = raw.slice(0, tab).trim().toUpperCase()
    const rest = raw.slice(tab)
    let depth = 0
    while (depth < rest.length && rest.charAt(depth) === '\t') depth++
    const fields = rest
      .slice(depth)
      .split('\t')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!fields.length) continue
    let text = fields[0]
    let prog: [number, number] | undefined
    for (const f of fields.slice(1)) {
      const pm = PROG.exec(f)
      if (pm) prog = [+pm[1], +pm[2]]
      else text += ' ' + f
    }
    const done = status === 'C'
    if (!sec) {
      sec = { cat: '', name: 'Achievements', ach: [] }
      sections.push(sec)
      stats.sections++
    }
    if (depth <= 1 || !ach) {
      ach = { n: text, c: [] }
      if (done) ach.d = true
      sec.ach.push(ach)
      stats.ach++
      if (done) stats.achDone++
    } else {
      const c: AchObjective = { t: text }
      const om = /^\(Optional\)\s*/i.exec(text)
      if (om) {
        c.t = text.slice(om[0].length)
        c.o = true
      }
      if (done) c.d = true
      if (prog) c.p = prog
      ach.c.push(c)
      stats.comp++
      if (done) stats.compDone++
    }
  }
  if (!stats.ach) throw new Error('No achievements found. Expected heading lines like "EverQuest: Hunter" followed by tab-indented lines that start with I or C.')
  return { sections, stats }
}

/** "Kelwyn_neriak-Achievements.txt" → { character: 'Kelwyn', server: 'neriak' } */
export function sourceFromName(name: string): { character: string; server: string } {
  const m = /^(.+?)_(.+?)-Achievements\.txt$/i.exec(name)
  return m ? { character: m[1], server: m[2] } : { character: '', server: '' }
}

export const norm = (s: string) => String(s).toLowerCase().replace(/\s+/g, ' ').trim()
export const secKey = (sec: AchSection) => (sec.cat ? `${sec.cat}: ${sec.name}` : sec.name)
export const achKey = (sec: AchSection, a: Achievement) => `${secKey(sec)} > ${norm(a.n)}`
export const objKey = (sec: AchSection, a: Achievement, c: AchObjective) => `${achKey(sec, a)} > ${norm(c.t)}`

/** "Hunter of Befallen" → "Befallen": achievements named for a place, whose objectives are named mobs there. */
export function placeOf(a: Achievement): string | null {
  const m = /^(?:Hunter|Conqueror) of (.+)$/i.exec(a.n)
  return m ? m[1] : null
}

/**
 * Zones that share their kills, so one named counts in both. Verified against the export: both lists
 * carried identical statuses. Same-named mobs in two unrelated zones are separate kills, and must not
 * be listed here.
 */
const SHARED_KILLS: [string, string][] = [['The Lair of the Splitpaw', 'The Southern Plains of Karana']]

/** [section, achievement] */
export type AchRef = [number, number]
/** [section, achievement, objective] */
export type ObjRef = [number, number, number]

export type AchState = 'done' | 'broken' | 'blocked' | 'open'

export interface AchCounts {
  req: number
  done: number
  opt: number
  optDone: number
  /** Required objectives that follow a broken or blocked achievement. */
  ign: number
}

export interface GroupStats {
  ach: number
  done: number
  ign: number
  blocked: number
  open: number
  trackable: number
  req: number
  reqDone: number
  opt: number
  optDone: number
}

/**
 * The export with the player's marks applied, and every rule that reads across it: objectives that
 * name another achievement follow it, twin achievements listed in two sections tick together, and a
 * named in zones that share kills ticks in both.
 */
export class AchievementBook {
  readonly sections: AchSection[]
  private readonly ticked = new Set<string>()
  private readonly brokenSet = new Set<string>()
  /** Objective → the achievement it names. */
  private readonly links = new Map<string, AchRef>()
  /** Achievement → every copy of it, itself included, when it is listed more than once. */
  private readonly twins = new Map<string, AchRef[]>()
  /** Objective → the same named in a zone that shares the kill. */
  private readonly kin = new Map<string, ObjRef[]>()
  /** Named → every place-achievement that lists it. */
  private readonly places = new Map<string, string[]>()
  private stateCache = new Map<string, AchState>()
  private doneCache = new Map<string, boolean>()

  constructor(sections: AchSection[], marks: AchMarks = { ticks: [], broken: [] }) {
    this.sections = sections
    for (const t of marks.ticks) this.ticked.add(t)
    for (const b of marks.broken) this.brokenSet.add(b)
    this.index()
  }

  ach([si, ai]: AchRef): Achievement {
    return this.sections[si].ach[ai]
  }

  private index(): void {
    const byName: Map<string, number>[] = []
    const global = new Map<string, AchRef>()
    const groups = new Map<string, AchRef[]>()
    this.sections.forEach((sec, si) => {
      const map = new Map<string, number>()
      byName.push(map)
      sec.ach.forEach((a, ai) => {
        const k = norm(a.n)
        if (!map.has(k)) map.set(k, ai)
        if (!global.has(k)) global.set(k, [si, ai])
        const gk = k + '|' + a.c.map((c) => (c.o ? '*' : '') + norm(c.t)).join('|')
        groups.set(gk, [...(groups.get(gk) ?? []), [si, ai]])
      })
    })
    for (const refs of groups.values()) if (refs.length > 1) for (const r of refs) this.twins.set(r.join(':'), refs)

    this.sections.forEach((sec, si) =>
      sec.ach.forEach((a, ai) =>
        a.c.forEach((c, ci) => {
          for (const k of linkCandidates(c.t)) {
            const t: AchRef | undefined = byName[si].has(k) ? [si, byName[si].get(k)!] : global.get(k)
            if (t && !(t[0] === si && t[1] === ai)) {
              this.links.set(`${si}:${ai}:${ci}`, t)
              break
            }
          }
        })
      )
    )

    // Which zones each named appears in. Only place-named achievements count, and only their real
    // objectives: one that links to another achievement is a zone, not a named.
    const placeAt = new Map<string, AchRef>()
    this.sections.forEach((sec, si) =>
      sec.ach.forEach((a, ai) => {
        const p = placeOf(a)
        if (!p) return
        if (!placeAt.has(p)) placeAt.set(p, [si, ai])
        a.c.forEach((c, ci) => {
          if (this.link([si, ai, ci])) return
          const list = this.places.get(norm(c.t)) ?? []
          if (!list.includes(p)) list.push(p)
          this.places.set(norm(c.t), list)
        })
      })
    )
    for (const [pa, pb] of SHARED_KILLS) {
      const A = placeAt.get(pa)
      const B = placeAt.get(pb)
      if (!A || !B) continue
      this.ach(A).c.forEach((ca, i) => {
        if (this.link([...A, i])) return
        this.ach(B).c.forEach((cb, j) => {
          if (this.link([...B, j]) || norm(cb.t) !== norm(ca.t)) return
          this.kin.set(`${A[0]}:${A[1]}:${i}`, [...(this.kin.get(`${A[0]}:${A[1]}:${i}`) ?? []), [B[0], B[1], j]])
          this.kin.set(`${B[0]}:${B[1]}:${j}`, [...(this.kin.get(`${B[0]}:${B[1]}:${j}`) ?? []), [A[0], A[1], i]])
        })
      })
    }
  }

  /** The achievement this objective names, if it names one. */
  link([si, ai, ci]: ObjRef): AchRef | undefined {
    return this.links.get(`${si}:${ai}:${ci}`)
  }

  twinsOf(r: AchRef): AchRef[] | undefined {
    return this.twins.get(r.join(':'))
  }

  kinOf(r: ObjRef): ObjRef[] {
    return this.kin.get(r.join(':')) ?? []
  }

  /** Other place-achievements that list the same named. */
  otherPlaces(c: AchObjective, place: string): string[] {
    return (this.places.get(norm(c.t)) ?? []).filter((p) => p !== place)
  }

  /** The zone column shows only where a block holds real named, not a region made of zone links. */
  hasZoneColumn(r: AchRef): boolean {
    const a = this.ach(r)
    return !!placeOf(a) && a.c.some((_, ci) => !this.link([...r, ci]))
  }

  /** Recorded by the game itself, so a tick cannot take it back. */
  fromGame([si, ai, ci]: ObjRef): boolean {
    return !!this.sections[si].ach[ai].c[ci].d
  }

  ticks([si, ai, ci]: ObjRef): boolean {
    const sec = this.sections[si]
    const a = sec.ach[ai]
    return this.ticked.has(objKey(sec, a, a.c[ci]))
  }

  isBroken(r: AchRef): boolean {
    return this.brokenSet.has(achKey(this.sections[r[0]], this.ach(r)))
  }

  /** An objective counts as done when the game says so, it is ticked, or the achievement it names is done. */
  objDone(r: ObjRef): boolean {
    const to = this.link(r)
    if (to) return this.achDone(to)
    return this.fromGame(r) || this.ticks(r)
  }

  /** Done when the game says so, or when every required objective is. */
  achDone(r: AchRef, seen = new Set<string>()): boolean {
    const key = r.join(':')
    const cached = this.doneCache.get(key)
    if (cached !== undefined) return cached
    const a = this.ach(r)
    if (a.d) return this.cacheDone(key, true)
    if (seen.has(key)) return false
    seen.add(key)
    const req = a.c.map((c, ci) => ({ c, ci })).filter(({ c }) => !c.o)
    const done =
      req.length > 0 &&
      req.every(({ ci }) => {
        const to = this.link([...r, ci])
        return to ? this.achDone(to, seen) : this.fromGame([...r, ci]) || this.ticks([...r, ci])
      })
    return this.cacheDone(key, done)
  }

  private cacheDone(key: string, v: boolean): boolean {
    this.doneCache.set(key, v)
    return v
  }

  /** done | broken | blocked | open. Blocked: nothing left except objectives that need a broken achievement. */
  state(r: AchRef): AchState {
    const key = r.join(':')
    const cached = this.stateCache.get(key)
    if (cached) return cached
    if (this.achDone(r)) return this.cacheState(key, 'done')
    if (this.isBroken(r)) return this.cacheState(key, 'broken')
    this.stateCache.set(key, 'open') // guards cycles
    const a = this.ach(r)
    const req = a.c.map((c, ci) => ({ c, ci })).filter(({ c }) => !c.o)
    let anyIgnored = false
    let allSettled = req.length > 0
    for (const { ci } of req) {
      if (this.objDone([...r, ci])) continue
      if (this.objIgnored([...r, ci])) {
        anyIgnored = true
        continue
      }
      allSettled = false
      break
    }
    return this.cacheState(key, allSettled && anyIgnored ? 'blocked' : 'open')
  }

  private cacheState(key: string, s: AchState): AchState {
    this.stateCache.set(key, s)
    return s
  }

  /** Needs an achievement that is broken, or blocked itself. */
  objIgnored(r: ObjRef): boolean {
    const to = this.link(r)
    if (!to) return false
    const s = this.state(to)
    return s === 'broken' || s === 'blocked'
  }

  counts(r: AchRef): AchCounts {
    const s: AchCounts = { req: 0, done: 0, opt: 0, optDone: 0, ign: 0 }
    this.ach(r).c.forEach((c, ci) => {
      const o: ObjRef = [...r, ci]
      const done = this.objDone(o)
      if (c.o) {
        s.opt++
        if (done) s.optDone++
      } else if (!done && this.objIgnored(o)) s.ign++
      else {
        s.req++
        if (done) s.done++
      }
    })
    return s
  }

  private statsOf(refs: AchRef[]): GroupStats {
    const s: GroupStats = { ach: refs.length, done: 0, ign: 0, blocked: 0, open: 0, trackable: 0, req: 0, reqDone: 0, opt: 0, optDone: 0 }
    for (const r of refs) {
      const st = this.state(r)
      if (st === 'broken') s.ign++
      else s[st]++
      const x = this.counts(r)
      s.req += x.req
      s.reqDone += x.done
      s.opt += x.opt
      s.optDone += x.optDone
    }
    s.trackable = s.ach - s.ign
    return s
  }

  sectionStats(si: number): GroupStats {
    return this.statsOf(this.sections[si].ach.map((_, ai) => [si, ai] as AchRef))
  }

  categories(): string[] {
    return [...new Set(this.sections.map((s) => s.cat))]
  }

  categoryStats(cat: string): GroupStats {
    return this.statsOf(this.sections.flatMap((sec, si) => (sec.cat === cat ? sec.ach.map((_, ai) => [si, ai] as AchRef) : [])))
  }

  totals(): GroupStats & { secs: number; secsDone: number } {
    const all = this.statsOf(this.sections.flatMap((sec, si) => sec.ach.map((_, ai) => [si, ai] as AchRef)))
    let secsDone = 0
    this.sections.forEach((_, si) => {
      const s = this.sectionStats(si)
      if (s.trackable > 0 && s.done === s.trackable) secsDone++
    })
    return { ...all, secs: this.sections.length, secsDone }
  }

  /** Every objective one tick lands on: itself, the same named in a zone sharing the kill, and each twin of those. */
  tickTargets(r: ObjRef): ObjRef[] {
    const seeds: ObjRef[] = [r, ...this.kinOf(r)]
    const out: ObjRef[] = []
    const seen = new Set<string>()
    for (const [si, ai, ci] of seeds) {
      for (const [tsi, tai] of this.twinsOf([si, ai]) ?? [[si, ai] as AchRef]) {
        const k = `${tsi}:${tai}:${ci}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push([tsi, tai, ci])
      }
    }
    return out
  }

  /** The marks after ticking or unticking an objective (and everywhere the tick lands). */
  withTick(r: ObjRef, on: boolean, marks: AchMarks): AchMarks {
    const ticks = new Set(marks.ticks)
    for (const [si, ai, ci] of this.tickTargets(r)) {
      const sec = this.sections[si]
      const a = sec.ach[ai]
      const c = a.c[ci]
      if (!c) continue
      if (on && !c.d) ticks.add(objKey(sec, a, c))
      else ticks.delete(objKey(sec, a, c))
    }
    return { ...marks, ticks: [...ticks] }
  }

  /** The marks after marking an achievement Broken or not (twins included). */
  withBroken(r: AchRef, on: boolean, marks: AchMarks): AchMarks {
    const broken = new Set(marks.broken)
    for (const t of this.twinsOf(r) ?? [r]) {
      const k = achKey(this.sections[t[0]], this.ach(t))
      if (on) broken.add(k)
      else broken.delete(k)
    }
    return { ...marks, broken: [...broken] }
  }

  /** Ticks the export now records itself are dropped; they have done their job. */
  prune(marks: AchMarks): AchMarks {
    const recorded = new Set<string>()
    for (const sec of this.sections) for (const a of sec.ach) for (const c of a.c) if (c.d) recorded.add(objKey(sec, a, c))
    return { ...marks, ticks: marks.ticks.filter((t) => !recorded.has(t)) }
  }
}

function linkCandidates(t: string): string[] {
  const m = /^Complete the achievement\s+"(.+)"\.?$/i.exec(t)
  const base = m ? m[1] : t
  const out = [base]
  if (base.indexOf(' or ') > 0) out.push(...base.split(' or '))
  return out.map(norm)
}

/** Sorts ignoring a leading article, reading numbers as numbers: "a froglok scryer" under F, Baking (100) after Baking (50). */
export function compareNames(x: string, y: string): number {
  const key = (t: string) => String(t).toLowerCase().replace(/^(?:an?|the)\s+/, '')
  return key(x).localeCompare(key(y), undefined, { numeric: true, sensitivity: 'base' })
}

/** Achievements whose kills are the SAME named mobs as another's: tick either, both tick. Exposed for tests. */
export const sharedKills = SHARED_KILLS
