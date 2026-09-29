# Changelog

What changed in each version. The release workflow publishes a version's section as its release notes, and installed copies show them when an update arrives.

## 2.4.0 (2026-09-29)

- **Slayer: Dervishes.** The Dervish Cutthroats of the Deserts of Ro and the Commonlands are humanoid bandits, not Dervishes: their kills now count toward the playable races only, and a Dervish Thug as an Ogre. **Spin Me Right Round** now suggests the blade storms of the Plane of Sky's island 1.5 (levels 59 to 61).
- **Fixed: a faction's standing fell short after a busy stretch.** Only the last 20 changes the log saw since your factions export were added to it, so an evening's kills could leave it hundreds short: two achievements the game gave at 2000 showed 1750. Every change since the export now counts, read from the log itself. And a faction achievement the game says you completed is done at once on the Factions page, the plan and the overlay, without waiting for a new achievements export.
- **Factions › Optimize reads quest walkthroughs better.** A faction block a page leaves open no longer swallows the next hand-in: Crusader Iktra takes 4 Metal Bits for +5, a Small Piece of High Quality Ore for +10 and a Small Brick for +15, where it read one piece for +15. Faction lines written outside a block, P99's way of writing amounts and pages that say "Your faction with" are read, and what the NPC gives back is not taken for a hand-in. A hand-in of other things than your log saw go to that NPC stays in as another way.
- **From play:** the Small Piece of High Quality Ore drops only from the Goblin Janitor in Runnyeye, and the Illegible Cantrip Quest cannot be done over and over. **Arcane Scientists** is now planned on Rephas's Rat Ear Pie Quest in Qeynos Hills instead of 200 Illegible Cantrips. Each Rat Ears is +5, and the Grilled Rat Ears he gives for it are +5 more when handed back, so one step counts both. Rat Ears take about 4 minutes each from rats, as in Misty Thicket.
- **Hand-ins that come back.** Where a quest's NPC gives you something to hand straight back for as much again, the plan counts both hand-ins as one, from the walkthrough or from your log once you have done it.
- **The No city NPC kills switch is gone** from Factions › Optimize. The city NPCs flag on a step stays.
- **Quests that need better faction first.** The plan leaves out a quest whose NPC takes it only at a con you are not at yet, until you are. Your con is your standing plus your race's and class's modifiers from the game's own files; your deity's is not known. Faking a con only reaches Indifferent, so only a need above that holds a quest back. **Tunare Scouts Dagger** needs Amiable with Tunare's Scouts and gives +1 a hand-in (from Allakhazam). Lock one in to plan it anyway.
- **Tunare's Scouts** can now be raised by killing the arboreans of Greater Faydark (+1 each, from Allakhazam), which eqlwiki does not list.
- **Factions › Optimize reads Allakhazam's faction pages too.** Each page gives the con a quest's NPC wants first, which holds the quest back until you are there, and what a kill or a quest does to the faction. A kill's effect is put together from every page that names the mob, so a camp gets exact amounts instead of eqlwiki's guesses, and mobs eqlwiki does not list become camps. A quest amount eqlwiki leaves as "got better" comes from there too. The site asks readers to wait twenty seconds between pages, so the tracker reads one every twenty seconds in the background: the factions of the achievements you have left first, then the rest of yours. It keeps each page a month. The Optimize tab and the Data Sources page say how far it has got.
- Faction and quest pages are read from eqlwiki again once, so the plan sees these fixes now rather than when the week-old copy runs out.
- **A plan step says how many items it takes in all**, with each hand-in's share when it is more than one: "1,520 Metal Bits (4 a hand-in)".
- **Stats › AAs.** A new tab lists every AA your log and its archives saw you buy: the rank each last reached, the points it cost and when you last raised it. Open one for each rank, and any refund where it gave the points back. Above the list: the AA points you have left to spend, the points spent, and a warning when the game says your pool of points is full. Abilities the game gives for nothing are behind **Granted**; ones your `/alternateadv list` holds that the log never saw bought show as _list only_. The ability list the AC and Combat tabs use moved here too, and is read again by itself when you type `/alternateadv list` after buying.
- **Fixed:** with another character picked on the Stats page, its AAs were read from the log of the character being played. Each character's now come from its own log.
- **Your race and classes follow /who.** A race or class change used to go unnoticed: /who only filled in a race the tracker did not have yet, and never the classes. Now a /who of yourself, typed while the tracker runs, updates both, so the faction cons, the AC sums, spell durations and the gear you can wear follow. /who shows one level, the lowest of your three: no class is put below it, a new class comes in at it, and at 50 every class is 50. Classes that stay keep your order, so your main class stays first. An illusion into something no character can be (an Elemental) leaves your race alone; one into a playable race shows in /who too, and the next /who without it puts yours back. The Race field on the Stats page lists all sixteen playable races.

