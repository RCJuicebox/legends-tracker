// Where Slayer kills come from, as play has shown it: for the Slayer plan, beside what the player's
// own logs measured (which win where they have the camp) and eqlwiki's count of a race's NPCs in a
// zone (hunt.ts). Races are the keys raceNames.ts gives (the client's race names, lower-cased); a
// camp feeds every open achievement that lists one of them. Each says who said so and when: the EQL
// Discord's Slayer talk read 2026-10-11, or the player.

export interface SlayerCamp {
  zone: string
  /** The mobs to kill, as the log names them. */
  mobs: string[]
  /** Their races, as raceNames.ts keys them. */
  races: string[]
  /** Kills a day at most: one raid lockout per difficulty. */
  perDay?: number
  /** Kills an hour while at it, where play has put a number on it. */
  perHour?: number
  /** One spawn's respawn, in minutes, and how many spawns: an hour's kills at most. */
  respawnMin?: number
  spawns?: number
  /** What to know, in a sentence. */
  note: string
  /** Who said so, and when. */
  said: string
}

export const SLAYER_CAMPS: SlayerCamp[] = [
  {
    zone: 'Kedge Keep',
    mobs: ['Phinigel Autropos'],
    races: ['kedge'],
    perDay: 5,
    note: 'The only kedge in the game, and a raid boss: one kill a difficulty (0 to 4) a day. Start on day one.',
    said: 'EQL Discord, 2026-09 to 10'
  },
  {
    zone: 'Permafrost Caverns',
    mobs: ['Lady Vox'],
    races: ['dragon', 'true dragon'],
    perDay: 5,
    note: 'A true dragon on a raid lockout: one kill a difficulty (0 to 4) a day, beside Lord Nagafen.',
    said: 'EQL Discord, 2026-09 to 10'
  },
  {
    zone: "Nagafen's Lair",
    mobs: ['Lord Nagafen'],
    races: ['dragon', 'true dragon'],
    perDay: 5,
    note: 'A true dragon on a raid lockout: one kill a difficulty (0 to 4) a day, beside Lady Vox.',
    said: 'EQL Discord, 2026-09 to 10'
  },
  {
    zone: 'The Liberated Citadel of Runnyeye',
    mobs: ['a mimic'],
    races: ['mimic'],
    perHour: 60,
    note: 'Where mimics come quickest: some 600 in a day of play. The Plane of Hate has a handful on an hour’s respawn.',
    said: 'EQL Discord, 2026-09-24 and 10-01'
  },
  {
    zone: 'The Estate of Unrest',
    mobs: ['a lesser blade fiend'],
    races: ['dervish'],
    respawnMin: 7.5,
    spawns: 1,
    note: 'Lesser blade fiends are Dervishes, on a seven and a half minute respawn.',
    said: 'the player, 2026-10-11'
  },
  {
    zone: 'The Plane of Sky',
    mobs: ['a blade storm'],
    races: ['dervish'],
    note: 'Blade storms on the island past the first, levels 59 to 61. The Dervish Cutthroats of Ro and the Commonlands are not Dervishes.',
    said: 'the player, 2026-09-28'
  },
  {
    zone: 'The Eastern Plains of Karana',
    mobs: ['a wolf'],
    races: ['wolf'],
    note: 'Outside the tunnel to the Gorge: several wolves that are back almost at once.',
    said: 'EQL Discord, 2026-09-18'
  },
  {
    zone: 'The Southern Plains of Karana',
    mobs: ['a treant'],
    races: ['treant', 'aviak', 'centaur', 'lion'],
    note: 'Treants at a double spawn, with a roaming one to the southwest; aviaks, centaurs and cats in the same zone.',
    said: 'EQL Discord, 2026-09-15 to 10-08'
  },
  {
    zone: 'The Rathe Mountains',
    mobs: ['a hill giant'],
    races: ['giant'],
    note: 'Said to be the one place giants come back at a fair rate.',
    said: 'EQL Discord, 2026-10-03'
  },
  {
    zone: 'Steamfont Mountains',
    mobs: ['a clockwork'],
    races: ['clockwork'],
    note: 'The northern valleys, for most kinds of clockwork. The clockwork gnomes of Solusek A do not count.',
    said: 'EQL Discord, 2026-07-29 and 10-07'
  },
  {
    zone: 'The Lesser Faydark',
    mobs: ['a brownie'],
    races: ['brownie', 'fairy', 'pixie', 'bixie'],
    note: 'A fixed brownie camp keeps a steadier pace than the scouts that wander the zone.',
    said: 'EQL Discord, 2026-10-01'
  },
  {
    zone: 'The Plane of Fear',
    mobs: ['a nightmare'],
    races: ['nightmare'],
    note: 'The ponies at the top right.',
    said: 'EQL Discord, 2026-09-20'
  }
]
