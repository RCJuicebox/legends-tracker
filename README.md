# Legends Tracker

Spell timers and recast cues, overlays, triggers, mote and dungeon-crawl tracking, and log management
for **EverQuest Legends**, driven by the game's chat log and its own data files. Electron + TypeScript
+ React.

(Called EQL Audio Triggers until 2026-09-24; its settings carry over on first start.)

Read the log, play sound, draw overlays. No process memory reads, no injection, no input sent
to the game.

Windows only, like the game: it uses Windows' speech, OCR and window APIs.

## Installing

Run **`Legends-Tracker-Setup-<version>.exe`** from the GitHub Releases page. It installs in one step,
with no questions, for the current user (no admin prompt) into `%LOCALAPPDATA%\Programs\legends-tracker`, with Start menu and desktop
shortcuts and an uninstaller. The app lives in the tray; closing the window keeps the overlays and audio
running, and **Quit** is on the tray menu.

The installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC" the first
time: **More info → Run anyway**.

### Updates

The installed app checks GitHub Releases shortly after it starts and every hour after that (and
whenever **Check for updates** is pressed in Settings), downloads a newer version in the background,
and offers to restart into it: **Update ready: restart** in the title bar, **Restart to update to
<version>** on the tray menu, **Restart and update** in Settings. A Windows notification
says when a new version has been found and again, to click on, when it is ready to install; each is
said once per version. The update installs silently, with no installer window, and the app starts again
by itself; if you just quit instead, it installs on the way out. Settings live in `%APPDATA%\Legends Tracker`, outside the install folder, so
they survive updates and uninstalls.

### Releasing a new version

1. Bump `version` in `package.json` (e.g. 1.0.0 → 1.1.0) and commit. The updater only offers a higher
   version.
2. Run:

   ```bash
   npm run release
   ```

   It pushes the commit and its version tag. GitHub Actions (`.github/workflows/release.yml`) then builds
   the installer from that commit on a clean Windows machine, runs the type-check, lint and tests,
   creates the release as a draft, uploads the installer with `latest.yml` and its blockmap, checks
   all three arrived, and publishes. Every installed copy picks it up on its next check.
   `gh run watch` follows the build. GitHub now and then starts two runs for one tag: the second waits
   for the first, finds the version published and builds nothing.

Running the Release workflow by hand (Actions → Release → Run workflow) is a dry run: it builds the
installer and attaches it to the run, publishing nothing. Every push to `main` also runs
`npm run check`, which is the type-check, lint and tests, then a smoke test of the built app and
of a packaged copy (`ci.yml`).

`npm run dist` builds the installer into `dist\` without publishing anything.

## Running from source

Double-click **`Start Legends Tracker.cmd`** (after `npm install` and `npm run build`). A running copy
keeps the code it started with, so after a rebuild use **`Restart Legends Tracker.cmd`**: it asks the
running copy to quit (`electron . --quit`, which the copy answers by writing its settings and closing
its overlays), waits for it to go, and starts a fresh one.

```bash
npm install
```

```bash
npm run build
```

```bash
npm test
```

`npm run check` runs the type-check, lint, format check and tests together, as CI does. `npm run coverage`
runs the tests with coverage and fails when a folder falls below its floor in `vitest.config.ts`
(CI runs it too); `npm run bench` prints what each part of the engine costs a line. After
`npm run build`, `npm run smoke` starts the app on a throwaway profile with a tiny game folder, checks
its window answers and its mote worker reads a log, and quits it; `node scripts/smoke.mjs <path to the
exe>` does the same for a packaged copy. `npm run dev` runs with hot reload. Settings live in `%APPDATA%\Legends Tracker`; [Your data](#your-data) lists every file.
Setting `EQL_USER_DATA` to another folder runs against a separate profile.

The game formulas the app relies on, each with the reading that settled it, are in
[`docs/formulas.md`](docs/formulas.md); what changed in each version is in [`CHANGELOG.md`](CHANGELOG.md),
whose Unreleased section becomes the next release's notes.

### Measuring

Check memory and CPU with the game running and a fight or two on the meter, since an idle app
tells you little.

- **Settings › Copy diagnostics** lists every process with its memory (working set, as Task
  Manager counts it) and CPU: the main process, each window and overlay by name, and the GPU
  process. It also gives the main process's JavaScript heap.
- **The log** (`main.log` in the log folder) records the spell data's load on each start, for
  example `Spell data: 41472 spells in 250 ms; the heap grew 40 MB reading it`. That is the
  largest thing the app reads; about 23 MB of it stays once the garbage is collected (the 32,000
  spells no class gets by level 50 are left out). Every five
  minutes of fighting it also records the damage meter's push, what goes to the windows twice a
  second (`Meter push: 13 KB, 40 in the session, 10 fights kept`): the fight in hand and every
  fight's and session's totals. The open session goes whole only to a page showing it.
- **Task Manager**, Details tab, with the *Command line* column added: each `electron.exe` or
  `Legends Tracker.exe` is one of the processes above. Its `--type=renderer` processes are the
  windows.
- **Resource Monitor**, Disk tab, filtered to the app: shows the log being read and what is
  written. The history files (casts, motes, respawns, buffs) are written at most every 15
  seconds, not on every line.
- **A trace**: run from source with `--remote-debugging-port=9222`, open `chrome://inspect` in
  Chrome, and record a Performance profile of a window (the main one, or an overlay), or take a
  heap snapshot. For the main process, add `--inspect` and use the same page's Node target.
- **`npm run bench`** prints what each part of the engine costs a line, over the twenty minutes of
  real play in `tests/fixtures/golden-session.txt` (about 3 µs a line in all on 2026-09-30, two
  thirds of it the damage meter).
- **The log** also records, while fighting, the size of the damage meter's push every five minutes
  (`Meter push: 14 KB, 23 in the session…`), and any read or save of the log history cache that
  takes over a quarter of a second, with its size. A source run's Plan tab logs each faction
  plan's time to the window's console.

## Live

The first page. **Start watching** and **Stop watching** follow the character log chosen in
Settings; **Arrange overlays** and **Mute** sit beside them. Below:

- **Getting set up**, a checklist shown until every step is done or it is hidden: the game folder
  (so spells can be timed), the character log, your classes and levels (Stats), where sound plays
  (Audio) and where the overlays sit (Overlays). The last two can be marked fine as they are.
- A warning when the game is running but the watched log has had nothing new for five minutes:
  logging may be off (`/log on`), or another character is being played. When another character's
  log is being written while this one is quiet, a button follows that log instead.
- Status, character and zone, motes today (or in the instance run under way, with motes per hour)
  and the log's size, each a click from its page.
- **Fighting** (or **Last fight**) and **This session**: the fight's name, length, kills and DPS,
  yours among it; the session's fights, kills, deaths, coin and kills per hour. Both open the
  damage meter.
- Every buff, DoT and timer running, as the overlays show them, and **Activity**: timers started
  and faded, triggers fired, fights, loot, archives, notes and warnings, newest first.
- **Try log lines**: paste log lines to run them through the live tracker and triggers, with their times
  moved to now, or **Show demo timers** on the overlays.

## Damage meter

Its own page under Play, and a floating overlay of its own. Every combat line the game prints is
read into it: your melee, spells, DoT ticks and damage shields, your pet's, your group's, strangers
fighting near you, and everything hitting your side.

