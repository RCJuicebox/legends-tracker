import type { EpicStep } from './core'

// Goals › Epics' spell quests: the five class spells a quest gives (Tashania, Ice Comet, Divine Might,
// Life Leech, Call of Flame), each as the same kind of tree as an epic's list (core.ts): a reward with
// the pieces that make it under it. Hand-kept from each quest's eqlwiki page (item names, zones and
// /locs as the wiki gives them, read 2026-10-19 at the revisions below); SEQO
// (https://github.com/RealMaeel/seqo, from the EQ Legends Tools quest guides) gave which five and the
// warnings in the notes. The ten Old Silver Coins are all called that, and the ten Rods too, so each
// is a step of its own by its spot (its `label`) and the log counts them together.

/** A spell quest, as Goals › Epics keeps it. */
export interface SpellQuestData {
  /** The class that casts the spell. */
  cls: string
  /** The spell, as its scroll is named less "Spell: ". */
  spell: string
  /** The level the spell is cast at. */
  level: number
  /** The quest's eqlwiki page. */
  page: string
  /** The page's revision the steps were read at. */
  revision: number
  steps: EpicStep[]
}

type More = Partial<Pick<EpicStep, 'qty' | 'zone' | 'note' | 'label' | 'unverified'>>

/** A piece to hold, or the reward its parts make. */
const piece = (item: string, how: string, more: More = {}, parts: EpicStep[] = []): EpicStep => ({ item, qty: 1, how, ...more, parts })

/** A quest step that gives no item of its own: done when ticked off, or covered by the reward above. */
const quest = (name: string, how: string, parts: EpicStep[]): EpicStep => ({ quest: name, qty: 1, how, parts })

/** One of the ten same-named ground spawns, by its name on the wiki and its spot. */
const spot = (item: string, label: string, zone: string, note: string): EpicStep => piece(item, 'Ground spawn', { label, zone, note })

const GEMS = ['Star Ruby', 'Pearl', 'Fire Emerald', 'Sapphire'].map((g) => piece(g, 'Buy from a jewelcrafting vendor, or loot'))

