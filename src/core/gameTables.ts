import { CLASS_NUMBER, type ClassId } from '../shared/game/classes'
import type { SkillCapRow } from '../shared/ipc'

// The game's own tables, read from its Resources folder:
//   skillcaps.txt     CLASS^SKILL^LEVEL^CAP^flag^      every class, skill and level
//   ACMitigation.txt  CLASS^LVL^AC_CAP^SOFT_CAP_MULTIPLIER^
//   basedata.txt      LEVEL^CLASS^hp^mana^end^?^?^hp_fac^mana_fac^end_fac^
// Class numbers are classic EverQuest's (1 Warrior … 16 Berserker), skill numbers too.
// The main process reads the files (GameTables in main/stats.ts); the parsing and the questions are here.

export interface GameTableData {
  /** class → skill → caps by level (index 0 = level 1). */
  skills: Map<number, Map<number, number[]>>
  /** class → [cap by level, multiplier by level]. */
  ac: Map<number, { caps: number[]; mult: number[] }>
  /** class → level → what a point of STA, the casting stat and the endurance stats is worth. */
  factors: Map<number, Map<number, { hp: number; mana: number; end: number }>>
}

/** The three files' text, each '' when it could not be read. */
export interface GameTableFiles {
  skillcaps: string
  acMitigation: string
  basedata: string
}

/** Parses the three files' text into the tables. */
export function parseGameTables(files: GameTableFiles): GameTableData {
  const t: GameTableData = { skills: new Map(), ac: new Map(), factors: new Map() }
  for (const line of files.basedata.split('\n')) {
    const p = line.split('^')
    const [l, c] = [Number(p[0]), Number(p[1])]
    if (!l || !c) continue
    let byLevel = t.factors.get(c)
    if (!byLevel) t.factors.set(c, (byLevel = new Map()))
    byLevel.set(l, { hp: Number(p[7]) || 0, mana: Number(p[8]) || 0, end: Number(p[9]) || 0 })
  }
  for (const line of files.skillcaps.split('\n')) {
    const [c, s, l, cap] = line.split('^').map(Number)
    if (!c || Number.isNaN(s) || !l) continue
    let bySkill = t.skills.get(c)
    if (!bySkill) t.skills.set(c, (bySkill = new Map()))
    let caps = bySkill.get(s)
    if (!caps) bySkill.set(s, (caps = []))
    caps[l - 1] = cap || 0
  }
  for (const line of files.acMitigation.split('\n')) {
    if (line.startsWith('#')) continue
    const [c, l, cap, mult] = line.split('^').map(Number)
    if (!c || !l) continue
    let row = t.ac.get(c)
    if (!row) t.ac.set(c, (row = { caps: [], mult: [] }))
    row.caps[l - 1] = cap
    row.mult[l - 1] = mult
  }
  return t
}

/** Every skill any of the classes has at this level, each at the best cap among them. */
export function skillCapsOf(t: GameTableData, classes: string[], level: number): SkillCapRow[] {
  const best = new Map<number, SkillCapRow>()
  for (const cls of classes) {
    const bySkill = t.skills.get(CLASS_NUMBER[cls as ClassId])
    if (!bySkill) continue
    for (const [id, caps] of bySkill) {
      const cap = caps[Math.min(Math.max(level, 1), caps.length) - 1] ?? 0
      if (cap > (best.get(id)?.cap ?? 0)) best.set(id, { id, cap, from: cls })
    }
  }
  return [...best.values()].sort((a, b) => b.cap - a.cap || a.id - b.id)
}

/** Per class, the HP, mana and endurance factors at this level (basedata.txt). */
export function classFactorsOf(t: GameTableData, classes: string[], level: number): Record<string, { hp: number; mana: number; end: number }> {
  const out: Record<string, { hp: number; mana: number; end: number }> = {}
  for (const cls of classes) {
    const row = t.factors.get(CLASS_NUMBER[cls as ClassId])?.get(level)
    if (row) out[cls] = row
  }
  return out
}

/** Soft cap and post-cap multiplier per class at this level. */
export function acCapsOf(t: GameTableData, classes: string[], level: number): Record<string, { cap: number; mult: number }> {
  const out: Record<string, { cap: number; mult: number }> = {}
  for (const cls of classes) {
    const row = t.ac.get(CLASS_NUMBER[cls as ClassId])
    if (!row) continue
    const i = Math.min(Math.max(level, 1), row.caps.length) - 1
    out[cls] = { cap: row.caps[i], mult: row.mult[i] }
  }
  return out
}
