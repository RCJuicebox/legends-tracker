import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { CLASS_NUMBER, type ClassId } from '../core/acModel'
import { latestAas, type AaSummary } from '../core/aa'

// The game's own tables, read from its Resources folder:
//   skillcaps.txt     CLASS^SKILL^LEVEL^CAP^flag^      every class, skill and level
//   ACMitigation.txt  CLASS^LVL^AC_CAP^SOFT_CAP_MULTIPLIER^
//   basedata.txt      LEVEL^CLASS^hp^mana^end^?^?^hp_fac^mana_fac^end_fac^
// Class numbers are classic EverQuest's (1 Warrior … 16 Berserker), skill numbers too.

interface Tables {
  dir: string
  /** class → skill → caps by level (index 0 = level 1). */
  skills: Map<number, Map<number, number[]>>
  /** class → [cap by level, multiplier by level]. */
  ac: Map<number, { caps: number[]; mult: number[] }>
  /** class → level → what a point of STA, the casting stat and the endurance stats is worth. */
  factors: Map<number, Map<number, { hp: number; mana: number; end: number }>>
}

export interface SkillCapRow {
  id: number
  cap: number
  /** Which of the classes has that best cap. */
  from: string
}

export class GameTables {
  private tables: Tables | null = null

  constructor(private readonly gameDir: () => string) {}

  private async load(): Promise<Tables> {
    const dir = this.gameDir()
    if (this.tables?.dir === dir) return this.tables
    const t: Tables = { dir, skills: new Map(), ac: new Map(), factors: new Map() }
    const read = (f: string) => fs.readFile(join(dir, 'Resources', f), 'utf8').catch(() => '')
    const [skills, ac, base] = await Promise.all([read('skillcaps.txt'), read('ACMitigation.txt'), read('basedata.txt')])
    for (const line of base.split('\n')) {
      const p = line.split('^')
      const [l, c] = [Number(p[0]), Number(p[1])]
      if (!l || !c) continue
      let byLevel = t.factors.get(c)
      if (!byLevel) t.factors.set(c, (byLevel = new Map()))
      byLevel.set(l, { hp: Number(p[7]) || 0, mana: Number(p[8]) || 0, end: Number(p[9]) || 0 })
    }
    for (const line of skills.split('\n')) {
      const [c, s, l, cap] = line.split('^').map(Number)
      if (!c || Number.isNaN(s) || !l) continue
      let bySkill = t.skills.get(c)
      if (!bySkill) t.skills.set(c, (bySkill = new Map()))
      let caps = bySkill.get(s)
      if (!caps) bySkill.set(s, (caps = []))
      caps[l - 1] = cap || 0
    }
    for (const line of ac.split('\n')) {
      if (line.startsWith('#')) continue
      const [c, l, cap, mult] = line.split('^').map(Number)
      if (!c || !l) continue
      let row = t.ac.get(c)
      if (!row) t.ac.set(c, (row = { caps: [], mult: [] }))
      row.caps[l - 1] = cap
      row.mult[l - 1] = mult
    }
    this.tables = t
    return t
  }

  /** Every skill any of the classes has at this level, each at the best cap among them. */
  async skillCaps(classes: string[], level: number): Promise<SkillCapRow[]> {
    const t = await this.load()
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
  async classFactors(classes: string[], level: number): Promise<Record<string, { hp: number; mana: number; end: number }>> {
    const t = await this.load()
    const out: Record<string, { hp: number; mana: number; end: number }> = {}
    for (const cls of classes) {
      const row = t.factors.get(CLASS_NUMBER[cls as ClassId])?.get(level)
      if (row) out[cls] = row
    }
    return out
  }

  /** Soft cap and post-cap multiplier per class at this level. */
  async acCaps(classes: string[], level: number): Promise<Record<string, { cap: number; mult: number }>> {
    const t = await this.load()
    const out: Record<string, { cap: number; mult: number }> = {}
    for (const cls of classes) {
      const row = t.ac.get(CLASS_NUMBER[cls as ClassId])
      if (!row) continue
      const i = Math.min(Math.max(level, 1), row.caps.length) - 1
      out[cls] = { cap: row.caps[i], mult: row.mult[i] }
    }
    return out
  }
}

/**
 * The newest /alternateadv list dump in a log, read from the end backwards in widening windows so a
 * large log costs little. A dump found right at the start of a window might be cut off, so the window
 * widens again before trusting it.
 */
export async function readAasFromLog(logFile: string): Promise<AaSummary | null> {
  let handle
  try {
    handle = await fs.open(logFile, 'r')
  } catch {
    return null
  }
  try {
    const size = (await handle.stat()).size
    for (let span = 4 << 20; ; span *= 4) {
      const start = Math.max(0, size - span)
      const buf = Buffer.alloc(size - start)
      await handle.read(buf, 0, buf.length, start)
      const text = buf.toString('latin1')
      const found = latestAas(text)
      const safe = start === 0 || (found && text.indexOf(`[${found.when}] Ability #`) > 256 * 1024)
      if (found && safe) return found
      if (start === 0) return found
    }
  } finally {
    await handle.close()
  }
}