export const SPELL_QUEST_DATA: readonly SpellQuestData[] = [
  {
    cls: 'Enchanter',
    spell: 'Tashania',
    level: 41,
    page: 'Coin of Tash (Tashania)',
    revision: 177188,
    steps: [
      piece('Spell: Tashania', 'Hand the Radiant Coin of Tash to Romar Sunto', { zone: 'Temple of Solusek Ro', note: '(393, 90); never hand in while invisible (Sneak is fine)' }, [
        piece('Radiant Coin of Tash', 'Hand the Gleaming Coin of Tash to Raine Beteria', { zone: 'Erudin', note: 'library (-1050, -212)' }, [
          piece('Gleaming Coin of Tash', 'Hand the Glowing Coin of Tash to Mizr N`Mar', { zone: 'Neriak Third Gate', note: 'library (913, -1314)' }, [
            piece('Glowing Coin of Tash', 'Hand the Coin of Tash to Tarn Visilin', { zone: 'High Keep', note: 'library (75, -220)' }, [
              piece('Coin of Tash', 'Combine the ten Old Silver Coins in the Coin Pouch', {}, [
                piece('Coin Pouch', 'Ask Romar Sunto about the coin pouch', { zone: 'Temple of Solusek Ro', note: '(395, 95)' }),
                spot('Old Silver Coin', 'Azia', "Ak'Anon", 'by the great wheel, not in the water (1990, -260)'),
                spot('Old Silver Coin', 'Beza', 'Erudin Palace', 'on the rocks in the fountain, a level up from the zone-in teleporter (703, 740)'),
                spot('Old Silver Coin', 'Caza', 'North Felwithe', 'in the fishing pond (-110, -790)'),
                spot('Old Silver Coin', 'Dena', 'West Freeport', 'in the pool under the Academy of Arcane Science (129, -750)'),
                spot('Old Silver Coin', 'Ena', 'Grobb', 'in the pool past the first bridge, on the right (197, -261)'),
                spot('Old Silver Coin', 'Fana', 'Halas', 'underwater on a ledge in the lake, by the far dock (-138, 179)'),
                spot('Old Silver Coin', 'Geza', 'South Kaladim', 'in the pool by the warriors’ guild (75, 360)'),
                spot('Old Silver Coin', 'Heda', 'Neriak Commons', 'in the water by the glass windows, off the big bridge (0, -795)'),
                spot('Old Silver Coin', 'Izah', 'Oggok', 'in the lake by the warriors’ guild, north end (109, 101)'),
                spot('Old Silver Coin', 'Jaka', 'North Qeynos', 'in the Koalindl Fish Pool under the Temple of Life (-90, -445)')
              ])
            ])
          ])
        ])
      ])
    ]
  },
  {
    cls: 'Wizard',
    spell: 'Ice Comet',
    level: 49,
    page: "Tarton's Wheel",
    revision: 179948,
    steps: [
      piece(
        'Spell: Ice Comet',
        'Hand the Staff of the Wheel and the Star of Eyes to Sulgar',
        { zone: 'Everfrost Peaks', note: 'on the north wall, west of the frozen river’s western fork' },
        [
          piece('Staff of the Wheel', 'Combine the ten Rods in the Glowing Chest', { note: 'the same combine makes the Star of Eyes' }, [
            piece('Glowing Chest', 'Ask Sulgar for the wheel case', {
              zone: 'Everfrost Peaks',
              note: 'temporary: what is in it is lost when you camp, so keep the Rods in your bags until the combine'
            }),
            spot('Rod', 'Azia', "Erud's Crossing", 'underwater past the shipwreck, after the ledge; level 40 sharks (-1159, 2329)'),
            spot('Rod', 'Beza', 'Everfrost Peaks', 'in the house at the back of the cave under the frozen river; the Lich of Miragul sees invisible (5000, -5100)'),
            spot('Rod', 'Caza', 'Lake Rathetear', 'underwater, top floor of the tower in the cave under the first island (2782, 142)'),
            spot('Rod', 'Dena', "Dagnor's Cauldron", 'underwater in a gully on the lake floor, left of Kedge Keep (-890, -740)'),
            spot('Rod', 'Ena', 'Lower Guk', 'on the floor of the reanimated hand’s room: bring a group (1145, -690)'),
            spot('Rod', 'Fana', 'Oasis of Marr', 'underwater, top floor of the tower in the lake (-790, -60)'),
            spot('Rod', 'Geza', 'Highpass Hold', 'under the waterfall by The Tiger’s Roar patio (-180, 445)'),
            spot('Rod', 'Heda', 'Qeynos Aqueducts', 'underwater on the tile floor of the shark pit (670, 60)'),
            spot('Rod', 'Izah', 'Neriak Commons', 'outside The Blind Fish'),
            spot('Rod', 'Jaka', 'Estate of Unrest', 'underwater on the hidden cavern floor right of the manor (520, -285)')
          ])
        ]
      )
    ]
  },
  {
    cls: 'Paladin',
    spell: 'Divine Might',
    level: 45,
    page: 'The Bones of Darak Lightforge',
    revision: 172079,
    steps: [
      piece('Spell: Divine Might', 'Hand the Revenant Ash to Simon Aldicott', { zone: 'West Commonlands' }, [
        piece('Revenant Ash', 'Kill a Tortured Revenant', { zone: 'West Commonlands', note: 'Simon Aldicott spawns it when you hand him the sealed casket: be ready to fight' }, [
          quest('The sealed casket', 'Combine the six bones, the sword and the shield in the Gem Encrusted Casket', [
            piece('Gem Encrusted Casket', 'Hand the Full Gem Bag to Ping Fuzzlecutter', { zone: 'West Freeport' }, [
              piece('Full Gem Bag', 'Combine the six gems and the two bars in the Empty Gem Bag', {}, [
                piece('Empty Gem Bag', 'Ask Ping Fuzzlecutter “What components?”', { zone: 'West Freeport' }),
                piece('Diamond', 'Loot from level 50+ mobs'),
                ...GEMS,
                piece('Fire Opal', 'Buy from Amber or Jade (North Freeport), or loot'),
                piece('Enchanted Platinum Bar', 'Enchant Platinum (Enchanter 32+) on a Platinum Bar', { qty: 2, note: 'keep the two unstacked' })
              ])
            ]),
            piece('Dusty Old Backbone', 'Ground spawn', { zone: 'Estate of Unrest', note: 'in the ghost room pit, through the basement’s invisible wall and the lava (530, 75)' }),
            piece('Dusty Ribcage', 'Ground spawn', { zone: 'Estate of Unrest', note: 'in the same pit as the backbone (530, 75); also in Mistmoore’s garden (-25, 90)' }),
            piece('Dusty Old Finger Bones', 'Ground spawn', { zone: 'Kedge Keep', note: 'Phinigel Autropos’s room, on a rock in the south wall’s alcove (-143, 146)' }),
            piece('Dusty Old Skull', 'Ground spawn', { zone: 'Steamfont Mountains', note: 'Meldrath’s room in the minotaur caves (1709, -2217)' }),
            piece('Dusty Old Jawbone', 'Ground spawn', { zone: 'Everfrost Peaks', note: 'in the underwater ice cave, under the third emblem (4537, -5234)' }),
            piece('Dusty Broken Sword', 'Ground spawn', { zone: 'North Kaladim', note: 'in the water in the mines (761, 332)' }),
            piece('Dusty Broken Shield', 'Ground spawn', { zone: 'Erudin', note: 'on a ledge of the right-hand cliffs: swim from the docks (-608, -724)' }),
            piece('Dusty Old Leg Bone', 'Hand a Pick and two Dwarven Ales to Diggs Duggun', { zone: 'Gorge of King Xorbb', note: '(1260, -550)' }, [
              piece('Pick', 'Buy from Kadek Norkhitter', { zone: 'North Kaladim' }),
              piece('Dwarven Ale', 'Buy from Dura Darkfoam (South Kaladim), or any ale vendor', { qty: 2, note: 'keep the two unstacked for the hand-in' })
            ])
          ])
        ])
      ])
    ]
  },
  {
    cls: 'Shadow Knight',
    spell: 'Life Leech',
    level: 47,
    page: 'The Etched Stone',
    revision: 176998,
    steps: [
      piece('Spell: Life Leech', 'Hand the Monstrous Zombie Heart to Kazzel D`Leryt', { zone: 'Rathe Mountains', note: 'he roams near (-634, -1561)' }, [
        piece(
          'Monstrous Zombie Heart',
          'Kill the monstrous zombie (level 53)',
          { zone: 'Rathe Mountains', note: 'Kazzel D`Leryt spawns it when you hand him the Pulsating Hyacinth Telesm' },
          [
            piece('Pulsating Hyacinth Telesm', 'Hand the Faceted Hyacinth Telesm to Xenyari Lisariel', { zone: 'Rathe Mountains', note: 'at the druid ring; she dies after' }, [
              piece(
                'Faceted Hyacinth Telesm',
                'Hand the Faceted Hyacinth, White Gold Necklace, Crystalline Orb and Bloodied Piece of Parchment to Kazzel D`Leryt',
                { zone: 'Rathe Mountains' },
                [
                  piece(
                    'Faceted Hyacinth',
                    'Hand the Uncut Hyacinth and 1,000pp to Darfumpel Zirubbel',
                    { zone: 'Rathe Mountains', note: '(4093, 896); he dislikes necromancers, so go disguised' },
                    [piece('Uncut Hyacinth', 'Give Kazzel D`Leryt 2,000pp', { zone: 'Rathe Mountains' })]
                  ),
                  piece('White Gold Necklace', 'Kill a froglok noble', { zone: 'Lower Guk' }),
                  piece('Crystalline Orb', 'Kill a stone spider', { zone: "Nagafen's Lair" }),
                  piece('Bloodied Piece of Parchment', 'Hand the Prickly Pear to Xenyari Lisariel', { zone: 'Rathe Mountains', note: 'at the druid ring' }, [
                    piece('Prickly Pear', 'Kill an icy terror', { zone: 'Permafrost', note: 'one of Lady Vox’s guardians' })
                  ])
                ]
              )
            ])
          ]
        )
      ])
    ]
  },
  {
    cls: 'Ranger',
    spell: 'Call of Flame',
    level: 49,
    page: 'Call of Flame Quest',
    revision: 178597,
    steps: [
      piece('Spell: Call of Flame', 'Hand the Poacher’s Head to Ganelorn Oast', { zone: 'East Karana' }, [
        piece(
          "Poacher's Head",
          'Kill Vance Bearstalker (level 53, summons)',
          {
            zone: 'East Karana',
            note: 'Ganelorn Oast spawns him for the Gift, Burnt Sash, Adamantite Band and Electrum-Bladed Wakizashi in one hand-in (no MQ)'
          },
          [
            piece('Gift', 'Hand the Note of Credit to Aanina Rockfinder', { zone: 'North Kaladim' }, [
              piece('Note of Credit', 'Hand the Symbol of Achievement to Ganelorn Oast', { zone: 'East Karana' }, [
                piece('Symbol of Achievement', 'Hand the Albino Rattlesnake Eggs to Kithicor', { zone: 'Kithicor Forest' }, [
                  piece('Albino Rattlesnake Eggs', 'Hand the Love Letter (Sealed) to Ganelorn Oast', { zone: 'East Karana' }, [
                    piece('Love Letter (Sealed)', 'Ask Lily Ashwood', { zone: 'Greater Faydark' })
                  ])
                ])
              ])
            ]),
            piece('Burnt Sash', 'Kill an imp protector', { zone: "Nagafen's Lair", note: 'rare' }),
            piece('Adamantite Band', 'Kill a reanimated hand', { zone: 'Lower Guk', note: 'rare' }),
            piece(
              'Electrum-Bladed Wakizashi',
              'Hand both fangs to an avenging caitiff (Vampire Teeth)',
              { zone: 'Mistmoore', note: 'in the tunnel under Ssynthi’s crypt (-75, 320); the spell takes the wakizashi' },
              [
                piece('Butler Syncalls Fang', 'Kill Butler Syncall', { zone: 'Mistmoore', note: 'about 5% (-315, -112)' }),
                piece('Maid Issis Fang', 'Kill Maid Issis', { zone: 'Mistmoore', note: 'about 5% (-339, -67)' })
              ]
            )
          ]
        )
      ])
    ]
  }
]