- **Fights and sessions.** A fight opens on the first blow between your side and an enemy and
  closes when the last enemy it engaged dies, or after ten seconds without a blow (Settings). The log
  names two of a kind alike, so a blow from or to another of that name in the next four seconds takes
  the fight up again: two haunted chests fought at once are one fight with two kills. It is
  named after the mob that took the most ("a fetid fiend +2"). A session is everything since you
  entered the zone, or pressed **New session**; the Session figures read from it. Both are picked
  from the same list, newest first, and the meter keeps showing the last fight until the next
  begins.
- **Damage, Incoming, Healing.** Damage lists who dealt what, with DPS over the fight, share, and
  active DPS (damage over the time actually spent striking, gaps between hits capped at 3 s). Click a
  row for its skills and spells: hits, crit rate, landed rate, resists, average and best hit, and
  the pet's lane when pets are folded into their owners. Incoming lists who hit your side, with
  **Your defence** (hit, miss, dodge, parry, block, riposte, absorb rates over the swings aimed at
  you) and damage taken per person. Healing lists healers with overheal, a click down to their
  spells and targets, runes and what enemies healed themselves for.
- **Damage by mob** shows where the damage went; click a mob to see who did what to it. **DPS over
  time** draws you, your pet, the rest of your side and incoming damage on a 6-second rolling
  average, for fights.
- **Procs** lists every effect that fired without being cast: a spell damage or direct heal line of
  yours (or your pet's, or a group-mate's) with no `You begin casting` line of theirs in the twenty
  seconds before it. Each row has its firings, their damage and healing (a lifetap's damage line and
  heal line are one firing), and firings per minute of that source's active combat time, withheld
  under ten seconds of it. Abilities you press print the same way (Reaving Strike, Harm Touch) and
  are marked as such; swings the game annotates `(Finishing Blow)` count as the AA, with the damage
  of the swings that procced. The same note sits on the skill rows in a drilldown.
- **Everyone, Group, You.** Whose rows are listed. Group members are learned from the log's
  join and leave lines and can be added by hand; a group-mate's pet joins them once it says
  `/pet who leader`. A single capitalised name is a stranger or a named mob until it hits or heals
  someone whose side is known, and is then remembered.
- **Pets.** Your own pet is yours from the first `<pet> told you, 'Attacking … Master.'`, and what
  it did before that line is re-attributed. A mob's pet is "<mob> pet".
- **Copy** puts the list on the clipboard as text, for chat.
- **On start**, the last hour of the log (Settings) is read into the meter before live lines, so the
  fights before the app opened are there; **Read the log again** rebuilds from scratch.

The meter overlay is a compact copy of the same list over the game, click-through like the others.
Hover its header for the controls: fight or session, what it lists, whose rows, a flag that starts a
new session, and a pin that unlocks the rows so a click opens their breakdown. The Overlays page
sets what each meter window shows; there can be several, say one for the fight and one for the
session.

The line shapes, the fight rules and the sums are pinned in `tests/combat.test.ts` with lines
copied from the log.

## Buffs

What your group can buff you with, what is on you now, and what to ask for. Classes come from `/who`
lines: Legends characters play three classes and change them, so each name keeps its newest. Type
`/who <name>` for a group-mate the tracker does not know yet (the feed says so, once each) and
`/who <your name>` for yourself; failing that, your own classes come from the Stats page. What each
class can cast, and at what level, comes from `spells_us.txt`, up to the level cap of 50.

A buff counts as on you from its "you feel…" line, matched to the cast just before it, until its
fade line or your death. Someone else's buff is timed at their `/who` level without their focus, so
its real end can come later; the fade line is what counts. With **Buffs from my group on the overlays** on
(here or in Settings), it gets a bar on the buffs overlay and a spoken "… is fading, ask
<caster>" a minute before its earliest end. Songs and buffs under five minutes are left out.

**Buffs you want** lists every class's buffs, the group's classes first, to pick from; by default
every HP and AC, haste, spell haste, mana regen, stat, proc and permanent utility buff worth
something. **Best combination** is the set of your picks worth the most that can all be on at once,
by the game's stacking rules worked out at the caster's level, and says when the order they land in
matters: **With your group** (what they and you can cast, and what is on you) or **With anyone**
(every class at level 50, to plan with). A buff is worth its HP, plus 2 a point of AC, 1.5 of STA
and 1 of other stats; CHA counts nothing, and buffs worth under 20 are not asked for. What is
missing from it is shown over the game when it changes and again every ten minutes while it holds,
never mid-fight and never spoken; a self-only buff your classes can cast reads "Cast …". The picks
are kept per character.

## Loot

Everything looted, newest first, grouped by the damage meter's sessions (a zone, or a New session
press), with the coin picked up from corpses and taken in sales per session. Auto-loot says what
became of each item and the page shows it: kept, merged into an item you own, sold (and for what),
stored in the tradeskill depot, or stored as currency (motes; hidden by default, the Motes page
counts them). A group-mate's loot line (`--Aldric has looted …--`) is listed under their name.

Each row says what the item is, from its eqlwiki page: equipment gets its slot, first stats and
classes; anything else gets the page's notes, the quests and recipes it is used in, and what
merchants pay. The name links to eqlwiki, and a second link searches Allakhazam. The lookup is the
Gear page's (cached a week, fetched only for items on screen); a page found under a different
spelling is missed and says so.

## Respawns

How long each mob you kill takes to come back, measured from the log. A kill opens a watch on that
name in that zone; the first line that names it again closes it: it hits or is hit, casts, speaks,
is considered, or is killed again. A mob can only be seen once it is back, so every gap is at least
its respawn time, and the shortest gap is the estimate. Leaving the zone ends every watch, since
what happened while you were away is unknown. A gap under 30 seconds means two mobs share the name;
those names are hidden unless **Shared names** is on. Each mob keeps its last 20 gaps, and the 400
mobs killed most recently are kept.

Once the time is known, **Add timer** on its row (or **Add a timer by name** for one not killed yet)
makes a trigger in the `Respawns` folder of the Triggers page. It starts on any of the log's three
death lines for that name (`You have slain X!`, `X has been slain by …!`, `X died.`), counts down
on the overlay you choose, and can say "X in N seconds" and "X is up". Anything else added to that
trigger on the Triggers page is kept when the timer is changed here.

## Tradeskills

For the consumables you keep making. **Download the recipes** reads every page in eqlwiki's Player
Crafted category (about a minute, kept a week on this PC): each gives its recipe and how many a
combine makes, and the Alchemy table adds the potions whose own pages give none. Find a recipe and
star it; each starred recipe gets a card with its ingredients, how many of each you have, how many
combines that makes, where to buy the rest and what the batch costs.

Counts are from your last `/outputfile inventory` export: bags, bank, shared bank and tradeskill
depot. A price you type in wins; then what the log shows you paying last (`You purchased 100 Small
Vial from … for 1 platinum.`), from the log and its archives; then the wiki's merchant value for
something a vendor sells, which is what a vendor asks at best. Where to buy is the merchant you
last bought from, else the vendors on the ingredient's eqlwiki page; an ingredient no vendor sells
says which tradeskill makes it. Each ingredient links to eqlwiki and to EQ Traders Corner.

## Spell timers

Every spell you cast is tracked automatically. No trigger needed.

1. `You begin casting X.` opens a pending cast.
2. The spell's own landing text, from the client's `spells_us_str.txt`, names the target and starts
   the timer. Only spells *you* are casting are considered, which tells your landing apart from
   anyone else's identical message.