## 2.3.0 (2026-09-28)

- **Factions: where you stand.** Type `/outputfile faction` in game and the Factions page reads the file the game writes: every faction's standing (-2000 to 2000), how it cons (Ally, Warmly … Scowling) and how far it is to the next con up. Faction changes your log records after the export are added on, so the standings keep up as you play; type it again now and then to refresh. Factions the game lists by number only (Faction723) are hidden until you show them.
- **Factions: achievements.** **Achievements to Do** lists the factions whose EverQuest › Progression achievement is still open (83 factions have one), with how many points are left to 2000. Open a row for what raises that faction, from eqlwiki: the mobs to kill (by zone), the quests and the zones. Rows start closed.
- **Factions › Optimize: a plan for every faction achievement still to do,** for whichever character is picked, and live: it follows the Standings tab, so the counts go down as you play, and the order is kept while you play (an achievement done, a new lock or **Plan afresh** re-plans). Step by step, where to go, what to kill or hand in, how many and about how long, in the order that finishes them all soonest. An achievement is done the moment its standing reaches 2000 and stays done, so work that lowers another achievement still to do is put after that one is done, and quick ones come first when the order costs nothing. What raises a faction comes from your own log first (every kill and hand-in that moved a faction, with the amounts Legends gives and how fast you got through them), then eqlwiki's faction, quest and item pages; mobs are grouped into camps by zone, common ones at your kill pace and named ones at one per respawn, so a quest beats a camp of one or two named mobs. Items you hold (bags, bank, depot) and items you have bought before make hand-ins quick. Open an achievement for every way to raise it: **Lock in** one and the plan finishes that achievement with it and is built around it, **Rule out** one and the plan leaves it alone, or give your own pace an hour. The assumptions (travel, kill pace, named respawn, gathering) can be changed. Two goals: **Fastest**, or **Most factions positive**, which also counts every faction ending at 0 or above and adds restore steps where they are worth the time; either way a faction is judged by where it ends, so points a later step gives back cost nothing.
- **Achievements overlay.** A new overlay (switched on from Factions › Optimize or the Overlays page) follows the faction plan while you play: the step you are on, counting down as your factions move, about how long it has left, and the next step; a step done is said aloud with the next, and each achievement it finishes flashes. It also shows the Slayer achievements your recent kills counted toward, and the skills your skill achievements want that went up lately, live.
- **Track an achievement.** The star on any achievement on the Achievements page keeps it on the achievements overlay with its progress: a Slayer count, each skill against its cap, a faction's standing toward 2000, or the objectives left (a Hunter achievement's named, ticked off as your log shows each kill). **Tracked** at the top of the page lists them.
- **Skill achievements show where each skill stands.** General › Skills objectives ("Reach the maximum skill in Divination at level 50") show the skill as your log last gave it against the cap to reach, the best of your classes at that level from the game's skill caps, on the Achievements page and the overlay.
- **Slayer counts go on as you play.** Each open Slayer achievement's count from your achievements export, plus every kill since that the log shows (yours, your pet's and your group's), matched to its races by the mob's name or, where the name does not say, by the race eqlwiki gives for it. Shown as `+N` on the Achievements page and on the overlay; one the game says is completed shows done.
- **Factions › Optimize: Now, flags and a city switch.** The Now card shows the step you are on as you play. Steps say what could make them slower or rougher than planned (city NPCs, amounts guessed, item source unknown, named only), and **No city NPC kills** leaves out camps of a city's guards and merchants.
- **Factions: your other characters' logs count.** What a kill or hand-in does to a faction is the same for every character, so an alt's plan starts from what your other characters have measured; kill pace stays each character's own.
- **Factions › Standings: what moved it, the quickest ways, and a lookup.** Open a faction for what moved it in your logs (each mob or NPC, how often and by how much) and the quickest ways to take it to 2000. **What does a mob or NPC do?** looks up any name in your logs or eqlwiki's faction pages and shows what it does to every faction, coloured by whether it helps or hurts your achievements.
- **Copy buttons on game commands.** Wherever the app asks you to type `/outputfile inventory`, `/outputfile achievements` or `/outputfile faction`, a copy icon beside the command puts it on the clipboard to paste into the game's chat box.
- **Settings › game folder** now lists the faction files it finds.
- **Character › Progression is gone.** Its sessions, levels, AA purchases and skill-ups are no longer counted, and what it had kept is cleared from the log history cache.

