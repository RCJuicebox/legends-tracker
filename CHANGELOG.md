# Changelog

What changed in each version. The release workflow publishes a version's section as its release notes, and installed copies show them when an update arrives.

## Unreleased

- **The Standings tab shows what NPCs really con you at.** A standing's con word came from the raw standing alone; it is now the standing with your race's, your deity's and the best of your three classes' modifiers from the game's own table, as NPCs see it, and hovering a standing shows the sum ("NPCs con 100, Amiably: Wood Elf +50, Bard +50, the best of Monk, Enchanter and Bard, Agnostic 0"). The best class counts whichever it is, main or not: a Monk/Bard/Enchanter cons Neriak's Dreadguard Inner at 2000 as an Ally, where the Monk's −300 alone would be Warmly. The standing itself stays the raw one the achievements count. Tested in play: Tunare's Scouts at 0 conned −950 Scowling for an Iksar of Cazic Thule, −750 Threatening for an Agnostic Iksar, −100 Apprehensive for a Wood Elf of Cazic Thule and 100 Amiably for an Agnostic Wood Elf, each exactly as worked out, and three of them right on a band's edge.
- **Deity on the Stats page.** /who does not show it, so it is set there: Agnostic or one of the sixteen gods, as Loadouts names them. None set counts as Agnostic. Kerran, Froglok and Drakkin now con with their own race's modifiers too.
- **Agnostic.** The Plan tab plans every character as Agnostic, the deity with no faction modifiers: renouncing your faith is the first step for anyone working on factions. A character with another deity, or none set, is told so at the top, with whether its achievements export has Agnostic unlocked and, if not, how: eqlwiki's Renouncing Your Faith (level 46 and up: the Emissary of Zebuxoruk in the Oasis of Marr, then Cazic Thule in the Plane of Fear and Innoruuk in the Plane of Hate).
- **Race swaps for gated quests.** When a quest's NPC will not take your hand-in at your race's con, but another race you have unlocked would be there (as an Agnostic), the Plan tab can plan that step as that race: swap in Loadouts, do it, swap back. It does so only where it beats the other ways, counting about 5 minutes for the swap (set in Assumptions, where swaps can be switched off). The step says which race and why ("Swap to Human in Loadouts for this step, then back: as a Wood Elf, it needs Amiable with Bloodsabers; you con Indifferent (4), 96 short"), so does the Now card, and the summary shows what the swaps save.
- **From play: Dismal Rage and The Spurned.** Cyclops eyes do not drop in the classic zones, so Xelha's Cyclops Eye is no longer planned. Dismal Rage is planned on Message Intercept the evil way: a Bottle of Milk to Mojax Hikspin in West Commonlands, the note off \*Duggin Scumber, and the note to Raltur Caliskon in East Freeport, who wants you Amiable with Dismal Rage. That is +19 Dismal Rage a round, at about 20 seconds, the pace a log shows for the same round the good way. The Spurned is planned on the hail-and-deliver step of Innoruuk Disciple: "I will assist you" to Wallin Slyfoot in West Commonlands for a note, handed to Draxiz N\`Ryt in Neriak Commons for +10. The note is lore, so it is one a round trip, counted as 3 minutes; set your own pace on it. Draxiz eats the note below Dubious with The Spurned, faking or not, so a race that cons lower is told to swap for the step, to the race that cons best first (a Dark Elf).
- **Merchants of Erudin without Peace Keepers.** Small Lanterns to Jyle Windshot in West Freeport's Hogcallers' Inn (at Indifferent or better with Faydarks Champions, four to a trade) give Wooden Shards back, a Wooden Heart now and then; Wooden Shards to Emil Parsini in the hut outside Erudin, a whole stack at once, give Merchants of Erudin +5 and High Council of Erudin +5 a shard (from play), High Guard of Erudin too, and a Treant Resin back. Planned at a lantern a hand-in; Jyle's amounts are guessed (+5) until a log shows them below the cap. No merchant in West Freeport sells the lanterns; the nearest is Innkeep Palola in North Freeport.
- **A race swap names the race that cons best** at what the quest wants, among those that would do, or the race you are already swapped to for the step before.
- **The plan sees a quest open as you get there.** A quest whose NPC wants a con you are not at yet used to be left out until you were. Now the plan checks what each NPC wants against the standing it will have at that point, with your race's and classes' modifiers as an Agnostic, so a quest opens once earlier steps have raised that faction far enough. A race or class change, or a race unlocked, plans the order again by itself.
- **Steps that open a quicker way.** The plan may add a step that raises a faction just far enough for a quicker quest's NPC to take it, then do that quest. The step says **opens a way** and what it opens, and the Now card and the achievements overlay count it down to that standing. For one character, Miners Guild 628 went from 400 kills in North Kaladim (about 17 hours) to 12 kills there, then Ogre Heads to Mater for Miners Pick as a Dwarf (about 4½ hours in all). The catalog now also finds ways to raise a faction a quest wants more of than you con, where that quest raises an achievement.
- **Race unlocks.** Each race unlock wants three of the race's factions maxed, as the game's own achievement files list them; the achievements export says which you have done, faction by faction. The Plan tab counts the race unlocks still to do as achievements too, lists them with the step that does each, and from that step on may swap to that race for a quest. Half Elf's comes with Human's or Wood Elf's; Kerran's is a task, so it is not planned. **Race unlocks first**, a switch at the top of the tab, does them before the rest: each unlock done sooner counts as time saved, so the plan still does what is quick on the way. With it on, a character with Human's Freeport unlock to do raises Dismal Rage to Amiable, does Raltur's notes until Dismal Rage is done (Knights of Truth +7 each on the way), then Sir Lucan's for the unlock, rather than all of Sir Lucan's first and Dismal Rage raised back up from below zero after.
- **Message Intercept the good way.** A Bottle of Milk to Mojax Hikspin, \*Duggin Scumber's note to Sir Lucan D\`Lere in West Freeport: The Freeport Militia +22, Knights of Truth +8, Priests of Marr +8, Steel Warriors +5 and Coalition of Tradefolk Underground +4 a round, from a log's 96 rounds. Your log's \*Duggin kills and notes to Sir Lucan are parts of the round now, not ways of their own.
- **Fixed: a hand-in's items when they go into the trade window one at a time.** Two Rusty Daggers put in one by one and two Gold to Tylfon were counted as one dagger a hand-in, the last thing put in; and a trade begun a second after the NPC answered took that answer for its own. What goes into one trade is now counted together, so Tunare Scouts Dagger reads 2 Rusty Daggers and 2 Gold a hand-in, as in play (400 hand-ins, 819 daggers and 814 gold from 0 to 2000). The walkthrough's Tunare Scouts Dagger is +5 a hand-in, not Allakhazam's +1, and wants the 2 Gold too: it had planned 2,000 hand-ins and 4,000 daggers. The logs are read again once for this.
- **Priests of Innoruuk by Saxarivza Zaxun's note.** "I am devoted to Innoruuk" to Saxarivza Zaxun under East Freeport (at any con, from above ground over her at -93, -175) gets a note for her brother Perrir Zexus in Neriak Third Gate: +200 Priests of Innoruuk, and -800 Primordial Malice. Perrir wants better than Threatening, which sneak or invisibility for the trade fakes. Planned as one note a round trip of about 10 minutes until play says whether she gives more than one; set your own pace on it if she does.
- **Fixed:** the Leatherfoot Raider Skullcap to Perrir was counted as -840 Primordial Malice, Allakhazam's figure for the whole quest (the note step's); the skullcap raises it. An amount a site gives for a whole quest now goes only on a step moving the same way. And items a quest round comes by on the way (the note from an NPC) no longer count the bags: 41 other Notes were being taken for ones on hand.
- **The achievements overlay says plainly what is now and what is next.** The step being worked on is its own block, tagged **Now · step 17** in the accent colour with a bar down its side, saying what to do in so many words ("Message Intercept: hand in to Raltur Caliskon", wrapped rather than cut short), with its progress and what is left. The step after it is a block of its own below, greyed and tagged **Next · step 18**, with its zone ("here too" when it is the same one), or **Last step of the plan**. The header counts the steps done. The Now card on the Plan tab gives the next step's number too.
- **Pick the step you are on.** The Now card and the achievements overlay follow the step your kills and hand-ins go toward, else the one you were on, else the first one left in your zone. Now **Work on this** on any step of the plan, or **Back to step 1** on the Now card, makes that the step followed, counted from there, until your kills or hand-ins go toward another.
- **Fixed: a new achievements export could bring back race unlocks you have done.** An export can list only what is still open (the achievements window decides), and a race unlock it left out was taken for not known, so the plan went back to maxing their factions and the Now card jumped ahead. One left out is done now, as with the faction achievements; the same for Agnostic.
- **A quest round's step says the whole round.** A Message Intercept step read "Hand in to Raltur Caliskon" with the milk under it, as if Raltur took the milk. It is now the quest's step ("Message Intercept — hand in to Raltur Caliskon"), with the round's walkthrough line, and each item says who takes it ("51 Bottle of Milk to Mojax Hikspin"). The same goes for the Small Lanterns to Jyle Windshot, and any quest step shows its walkthrough line.
- **Song Weavers is planned.** A hand-in your log saw only once or twice counted as a quest's one-time reward, even where the walkthrough makes it a repeatable quest, and the walkthrough's own step was dropped for the log's. Now the walkthrough's word stands, and so does what its NPC wants: Sylia Windlehands' Spiderling Silks in Greater Faydark (4 Spiderling Silk for +5) repeats, and she takes them only at Amiable with Song Weavers (from play: nothing at Indifferent, then taken five minutes later at Amiable after a class change).
- **Fixed:** Miner's Cap wants the lore Scrap Metal Cleaner VII drops in North Kaladim, one a kill, not the rogue clockworks' of Steamfont that eqlwiki's item page lists with it. Miners Pick shows the 300 Gold Mater wants with each Ogre Head.
- The plan's search spends its time better: a quest is moved together with the step that opens it, and a new step is tried where it shares a zone with its neighbours. A plan of all 83 faction achievements takes about a third of a second.
- **Fixed: no focus ring on buttons.** Tabbing to a button, tab or sidebar item showed no outline since 2.0.0; it does again.
- **Fixed: a settings file another program held at start was set aside.** A virus scanner or backup tool holding `settings.json` for a moment made the app rename it and start on defaults. The read is now tried again, and a file that still cannot be opened is left as it is and not written over; the Live page says so.
- **Fixed: a damaged mote file could stop the app starting.** `motes.json`, `casts.json` and `mote-stock.json` are checked as they are read: a mote history of the wrong shape is rebuilt from the logs and bad entries are dropped. A failure while starting now closes the app with a message, where it could leave it running with no window.
- **Fixed: a DoT's recast cue came 6 seconds late when its first tick was a critical hit.** A resisted cast ("a ratman warrior resisted your Envenomed Bolt X!") now clears the cast and says so in the feed; a weapon's proc resisted is not worth saying, and is not.
- **Fixed: a lifetap proc showed as two procs**, one from its damage line (with the rank) and one from its heal line (without).
- **Factions: "Give [[Item]] to [[NPC]]" is read the right way round.** Walkthroughs written that way (Kobold Killing) had the item and the NPC swapped and were never planned, and a zone after the NPC ("… in Kaladim") was taken for an item. Faction and quest pages are read from eqlwiki again once.
- **Factions: an export that shows completed achievements but no Progression section is not "all done".** The standings decide instead; the same for race unlocks. An export of open achievements only still counts what it leaves out as done.
- **Allakhazam: a page not laid out as the site's faction pages is not kept.** It was kept for a month as a faction with nothing on it; now Data Sources says so and it is tried again the next day.
- **Data Sources: Icons and Faction pages turn OK** once they are read, the copy kept on disk included.
- **The sidebar scrolls** at a large UI size on a short screen, the watch footer staying in view.
- **Paths in the settings are checked.** The watched log must be a character log (`eqlog_…txt`) and the game folder must hold the game's spell data; Open archive folder opens only a folder.
- **Light theme: accent text and the damage meter's colours are darker**, so small text reads at 4.5:1 or better on every background.
- **Meter: a lifetap's ticks heal you.** Harm Touch's ticks print as the enemy healing you ("Innoruuk, the Prince of Hate healed you for 451 hit points by Leech Touch I.") and were dropped; they now count as your own heals, in the Healing tab and on the ability's row.
- **Meter: a DoT whose caster is gone no longer makes an enemy of its spell.** "Jobarab has taken 30 damage by Deadly Poison." booked an enemy called Deadly Poison that never died and could name the fight; the damage now goes to whoever took it, and "You have taken 30 damage by Deadly Poison." counts in Incoming.
- **Meter: a beastlord's warder is its owner's pet from its first blow**, not an enemy until `/pet who leader`; its damage counts and its death opens no respawn timer.
- **Meter: deaths are your side's and the fight's**, not every player who dies somewhere in the zone. A pet folded into its owner's row folds into Active DPS too.
- **Spell timers: a spell another overwrote ends its timer** ("Your Envenomed Bolt spell on X has been overwritten."), with no recast cue for a spell that is gone; a detrimental spell that "did not take hold" on its target stops waiting to land.
- **Factions: a plan searched again keeps the step you are on.** New ways read from Allakhazam (a page every twenty seconds) reshuffled the plan and reset the Now card's progress; the plan is searched again only when the ways themselves change or you change the kill pace, and the step worked on keeps its place and progress wherever it lands in the new order.
- **Factions: a second character's Allakhazam pages come first** once it is picked, rather than after hours of the first character's; the pages read are written every ten, not after each.
- **Factions: a groupmate talking as a faction changes is not taken for the NPC** of a hand-in; a one-word NPC counts once you have offered it something in the zone.
- **Overlays follow your monitors.** Plugging a monitor in or out, or changing its resolution or scaling, places the overlays again; before, they stayed where the old layout put them until the next settings change.
- **A window that keeps crashing is left closed** after three tries in five minutes, with a word in the Live feed, instead of being made again every second. A page that cannot be loaded at all (a damaged install) is logged, and the main window's says so on screen.
- **An unexpected error's message no longer stops the app** while it waits to be closed: timers, speech and overlays carry on behind it.
- **Copy diagnostics says more**: each data source's state and last error, every monitor and its scaling, speech and Azure, hotkeys another program holds, the character record, triggers that would not compile, the spell file's date and the settings schema.
- **Less work while you play.** The log history cache (half a megabyte) was compared and written after nearly every read, every few seconds with the Factions or Tradeskills page open; it is now written a minute and a half after a change and at quit. The achievements counts are read every half minute only while the overlay, a followed plan or a page shows them. The melee counts skip every line that is not yours without parsing it.
- **The Plan tab no longer freezes while it plans.** The plan is worked out in the background and shows when it is ready. The Factions page finds your exports without listing the whole game folder every ten seconds, and overlays redraw only what changed.
- **Times, days and percentages read the same on every page.** A timer is `4:05`, a length of time "3 h 20 min", a day "Fri, Sep 25", and ages ("3m ago") keep up while a page stays open. Waits and errors look the same everywhere and are read out by screen readers; web data is **Refreshed** and a log is **Read again** (Motes' "Rebuild from logs" is now "Read the logs again").
- **Fixed: Data Sources said "No character log chosen"** before watching started, when one was.
- **Buffs says the cast order once**, above the best combination ("Strength, then Harnessing of Spirit"), instead of "after …" on every row and in every ask; your classes read in your own order, as on every other page.
- **Upgrades' tables fit.** Best merge keeps item names to a line or two and names motes by rank ("4 × Major"); Spell upgrades scrolls within its card instead of pushing the page sideways.
- **Asks before it cannot be undone**: removing a respawn timer and archiving a log now ask first; removing a stance or a group member and "All capped" on Skills can be undone.
- **Which character a page shows.** Stats, Gear, Achievements, Factions, Tradeskills and Upgrades show the character picked there, which may not be the one you are playing: each names it, says "not the one playing" when so, and has **Back to** the one you play. Spell Timers' **Edit classes and levels** opens Stats on the character being played. Best merge on Upgrades has the character picker and Refresh item stats again.
- **Slayer counts a skeletal wolf as a wolf**, once, not as a skeleton too (a word that describes gives way to the one that names), and never counts a player your side killed.
- **Buffs reads /who lines of players away, linkdead or with a surname.**
- **Factions: a log archived and begun afresh is read from its start** for the changes since your export, even once it has grown past where the old one ended; and a game folder with no achievement list says so instead of "every faction achievement is done".
- **The app's log (main.log) reads in your own time**, with its offset from UTC, so its lines match the game's log by eye; a line repeated many times is written once with a count, and two old logs are kept. A speech engine that stops working shows on Data Sources.
- **Fixed: when the log you watch is not in the game's Logs folder**, the pages that read your history (Gear, Spell upgrades, Tradeskills, Factions) now read that log too.
- **Reading the screen leaves nothing behind**: the enlarged picture it reads goes in the app's own cache folder and is removed whatever happens.
- **Names that say what they are.** Factions' Optimize tab is now **Plan**; Stats' Character tab, which reads the game's Stats window off the screen, is **Stats window**, under a card headed Character; the meter's Overall is **Session** everywhere; the group-buffs switch has one name on Buffs and Settings.
- **Small things that read better**: the sidebar says "Watching; no line yet" rather than "Last line never"; Respawns with nothing to show says what each switch hides, with a button to show it; an Azure voice without a key says the Windows voice speaks meanwhile; Achievements opens on General; saving a spell's settings says so; a screen read's result stands out; toasts wait while the pointer is on them, and ticking off several achievements at once gives one toast; timer bars step with the clock when Windows is set to show fewer animations; every filter box clears with Escape.
- **Pages say what they share.** Spell Timers' Rank bonuses and Upgrades › Spell upgrades go by the same numbers, and each now says so with a link to the other. Upgrades says your motes on hand are kept in the Merge planner (typed in, read from the screen, or added as you loot them), with a link. Loot has its own **New session**: its sessions are the damage meter's, so it starts one there too. Links within a sentence read as links, in the accent colour, rather than breaking the line.
- **One look for a page's tabs.** Gear and Factions switched views with a segmented switch where Stats and Upgrades had tabs. All four have tabs now, and a segmented switch is always a choice within the page.
- **Overlays: Done on the overlays themselves.** While arranging, each overlay's label has a **Done** button, so you need not go back to the app to finish.
- **Overlays: the background slider fades the panel, not the text.** An overlay's opacity used to fade its text and bars along with the dark panel behind them, and stopped at 20%. It now fades the panel alone, all the way to none, and the text and bars stay as they are. The alerts, which are text alone, still fade as a whole.
- **Overlays: the achievements overlay says it is on.** Shown with nothing tracked, it drew nothing and looked broken. It now says, in one faint line, what it is waiting for.
- **Overlays: laid out without overlapping.** A first install lays the overlays out on your main monitor with none over another, down to a 1280 × 720 screen: the alerts had sat over the buffs on a 1080p screen. The shipped positions fit a 1080p screen (they sat off its right edge), and an overlay added on the Overlays page steps clear of one already there instead of landing on it.
- **Plainer words.** Stats' fields say "%" and "spells and songs on you" rather than spell-effect numbers (still there on hover), and "8900 as a rule" for crit difficulty. Motes says "worth 1,234 Infinitesimal motes" rather than "Infinitesimal-equivalent". The long explanations on Factions, the Plan tab and Buffs are split into short parts with a bold lead each, and Factions lists the con bands as a table rather than a sentence. Pages that still named the old Inventory page, Motes upgrade planner and Focus effects tab name Gear, Upgrades › Merge planner and Focus items.
- **Starting to watch reads less of the log.** Finding where the last few minutes of a log begin meant reading back through it a megabyte at a time, and through all of it when the time asked for was older than the log (which grows to 300 MB before it is archived). It now takes a few dozen small reads. The fights read back at start also name their zone when you entered it long before.
- **Factions: the plan's time left counts what is left.** "About N of steps left" added up every step as planned. A step whose faction has come on since now counts at what it still wants. A hand-in that moves several factions makes its own step the Now step, rather than the first step wanting any of them, and on a tie the step you were on stays. A faction the export does not list counts down from what the log moves it. A step that brings a faction back from below zero is no longer ticked off before the steps that lower it.

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
