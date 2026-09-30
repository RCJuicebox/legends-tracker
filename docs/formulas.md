# EverQuest Legends formulas

The game formulas Legends Tracker relies on, as far as they have been measured or confirmed in game.
Each entry gives the formula, the date it was settled, the measurement or source that settled it, and where the app implements it.

All in-game readings come from one test character: an Iksar Shadowknight / Monk / Shaman at level 50, unless an entry says otherwise. "The window" is the in-game Inventory window's stats panel. "Test Fifty Five" and "Test Sixty" are the two fixed training dummies used for parses.

## What the game exports

Settled 2026-09-12.

- `/alternateadv list` writes every held ability to the log, one entry per ability. Each description states the effect at the rank held, so the numbers can be read straight out of the text. The test character's dump listed 69 abilities. Re-run it after buying AAs; only the most recent dump counts.
- `/charinfo` prints two lines only, the origin location and the bind point. No stats.
- Raw stats (STR, DEX, AGI, STA, WIS, INT, CHA) and the window figures (HP, mana, AC, ATK) appear in no file and no log line. They must be read off the screen or computed from race, gear and buffs.

Implemented in `src/core/aa.ts` `latestAas`, `summarizeAas` and `aaEffects`. The original calculator's AA import passed 31 end-to-end checks, with the log, JSON and paste routes agreeing.

## Alternate Advancement values

Settled 2026-09-12, from the test character's `/alternateadv list` dump.

| input | value | from |
|---|---|---|
| AC soft cap (SPA 259) | 12% | Combat Stability 10 + Physical Enhancement 2 |
| ATK | +104 | Hunter's Attack Power |
| melee avoidance (SPA 172) | 12% | Combat Agility 10 + Physical Enhancement 2 |
| melee crit | 5% | Combat Fury (max rank) |
| dual wield | +32% | Ambidexterity |
| all seven stats | +10 | Innate Eminence |
| base HP | +12% | Natural Durability |

Innate Eminence is already included in the window's stats, so it is shown and never added again. Implemented in `src/core/aa.ts` `AA_USES`.

## Skill ids and caps

Settled 2026-09-13.

- EverQuest Legends uses the classic EverQuest skill ids. The window's Skills list matched `Resources/skillcaps.txt` on 62 of 63 caps, each cap being the best of the three classes.
- Triple Attack is id 76, not 72.
- The log keeps skill highs from earlier class combinations (Bard instruments, Paladin Smite, Parry 230). Those are not over-cap readings.

Implemented in `src/core/combatModel.ts` `SKILL_NAMES` and `TRIPLE_ATTACK`; the cap table is read in `src/main/stats.ts`.

## Item merge scaling

Settled 2026-09-12. Source: eqlwiki.com's `ItemLevelSlider` extension, which implements the game's +N scaling. Checked on the test character's worn gear: 152 base AC became 249 at the gear's merge levels (+97), which the AC model below then reproduced exactly. A ring with +5 to each stat showed +9 at +4, and removing it lowered each stat by exactly 9.

Merge level N runs 0 to 10. `excelRound` rounds halves away from zero.

| stat | value at +N |
|---|---|
| AC, HP, mana, endurance, the seven stats, every save; base 0 | 0 |
| the same; base 1 to 10 | base + N |
| the same; base over 10 | floor(base + excelRound(base × N ÷ 10)) |
| the same; negative base | mirrors the above, capped at 0 |
| weapon damage | base + floor(base × N ÷ 10) |
| haste, HP / mana / endurance regen | base + N |
| weight | base × (1 − 0.09 × N), rounded up to 0.1; unchanged at 0.1 or less |
| Void resist, on an item with two or more of the seven stats and five resists (Fire, Cold, Poison, Magic, Disease) | + N, whatever its own Void (added 2026-09-30) |
| ATK | base: the slider leaves it unscaled (2026-09-30) |

Implemented in `src/core/inventory.ts` `scaledStats`, using `scalePrimary`, `scaleDamage`, `scaleFlat`, `scaleWeight` and `voidFromMerge`.

The Void and ATK rows are the slider's and not yet checked in play. Void is close to settled: the test
character's worn gear (none of it with Void of its own) comes to +107 Void from merges on 2026-09-30,
and a Stats window read on 2026-09-24, at lower merge levels, showed Void 124 where the other resists'
bases were 23 to 44. *Settles it:* a Stats window read on the day of an inventory export, where Void
should be the race's base plus the gear's merge levels on items that qualify. ATK: merge an item with
ATK and read the Stats window's Attack before and after.