## 2.2.0 (2026-09-27)

- **Gear optimizer: keep what you wear.** The lock card now shows everything you are wearing, slot by slot: click a piece to lock it, and the optimizer leaves it on and works around it. Any other piece still goes in a slot from **Or put another piece in a slot**. The card folds away from its heading and says what is locked while folded. The **Keep it** button on suggested changes, which sat beside the new item and read as if it kept that, is gone.
- **Damage meter: only fights you're in.** Other players' fights nearby are left out: a fight needs you, your pet or your group, and a stranger's blows no longer open a fight of their own, show in Overall, or keep your fight from ending. Anyone fighting your enemy still counts, with the adds they take on. If your raid pulls before you swing, the fight starts at the pull.
- **Damage meter:** a player who only missed says so ("1 swing, all missed") instead of showing an empty row; "1 hits" reads "1 hit"; and the bars are lighter, so the figures on your own (amber) bars are easier to read.

## 2.1.0 (2026-09-27)

- **Gear › Gear optimizer: lock a piece in.** Choose any piece you own (or, with All gear, one to get) and a slot it fits, and the optimizer keeps it there and wears everything else around it. It may still put an exaltation from Storage in the piece. **Keep it** on a suggested change locks what you wear in that slot. Locks are kept per character until you unlock them.
- **Timer bars have a new fill**: the six-second tick marks are gone. A bar is now faint where it started and full colour at its glowing leading edge. In its last 12 seconds it shifts from the timer's own colour to amber, then red.

## 2.0.0 (2026-09-27)

### A look of its own, light or dark

- **Field Kit**: the app now looks like the game's own windows: bevelled panels, condensed headings (Windows' Bahnschrift), figures in Cascadia Mono, an amber accent, and a mark on each timer bar for every six-second tick.
- **Settings › Appearance**: System, Light or Dark. System follows Windows. The overlays stay dark over the game whichever you pick.

### Safer and lighter

- **Updates save everything first.** Restarting into an update now writes your settings and where mote tracking got to before the installer starts.
- **If the app cannot start, it says so** with a message naming the log file, instead of running on with no tray icon.
- **Hidden windows rest.** The main window in the tray and the overlays hidden with the game are sent nothing and stop redrawing until they show again.
- **The Windows speech engine starts when first needed** and stops after five quiet minutes; with an Azure voice it may never start at all.
- **Unsaved trigger edits survive a restart** and are marked in the sidebar until you save them.
- The **Damage meter** and **Respawns** overlays can no longer be removed by accident; if an older version let you remove them, they come back.
- Settings read at start are checked the same way a save is, so a hand-edited file cannot stop the app.

### Clearer and more helpful

- **Shadow Knight** is spelled the same way on every page.
- **Copy diagnostics** (Settings) puts the version, your settings summary and the end of the log on the clipboard for a bug report, without your Windows user name.
- A page that hits an error shows what happened in its place; the rest of the app keeps working, and a crashed window is brought back.
- **Following another character:** if your log goes quiet while another character's log is being written, the Live page offers to follow them.
- Waking the PC from sleep no longer speaks every timer that ran out overnight.
- Updates show **what's new** on the Settings page, and a failed download is mentioned once.
- **Updates install silently.** The installer is now one-click: no window, no questions, and the app comes back by itself. It always installs to `%LOCALAPPDATA%\Programs\legends-tracker`; the folder can no longer be chosen.

### New places to look

- **Getting set up** on the Live page lists what still needs doing (game folder, log, classes and levels, audio device, overlay placement), each with a link to where it is done. It goes away once everything is set.
- The **Live page** shows the fight in hand and the session so far (fights, kills, deaths, coin, kills an hour), and warns when the log has gone quiet while the game runs.
- **Character › Upgrades** gathers every way to spend motes: Best merge, the Merge planner and Spell upgrades. **Plan** on a merge or a worn item opens the planner there. Motes is now tracking alone.
- **Setup › Data Sources** lists every source the app reads (log, spell data, exports, the wiki, updates and more) with how its last read went, its age and a Refresh.
- **Long jobs show their progress** in a strip above the page, and each has **Cancel**: the item catalog and recipe downloads, the mote history rebuild, the Spell Timers log check and a meter rebuild.
- **Character › Factions** lists every faction your log and its archives recorded a change for: the net change, how many, when the last was, whether the game said it could get no better (or worse), and a row's last 20 changes. The game does not print your standing, so it is the net of what the log saw.
- **Character › Progression** shows what your log and its archives recorded of your progress: levels (grouped into runs, since the log never names the class), skill-ups per skill, AA purchases and unspent points, and each session's experience, AA points, levels and skill-ups with rates an hour. EQL prints no experience amounts, so experience is counted in messages.
- **Hotkeys** from anywhere: Ctrl+Shift+F9 mutes, F10 starts a meter session, F11 arranges the overlays. **UI size** (Settings) zooms the main window from 90% to 150%.

