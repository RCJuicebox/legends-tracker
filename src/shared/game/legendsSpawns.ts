// Spawns Legends has that TAKP's classic tables lack (spawns.ts): its own named, on spots the player
// has found. Each spot as the game's /waypoint takes it (the /loc order: y, x, then z), so it is
// typed in as found. Each says who said so and when.

export interface LegendsSpawn {
  /** As the game's ZoneNames.txt names it. */
  zone: string
  /** As the log names it. */
  name: string
  /** The mobs it pops in place of, where known. */
  ph?: string[]
  /** Its spots: /waypoint y, x[, z], and what is there. */
  spots: { at: [number, number, number?]; where?: string }[]
  said: string
}

/** A spot the player found a named at in play (hunter-spots.json, FEAT-020): /loc order, and when it was said. */
export interface FoundSpot {
  zone: string
  name: string
  at: [number, number, number?]
  where?: string
  on: number
}

export const LEGENDS_SPAWNS: LegendsSpawn[] = [
  {
    zone: 'The Western Plains of Karana',
    name: 'a werewolf bandit',
    ph: ['a bandit'],
    spots: [
      { at: [-649, -13825] },
      { at: [-3969, -10966], where: 'the southern border of the zone' },
      { at: [882, -6985], where: 'in a group of bandits' },
      { at: [-2783, -10736, 28] }
    ],
    said: 'the player, 2026-10-13'
  }
]
