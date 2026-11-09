// Where Slayer kills come from, as play has shown it: for the Slayer plan, beside what the player's
// own logs measured (which win where they have the camp) and eqlwiki's count of a race's NPCs in a
// zone (hunt.ts). Races are the keys raceNames.ts gives (the client's race names, lower-cased); a
// camp feeds every open achievement that lists one of them. Each says who said so and when: the EQL
// Discord's Slayer talk read 2026-10-11, or the player.

import { SLAYER_GUIDE_SAID } from './slayerGuide'

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
  /** Achievements its races list that its mobs do not count toward, as play settled. */
  not?: string[]
  /** Mobs a pet cannot take: no camp when the plan is of pet kills alone. */
  noPet?: boolean
  /** One spawn's respawn, in minutes, and how many spawns: an hour's kills at most. */
  respawnMin?: number
  spawns?: number
  /** What to know, in a sentence. */
  note: string
  /** Who said so, and when. */
  said: string
}

/** The game's daily reset, when raid lockouts open again: noon US Eastern (the player, 2026-10-20; the replay timer ends then). */
const RESET_ZONE = 'America/New_York'
const RESET_HOUR = 12

/** When the lockout day a time falls in began: the last daily reset at or before it. */
export function lockoutDayStart(now: number = Date.now()): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: RESET_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  })
  const wall = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, Number(x.value)]))
    return { y: p.year, m: p.month - 1, d: p.day, ms: Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) }
  }
  // The zone's offset at a time, asked again at the answer so a clock change that day lands right.
  const offset = (t: number) => wall(t).ms - Math.floor(t / 1000) * 1000
  const reset = (y: number, m: number, d: number) => {
    const w = Date.UTC(y, m, d, RESET_HOUR)
    return w - offset(w - offset(w))
  }
  const { y, m, d } = wall(now)
  const today = reset(y, m, d)
  return today <= now ? today : reset(y, m, d - 1)
}

/**
 * Where in a zone, as players say, for the achievements named: shown with a step there for one of
 * them, whatever paces it; `at`, where to stand, as /waypoint takes it (y, x), marked on its map.
 */
export const SLAYER_SPOTS: { zone: string; for: string[]; tip: string; said: string; at?: [number, number] }[] = [
  {
    zone: 'The Stonebrunt Mountains',
    for: ['Monkey Business'],
    tip: 'Stand at /waypoint 3370, -70: three graniteback spots within 50 of it, three more a short pull; about 34 gorillas an hour, with tigers, pandas and kejekan between',
    said: 'the player, 2026-10-18',
    at: [3370, -70]
  },
  {
    zone: 'The Lesser Faydark',
    for: ['Shorter People', 'Legendary Creatures'],
    tip: 'The faeries, all to the west of the map: the best camp for Shorter People (about 460 an hour), and Legendary Creatures too',
    said: 'the player, 2026-10-15'
  },
  {
    zone: 'The Eastern Plains of Karana',
    for: ['Strange Weather'],
    tip: 'Stand at /waypoint 515, -797 and let the pet pull: gorge hounds, lion patriarchs, lioness matriarchs and lionesses, about 51 an hour over 7 h',
    said: 'the player, 2026-10-30',
    at: [515, -797]
  },
  {
    zone: 'New Sebilis Expedition',
    for: ['Mostly Kunzar'],
    tip: 'Stand at /waypoint -697, -195 and let the pet pull the undead: about 244 an hour over 3 h',
    said: 'the player, 2026-11-09',
    at: [-697, -195]
  },
  {
    zone: 'The Rathe Mountains',
    for: ['Leechy Keen'],
    tip: 'Stand at /waypoint -1272, 1472 for the larval bleeders: about 68 an hour with a pet',
    said: 'the player, 2026-11-09',
    at: [-1272, 1472]
  }
]

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
    zone: 'The Plane of Hate',
    mobs: ['Innoruuk, the Prince of Hate'],
    races: ['innoruuk'],
    perDay: 5,
    note: 'One of the two avatars of a deity, with Cazic-Thule: a raid lockout, one kill a difficulty (0 to 4) a day.',
    said: 'the player, 2026-10-12; EQL Discord, 2026-09-21'
  },
  {
    zone: 'The Plane of Fear',
    mobs: ['Cazic-Thule'],
    races: ['cazic thule'],
    perDay: 5,
    note: 'One of the two avatars of a deity, with Innoruuk: taken for a raid lockout like the others, one kill a difficulty a day.',
    said: 'the player, 2026-10-12'
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
    note: 'The northern valleys, for most kinds of clockwork.',
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
  },
  {
    // The zone has no spawn table: without this, Mostly Kunzar and I'm a People Person! had no camp for
    // a player whose log has not been there. A pet run 2026-10-14: 722 undead in 2.96 h.
    zone: 'New Sebilis Expedition',
    mobs: ['a decaying skeleton', 'a skeleton', 'a withering skeleton', 'an iksar ghost', 'a sarnak ghost'],
    races: ['iksar'],
    // Kylong Iksars, not the true Iksars I'm a People Person! wants (ZONE_MOB_NOT_FOR).
    not: ["I'm a People Person!"],
    perHour: 244,
    note: 'The undead, Kylong Iksars that count as Iksars for Mostly Kunzar; spiderlings and golems among them.',
    said: 'the player, 2026-11-09'
  },
  {
    // The troopers, here and in North Ro by the zone line: the only true Iksars for I'm a People Person!'s ten.
    zone: 'New Sebilis Expedition',
    mobs: ['Trooper Loxra', 'Trooper Axyl', 'Crusader Graez'],
    races: ['iksar'],
    noPet: true,
    // Not timed here: taken as North Ro's troopers', not the usual pace three named mobs cannot keep.
    respawnMin: 8,
    spawns: 3,
    note: 'The troopers, the only true Iksars there: a pet cannot take them.',
    said: 'the player, 2026-11-09'
  },
  {
    zone: 'The Northern Desert of Ro',
    mobs: ['Trooper Tygin', 'Trooper Axlia', 'Crusader Iktra'],
    races: ['iksar'],
    noPet: true,
    // Two came back 8 and 9 minutes after they died (the log, 2026-10-13).
    respawnMin: 8,
    spawns: 3,
    note: 'The troopers by the New Sebilis zone line: a pet cannot take them.',
    said: 'the player, 2026-11-09'
  },
  {
    zone: 'The Rathe Mountains',
    mobs: ['a larval bleeder'],
    races: ['leech'],
    // Measured beside the plant camp at -1273, 1586, a pet's 15.8 h on 2026-11-02 and 03.
    perHour: 68,
    note: 'The larval bleeders, the very small leeches by the froglok city.',
    said: 'the player, 2026-11-09'
  },
  {
    // The tables' ratmen (45 to 55) are over the plan's level ceiling, and eqlwiki's count leaves a zone
    // the tables have to them: nothing else feeds You Dirty Ratman!.
    zone: 'The Ruins of Old Paineel',
    mobs: ['a ratman warrior', 'a ratman guard'],
    races: ['ratman'],
    note: 'Camp Slizik the Mighty: ratmen of 45 to 55, a group’s camp more than a pet’s.',
    said: SLAYER_GUIDE_SAID
  }
]