### One character record

- A character's classes, levels and race are kept in one place and edited on the **Stats** page; Spell Timers, Gear, the upgrade finder, Spell upgrades and Buffs all use it. Achievements, Stats, Gear and Tradeskills remember the same character pick.

### Smaller things

- Deleting a trigger, resetting the group and removing the Azure key ask first; Export, New session and Read the log again say they worked.
- Info popovers close on Escape or a click elsewhere. Status chips carry a mark as well as a colour. Grids wrap in a narrow window. Each overlay card has **Bring on screen**.
- Every filter box clears with Escape, the show/hide chips on Loot and the upgrade finder look the same, and the **Respawns** table sorts by any of its columns (remembered).

- **Respawns** shows a small line of every gap seen beside the last one. **Damage meter**: a row you click into shows its damage, DPS, hits, crit and landed rates and best hit above its skills.
- **Damage meter**: **Overall** now charts DPS over time, the session's fights end to end; **Compare with…** sets a fight beside another, everyone's rate and the change.
- **Spell Timers** shows what a detrimental spell is resisted with (poison, disease, magic…), from the game's spell file.
- **Try it** (Live) and **Test** (Triggers) share what you paste and point at each other; Test can **Run it for real**.
- **Spell Timers › Check against your log**: a spell that is off has **Add this focus**, which sets its extra focus to what the log implies.

### Fixes

- A `/who` of yourself fills in your race on the Stats page if it was empty, and your zone if the app did not know it yet.
- Item details on **Loot** and **Gear** say when the wiki was last read for them; on Loot, **Look up again** reads that item's page now.
- If a game patch changes the layout of the spell file, the app says so instead of timing spells from the wrong columns.
- Reading the mote counts off the screen finds the Quantity column at any UI size.
- Reading the last N minutes into the meter no longer includes older fights from a small log.
- Log times stay in order through the hour the clocks go back, so an AA list or a fight across it is read whole.
- Damage written with a thousands separator ("1,234 points") is counted.
- A log waiting for the game to close that was moved or deleted is no longer archived later at any size.

### Faster lookups

- Casts, melee and purchases are read from your log and archives **in one pass** and remembered, so Gear and Tradeskills open quickly after the first time.
- **Refreshing the item catalog reads only the wiki pages edited since last time** (a few seconds, where it was minutes), and every wiki request is polite: one at a time, backing off when the wiki is busy.
- The pet is found by reading only the part of the log written since last time.
- Downloaded data (the item catalog, recipes, wiki pages, spoken phrases, log counts) moves out of your roaming profile to `%LOCALAPPDATA%\Legends Tracker`.
- **The upgrade finder no longer freezes** while it judges candidates in the round: the page stays responsive and the results arrive in the same time.
- **Timer bars drain smoothly by themselves**, and the overlays redraw only to change the clock text.
- **Pages redraw only when what they show changes**, not every second while you play.
- **Spell data loads in about two-thirds of the time** and holds a third less memory. The item catalog is no longer kept in memory when no Gear page is open.
- **The overlays on a monitor now share one window** while you play (about 100 MB less memory for each overlay after the first). **Arrange overlays** still gives each its own window to drag and resize, across monitors too.
- **Copy diagnostics** lists each window's memory and CPU, for a report about the app being slow or heavy.

## 1.9.0 (2026-09-27)

### Gear optimizer: gear you own, or all gear

- **Optimize what you own** is now the **Gear optimizer**, with two modes. **Gear you own** works as before. **All gear** also weighs the best of everything your classes can wear from the eras shown (the top dozen a slot), marks the pieces to get, and says where they drop.
- Pieces to get are compared the way the upgrade finder's **Compare** setting says: as they drop, or at the merge level of what you wear in that slot. The setting now shows on the optimizer too.
- The upgrade finder and the optimizer now agree. An item you own is judged as your own copy, listed only in the slot your best set would put it, and ranked after anything to get that beats your best set.
- Changes that are one move, like a new weapon in Primary pushing the old one to Secondary, show their combined gain.

