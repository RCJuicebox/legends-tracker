import { playableRace } from '../../shared/game/races'
import type { AchSection, Achievement } from '../../core/achievements'
import type { UnlockGoal } from './planner'

// The race unlocks: Legends' "Untapped Potential: Races" achievements, one a race, each done by
// maxing three of that race's home factions ("Get maximum faction with Merchants of Halas."). One
// done lets the character pick the race in Loadouts, and so swap to it for a quest its own race's con
// keeps closed. The client's Resources/Achievements files define them: AchievementsClient.txt names
// them, and AchievementComponentsClient.txt lists each one's parts, a faction's as 60000 + its id. The
// achievements export says which are done, part by part. A part is done the moment its faction reaches
// 2000, like the faction's own Progression achievement, and stays done: one character's Freeport
// unlock is done with The Freeport Militia at −226 since. Half Elf's comes with Human's or Wood Elf's,
// Kerran's is a task rather than factions, and Drakkin's is a placeholder (no Drakkin in game yet).

const RACE_UNLOCK = /^Race Unlock - (.+?)\s*$/i
const MAX_FACTION = /^Get maximum faction with (.+?)\.?\s*$/i
const WITH_RACES = /autocomplete when you unlock (.+?) as a race/i
/** A part that is a faction's, as the component list refers to it: 60000 + the faction's id. */
const FACTION_PART_BASE = 60000

/** A race unlock as the client defines it. */
export interface RaceUnlockDef {
  id: number
  /** "Race Unlock - Human (Qeynos)". */
  achievement: string
  /** The race it unlocks, as /who writes it: "Human" for both of Human's. */
  race: string
  /** The factions to max, by id and as the client names them ("Freeport Militia", the game's The Freeport Militia). */
  factions: { id: number; name: string }[]
  /** Done when any of these races is unlocked, rather than by factions (Half Elf's). */
  withRaces?: string[]
  /** Done some other way than factions ("Complete the 'Aid the Kerrans of Kerra Isle' Task"). */
  other?: string
}

/** The race unlocks in the client's AchievementsClient.txt and AchievementComponentsClient.txt; placeholders left out. */
export function parseRaceUnlocks(achievements: string, components: string): RaceUnlockDef[] {
  const defs = new Map<number, RaceUnlockDef>()
  for (const line of String(achievements).split(/\r?\n/)) {
    const [id, name] = line.split('^')
    const m = name ? RACE_UNLOCK.exec(name.trim()) : null
    const n = parseInt(id, 10)
    const race = m ? playableRace(m[1].replace(/\s*\(.*\)\s*$/, '')) : ''
    if (race && Number.isFinite(n)) defs.set(n, { id: n, achievement: name.trim(), race, factions: [] })
  }
  const placeholders = new Set<number>()
  for (const line of String(components).split(/\r?\n/)) {
    const [id, , type, ref, text = ''] = line.split('^')
    const def = defs.get(parseInt(id, 10))
    // 1 is a part it needs; 2 a way around it (created as that race, a token); 3 when it shows.
    if (!def || type?.trim() !== '1') continue
    const t = text.trim()
    const faction = MAX_FACTION.exec(t)
    const part = parseInt(ref, 10)
    const races = WITH_RACES.exec(t)
    if (faction && part > FACTION_PART_BASE && part < FACTION_PART_BASE + 10000) def.factions.push({ id: part - FACTION_PART_BASE, name: faction[1].trim() })
    else if (races)
      def.withRaces = races[1]
        .split(/\s*(?:,|\bor\b|\band\b)\s*/)
        .map(playableRace)
        .filter(Boolean)
    else if (/placeholder/i.test(t)) placeholders.add(def.id)
    else def.other = t.replace(/\.$/, '')
  }
  return [...defs.values()].filter((d) => !placeholders.has(d.id))
}

/** A race unlock for one character: done or not, and each of its factions. */
export interface RaceUnlock {
  achievement: string
  race: string
  /** Done; null when no achievements export says. */
  done: boolean | null
  /** Its factions by the game's names: each part done (the export says so, or the faction is at 2000 now), or null when nothing says. */
  factions: { faction: string; done: boolean | null }[]
  withRaces?: string[]
  other?: string
}

/**
 * The race unlocks for a character, from the client's definitions and the character's achievements
 * export (null without one). `nameOf` puts a faction the game's way by its id, and `standingOf` says
 * where one stands now (null when not known).
 */
export function raceUnlocks(
  defs: RaceUnlockDef[],
  sections: AchSection[] | null,
  nameOf: (id: number, name: string) => string,
  standingOf: (faction: string) => number | null
): RaceUnlock[] {
  const listed = new Map<string, Achievement>()
  for (const s of sections ?? []) for (const a of s.ach) if (RACE_UNLOCK.test(a.n)) listed.set(a.n.trim().toLowerCase(), a)
  return defs.map((d) => {
    const a = listed.get(d.achievement.toLowerCase())
    const part = (name: string) => a?.c.find((c) => MAX_FACTION.exec(c.t)?.[1].trim().toLowerCase() === name.toLowerCase())
    const factions = d.factions.map((f) => {
      const faction = nameOf(f.id, f.name)
      const standing = standingOf(faction)
      const said = part(f.name)
      const done = a?.d || said?.d || (standing !== null && standing >= 2000) ? true : said || standing !== null ? false : null
      return { faction, done }
    })
    return {
      achievement: d.achievement,
      race: d.race,
      done: a ? a.d === true : null,
      factions,
      ...(d.withRaces ? { withRaces: d.withRaces } : {}),
      ...(d.other ? { other: d.other } : {})
    }
  })
}

/** The races a character can pick in Loadouts, by its race unlocks; null when nothing says which are done. */
export function unlockedRaces(unlocks: RaceUnlock[]): string[] | null {
  if (!unlocks.some((u) => u.done !== null)) return null
  return [...new Set(unlocks.filter((u) => u.done === true).map((u) => u.race))]
}

/**
 * The race unlocks still to do, as the planner takes them: the factions each still wants maxed, or for
 * Half Elf's, the unlocks any one of which does it. One done some other way (Kerran's task) is not the
 * plan's to do.
 */
export function unlockGoals(unlocks: RaceUnlock[]): UnlockGoal[] {
  return unlocks.flatMap((u): UnlockGoal[] => {
    if (u.done === true || u.other) return []
    if (u.withRaces) {
      const anyOf = unlocks.filter((v) => v !== u && u.withRaces!.includes(v.race)).map((v) => v.achievement)
      return anyOf.length ? [{ achievement: u.achievement, race: u.race, factions: [], anyOf }] : []
    }
    return [{ achievement: u.achievement, race: u.race, factions: u.factions.filter((f) => f.done !== true).map((f) => f.faction) }]
  })
}