## AC: soft cap and mitigation

Settled 2026-09-12. Source: Dzarn's post "What is your 'Real AC'?", reposted to r/EQLegends by neodraykl, with every division truncating. The window's three AC figures are mitigation / soft cap / avoidance.

- AC sum = gear AC × 4 ÷ 3 + race and class bonus + Defense ÷ 3 + AC buffs ÷ 4 + Agility ÷ 20 (Defense ÷ 2 and buffs ÷ 3 for cloth casters).
- Soft cap = the class cap from `Resources/ACMitigation.txt` (the best of the three classes) + that cap × SPA 259 % ÷ 100.
- Mitigation = soft cap + (AC sum − soft cap) × the table's post-cap multiplier (0.33), when the sum is over the cap.

Test character, unbuffed: soft cap 392 + 392 × 12 ÷ 100 = 439. AC sum 524 = 332 (gear 249 × 4 ÷ 3) + 76 (Defense 230 ÷ 3) + 8 (Agility 178 ÷ 20) + 35 (Iksar) + 73 (Monk weight bonus). Mitigation 439 + (524 − 439) × 0.33 = 467. The window read 467 / 439 / 501.

Later checks, all exact:

| change | mitigation | notes |
|---|---|---|
| Engineer's Ring removed (28 AC, 9 to every stat) | 454 | predicted before the screenshot; soft cap stayed 439 |
| Midnight Clad Leggings +4 removed | 463 | predicted before the screenshot |
| Agility buff +45 | 468 | Agility ÷ 20 went from 8 to 11 |
| two items merged one level each, worn AC 249 → 251 (2026-09-13) | 467 | predicted 467 |

Over the soft cap, a point of gear AC is worth 0.43 mitigation and a point of buff AC 0.083, so gear AC is about five times better.

Implemented in `src/core/acModel.ts` `computeAc`, with `acSum` and `raceClassBonus`. `tests/core/stats.test.ts` reproduces the 12 September and ring-off readings.

## AC buffs count a quarter

Settled 2026-09-13. The Guardian buff (`spells_us.txt`: 35 + level, max 80, so 80 at level 50) took mitigation from 467 to 474 twice, with soft cap and avoidance unchanged. 80 ÷ 4 = 20 gives AC sum 546 and mitigation 474 exactly. Dividing by 3 would give 476; 79 AC would give 473.

Predictions made before the test, from the same baseline:

| buff AC | mitigation |
|---|---|
| +20 | 468 |
| +40 | 470 |
| +75 | 472 |
| +100 | 475 |

Implemented in `src/core/acModel.ts` `acSum` (the `buffs` term).

## Avoidance

Settled 2026-09-14.

avoidance = floor((Computed Defense + 10) × (100 + SPA 172 %) ÷ 100)

Computed Defense is Dzarn's: Defense × 400 ÷ 225 + 8000 × (Agility − 40) ÷ 36000 + heroic Agility ÷ 10 + item avoidance (up to 100). The +10 and the SPA 172 term are EQEmu's `GetTotalDefense`. The test character's SPA 172 is 12% (Combat Agility 10 + Physical Enhancement 2).

How it was settled:

- 2026-09-12: an Agility buff of +45 (to 223) moved avoidance to 512. A flat +63 predicted 511 and a multiplier predicted 512, which ruled out a flat addition under both whole-number and fractional arithmetic. A measured multiplier of about 1.1448 then fitted all 9 AC figures across 3 screenshots.
- 2026-09-14: the formula above replaced the multiplier. It gives 499, 501, 501 and 512, matching all four readings. The gap between 1.1448 and the 1.12 the AAs describe was the +10.
- The ring-off reading moved avoidance 501 → 499, exactly the Agility term's change (30 at Agility 178, 28 at 169).

Implemented in `src/core/acModel.ts` `computeAc` (the `avoidance` line) and `computedDefense`.

## Attack line: Offense

Settled 2026-09-14 by weapon swaps. The window's Attack line reads Offense / Accuracy.

Offense = weapon skill + (2 × STR − 150) ÷ 3, integer, with the strength term 0 below 75 STR.