### Weapons

- **Each hand counts by how often it swings.** Your Dual Wield, Double Attack and Triple Attack skills from your log go through EQEmu's attack rounds, as on the Stats page, so the main hand's weapon ratio and procs count for more than the off hand's.
- **Weapons: best ratio first** (on by default) keeps the best-ratio weapons in your hands whatever the other weights, so you can tune HP, AC and the rest without a stat-heavy weapon taking over.

### Worn effects and procs

- **Separate tabs.** Worn effects has three sections: In combat, Stats (worn AC, attack, stats, resists and regen, priced by your stat weights) and Utility (Enduring Breath, Ultravision and the like, listed but not valued). Most worn effects were being missed before, because eqlwiki usually writes them as "Effect: X (Worn)".
- Both tabs filter to **your classes or all classes**, follow the era buttons, and show each item's classes.
- An exaltation must share a class with the item it goes in; an SK exaltation in a monk weapon is no use to anyone.
- Procs that land only on undead or summoned creatures are listed but not valued.

### Eras and races

- **Crafted items take their ingredients' eras.** An item with no era of its own is out of era if anything it's made from is, such as a mold from the Epics era. The recipe book now records every ingredient's era and reads recipes laid out one ingredient a line. It downloads again once, in the background.
- **Dwarven cultural plate** is for dwarves, halflings, gnomes and frogloks only, although eqlwiki says any race can wear it.

## 1.8.0 (2026-09-27)

### Worn effects and procs

Gear's worn effects and combat procs now count, on a new **Worn effects & procs** tab and in the upgrade finder and the optimizer.

- **Valued against your own melee.** Each is worth the damage a minute it adds to your melee, read from your log over the last 7, 14 or 30 days (or all of it), as a share of the melee damage you do now. 1% more is worth your role's Weapon damage (1%) weight, so effects sit on the same scale as stats.
- **Worn effects** work in any slot and count once however many pieces carry one. Unrighteous Bash (Torrid Corruptor) is worth its +15 on each bash plus the extra bashes from a shorter cooldown, with bash counted no more often than its cooldown allows. So a Torrid Corruptor in an Any slot now earns its keep.
- **Procs** fire only from a weapon in your hands. The rate is your log's when you have fired the proc, else EQEmu's (2 a minute, raised a little by DEX). The damage is your log's or the spell file's; a proc that lasts counts no more than kept up the whole time, since a new firing refreshes it.
- Stuns, debuffs, buffs and bashing with a two-hander are listed but not valued yet.

### Exaltations and pet gear

- **Worn and proc exaltations** (slots 9 and 10) bring their item's worn effect and proc in place of the host's, the way focus exaltations already did.
- **Exaltations kept in Storage › Exaltations** are tried in the focus, worn and proc slots of your pieces of the same kind, and only ones your classes may use.
- **Gear on your pet** counts as yours: the optimizer suggests taking a pet's piece when it is an upgrade for you. The log's pet list names no exaltations, so those pieces count without them.
- The optimizer no longer swaps two pieces for nothing, or shows an earring moving from one ear to the other.

### Fixes

- **Damage meter:** another player's hits and misses with one skill ("slashes" and "tries to slash") are now one row, not two with one at 0% landed.
- **Pet gear:** a pet holding a two-hander is no longer given a shield, even one that also fits the Back slot.

## 1.7.2 (2026-09-27)

### Gear: weapon ratio weighed as damage, Storage gear, and the finder agreeing with the optimizer

- **Weapon ratio is weighed per 1% more damage from the hand.** It used to be weighed per whole point of ratio, so a weapon with a bit more STR could beat one doing half again the damage. The weight is now called **Weapon damage (1%)**, as on the pet planner: Melee 12, Balanced 6, Tank 3 (1% of melee damage is about 6 Offense). Saved Custom weights are converted so they keep their place against Melee. **Ranged damage (1%)** covers the Range slot.
- **Storage › Equipment counts as gear you own.** The optimizer and the upgrade finder now weigh the gear you keep in Storage, and can suggest taking a piece out to wear.
- **Items you own are judged as your copy.** On "At your merge level" the finder used to score an item you own at the level of what you wear, and add it as an extra copy. It now uses your best copy at its own merge level, and in the round credits it with what the optimizer's set loses without it, so the finder and the optimizer agree.
- The Gear page's key ring list is now called **Storage**, with each tab named as the game names it (Equipment, Exaltations, Activated Items).