3. A DoT's first tick line (`… has taken N damage from your X.`) pins its end exactly: it wears off
   on its target's tick, `ticks − 1` ticks after the first. Until then the bar shows `~`.
4. The fade line (`Your X spell has worn off of T.`, or the spell's own fade text on you), the target
   dying, or a zone change (DoTs only) ends it.

**Recast cues.** By default the app says "Recast {spell}" 12 seconds before a DoT or a buff on you
ends; the time and wording are settings, and any spell can override them. A DoT's cue is exact to the
second once it has ticked. A buff on you shows no ticks, so its end is only known to within its last
6-second tick. Its bar aims at the earliest it could end, so it never runs longer than the buff and the
12-second cue is a floor, never fewer; at zero it shows "fading…" until the game's fade line arrives.

### The duration model

```
ticks = round(formula ticks × (1 + tier% × rank) × (1 + focus%))
```

That is the bracketed number in the in-game Spell window. The effect then runs on into the partial
tick it landed in, so it wears off between `ticks × 6` and `(ticks + 1) × 6` seconds after landing.

- **Formula ticks**: the client's duration formula (field 11 of `spells_us.txt`) at your level,
  capped by field 12.
- **Rank**: the roman numeral in the cast line is the tier count. An unranked spell has none; rank X
  has ten. Per-tier bonuses by category come from the EQL spell upgrade (mote) guide: DoT +5%,
  buff/debuff/mez/charm +10%. Heal over time is 7%, fitted: the guide's "+5% (?)" does not match
  Slugs Healing V (Spell window 0:24 (0:48) with only the AA; 9 ticks in the log with the ring too).
- **Focus**: a list of duration focus effects per character (Spell Timers page). Item focus effects are
  read from their focus spell in `spells_us.txt`: SPA 128 is the bonus, 134 the level cap and the
  decay (percent *of the focus* lost per spell level over the cap), 138 beneficial or detrimental,
  140 a minimum duration, 137 excluded effect types. Only the best item focus applies; AAs such as
  Spell Casting Reinforcement add on top. Each spell's breakdown lists what applied.
- **Rounding**: to the nearest tick.

Checked against a level-50 Shaman's in-game Spell windows (2026-09-23):

| Spell | Base | Calculation | Spell window |
|---|---|---|---|
| Envenomed Bolt X | 6 ticks | 6 × 1.5 = 9 | 0:36 (0:54) |
| Odium X | 5 | 5 × 1.5 = 7.5 → 8 | 0:30 (0:48) |
| Plague X | 13 | 13 × 1.5 = 19.5 → 20 | 1:18 (2:00) |
| Spirit of the Puma X | 10 | 10 × 2.0 × (1 + 0.50 + 0.105) = 32.1 → 32 | 1:00 (3:12) |

…and against the landing-to-fade times of every rank of those spells in the log (`tests/durations.test.ts`).
Puma's focus is Spell Casting Reinforcement (AA, 50%) plus Extended Enhancement II (the Engineer's
Ring's exaltation, +15%, cap 44) decayed six levels to 10.5%. Puma X really does last 3:12 in play
(the log's fades land 192–198s after it lands).

Confirmed in game on 2026-09-24: Puma X faded 194s after landing with the ring on (32 ticks) and 184s
with it off (30 ticks: 10 × 2.0 × 1.5). The decayed focus applies even though the ring never prints
its "sparkles" message on a Puma cast, so the absence of a focus message is no evidence either way.

The Spell window's bracket includes item focus: with the ring off, Puma X reads 1:00 (3:00).

**Check against your log** on the Spell Timers page replays recent history through the same tracker
and flags any spell whose real duration disagrees with the calculation, with the focus that would
fix it. It is a diagnostic; the timers themselves never learn from the log.

### Spell file layout

`spells_us.txt` is caret-delimited: 0 id, 1 name, 4 range, 5 area range, 8 cast ms, 10 recast ms,
11 duration formula, 12 duration cap (ticks), 14 mana, 28 beneficial, 29 resist type (0 none, 1 magic,
2 fire, 3 cold, 4 poison, 5 disease, 6 chromatic, 7 prismatic, 8 physical, 9 corruption), 36–51 class
levels (255 = cannot cast), 75 icon, 172 effects (`slot|spa|base|…` joined by `$`). `spells_us_str.txt`:
id, caster-me, caster-other, cast-on-you, cast-on-other, spell-gone. Icons are cut from
`uifiles\default\SpellsNN.tga`: 40×40, 36 per sheet.

Two other client files were looked at and are not read, since no page needs them yet.
`dbstr_us.txt` is `id^type^text^flag`: type 1 is AA names, 4 AA descriptions (at the rank held,
as the `/alternateadv list` dump prints them), 40 spell-stacking group names, and much of the rest
is mercenary, overseer and event text. `eqstr_us.txt` holds the client's message templates by
number (`469 Your faction standing with %B1(45) could not possibly get any worse.`), which is the
place to confirm a log line's exact wording.

## Triggers

Custom alerts for any log line: plain text (anywhere in the line, ignoring case) or a regular
expression, with snippets `{C}` (your character), `{S1}` (any text), `{N1}` (a number) and
`${Name}` (a named capture). Actions: speak, play a sound, show text, start a timer (with a warning,
ended speech and end-early phrases). Each trigger has a live test box: paste a log line to see the
match, the captures and exactly what it would do.

The sound library is the game's own `AudioTriggers\default` and `shared` folders plus the app's
`sounds` folder.

## Audio

Speech is rendered by Windows' own speech engine (a PowerShell process driving WinRT and
`System.Speech`, started when first needed and stopped after five quiet minutes) to WAV, or by Azure's
neural voices with your own key, then mixed with alert sounds in one audio context on the device you
choose. Speech follows that device instead of the system default. Phrases are cached. Speech plays
one phrase at a time, and the backlog is capped so warnings about a finished fight get dropped.

**Microsoft voices.** Azure AI Speech gives Microsoft's neural voices (Jenny, Aria, Guy and hundreds
more) with your own key. Create a Speech resource in the Azure portal (the free tier allows half a
million characters a month), then paste its key and region into the **Microsoft voices** card on the
Audio page and press **Save and check**; the voices then join the Voice list. The key is kept
encrypted with Windows' own data protection in `azure-speech.json`, is only ever sent to Azure, and
is never shown again. Each phrase is fetched from Azure once and kept as a WAV in `speech-cache` in
the cache folder (the newest 4,000), so a night's cues cost a few hundred characters. When Azure
cannot answer (offline, a key turned down, over its limit), the Windows default voice speaks
instead, so no cue is lost.

## Overlays

Transparent windows that let clicks through, never take focus (EverQuest drops keyboard input the
moment it loses focus), stay out of Alt-Tab, and re-assert always-on-top every two seconds. The game
must be windowed or borderless. **Arrange** lifts all of that so they can be dragged and resized;
**Done** on any of them, or Arrange again, puts them back. An overlay's **Background** slider fades
the dark panel behind its text and bars, down to none; the alerts, text alone, fade as a whole.
Timer bars sort soonest-first and can group under each target's name. A meter overlay is the damage
meter's list; Windows keeps forwarding mouse moves to it while it ignores clicks, so hovering its
header hands it the mouse for its controls and moving off hands it back.

