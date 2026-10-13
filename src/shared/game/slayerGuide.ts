// eqlwiki's Slayer guides (Slayer: Skill, Slayer: Special and Slayer: Conquest, a player's "how I
// would do it" for the Classic era, read 2026-10-13, pages last edited 2026-10-12): where each Slayer
// achievement's kills are, in the guide's words (spelling tidied), and the zones they name as the
// game names them. The plan takes the zones as camps players name, paced by the zone's spawns; the
// words go beside them.

export interface SlayerGuideTip {
  achievement: string
  /** The guide's words. */
  tip: string
  /** The zones it names, as the game names them; none where it names no place (a lockout, "do the others"). */
  zones: string[]
}

export const SLAYER_GUIDE_SAID = 'eqlwiki’s Slayer guide, 2026-10-12'

const KARANA = { n: 'The Northern Plains of Karana', e: 'The Eastern Plains of Karana', w: 'The Western Plains of Karana', s: 'The Southern Plains of Karana' }
const SEB = 'New Sebilis Expedition'
const PAINEEL = 'Paineel'
const HOLE = 'The Ruins of Old Paineel'
const UGUK = 'The City of Guk'
const LGUK = 'The Ruins of Old Guk'
const STEAM = 'The Steamfont Mountains'
const RATHE = 'The Rathe Mountains'
const LFAY = 'The Lesser Faydark'
const SKY = 'The Plane of Sky'
const FEAR = 'The Plane of Fear'
const HATE = 'The Plane of Hate'

/** Names as the game writes them: straight apostrophes ("Here's Yer Grozmok", "Solusek's Eye"). */
const straight = (s: string) => s.replace(/’/g, "'")
const t = (achievement: string, tip: string, ...zones: string[]): SlayerGuideTip => ({ achievement: straight(achievement), tip, zones: zones.map(straight) })

