import { AchievementBook, achKey, type AchSection } from './achievements'
import type { SkillRow, SlayerRow, TrackedAchievement } from '../shared/tracking'

// The achievements the player tracks (the star on the Achievements page), each with its progress in
// whatever way it has one: a Slayer count, the skills it wants, a faction's standing, else the
// objectives still to do, a named the log has shown killed since the export ticked off at once.

export interface TrackedSources {
  slayer?: SlayerRow[]
  skills?: SkillRow[]
  /** Faction achievements' factions and standings, by achievement name lower-cased. */
  factions?: Record<string, { faction: string; standing: number | null }> | null
  /** Kills since the export, by mob name lower-cased. */
  kills?: Map<string, { times: number[] }>
  /** Achievements the game said were completed since the export, lower-cased. */
  completed?: Set<string>
}

/** A mob's name for matching: lower-cased, its article and the log's marks off. */
const bare = (name: string) =>
  name
    .toLowerCase()
    .replace(/^[*#]+/, '')
    .replace(/^(?:an?|the)\s+/, '')
    .trim()

/** The tracked achievements (by achKey, in the order tracked) the export still lists, with their progress. */
export function trackedAchievements(sections: AchSection[], marks: { ticks: string[]; tracked: string[] }, from: TrackedSources = {}): TrackedAchievement[] {
  if (!marks.tracked.length) return []
  const book = new AchievementBook(sections, { ticks: marks.ticks, broken: [] })
  const where = new Map<string, [number, number]>()
  sections.forEach((sec, si) => sec.ach.forEach((a, ai) => where.set(achKey(sec, a), [si, ai])))
  // A Hunter objective names the mob without its article ("orc warlord"); the log with it ("an orc warlord").
  const kills = new Map([...(from.kills ?? [])].map(([k, v]) => [bare(k), v]))
  const out: TrackedAchievement[] = []
  for (const key of marks.tracked) {
    const at = where.get(key)
    // Not in the export: done since, and so no longer listed.
    if (!at) continue
    const [si, ai] = at
    const sec = sections[si]
    const a = sec.ach[ai]
    const t: TrackedAchievement = { key, name: a.n, section: sec.cat ? `${sec.cat}: ${sec.name}` : sec.name, done: book.achDone(at) || !!from.completed?.has(a.n.toLowerCase()) }
    const slayer = from.slayer?.find((r) => r.name === a.n)
    const skills = from.skills?.filter((r) => r.achievement === a.n) ?? []
    const faction = from.factions?.[a.n.toLowerCase()]
    if (slayer) t.count = { value: Math.min(slayer.max, slayer.count + slayer.since), max: slayer.max, since: slayer.since }
    else if (skills.length) t.skills = skills.map((r) => ({ skill: r.skill, value: r.value, target: r.target }))
    else if (faction && faction.standing !== null) t.count = { value: faction.standing, max: 2000, faction: faction.faction }
    else {
      const required = a.c.map((c, ci) => ({ c, ci })).filter(({ c }) => !c.o)
      const open = required.filter(({ ci }) => !book.objDone([si, ai, ci]))
      const killedAt = (name: string) => {
        const times = kills.get(bare(name))?.times
        return times?.length ? Math.max(...times) : 0
      }
      // A named killed since the export is ticked off here before the next export says so.
      const justDone = open.map(({ c }) => ({ name: c.t, at: killedAt(c.t) })).filter((x) => x.at > 0)
      t.left = open.map(({ c }) => c.t).filter((n) => !justDone.some((x) => x.name === n))
      t.total = required.length
      if (justDone.length) t.justDone = justDone.sort((x, y) => y.at - x.at)
      if (!t.left.length && required.length) t.done = true
    }
    out.push(t)
  }
  return out
}