By default the overlays show only while the game (or this app's own window) has focus, and hide when
you tab to anything else; audio cues play regardless. The app asks Windows (through koffi, no helper
process) for the foreground window's process four times a second, and watches for `eqgame.exe`: when the
game closes, every timer is cleared. Overlays hidden with the game are sent nothing and slowed until they
show again.

The **Achievements** overlay (hidden until you switch it on, here, on Factions › Plan or on the
Achievements page) shows the achievements you track (the star on the Achievements page), then the step of the faction plan you follow, counting down as your factions move (what it still wants,
about how long, and the next step), the Slayer achievements your kills of the last half hour
counted toward, and the skills your skill achievements want that went up in that time. A step done is said aloud with the next, and each achievement it finishes flashes on
the alerts overlay (**Say when a faction plan step is done**). With nothing to show, it says so in
one faint line.

## Motes

Every mote you loot is counted from its loot line (`You looted 4 Mote of Major Potential from Reward Chest
and stored it in your currency`), per day and per rank, with each rank's item-XP value from the mote
guide (Infinitesimal 1 … Infinite 10).

Instance runs are timed for motes per hour. A run starts when you enter a tiered instance zone
(`The Plane of Hate 4 (Refined)`, `Najena - Solo 4 (Refined)`, tiers Refined/Awakened/Adaptive/Fused).
The Instance window's Normal / Dungeon Crawl choice never reaches the log, and nothing crawl-specific is
logged during one, so a run becomes a **dungeon crawl** only when the game prints `You have completed
the Dungeon Crawl and earned reward loot!` (the reward chest, logged in the same second, counts). A run
also ends when you enter a different instance, when the game closes, or after 30 minutes away; stepping
out to bank and back into the same instance keeps it going. A run that ends without the completion and
reward chest was a normal instance, not a crawl; it is listed as "normal", and kept only if it produced
motes. Manual Start/Stop covers anything else.

On first launch, history is rebuilt from the character's log and its zipped archives.

### Spell upgrades

The Upgrades page's **Spell upgrades** tab says which of the spells and songs you cast to put motes
into next. It counts your casts (`You begin casting …` / `You begin singing …`) over the last 7, 14
or 30 days of play, or all your logs, and scores the next rank of each spell with the community's
EQL spell upgrade (mote) guide:

- A spell at rank N needs 2^N xp for rank N+1, and on a spell every mote counts its xp whatever the
  spell's rank (Infinitesimal 1, Minor 1, Lesser 2, Potential 4, Major 5, Greater 6, Superior 7,
  Grand 8, Ascendant 9, Infinite 10). There is no tier limit as on items, so the low ranks that no
  item of yours can use any more are worth their full xp here, and "Pay with" spends the lowest ranks
  first (each rank's combine value doubles while its xp barely grows).
- What a rank gives depends on the category, from the guide's per-tier table: nukes and lifetaps
  −2% cast, −2% mana, +6% damage; DoTs −4% cast, −2% mana, +5% duration, +3% per tick (unconfirmed);
  heals −4% cast, −2% mana, about +3% healing; heals over time the same with +5% duration; debuffs,
  charms, mezzes and buffs −4% cast, −4% mana, +10% duration, with charm and mez raising the highest
  level they work on and buffs gaining no stats (damage shields confirmed not to). Every spell also
  gets −2% recovery, −2% reuse and −15 resist modifier per rank; pet summons +1 pet level. Duration
  bonuses use the spell timers' per-rank table, so heals over time get the fitted 7%. Instant and
  permanent spells get no duration bonus; zero-mana spells nothing on mana.
- The spell file marks a gate or a cure beneficial with no duration, the same as a heal, so the
  sections go by effects too: anything that moves you (gate, teleport, succor, translocate) is
  **Transport**; bind affinity and a "heal" that heals nothing (cures, summoned items, resurrection)
  are **Misc**; a pet summon is **Pet summons**. Neither of the first two is in the guide's table;
  they get the −4% cast and −2% mana cuts other spells get and nothing else.
- **Ignore** on a row hides a spell you will never put motes into; "Show ignored" lists them faint
  with a Restore button. The list is kept per character on this machine.
- **Your trio** keeps only spells one of your current classes (what `/who` last said, else the
  character sheet) has at its level now, never over the level cap of 50: a spell a Necromancer gets at
  39 is not the Shadow Knight's until 49. **Every class you have cast as** shows everything in the
  window.
- A point is one cast made one percent better, with weights you can change (damage and healing 1,
  duration 1, mana ½, cast time ½, recovery and reuse ¼, a level 5). A rank's worth is casts × points
  per cast; worth per xp is the default order. Spells at rank X are listed last, with nothing to plan.
  Potions, clickies and abilities granted outside the spell book (Harm Touch, Life Burn) are left
  out: motes go into spell-book spells.

The rank a spell is at is the highest numeral the log has seen you cast it with, so a spell you
upgraded but have not cast since shows its old rank until you cast it.

## Achievements

Read from the export the game writes into its folder when you type `/outputfile achievements`
(`<name>_<server>-Achievements.txt`). The page watches the file and picks up a new one within a few
seconds. It counts achievements, required objectives and sections complete, by category and
section, with a search across every section and **Remaining only**. Optional objectives never count
toward completion, as the game scores them.

An objective the export does not show as done yet can be ticked by hand. Ticks are kept by name in
the app's data, so a new export keeps them, and a tick lands everywhere the same objective appears
(the same kill named in another achievement, say). An objective that names another achievement
follows that one, and a click jumps there. An open Slayer race achievement suggests zones to hunt
that race in, with their level ranges, from eqlwiki's NPC pages; their race fields are entered by
hand, so treat them as leads.

The star on an achievement **tracks** it: it stays on the achievements overlay with its progress,
whatever moved lately, until you click the star again (or ✕ in **Tracked** at the top of the page).
A Slayer achievement shows its count, a skill achievement each skill against its cap, a faction
achievement the standing toward 2000, and anything else its objectives still to do: for a Hunter or
Conqueror achievement the named left, each ticked off the moment your log shows it killed. What you
track is kept per character with your ticks.

Slayer counts go on as you play: the export gives each open Slayer achievement's count when it was
written, and every kill since that the log shows (yours, your pet's and your group's) is added to the
achievements whose races it is, shown as `+N` beside the count and on the achievements overlay. The
log names the mob, never its race, so a kill is placed by its name (`a kobold runt`, `an orc
centurion`, `a fire giant warrior`, `a rattlesnake`) or, where the name does not say, by the race
eqlwiki's page for the mob gives (`A Forsaken Revenant`: Elf Vampire), looked up in the background
and kept. A mob that dies of your damage over time with no killer named (`A bixie died.`) counts
too. Checked against the game's own `You have completed achievement:` lines over a day of play, the
counts ran 0 to 4 kills short of the game's; the next export puts them right. One the game says is
completed shows done.

A skill objective (General › Skills: "Reach the maximum skill in Divination at level 50.") shows
the skill as the log last gave it (`You have become better at Divination! (190)`) against the cap
to reach, from the game's `skillcaps.txt`: the best of your classes at that level, as the Skills
window shows it, or the achievement's own class's when your classes are not known (type `/who`).
The log never prints a skill raised at a guildmaster, so one it has never seen go up says so, and a
value can be higher than the log last said.

## Factions

Where the character picked (the same pick as Achievements, Stats and Gear) stands with each
faction, and the faction changes its log and archives recorded. Type `/outputfile faction` (or `factions`) in game
and the game writes `Name_server-CLS-Factions.txt` (the class is in the name) into its folder: a
line per faction with its ID, name, standing (-2000 to 2000) and points to max. The page reads the
newest one for the character, shows each standing with what NPCs con you at (Ally, Warmly, Kindly,
Amiably, Indifferent, Apprehensive, Dubious, Threatening, Scowling) and the points to the next con
up, and adds on every change the log recorded after the export was written, so the standing keeps up
as you play. The standing is the raw one the achievements count; NPCs con you on it with your race's,
your deity's and the best of your three classes' modifiers added, from the game's own table
(`Resources\Faction\FactionAssociations.txt`): the race, classes and deity from the Stats page (/who
keeps the first two). The best class counts whichever it is: a Monk/Bard/Enchanter cons the bards'
Song Weavers at 0 as Amiable (Bard +50), and Neriak's Dreadguard Inner at 2000 as an Ally, where the
Monk's -300 alone would be Warmly. Without classes on the record, the class the export is named for
counts. Hover a standing for the sum. Without a race the con is the standing alone, and no deity set
counts as Agnostic, which has no modifiers. The con bands are
EQEmu's (Ally from 1100, Warmly 750, Kindly 500, Amiably 100, Indifferent 0, Apprehensive -100,
Dubious -500, Threatening -750), and cons seen in play land on them to the point: Tunare's Scouts at
0 conned -950 Scowling for an Iksar of Cazic Thule, -750 Threatening for an Agnostic Iksar, -100
Apprehensive for a Wood Elf of Cazic Thule and 100 Amiably for an Agnostic Wood Elf. A faction keeps only its last 20 changes, so after more than that since the export the
standing is marked `≈`: type the command again to refresh it. Factions the game has no name for
(`Faction723`) are hidden behind the **Unnamed** chip.