export const SLAYER_GUIDE: SlayerGuideTip[] = [
  // Slayer: Skill
  t('Oh the Humanity!', 'Bandit camps: Oasis of Marr, North Karana, West Karana', 'The Oasis of Marr', KARANA.n, KARANA.w),
  t('Barbarous', 'Halas (faction hit); West Commonlands, the bandit camp at 1000, 1000', 'Halas', 'West Commonlands'),
  t('Hardly Erudite of You', 'Erudin, Erudin Palace (faction hit); the undead ghost Erudites in the Hole', 'Erudin', 'Erudin Palace', HOLE),
  t('Wood You Could You?', 'Greater Faydark, the bandit camp', 'The Greater Faydark'),
  t('Highly Uncivilized', 'Felwithe (faction hit)', 'Northern Felwithe', 'Southern Felwithe'),
  t('Love Will Teir Them Apart', 'Castle Mistmoore', 'The Castle of Mistmoore'),
  t('Now .49999%', 'The bandit camp in West Karana, Lesser Faydark (faction hit), the bandit camp in Greater Faydark', KARANA.w, LFAY, 'The Greater Faydark'),
  t('Axe Me No Questions', 'Kaladim (faction hit), the bandit camps in Butcherblock', 'North Kaladim', 'South Kaladim', 'Butcherblock Mountains'),
  t('Fuzzyfeet', 'Rivervale, -400, 40 is a good spot; Nektulos Forest Leatherfoots (faction hits)', 'Rivervale', 'Nektulos Forest'),
  t('A Clockwork Gnome', 'Solusek’s Eye, Befallen', 'Solusek’s Eye', 'Befallen'),
  t('Here’s Yer Grozmok', 'West Commonlands, Rathe Mountains (the Soldier’s Brooch mobs)', 'West Commonlands', RATHE),
  t('Get Stupid', 'West Commonlands, Najena', 'West Commonlands', 'Najena'),
  t('Icky!', 'New Sebilis Expedition, the skeletons and ghosts', SEB),
  t('It’s a Frog Eat Frog World', 'Upper and Lower Guk', UGUK, LGUK),
  t('Not a Kerran the World!', 'Kerra Isle (faction hit), Stonebrunt Mountains, the cat camp up north', 'Kerra Isle', 'The Stonebrunt Mountains'),
  t('Bat Country!', 'Greater Faydark, Najena', 'The Greater Faydark', 'Najena'),
  t('Rat Killer', 'Plane of Hate, Warrens', HATE, 'The Warrens'),
  t('Armadilloed and Dangerous', 'North Ro', 'The Northern Desert of Ro'),
  t('It Stinks!', 'Toxxulia Forest', 'Toxxulia Forest'),
  t('You Dirty Ratman!', 'The Hole, camp Slizik the Mighty', HOLE),
  t('Beetlemania', 'North and South Karana, Misty Thicket, the Paineel newbie area', KARANA.n, KARANA.s, 'Misty Thicket', PAINEEL),
  t('Leechy Keen', 'Rathe Mountains near the froglok city (very small leeches)', RATHE),
  t('Shoo fly!', 'Rathe Mountains, the froglok newbie area', RATHE),
  t('Get the Broom!', 'Misty Thicket, Kithicor Forest, Steamfont Mountains NE corner', 'Misty Thicket', 'Kithicor Forest', STEAM),
  t('Snake in the Grass', 'Misty Thicket, Kithicor Forest, the Paineel newbie area', 'Misty Thicket', 'Kithicor Forest', PAINEEL),
  t('A Bone to Pick With You', 'The Paineel newbie area, New Sebilis Expedition', PAINEEL, SEB),
  t('Stake Dinner', 'Castle Mistmoore', 'The Castle of Mistmoore'),
  t('Hide Your Brains!', 'Estate of Unrest', 'The Estate of Unrest'),
  t('Mummy Dearest', 'South Desert of Ro, Oasis of Marr, Unrest', 'The Southern Desert of Ro', 'The Oasis of Marr', 'The Estate of Unrest'),
  t('Ghoul On the Hill', 'Estate of Unrest', 'The Estate of Unrest'),
  t('Round of Applause', 'Najena or Befallen', 'Najena', 'Befallen'),
  t('Ghosts of Frostfell Past', 'Estate of Unrest, New Sebilis Expedition', 'The Estate of Unrest', SEB),
  t(
    'New Tricks',
    'Everfrost Peaks, Nektulos Forest, Misty Thicket, Kithicor Forest, East Karana',
    'Everfrost Peaks',
    'Nektulos Forest',
    'Misty Thicket',
    'Kithicor Forest',
    KARANA.e
  ),
  t('Got Your Tongue?', 'North, East and West Karana', KARANA.n, KARANA.e, KARANA.w),
  t('Featherbrained Plan', 'South Karana, Plane of Sky island 5, Steamfont Mountains NE corner', KARANA.s, SKY, STEAM),
  t(
    'Better Get a Barrel',
    'Feerrott (2 at the way into Cazic-Thule, 2 more inside at the throne room), Plane of Fear, Stonebrunt',
    'The Feerrott',
    'Temple of Cazic-Thule',
    FEAR,
    'The Stonebrunt Mountains'
  ),
  t('Bear With Me', 'North, East and West Karana; West Commonlands toward the Kithicor zone line', KARANA.n, KARANA.e, KARANA.w, 'West Commonlands'),
  t('The Elephant in the Room', 'South Karana, all over the zone; Everfrost Peaks', KARANA.s, 'Everfrost Peaks'),
  t(
    'These Boots Were Made For...',
    'Rathe Mountains, Cazic-Thule’s underwater gator area (best), Upper Guk, Oasis of Marr',
    'Temple of Cazic-Thule',
    RATHE,
    UGUK,
    'The Oasis of Marr'
  ),
  t('Plenty of Fish In the Sea', 'Kedge Keep (the crossroads), the Rivervale pond', 'Kedge Keep', 'Rivervale'),
  t('Orc Weapons, Your Blood Will Spill!', 'Crushbone or West Commonlands', 'Clan Crushbone', 'West Commonlands'),
  t('New Frontiers', 'Clan Runnyeye, Permafrost', 'The Liberated Citadel of Runnyeye', 'Permafrost Keep'),
  t('The More You Gnoll!', 'Blackburrow', 'Blackburrow'),
  t('World Warrens Three', 'The Warrens', 'The Warrens'),
  t('Alliz Tae Ew', 'Temple of Cazic-Thule, Innothule Swamp', 'Temple of Cazic-Thule', 'Innothule Swamp'),
  t('Re-Extinction', 'Only Phinigel Autropos counts: five kills a day'),
  t('Aquatic Allure', 'Kedge Keep', 'Kedge Keep'),
  t('I Said Argyle!', 'Plane of Hate, Lower Guk', HATE, LGUK),
  t('You’re Not Scaring Anyone', 'West and East Karana, Plane of Fear', KARANA.w, KARANA.e, FEAR),
  t('Lumberer', 'South Karana, two treants in the northeast corner', KARANA.s),
  t('Mushroom Hunting', 'Runnyeye, Rathe Mountains froglok newbie area', 'The Liberated Citadel of Runnyeye', RATHE),
  t('Stop Dragon This Out', 'Plane of Fear (1), Plane of Hate (5 to 8)', HATE, FEAR),
  t('You Keep Dragon Me Into This', 'Lesser Faydark, all to the west of the map; Steamfont Mountains NE corner', LFAY, STEAM),
  t('A Small Giant Problem', 'With the Nagafen and Vox runs, Rathe Mountains NE area, the Ocean of Tears cyclops', RATHE, 'The Ocean of Tears'),
  t('Fairicide', 'Lesser Faydark, all to the west of the map', LFAY),
  t('For the Hive!', 'Lesser Faydark, all to the west of the map; Plane of Sky island 6 boss; Misty Thicket', LFAY, 'Misty Thicket', SKY),
  t('Jumjummery', 'Lesser Faydark, all to the west of the map; Steamfont NE area (best)', STEAM, LFAY),
  t('Self Centaured', 'South Karana, the camp in the northeast', KARANA.s),
  t('Amazing!', 'Steamfont, the minotaur cave in the northeast', STEAM),
  t('No Vacancy', 'Plane of Sky, North and East Karana', SKY, KARANA.n, KARANA.e),
  t('Puzzling', 'Plane of Sky', SKY),
  t('My Golden Boots', 'Plane of Sky, Nagafen’s Lair', SKY, 'Nagafen’s Lair'),
  t('Imp-atient', 'Plane of Sky, Nagafen’s Lair', SKY, 'Nagafen’s Lair'),
  t('Elementary', 'Plane of Sky, Plane of Fear, Najena, the Hole, Steamfont NE corner', SKY, FEAR, 'Najena', HOLE, STEAM),
  t('Spin Me Right Round', 'Lavastorm, Plane of Sky', 'The Lavastorm Mountains', SKY),
  t('Terrorible Tentacles', 'Estate of Unrest, Plane of Fear, Permafrost (the Vox area)', 'The Estate of Unrest', FEAR, 'Permafrost Keep'),
  t('Denizens of Fear', 'Plane of Fear', FEAR),
  t(
    'Eye See What You Did There!',
    'Lower and Upper Guk, Clan Runnyeye, Gorge of King Xorbb, Plane of Fear',
    LGUK,
    UGUK,
    'The Liberated Citadel of Runnyeye',
    'The Gorge of King Xorbb',
    FEAR
  ),
  t('Cubic', 'Plane of Fear, Runnyeye (only one)', FEAR, 'The Liberated Citadel of Runnyeye'),
  t('Gnome Tested, Steamwork Approved!', 'Steamfont, near the minotaur cave in the northeast', STEAM),
  // Slayer: Special
  t('I’m a People Person!', 'Done with the other achievements'),
  t('What Keeps Mankind Alive?', 'West Karana, the bandit camps', KARANA.w),
  t('Three Letter Word for Dead...', 'Castle Mistmoore, Plane of Hate', 'The Castle of Mistmoore', HATE),
  t('Short People', 'Rivervale, -400, 40 is a nice spot; Butcherblock for bandits', 'Rivervale', 'Butcherblock Mountains'),
  t('Simple Folk of the Ykesha', 'West Commonlands, the dervish camp', 'West Commonlands'),
  t('Bounced!', 'West Commonlands', 'West Commonlands'),
  t('Mostly Kunzar', 'New Sebilis Expedition, the undead in the zone', SEB),
  t('Catnipped In the Bud', 'Stonebrunt Mountains, the cat camp up north; Kerra Isle, with the Amulet quest at the same time', 'The Stonebrunt Mountains', 'Kerra Isle'),
  t('Amphibicide', 'Upper and Lower Guk', UGUK, LGUK),
  t('Rats!', 'The Warrens (a spot with many rats on top of each other), Plane of Hate, Steamfont NE corner', 'The Warrens', HATE, STEAM),
  t('Eight Legs Are Better Than One!', 'Najena (the spider room), Steamfont NE corner (best)', STEAM, 'Najena'),
  t('The Hounds', 'Permafrost, Kithicor Forest, Everfrost Peaks, East Karana (the Gorge hounds)', 'Permafrost Keep', 'Kithicor Forest', 'Everfrost Peaks', KARANA.e),
  t('The Cat’s Pajamas', 'Stonebrunt Mountains, Oasis of Marr, North and West Karana', 'The Stonebrunt Mountains', 'The Oasis of Marr', KARANA.n, KARANA.w),
  t('Bird Flew', 'South Karana, Plane of Sky, Steamfont NE corner', KARANA.s, SKY, STEAM),
  t('Monkey Business', 'Plane of Fear, Temple of Cazic-Thule, Stonebrunt', FEAR, 'Temple of Cazic-Thule', 'The Stonebrunt Mountains'),
  t('Orc Kill!', 'Clan Crushbone', 'Clan Crushbone'),
  t('Me Thinks That You’ll Be Good to Eat!', 'Permafrost, Runnyeye', 'Permafrost Keep', 'The Liberated Citadel of Runnyeye'),
  t('Gnolling is Half the Battle', 'Blackburrow, Splitpaw Lair, Runnyeye', 'Blackburrow', 'The Lair of the Splitpaw', 'The Liberated Citadel of Runnyeye'),
  t('Kobolded Killer', 'The Warrens', 'The Warrens'),
  t('Gooooooooooooooolem!', 'The Hole, Plane of Fear, Gorge of King Xorbb, the New Sebilis Expedition golems (5 spawn)', HOLE, FEAR, 'The Gorge of King Xorbb', SEB),
  t('Dragonbane', 'Lady Vox and Lord Nagafen (ten kills a day at most)'),
  t('You Call That a Dragon?', 'Rathe Mountains, Lavastorm Mountains, Steamfont NE corner', RATHE, 'The Lavastorm Mountains', STEAM),
  t('A Giant Problem', 'Rathe Mountains, the Ocean of Tears, or with the Vox and Nagafen kills', RATHE, 'The Ocean of Tears'),
  t('Shorter People', 'Lesser Faydark, Steamfont NE corner', LFAY, STEAM),
  t('Slayer of Mystical Horses', 'Plane of Fear and Plane of Sky', FEAR, SKY),
  t('Breakdown Dead Ahead', 'Steamfont Mountains NE corner outside the minotaur caves, Solusek’s Eye, Ak’Anon’s zoo and mines', STEAM, 'Solusek’s Eye', 'Ak’Anon'),
  // Slayer: Conquest
  t('Doesn’t Play Well With Others', 'Done for the most part with Slayer: Special; Befallen for the rest', 'Befallen'),
  t('Don’t Bug Me', 'Najena, Solusek’s Eye, the Paineel newbie area, Steamfont NE corner', 'Najena', 'Solusek’s Eye', PAINEEL, STEAM),
  t('I Hate Snakes!', 'Cazic-Thule, the Paineel newbie area, the Rathe Mountains basilisk area', 'Temple of Cazic-Thule', PAINEEL, RATHE),
  t('Pesticide', 'The Warrens, Najena, the Paineel newbie area, Steamfont NE', 'The Warrens', 'Najena', PAINEEL, STEAM),
  t('We Are the Dead!', 'Estate of Unrest, Lower Guk, Befallen, the Paineel newbie area', 'The Estate of Unrest', LGUK, 'Befallen', PAINEEL),
  t('Strange Weather', 'North and West Karana, Kithicor Forest', KARANA.n, KARANA.w, 'Kithicor Forest'),
  t('The Zookeeper', 'West Commonlands, Permafrost (the bear pit), Kithicor Forest', 'West Commonlands', 'Permafrost Keep', 'Kithicor Forest'),
  t('Swordfishmermaid', 'The Rivervale pond: fish respawn faster than they can be killed', 'Rivervale'),
  t('Orc Stomp!', 'Clan Crushbone', 'Clan Crushbone'),
  t('Ugly Creature Near My Feet...', 'Permafrost, Solusek’s Eye, Clan Runnyeye', 'Permafrost Keep', 'Solusek’s Eye', 'The Liberated Citadel of Runnyeye'),
  t('BBBBBAAAARRRKKKK!!!!!', 'Blackburrow', 'Blackburrow'),
  t('Puttin’ On The Dog', 'Rathe Mountains, the Warrens', RATHE, 'The Warrens'),
  t(
    'It’s Alive!',
    'The Hole, Lower Guk, Solusek’s Eye, Castle Mistmoore, the New Sebilis Expedition golem area (5 spawn)',
    HOLE,
    LGUK,
    'Solusek’s Eye',
    'The Castle of Mistmoore',
    SEB
  ),
  t(
    'Plants Concrete and Stone',
    'Runnyeye, the Temple of Solusek Ro, Solusek’s Eye, the Rathe Mountains froglok newbie area',
    RATHE,
    'The Liberated Citadel of Runnyeye',
    'The Temple of Solusek Ro',
    'Solusek’s Eye'
  ),
  t('Here Be Dragons!', 'Lavastorm, Plane of Sky, Rathe Mountains, Steamfont NE area', 'The Lavastorm Mountains', SKY, RATHE, STEAM),
  t('Might They Be Giants?', 'Rathe Mountains', RATHE),
  t('Legendary Creatures', 'Lesser Faydark, Steamfont NE area', LFAY, STEAM),
  t('Planes, Trains and Element-iles', 'Lavastorm, Plane of Sky, Steamfont NE area', 'The Lavastorm Mountains', SKY, STEAM),
  t('A Sight for Sore Eyes', 'Plane of Fear, the Gorge of King Xorbb, Steamfont NE area', FEAR, 'The Gorge of King Xorbb', STEAM),
  t('Domo Arigato', 'Steamfont Mountains NE area, Solusek’s Eye, Ak’Anon', STEAM, 'Solusek’s Eye', 'Ak’Anon'),
  t('Your God Has Found You Lacking', 'Cazic-Thule, Innoruuk'),
  t('Table Flipper', 'The Hole, Plane of Hate, the Runnyeye bank (one mimic, on a 60 second respawn)', HOLE, HATE, 'The Liberated Citadel of Runnyeye')
]

/**
 * The guide's spots where one stop does many: "8 achievements in the Steamfont Mountains NE", "the
 * Rathe Mountains by the froglok city: I Hate Snakes!, Puttin' On The Dog, Plants Concrete and Stone,
 * We Are the Dead!", and so on. Shown with a step there.
 */
export const SLAYER_GUIDE_SPOTS: { zone: string; tip: string }[] = [
  { zone: STEAM, tip: 'The NE corner: near-instant respawns, and many Slayer achievements at once (the guide’s best place to start)' },
  { zone: PAINEEL, tip: 'The newbie area: near-instant respawns' },
  {
    zone: RATHE,
    tip: 'By the froglok city: I Hate Snakes!, Puttin’ On The Dog, Plants Concrete and Stone, We Are the Dead!; at the giants: Might They Be Giants?, Orc Stomp!, I Hate Snakes!'
  }
]