- It uses the skill of the weapon being swung (Hand to Hand when bare-fisted), not the Offense skill. 4 of 4 screenshots exact.
- Strength: removing the ring (STR 223 → 214) lowered Offense by 6, from 98 to 92 in the strength term. A strength buff of +67 raised Offense by 45.
- Stances never change Offense.
- ATK does not appear in it: Hunter's Attack Power (+104 ATK) is not visible in the window's Offense. The app leaves ATK out of Offense for that reason.

Implemented in `src/core/combatModel.ts` `windowOffense` and `strengthOffense`.

## Attack line: Accuracy and stances

Settled 2026-09-14 by weapon swaps. Source: EQEmu `compute_tohit` and `GetTotalToHit`, verbatim.

Accuracy = floor((Offense skill + weapon skill + 17) × 121 ÷ 100), then × (100 + stance %) ÷ 100.

- Worked example, bare-fisted: (Offense skill 230 + Hand to Hand 270 + 17) × 121 ÷ 100 = 625.
- 7 of 7 readings exact: Hand to Hand 625, 1H Piercing and 2H Slashing 601, Offensive 781, Balanced 687.
- The weapon tests were taken in Striker, which adds 0% to the window's Accuracy.
- Stats and the offhand weapon do not affect it. Strength, stamina, intelligence, wisdom, agility, dexterity and charisma were each ruled out by buffs or gear changes (2026-09-12). Engineer's Ring, toggled on and off directly, did not change it.
- Heroic stats do not exist on EverQuest Legends at present (2026-09-13), so heroic dexterity is not a source.
- Readings are only comparable within one stance. An early reading of 662 after the ring came off was a stance change, confirmed in game (2026-09-12).

Stance bonuses (SPA 184), 2026-09-13, same gear and buffs, ATK 530 throughout:

| stance | hit bonus | Accuracy |
|---|---|---|
| none (base) | 0% | 625 |
| Offensive | 25% | 781 |
| Balanced | 10% | 687 |
| Striker, Ranged, Defensive, Evasive, Mage Hunter, Channeler | 0% | 625 |

Striker's tooltip +25% applies only to skill attacks (Bash, Tail Rake, Flying Kick, Reave and so on), not to auto-attack (2026-09-14). The window's per-stance Attack line reads Base 373/625, Balanced 373/687, Striker 373/625, Offensive 373/781.

Implemented in `src/core/combatModel.ts` `baseAccuracy`, `stanceAccuracy` and `DEFAULT_STANCES`.

## Hit chance

Formula worked out 2026-09-12; confirmed on EverQuest Legends 2026-09-14.

EQEmu's `CheckHitChance` rolls Accuracy against the target's avoidance; the higher roll wins and ties split. In closed form:

- Accuracy ≥ avoidance: hit chance = 1 − avoidance ÷ (2 × Accuracy)
- Accuracy < avoidance: hit chance = Accuracy ÷ (2 × avoidance)

The closed form matches all 14,641 dice combinations checked. It never reaches 100% and there is no cap in the code: doubling Accuracy halves misses, 95% needs 10 times the target's avoidance and 99% needs 50 times.

Confirmation, Test Sixty, one parse in Offensive then one in Balanced:

- Offensive (Accuracy 781) hit 70.01%, which solves to a target avoidance of 468.
- Balanced (687) was predicted at 65.9% from that avoidance and measured 66.10%.
- Bash, kick and strike, each rolled on its own skill, landed within 0.1 point of prediction.
- Test Sixty's avoidance is about 467.
- A low-gear parse (most gear removed, DEX about 118) gave the predicted hit rates.

Implemented in `src/core/combatModel.ts` `hitChance` and `avoidanceFromHitRate`. `tests/core/stats.test.ts` checks the 70.01% → 468 and 65.9% figures.

## Swings per round

Settled 2026-09-14 on Test Sixty. Source: EQEmu's attack rounds (`CheckDoubleAttack`, `CheckTripleAttack`, `CheckDualWield`).

- Double attack chance = (skill + level) × (100 + bonus %) ÷ 100 ÷ 500
- Triple attack chance, rolled after a main-hand double, for Warrior, Monk, Berserker and Ranger = floor(c × 100 ÷ (c + 800)) %, where c is the Triple Attack skill
- Dual wield chance = (skill + level + Ambidexterity) ÷ 375
- Swings per round = 1 + double + double × triple, plus dual wield × (1 + double) for the offhand, whose own double needs Double Attack skill 150 or more