## 1.7.1 (2026-09-27)

### Fix: focus exaltations replace the item's own focus

- An item's **Focus Exaltation** now takes the place of the item's own focus, the way the game's item window shows it. Before, both were counted, so an exalted Djarn's Amethyst Ring still showed as your Spell Haste II even though its focus had become the exaltation's Extended Range II.
- **Click, Worn and Proc exaltations** bring no focus.
- Ordinary augments still add their focus to the item's.

## 1.7.0 (2026-09-27)

### Gear: one haste item, and weapon ratio in the hands only

- **One haste item is enough.** Haste does not stack, and the optimizer now plans for that: it tries each haste item you own as the one you wear, and keeps whichever leaves the rest of the set best. It can now move your haste from your gloves to a belt so better gloves can go on, a trade it could not find one piece at a time.
- **Weapon ratio counts in Primary and Secondary only.** A new **Ranged ratio** weight covers the Range slot, and it is 0 in every preset, so a melee can value weapon ratio highly and still get stats in the Range slot. Raise Ranged ratio under Custom weights if you want a good bow or throwing weapon there.
- **Upgrades judged in the round** now start from the best arrangement of what you already own, so a candidate is credited only with what it adds.
- The optimizer is also a little faster than before.
- Merge values weigh each item as its slot does, so merging a bow in the Range slot no longer counts weapon ratio.

### Also

- **Damage meter:** charmed pets are followed from the charm spell's own landing line, so Cajole Undead pets (" moans.") are tracked, and a heal cast in between no longer takes the pet.

## 1.6.1 (2026-09-26)

### Spell upgrades, sorted out

Follow-ups to the Spell upgrades tab from 1.6.0.

- **Transport and Misc sections.** The spell file marks a gate or a cure beneficial with no duration, the same as a heal, so gates, ports, rings, circles and binds were filed under Heal with a healing bonus they cannot get. Sections now go by effects too: anything that moves you is **Transport**; bind affinity and a "heal" that heals nothing (cures, summoned items, resurrection) are **Misc**. Neither is in the guide's table, so they get only the cast and mana cuts.
- **Your trio.** A toggle on its own row keeps only spells one of your current classes has at its level (what `/who` last said, else the character sheet; never over the level cap of 50). A spell a Necromancer gets at 39 is not the Shadow Knight's until 49, so it is left out until then. **Every class you have cast as** shows everything in the window.
- **Ignore.** Each row has an Ignore button for a spell you will never put motes into; "Show ignored" lists them faint with a Restore button. Kept per character on this machine.

## 1.6.0 (2026-09-26)

### Spell upgrades: which spells to put motes into

The Motes page has a third tab, **Spell upgrades**. It looks at every spell and song you cast over the last 7, 14 or 30 days of play (or all your logs) and scores the next rank of each, so the best value per upgrade comes first.

- **The rules.** A spell at rank N needs 2^N xp for the next rank, and on a spell every mote counts its xp whatever the rank (Infinitesimal 1, Minor 1, Lesser 2, Potential 4, Major 5 … Infinite 10). There is no tier limit as on items, so the low ranks no item of yours can use any more are worth their full xp here.
- **What a rank gives** comes from the community's EQL spell upgrade (mote) guide, by category: nukes and lifetaps −2% cast, −2% mana, +6% damage; DoTs −4% cast, −2% mana, +5% duration, +3% per tick; heals about +3% healing; debuffs, charms, mezzes and buffs −4% cast, −4% mana, +10% duration; pet summons +1 pet level. Every rank also takes −2% recovery and reuse. Duration bonuses use your Spell Timers' per-rank table.
- **Worth** is casts × points per cast, where a point is one cast made one percent better, weighed the way you choose (damage and healing, duration, mana, cast time, recovery and reuse, a level). Order by worth per xp, worth, or casts; filter by the guide's sections.
- **Pay with** lists the cheapest motes in your stock for the step, lowest rank first, since each rank's combine value doubles while its xp barely grows.
- Spells at rank X are listed last with nothing to plan. Potions, clickies and abilities granted outside the spell book are left out.

### Also

- Spells now carry their mana cost from the spell file.

## 1.5.0 (2026-09-26)

### Gear