83 factions have an achievement under EverQuest › Progression, done at the maximum standing: the
raw 2000 of the export, not the standing with race, class and deity added. **Achievements to
Do** lists the open ones, with an **Achievement** column: done, or the
points still to go. The link is the client's own list (`Resources\Achievements\AchievementsClient.txt`,
where each is numbered 80000 + the faction's id, so New Sebilis Expedition still finds New
Sebilisian Expedition). The achievements export lists only the achievements still open, so one it
leaves out counts as done, even when the standing has dropped since; without that export, a standing
of 2000 is done. Rows start closed; open one for what raises the faction, from its eqlwiki page
(`{{Factionpage}}`, or `<name> (Faction)` where a zone or NPC has the name): the mobs to kill,
grouped by zone, the quests and the zones. It is fetched when a row is first opened and kept a week.

The log never prints a standing, only each change (``Your faction standing with King Ak`Anon has
been adjusted by -1.``) and, once a faction can move no further, that it `could not possibly get any
better` (or `worse`). So **Net change** is the sum of the changes the log saw, with how many there
were and when the last was: what happened before your oldest log, or with logging off, is not in it.
Without an export that is all the page has. A faction is marked **maxed** or **bottomed** when the
game says so (until a change the other way) or its standing is at 2000 or -2000. Click a row for how
its standing was reached and its last 20 changes, what moved it in your logs (each mob or NPC, how
often and by how much, yours and your other characters'), and the quickest ways to take it to 2000
as the Plan tab reckons them. The log is read with casts, melee and purchases, in the same one
pass, and read on, with the export looked at again, every ten seconds while the page is open.

**What does a mob or NPC do?** looks a name up: every mob or NPC in your logs (any of your
characters') whose name holds what you type, with what each did to every faction, and the mobs
eqlwiki's faction pages list, with the way each moves a faction (their amounts are your logs' usual
ones). Each faction is coloured by what it means to you: green helps an achievement still to do,
amber sets one back, red takes a faction further below zero.

Wherever the app asks you to type an `/outputfile` command, the copy icon beside it puts it on the
clipboard, to paste into the game's chat box.

### Plan: the achievements still to do

The **Plan** tab plans every faction achievement still open for the character picked, whoever
it is and however many it has done: the steps, each a zone and what to kill or hand in there, how
many and about how long, in the order that finishes them all soonest. What is still to do, and where
each faction stands, is the Standings tab's own view, read every ten seconds, so the plan follows
play: the counts go down as you kill and hand in, and the order is kept while only the standings
move, so nothing is reshuffled mid-grind. An achievement done, a change of locks or assumptions, or a
change of con (a race or class change, a race unlocked) plans the order afresh; so does **Plan
afresh**. The plan counts everyone as **Agnostic**, the
deity with no faction modifiers: renouncing your faith is the first step for anyone planning
factions (eqlwiki's Renouncing Your Faith: level 46 and up, the Emissary of Zebuxoruk in the Oasis of
Marr, then Cazic Thule in the Plane of Fear and Innoruuk in the Plane of Hate; then pick Agnostic in
Loadouts). A character with another deity on the Stats page, or none, is told so at the top, with
whether its achievements export has Agnostic unlocked.

**Quests that want a con.** Many quests' NPCs take a hand-in only at some con (Allakhazam lists
them): Amiable, say, where a faked con reaches only Indifferent. The plan checks each as it goes, on
the standing it will have by then, so a quest opens once earlier steps raise that faction far
enough. And it may add a step for just that: raise a faction to where a quicker quest's NPC takes it,
then do the quest. Such a step says **opens a way** and what it opens ("Miners Guild 628 to 60 →
opens Miners Pick"), and the Now card and the overlay count it down to that standing. The catalog
also finds ways to raise a faction a quest wants more of than you con, where that quest raises an
achievement, so the step can be planned when the faction is no achievement of its own.

**Race swaps.** A quest whose NPC will not take the hand-in at your race's con, where another race
you have unlocked (the achievements export's Race Unlock achievements; every race without one), or
one the plan unlocks first, would be at the con it wants, as an Agnostic, can be planned with a race
swap: swap in Loadouts, do the step, swap back. The plan uses one only where it beats the other ways,
counting the swap as 5 minutes (**Assumptions**, where swaps can be switched off). Such a step, and
the **Now** card while you are on it, says which race and why ("Swap to Dwarf in Loadouts for this
step, then back: as a Wood Elf you would con Indifferent (0) with Miners Guild 628 by then, and Jeet
wants Amiable"); it names the race the NPC likes best, or the one you are swapped to already for the
step before ("Still a Dwarf"). The summary says what the swaps save against the same plan without
them.

A swap can be of a class, too: a con takes the best of your three classes' modifiers, so where a
class the NPC likes would open the quest, the plan may put it in your classes in place of one the NPC
likes no better ("Put Bard in your classes in Loadouts for this step": Sylia Windlehands wants
Amiable with Song Weavers, which a Wood Elf Monk, Shadow Knight and Shaman con Indifferent, and a Bard
adds 50).

**Race unlocks.** Each race unlock (Loadouts' "Race Unlock - Barbarian" and the rest) wants three of
the race's factions maxed, as the game's own achievement files list them; the achievements export
says which you have done, faction by faction, and a faction done for one stays done if it falls back.
Half Elf's comes with Human's or Wood Elf's; Kerran's is a task, so it is not planned. The plan counts
the race unlocks still to do as achievements too, lists them with the step that does each, and from
that step on may swap to the race. Switch on **Race unlocks first** (at the top of the tab) to do them
before the rest: each unlock done sooner counts as time saved, so the plan still does what is quick
to do on the way. Raltur's notes for Dismal Rage between Sir Lucan's for Human's Freeport unlock, for
one: the milk and \*Duggin Scumber are the same, and only where the note goes differs. Without that
character's factions export every
standing counts from 0, and without its achievements export an achievement counts as done only
while it is at 2000; the tab says so.
An achievement is done the moment the raw standing reaches 2000 and stays done whatever happens to
the standing after, so the order is what matters: work that lowers an achievement still to do comes
after that achievement is done, where it costs nothing. When two orders take as long, the one that
finishes achievements sooner wins, so stopping part way leaves the most done.

Two goals, switched at the top of the tab. **Fastest** takes every achievement in the least time.
**Most factions positive** takes every achievement too, and also counts every faction that ends at 0
or above (of those whose standing the factions export gives), each worth the hours set in
**Assumptions** (3 by default): it may take a slower way that keeps a faction up, and add
**restore** steps at the end that bring factions back from below zero, including ones below zero
now, when that is worth the time. Either way a faction is judged by where it ends: points an early
step takes and a later step gives back cost nothing. The tab shows how many factions are below zero
now and at the end of the plan, and the points left off factions that were at 2000.

What raises a faction comes from two places. Your log first: every faction change is put down to
the kill or hand-in around it (the faction lines of a kill come just before `You have slain …!`,
those of a hand-in just after `You offered N item to NPC.` and what the NPC says; Legends takes a
whole stack at once, one completion per item), so each kill camp and hand-in has the amounts Legends
really gives and the pace you got through them. A hand-in seen fewer than three times is taken to
be a quest's one-time reward, done. Then eqlwiki, read a week at a time: every faction page's mobs
and quests, each quest page's hand-ins and faction lines (where a page says only `got better`, your
log's usual amount stands in), and each hand-in item's page (a merchant, a drop, a recipe). Mobs are
grouped into camps: the mobs of a zone that move the same factions. A camp of common mobs goes at
your kill pace (from the log where you have killed there, else the median of your runs), a named
mob at one per respawn, so a camp of one or two named mobs loses to a quest. A quest step counts as
repeatable when it wants one kind of item that can be had and that nobody in the walkthrough hands
you; chain steps, rewards of 50 points or more and hand-ins the walkthrough does not make plain are
listed, not planned. Hand-ins take the stack at once, so what counts is getting the items: coin and
bought items are quick, gathered ones take the time set, and what you hold (bags, bank, shared bank
and depot, at your last `/outputfile inventory`) goes first. What a kill or hand-in does to a
faction is the game's, whoever does it, so your other characters' logs count too: an alt's plan
starts from what your main has measured (their kill pace stays their own).

The plan is found by building it greedily (at each point, whatever does the most for the
achievements still open per hour, points it takes off another open one counted as work to do again),
several times with a little noise, then moving steps (a quest together with the step that opens it)
and trying other ways for each achievement, and keeping whatever saves time. The same choices always
give the same plan. Open an achievement for
every way to raise it, quickest first: **Lock in** one and the plan finishes that achievement with it
and is built around it (a lock also tells the planner a one-time quest repeats); **Rule out** one
and the plan leaves it alone; or type your own kills or hand-ins an hour. **Assumptions** holds the
rest: getting to a new zone, kills an hour, a named mob's respawn, a hand-in, gathering one item, and
what a faction kept at 0 or above is worth to Most factions positive. Locks are kept per character.

Steps and ways carry what could make them slower or rougher than planned: **city NPCs** (a camp of
a city's guards, merchants or guildmasters, where the guards may join in), **amounts guessed** (the
wiki's word only), **item source unknown**, **named only** (one kill per respawn). **No city NPC
kills** leaves every city camp out of the plan, unless locked in.

The plan shown is the one followed while you play that character: **Now** at the top of the tab
(and the achievements overlay) says which step you are on (the one your kills and hand-ins go the
way of, or the first left in your zone), what it still wants and about how long, with the next. It
moves on by itself as achievements are done, and follows the order the tab showed last, open or not.

## Stats

Your character's record: up to three classes, the level of each, race (one of the sixteen playable
races: the AC sums tell Iksar apart, and faction cons add the race's modifiers) and deity (Agnostic
or one of the sixteen gods, as Loadouts names them; faction cons add its modifiers). A /who of
yourself while the tracker runs keeps the classes and race up to date, changes included. /who shows
one level, the lowest of the three: a class already on the record keeps its level unless it is below
that, a new class comes in at it, and at the level cap every class is at the cap. Classes that stay
keep your order (the first is your main class); /who lists them in class-number order, which says
nothing about that. /who does not show your deity, so set it here. Every page uses the record: spell
durations, AC and melee, gear and the upgrade finder, spell upgrades, buffs and faction cons. It is
kept per character in `settings.json`. Four tabs:

- **Stats window** reads the game's Inventory window, on its Stats tab, off the screen with Windows OCR
  (**Read from screen**; this window steps aside for a moment while it looks), and shows each figure
  with the calculators' prediction beside it.
- **AC** works out mitigation, the soft cap and avoidance the way the server does: worn AC from the
  inventory export, the soft cap and the multiplier past it from the game's
  `Resources\ACMitigation.txt`, the rest typed in. It follows "What is your 'Real AC'?" by Dzarn, an
  EverQuest developer; avoidance follows EQEmu's GetTotalDefense.
- **Combat** works out attack, chance to hit, crit and swings a round with EQEmu's formulas, and
  skill caps from `Resources\skillcaps.txt`, the best of your classes for each skill. The attack,
  hit and swing sums are confirmed against the stats window and parses; the crit model is not.
- **AAs** lists every ability the character's log and its archives saw bought ("You have gained the
  ability …", "You have improved … 3 at a cost of 6 ability points"): the rank it last reached, the
  points it cost and when. Open one for each rank, and any refund where it gave the points back.
  Abilities whose every rank cost nothing (a class's own come that way) are behind **Granted**. Above
  it: the points left to spend (the last "You now have N ability points" less what was bought since),
  the points spent, and a warning while the game says the pool of points is full. Nothing from before
  the oldest log, or with logging off, is known, so a rank can be higher and points spent more than
  shown; abilities the `/alternateadv list` holds that the log never saw bought are listed as _list
  only_.

The AA figures the sums use come from the newest `/alternateadv list` in the picked character's own
log: type it in game after buying, and the page reads it on a character's first visit and whenever
the log holds a newer list than the one kept (**Read the log again** on the AAs tab reads it now).
The ones that change a sum fill it in. Anything filled in from a file, a game table or the AAs can be
typed over. The page's inputs are kept per character in `characters\<name>_<server>.json`.

## Gear

What your character is wearing, from the game's inventory export: type `/outputfile inventory` in
game after a change and the page follows `<name>_<server>-Inventory.txt` in the game folder. The
export says where every item is and nothing about what it does, so each item's stats come from its
eqlwiki page (its in-game stats block), scaled for its +N merge level the way the wiki's own item
level slider scales them. Pages are kept a week; **Refresh item stats** fetches the worn ones again.

- **Character sheet**: every worn slot with its item, the worn totals, AC typed in for an item the
  wiki gets wrong, whether the secondary counts as a shield, and **Where everything is**: every item
  worn, in bags, in the bank or in Storage, with a search.
- **Upgrade finder**: for each slot, the items your classes, race and level can wear there, scored
  with stat weights (a preset per role, or your own) against what you wear. **Compare** takes
  candidates as they drop or merged to your level. **Judge** takes them **In the round** (everything
  you own rearranged around the candidate, so an item it pushes out may go to an Any slot and keep
  its focus) or **This slot only**. The era buttons hide what is out of era on Legends.
- **Focus items**: each focus effect on gear, worth what it does to the spells your log shows you
  casting, spell by spell; only the best of a kind works on a spell, as in game. What a focus does
  comes from `spells_us.txt`, which items carry it from eqlwiki.
- **Worn effects** and **Procs**: worth damage a minute against your own melee in the log; the stats
  a worn effect gives are priced by your weights.
- **Gear optimiser**: the best way to wear what you own (worn, carried, banked, in Storage ›
  Equipment or on your pet), each piece tried in every slot it fits, both Any slots included, and
  the exaltations in Storage tried in pieces of their own kind. It moves one piece at a time into
  the slot where it adds most until no move adds anything. **All gear** adds the best pieces you
  could get.
- **Pet**: the best of what you own for your pet to wear, against what it wears now (the log's
  `/pet inventory check` list), with the pet's classes from its summon page on eqlwiki.

The finder, the focus items and the optimiser need the wiki's item catalog: **Download the item
catalog** reads every piece of equipment on eqlwiki (about a minute), and later refreshes, at most
weekly, read only the pages edited since. Best merge is on the Upgrades page.

## Upgrades

Where motes go, in three tabs that spend the same stock:

- **Best merge**: the next +1 of each item you wear, best stat boost per mote first, by the Gear
  page's stat weights. What you wear is the inventory export; if you have looted or merged gear
  since it was written, the tab says so. **Only what your motes cover** hides the rest, and **Plan**
  sets an item up in the planner.
- **Merge planner**: put in an item's level, the xp in its bar and the level you want, and it works
  out which motes it takes, how many, and what to combine from your stock. Each mote works on one
  item level, one below its rank (Greater on +5, Superior on +6), and two combine into one of the
  next rank. The stock can be typed in, read off the game's currency window with Windows OCR
  (**Read motes from screen**), and with **Add looted motes automatically** grows as motes drop.
  **Done** takes the motes used off the stock and sets the item to its new level.
- **Spell upgrades**: see [Spell upgrades](#spell-upgrades) under Motes.

## Log files

A character log past the size limit (off by default; one switch on the Log Files page) is archived:
moved aside, zipped as `eqlog_<char>_<first date>_to_<last date>.zip`, read back and checked by CRC
and length, and only then deleted. **Archive now** does the same on demand.

Moving a log the game is writing to is only safe if the game reopens it by name. The archiver doesn't
assume either way; it watches what happens:

- the rename fails → the file is locked → nothing moved; archive after the game exits
- the game creates a fresh log at the old path → handoff confirmed → zip the moved file
- the moved file keeps growing → the game writes through its old handle → put it straight back,
  archive after the game exits
- the game exits → zip the moved file

No path loses a line. An archive interrupted by the app closing is finished on the next start.

## Data Sources

Every place the app's information comes from reports how its last read went, so nothing fails
quietly. The page groups them: your logs (the chat log, log history, mote history), the game's files
(spell data, game tables, icons, the character exports), eqlwiki.com (item lookups, the item
catalog, recipes, pet pages), the screen (OCR reads) and the app itself (Windows voices, updates).
Each row says what the source is for, its state (OK, due a refresh, failed, not there, reading, not
read yet), what was read, the last error and when it last read well, with **Refresh** where reading
it again makes sense. If a page is empty or out of date, the answer is usually here. **Open log
folder** opens the app's own `logs` folder.

## Settings

**Appearance** is System, Light or Dark (System follows Windows); the overlays keep the dark set
over the game either way. Every colour is a token in `styles.css`, with the light set beside the
dark one.

- The version, **Check for updates** (or **Restart and update**), **Open log folder**, and **Copy
  diagnostics**: the version, your PC, the settings that matter, each process's memory and CPU (see
  [Measuring](#measuring)) and the end of the app's log, ready to paste into a bug report, with no
  keys and no Windows user name.
- **Game**: the game folder, the character log, whether to start watching as the app opens, and
  **Yield CPU to EverQuest** (the app runs below normal priority, so the game wins every tie; sound
  stays normal). **UI size** scales this window from 90% to 150%; overlays have their own text
  sizes, on the Overlays page.
- **Hotkeys**, which work with the game in front: `Ctrl+Shift+F9` mutes or unmutes,
  `Ctrl+Shift+F10` starts a new damage meter session, and `Ctrl+Shift+F11` arranges or locks the
  overlays. A key another program already holds is flagged.
- The damage meter's fight gap, how much log it reads back on start, **Read the log again**, and
  whether entering a zone starts a new session; which spells are tracked by default (your own
  casts, buffs on you, buffs you cast on others, your group's buffs, DoTs, debuffs, mez and charm);
  and the buff and DoT warnings and what is said when they fade.

Closing the window leaves the app running in the tray, and a notification says so the first time.
The tray menu has **Open**, **Arrange overlays** (or **Lock overlays**), **Mute**, the update when
one is ready, and **Quit**.

## Your data

Everything the app keeps is in two folders. Setting `EQL_USER_DATA` moves both (see Running from
source).

The settings folder, `%APPDATA%\Legends Tracker` (or the `EQL_USER_DATA` folder):

| File | What it holds |
|---|---|
| `settings.json` | Everything set on the pages: game folder, character log, tracking, audio, overlays, damage meter and archive settings, the faction plan's Assumptions, the Live page's setup checklist, and per character the classes, levels, race and duration focus sources and the faction plan's locks, rule-outs and paces |
| `triggers.json` | Your triggers, respawn timers included; the first run copies them from `defaults/triggers.json` |
| `spell-rules.json` | Per-spell settings from the Spell Timers page: tracking, cues, speech, colour, overlay, a fixed duration |
| `casts.json` | Each ranked spell you have cast, when last and how often, for the Spell Timers page's list |
| `motes.json` | Mote history: instance runs, motes per day, runs whose kind you set by hand, and the time of the last line read |
| `mote-stock.json` | Motes on hand, the item in the Merge planner, and whether looted motes are added |
| `respawns.json` | Each mob's kills and death-to-sighting gaps, by zone |
| `buffs.json` | Who is who from `/who`, the buffs each character wants, and the buffs on each character now |
| `schema.json` | The schema version of each file above; a file from an older build is backed up as `<file>.pre-<N>.json` before it is brought forward |
| `window.json` | Where the main window was, whether it was maximised, and whether the tray notice was shown |
| `pets.json` | Per character, the newest pet gear list (`/pet inventory check`) and summoning cast the log showed, and how far back it was read |
| `tradeskills.json` | Starred recipes, the combines planned of each, and prices typed in |
| `faction-follow.json` | Per character, the faction plan the achievements overlay follows: its steps, the step you are on, and what is done |
| `azure-speech.json` | The Azure region, the key encrypted with Windows' data protection, and the voice list |
| `app-icon.ico` | Running from source only: the icon for the "Legends Tracker (source)" Start menu shortcut |
| `catchup.json` | How far into which log mote tracking had read when the app closed, so the next start carries on from there |
| `sounds\` | Sound files of your own for triggers, beside the game's `AudioTriggers` folders |
| `characters\` | One file per character: the Stats page's inputs, AC typed in per item and the shield choice from the Gear page |
| `achievements\` | One file per character: your ticks on the Achievements page |
| `logs\` | The app's own log, `main.log`, rolled over to `main.old.log` past 2 MB |

`casts.json`, `motes.json`, `respawns.json` and `buffs.json` change with nearly every line, so they
are written at most every 15 seconds; `mote-stock.json` waits 3 seconds. A file that will not parse
is moved aside as `<file>.corrupt-<time>.json` and started afresh. Every file is written whole or not
at all (to a `.tmp` file, then renamed over it), and tried again for a few seconds while another
program, a virus scanner or a backup tool, holds it.

The cache folder, `%LOCALAPPDATA%\Legends Tracker` (or `<EQL_USER_DATA>\local`), kept out of the
roaming profile:

| File | What it holds |
|---|---|
| `item-catalog.json` | Every piece of equipment on eqlwiki, for the upgrade finder, focus items and optimizer; refreshed at most weekly |
| `item-cache.json` | eqlwiki pages for the items you wear and look at (Gear, Loot, Tradeskills), kept a week |
| `tradeskill-recipes.json` | Every player-crafted recipe on eqlwiki, with the era of each product and ingredient; refreshed at most weekly |
| `pet-wiki.json` | eqlwiki's pet summon pages and Pet Guide, for the Pet tab |
| `npc-races.json` | The race each mob's eqlwiki page gives, for the Slayer counts of mobs whose names do not say; kept, and a name with no page asked again after a day |
| `faction-wiki.json` | What raises each faction, from its eqlwiki page, for the Factions page; kept a week |
| `faction-book.json` | Every eqlwiki faction page and the quest pages they name, read into ways to raise each faction, for the Plan tab; kept a week |
| `faction-alla.json` | Allakhazam's faction pages (the cons quests want, kill amounts), read one every 20 seconds; kept a month |
| `log-history.json` | Casts, melee, purchases and AAs bought counted over each character's log and archives, for Gear, Spell upgrades, Tradeskills and Stats › AAs; only what a log gains is read again |
| `speech-cache\` | Azure phrases as WAV files, the newest 4,000 |

It also holds `ocr.ps1`, the OCR script, written each run; the screen captures an OCR read takes are
deleted as soon as it is done. Everything here can be fetched or counted again, so the folder can be
deleted safely: the wiki downloads come back from their pages (or **Refresh** on Data Sources), log
history is counted again from your logs and archives, and Azure phrases are fetched again as they
are spoken.

The app reads what the game writes and changes none of it, apart from the archiver on the Log Files
page, which moves logs into `Logs\archive` or a folder you choose. It reads the chat logs in `Logs`
(`eqlog_<name>_<server>.txt`), the `/outputfile inventory` and `/outputfile achievements` exports
in the game folder, `spells_us.txt` and `spells_us_str.txt`, the game tables in `Resources`
(`basedata.txt`, `skillcaps.txt`, `ACMitigation.txt`), the icon sheets in `uifiles\default`, and
the sounds in `AudioTriggers`.

## Layout

| Path | What |
|---|---|
| `src/core` | Log parsing and tailing, spell book, duration model, spell tracker, triggers, archiver, log check, the damage meter (`combatLines` reads the lines, `combatRoster` knows who is on which side, `combatMeter` keeps the fights, `combatTimeline` their seconds for the chart, `combatView` sums them for display), the loot ledger (`loot`), motes (`motes` counts them, `moteCalc` plans item upgrades, `mergeValue` picks the best merge, `spellMotes` the best spell to upgrade). Plain TypeScript with no Electron dependency, so it is unit-tested directly |
| `src/features` | Feature modules, one folder each (factions): the feature's logic (`core.ts`; for factions also `attribution.ts`, what caused each change, `questPages.ts`, eqlwiki's quest pages, and the achievement plan: `catalog.ts`, what can raise each faction, `names.ts`, `ways.ts`, one faction's ways to 2000, and `planner.ts` with its `model.ts`, `search.ts` and `steps.ts`), its main-process side (`main.ts`: the log-history consumers and what the page asks for) and its pages (`page.tsx`, `planPage.tsx`, with the Plan tab's parts in `plan/`). `index.ts` lists their pages for the sidebar |
| `src/shared` | What both processes use: the IPC contract (`ipc.ts`), settings and view types, the game's tables and what is known of the game beyond them (`game/`: classes, spell effect numbers, guide bonuses; `factions.ts`, the faction planner's lore from play and Allakhazam; `hunt.ts`, where to hunt each Slayer race), the default overlays and hotkeys |
| `src/main` | Electron main process: windows, tray, overlays, speech, icons, persistence, the engine that joins it all (`engine/`, with the contract its parts keep in `feature.ts`), the data sources and long jobs (`sources/`), IPC handlers by family (`ipc/`) |
| `src/preload` | The IPC bridge, which lets a page use only the channels in the contract |
| `src/renderer` | The React UI (`index.html`), timer and meter overlays (`overlay.html`), the alerts overlay without React (`alerts.html`), the hidden audio mixer (`audio.html`) |
| `tests` | Vitest; fixtures are real rows from the client's spell files and real lines from the test character's log. `*.bench.ts` are timing runs (`npm run bench`), not part of `npm test` |
| `docs/formulas.md` | The game formulas, how each was measured or confirmed, and where the app implements it |
| `scripts` | The release push, the release notes from the changelog, the smoke test, the icon renderer |
| `defaults/triggers.json` | Triggers installed on first run |

The lint (`npm run lint`; `npm run check` runs it with the type-check and tests) holds the layers
apart. Core imports neither
Electron nor another layer. Shared imports only types from core. The renderer imports no Node
module, Electron, the main process or the preload. Main never imports the renderer. Type-only
imports may cross, since they vanish at build. The type-check holds the globals apart the same way:
`tsconfig.renderer.json` checks the pages without Node's types, so `process` or `Buffer` there is an
error, and `tsconfig.node.json` checks the main process, the preload and core without the DOM's, so
`window` or `document` there is one.

A feature module keeps one feature whole instead of spreading it over the layers: its files each
follow their own layer's rules by name (every `.tsx` the renderer's, `main.ts` and any `*Source.ts`
main's, every other `.ts` core's), so a page still cannot reach the main process. Its `main.ts` exports a `registerXxxIpc(ctx)` that
`src/main/index.ts` calls with the other IPC families, and its log-history consumer is added in
`src/main/context.ts`; its page's entry in `src/features/index.ts` (id, group, label, icon and the
page it follows) is where the sidebar puts it. Inside the engine the same idea runs the live log:
each part (the spell tracker, triggers, pet, motes, the combat feed, buffs, the status line and the
views that go out) is an `EngineFeature` with optional `line`, `tick`, `reset` and `linesRead`
hooks, and the engine hands every line, tick and change of character down one ordered list. The
order is behaviour (the tracker sees a line before the triggers; the meter files a fight before the
loot ledger looks for its session), so a new part goes in where it must run. Views pushed to the
windows go through one `Throttled` (`engine/throttle.ts`): sent when changed, at most so often, with
an optional heartbeat for work that must run on a beat anyway.

## Licence and credits

MIT (see `LICENSE`). Legends Tracker is a fan-made tool, not affiliated with or endorsed by Daybreak
Game Company. EverQuest and EverQuest Legends are trademarks of Daybreak Game Company LLC. The app
reads spell data and icons from your own game installation at runtime and ships none of the game's
files, apart from a few spell-file rows used as test fixtures. Per-rank duration bonuses are from the
community's EQL spell upgrade (mote) guide.