Predicted 3.05; two hour-long parses measured 3.05 and 3.06. The Project 1999 shape, which predicts 3.87, is ruled out. The low-gear parse measured 3.03, as predicted.

Implemented in `src/core/combatModel.ts` `doubleAttackChance`, `tripleAttackChance`, `dualWieldChance`, `swingsPerRound` and `handSwings`.

## HP, mana and endurance

Shapes settled 2026-09-12; absolute checks 2026-09-14. Source: EQEmu's SoD formulas with the client's `Resources/basedata.txt` factors at level 50. A multi-class character does not use a single best class:

- Mana: each casting class adds its own factor × its own casting stat, converted. Shadowknight uses intelligence and Shaman wisdom, both factor 4.5; the Monk adds nothing. Using only the best caster misses.
- HP: the two highest HP factors, summed (Shadowknight 4.8 + Monk 4.25 = 9.05), × stamina (stamina over 255 counts half), then + Natural Durability's 12%.
- Endurance: the two highest endurance factors, summed (Monk 4.5 + Shadowknight 3.25 = 7.75), × the converted average of STR, STA, DEX and AGI, plus item endurance.

Stat conversion: each point counts 1 up to 100, 2.5 from 100 to 200, and 1.25 past 200.

The deciding test was removing Midnight Clad Leggings +4 (2026-09-12). Predictions and results:

| figure | before | predicted | measured |
|---|---|---|---|
| mitigation AC | 467 | 463 | 463 |
| avoidance | 501 | unchanged | 501 |
| Offense | 368 | unchanged | 368 |
| max HP | 6240 | −70 if only the Shadowknight's 4.8 counts, −132 if Shadowknight + Monk | −132 |
| max mana | 5506 | −42 if one of WIS / INT drives mana, −85 if both | −103 (exact under the per-class formula) |
| Accuracy | 781 | moves only if INT or WIS feeds it | unchanged |

Fit across all controlled changes:

| pool | 2026-09-12 (six changes) | 2026-09-14 (absolute values) |
|---|---|---|
| mana | 6 of 6 exact | 4 of 4 exact, with an unexplained +4 |
| HP | 2 of 3 exact (the ring test 2 off) | within 1 on 5 of 5, with an unexplained ~+6 |
| endurance | 4 of 6 exact | 6 of 8 exact, and the weapon tests add 2 more exact fits; the Agility buff misses by 16 and the Strength buff by 9 |

Both missing buffs are pure single-stat buffs (Agility SPA 6 max 45, Strength SPA 4 max 67), so the misses are not side effects. An Agility buff of +45 raised endurance by 93.

Implemented per point in `src/core/statValue.ts` `conversions` and `statSlope`. The class factors are read from `basedata.txt` in `src/main/stats.ts`. The app does not compute absolute pools.

## Melee crit: what is ruled out

No formula has been recovered. The app takes a measured crit rate from a parse, and uses it in place of the classic model when one is entered.

Settled findings, 2026-09-12 to 2026-09-15:

- Melee crit is innate and broad on EverQuest Legends. The test character, with no Warrior or Berserker and Combat Fury at its maximum 5%, crit 11.88% on 13,606 hits (Test Fifty Five, 10 September), at the same rate on every attack type.
- The EQEmu / Sancus model does not apply. At EQEmu's difficulty of 8900 it gives this character 1.4%; without SPA 169 it gives non-Warrior, non-Berserker classes 0%.
- Stance does not change it: 11.3% to 11.4% in both Offensive and Balanced (Test Sixty, 2026-09-14).
- Dexterity does not change it: a Dexterity buff from 160 to 210 in Balanced gave 11.49% on 7,051 hits, against 11.44% without it. EQEmu's dexterity shape predicted 14.2%.
- Gear and stats do not change it: a low-gear parse (DEX about 118) gave 10.63% (95% range 9.61 to 11.75). Pooled Test Sixty: 11.32% on 25,721 hits (95% range 10.93 to 11.71).
- The number of melee and hybrid classes does not change it (2026-09-15). The thesis tested was 5% per melee or hybrid class plus 5% from Combat Fury:

| melee / hybrid classes | predicted, Combat Fury +5 points | predicted, Combat Fury × 1.05 | measured |
|---|---|---|---|
| 1 | 10% | 5.25% | not run |
| 2 (Shadowknight / Monk / Shaman) | 15% | 10.5% | 11.32%, 25,721 hits |
| 3 (Paladin / Shadowknight / Monk) | 20% | 15.75% | 11.11%, 9,419 hits |