- **Upgrade finder judges in the round.** Each candidate is added to everything you own and the optimizer wears the lot as well as it can around it. The gain shown is what the whole set gains, so a belt that pushes your focus belt into a free Any slot loses no focus, and lore twins and two-handers are caught. Cards say where the item lands and what else moves. "This slot only" gives the old one-slot answer.
- **Best merge tab.** The next +1 of each worn item, ranked by stat gain per mote value. Each step is costed by the mote its level takes, with what your stock can make; Plan sends the item to the Motes planner. A warning shows when gear was looted after your inventory export.
- **Enough rank for a focus.** On the Focus effects tab, pick a rank that is enough for you; stronger ranks then count for no more, so the finder and optimizer stop chasing the best.

### Buffs

- The missing-buffs reminder is on-screen text only; it is never spoken.
- Buffs stay off the overlays unless **Buffs from my group** is on (Buffs page or Settings › Spell tracking). It is off by default.
- Accepting a group invite puts the inviter in your group: the game prints no join line for them, so the invite line is used.
- **Reset group** on the Live and Buffs pages, for when the log missed a change.

### Timers

- Potions and clickies get no focus: Elixir of Clarity VI is its 30 minutes whatever you wear or have trained.

### Motes

- Click a run's type to mark it a dungeon crawl. The game tells only the instance owner that a crawl was completed, so runs in someone else's instance need marking. Marks survive rescans.

### Fixes

- The damage meter overlay's fight picker opens now (an in-window menu; the old native dropdown needed focus, which overlays never take).
- Copy buttons on the Live page work again.
- "Your group has been disbanded." now empties the group.

## 1.4.0 (2026-09-25)

### Buffs: the game's real stacking rules, your own buffs, and every permanent buff worth keeping up

**Stacking, as the game does it.** The best combination now follows the client's own rules (the ones EQEmu reproduces): a buff with the same effect in the same slot is blocked when weaker and replaces the old one otherwise; the block/overwrite commands honour their thresholds at the caster's level; effects the game ignores in stacking (levitate, see invisible, "HP when cast", focus limits) never clash; a DoT blocks regeneration. Order matters and the plan says so: a level-50 Strength stays on under Harnessing of Spirit, but only when Harnessing lands second ("Harnessing of Spirit (after Strength)"). A buff on you that blocks a chosen one is called out to click off first. Verified against every "did not take hold" pair in a real log since the August spell data.

**Your own buffs.** Self-only buffs are listed (marked *self*), and whatever your own classes can cast is yours to keep up, group or no group: the reminder says "Cast Rage; ask Brenna for Temperance". With no group, the best combination is what you can cast yourself. The tracker learns your classes from your own /who line (or the character sheet). A permanent self buff is spoken once per run.

**Every permanent buff that helps.** New *Procs* line for the combat innates (Vampiric Embrace, Divine Might, Instrument of Nife, Scream of Death, Call of Sky) and the rogue poisons, each labelled with the strike it procs; new *Other* line for Breath of the Dead, Hawk Eye and Form of the Great Wolf. Vision buffs are left out. Wards (Ward/Guard of Vie, Alendar, Calrena) and the heal-per-hit blessings (Blessing of the Page line) are offered too.

**Fixes.** Rune I to IV are four enchanter spells, no longer merged into one. Every offered buff was checked against the eqlwiki's era tags: all Classic, all in game. The "Left out" list in the best combination starts collapsed.

## 1.3.0 (2026-09-25)

Legends Tracker 1.3.0. Download `Legends-Tracker-Setup-1.3.0.exe` below; installed copies update themselves.

### New

- **Buffs: the best combination that stacks.** The tracker now works out the set of buffs worth the most that can all be on you at once, from the ones you pick that your group can cast and what is on you already, and asks for what is missing — saying what each would replace. Stacking follows the game's own spell file: two buffs with the same effect in the same slot do not stack, and some block others outright. With a shaman, that is Infusion of Spirit with Strength, Stamina, Dexterity and Agility over Harnessing of Spirit; with a cleric and a paladin, the cleric's Temperance; with only a paladin, the Symbol. The Buffs page shows the combination with your group or with anyone, and what was left out and why. Buffs are valued from their real effects at level 50 (Protection of Nature is +250 HP and +55 AC).
- **Microsoft neural voices.** On the Audio page, paste your own Azure Speech key (the free tier is plenty) and pick from Microsoft's neural voices — Jenny, Aria, Guy and hundreds more. Each phrase is fetched once and kept on your PC; if Azure cannot be reached, the Windows voice speaks instead. The key is stored encrypted and only ever sent to Azure.
- **Charm pets on the damage meter can be turned off** (a "Charm pets" checkbox beside "Pets with owners"). A new charm ends the charmer's last one, two people charming mobs of the same name share a pet row instead of one taking the other's, and a charmed pet's "Attacking" tell no longer makes every mob of its name your pet.

### Also in this release

- The installed app now uses the same Windows identity as its shortcuts, so notifications and pinning line up.

## 1.2.1 (2026-09-25)

Legends Tracker 1.2.1. Download `Legends-Tracker-Setup-1.2.1.exe` below; installed copies update themselves.

**If you installed 1.2.0:** it stops at start with "Cannot find module './src/koffi/index.cjs'" and cannot update itself. Install 1.2.1 over it from the download below; your settings and data are kept. 1.2.0 has been withdrawn.

### New

- **Buffs page**: who in your group can buff you with what, and when to ask. Classes come from `/who` (type `/who <name>` for anyone it doesn't know yet). Buffs others land on you are followed until they fade, shown on the Buffs overlay, and a spoken warning comes a minute before one runs out. When a groupmate could give you a buff you want and don't have, it says whom to ask for what — never mid-fight, and at most every ten minutes. Pick the buffs you want from each class's list; out of the box it is each class's best HP & AC, haste, spell haste and mana regen. Songs and buffs under five minutes are left out.
- **Tradeskills page**: star the recipes you make (Distillate of Clarity, Elixir of Greater Concentration, Celestial Healing…) and see each ingredient, how many you have (bags, bank and the tradeskill depot), what to buy, where to get it (vendors, or where it drops, is foraged or crafted), and what a batch costs. Prices are what your log shows you paying last, else the wiki's merchant value, or one you type in. Recipes come from eqlwiki (a one-minute download, refreshed weekly); every recipe and ingredient links to EQ Traders Corner.
- **Pet gear** (Gear › Pet): the best items you own for your pet, within the slots your classes give it. The pet's classes, level and base melee come from its eqlwiki page; what it wears now comes from `/pet inventory check`. Weapons are judged by the melee they give the pet under the Pet Guide's rules.
- **Respawns page**: how long each mob you kill takes to come back, measured from the log, and a one-click timer that starts at every kill of it and counts down on the new Respawns overlay.
- **Charm pets on the damage meter**: a mob charmed by you or a groupmate is that player's pet, apart from other mobs of its name, until it turns on the group or dies.
- **New icon**.

### Also in this release

- Speech uses Windows' newer voices too: anything added under Settings › Time & language › Speech › Manage voices shows up on the Audio page after a restart.
- Loot: sessions fold, folded to start with.
- The inventory export's tradeskill depot is read.

## 1.1.0 (2026-09-25)

Legends Tracker 1.1.0. Download `Legends-Tracker-Setup-1.1.0.exe` below; installed copies update themselves.

### New

- **Damage meter**, its own page under Play and a floating overlay. Fights open on the first blow and close on the last kill or after an idle gap; sessions per zone or on New session. Damage, Incoming and Healing views for everyone, your group or just you, with drilldowns into skills, targets and attackers, your defence rates, damage by mob, a DPS-over-time chart, active DPS, and copy-as-text. Pets are claimed from the log and can fold into their owner. The overlay's header shows its controls on hover and a pin unlocks its rows. The last hour of the log is read in on start.
- **Procs card** on the meter: every effect that fired without a cast line, with firings per minute of active combat time; abilities you press and Finishing Blow swings are marked.
- **Loot page**: everything looted, by session, with coin from corpses and sales, what auto-loot did with each item, and what the item is for from its eqlwiki page (slot and stats, or notes, quests, recipes and merchant value), with links to eqlwiki and Allakhazam.
- **Updates** are checked every hour, and a Windows notification announces a new version when it is found and again, clickable to restart, when it has downloaded.
- `Restart Legends Tracker.cmd` for running from source, and a `--quit` request a running copy answers by shutting down cleanly.

### Also in this release

- Gear: focus effects judged on the spells you actually cast; the upgrade finder weighs stats for your character and era; Any slots take any gear; an optimizer for what you own.
- Stats: attack line (Offense and Accuracy), character sheet read from the in-game window, skill caps from the game's own tables.
- Achievements and inventory read straight from the game's export files.
- Motes: per-day and per-run counts, an upgrade planner, counts read from the currency window.
- Engine: fixes to log parsing, triggers and the archiver; logging to the app's log folder; crash handlers; input validation on every IPC channel; many more tests.
- Lint with oxlint in CI.

## 1.0.0 (2026-09-24)