Implemented in `src/core/combatModel.ts` `classicCritChance`, kept for comparison only. The measured rate overrides it in `src/core/statsModel.ts` `combatReport`.

## Pets

Settled 2026-09-15 on Test Sixty.

- The Improved Vampirism II exaltation (+1% to +25% lifetap damage) does not focus pet spells. With it in the pet's weapon, Specter Lifetap hit for 61 on all 234 casts and Lifedraw for 105 on all 52, and no exaltation lines appeared. With the exaltation removed, both were identical.
- A pet uses its weapon even while the log says "Your pet's will is not sufficient to command its weapon". That message is the weapon proc's level gate; the weapon's damage still applies. Removing a 2H weapon (Khyldorn: DMG 36, delay 43, proc Siphon level 50) dropped the average slash from 108 to a bare "sting" of 43, cleave from 111 to 43 and bash from 42 to 14, and the message stopped.

Pet melee with a weapon is modelled in `src/core/pets.ts` `petSwing` and `weaponDamageBonus`; it assumes a worn weapon is used, as found here.

## Faction standing and con

Settled 2026-09-28 (the export and the achievements) and 2026-09-29 (the con), in play on the test character after it changed from Iksar of Cazic Thule to an Agnostic Wood Elf, Monk / Bard / Enchanter.

- `/outputfile faction` writes `Name_server-CLASS-Factions.txt`: the **raw** personal standing, -2000 to 2000, with no race, class or deity modifier. The log's lifetime net of "Your faction standing with X has been adjusted by N." lines equals the export's value. A race or deity change leaves the raw standings as they were: two exports either side of one were byte for byte the same.
- The 83 faction achievements (EverQuest › Progression, id 80000 + faction id) complete at raw 2000, and stay complete if the standing drops again. "Could not possibly get any better" is the line at 2000.
- What an NPC cons is **raw + race modifier + deity modifier + the best (highest) of the three classes' modifiers**, from the client's `Resources/Faction/FactionAssociations.txt` (`faction^key^modifier`; keys 1-16 classes, 51-62 the classic twelve races, Iksar 178, Kerran 180, Froglok 661, Drakkin 1106, deities 201-216). Agnostic has no key and adds nothing; a class with no row adds 0; the primary class has no special part.
- The con bands are EQEmu's: Ally 1100, Warmly 750, Kindly 500, Amiably 100, Indifferent 0, Apprehensive -100, Dubious -500, Threatening -750, Scowling below.

The readings that settled it:

| Character | Faction, raw | Sum | Con |
|---|---|---|---|
| Iksar, Cazic Thule | Tunare's Scouts, 0 | -750 - 200 = -950 | Scowls |
| Iksar, Agnostic | Tunare's Scouts, 0 | -750 | Threatening (so -750 is Threatening, not Scowling) |
| Wood Elf, Cazic Thule | Tunare's Scouts, 0 | 100 - 200 = -100 | Apprehensive (so -100 is Apprehensive) |
| Wood Elf, Agnostic | Tunare's Scouts, 0 | 100 | Amiable (so Amiably starts at 100) |
| Wood Elf, Agnostic, MNK/BRD/ENC | Song Weavers, 0 | 50 + best of MNK 0, BRD 50, ENC 0 = 100 | Amiable (a sum of all three would be the same; the Monk's alone would be Indifferent) |
| Wood Elf, Agnostic, MNK/SHD/SHM | Song Weavers, 0 | 50 + best of MNK 0, SHD -300, SHM 0 = 50 | Indifferent (a sum would be -250 Dubious) |
| Wood Elf, Agnostic, MNK/BRD/ENC | Dreadguard Inner, 2000 (Divn L\`Crit) | 2000 - 875 + best of MNK -300, BRD 0, ENC 0 = 1125 | Ally (the Monk's -300 would be 825 Warmly) |

A /con while invisible reads "regards you indifferently" whatever the standing: it proves nothing.

Implemented in `src/features/factions/core.ts`: `STANDINGS` and `standingBand` (the bands), `RACE_KEYS`, `conBasis` and `conOf` (the sum, best class by `clsIndex`), `withCons` for the Standings tab; the Plan tab plans every character as Agnostic (`consFor` in `main.ts`). Standings since an export are the export plus every change the log wrote after its "Outputfile Complete" line (`SinceExports`).
