# Legends Tracker

Spell timers and recast cues, overlays, triggers, mote and dungeon-crawl tracking, and log management
for **EverQuest Legends**, driven by the game's chat log and its own data files. Electron + TypeScript
+ React.

(Called EQL Audio Triggers until 2026-09-24; its settings carry over on first start.)

Read the log, play sound, draw overlays. No process memory reads, no injection, no input sent
to the game.

## Installing

Run **`Legends-Tracker-Setup-<version>.exe`** from the GitHub Releases page. It installs for the current
user (no admin prompt) into `%LOCALAPPDATA%\Programs\legends-tracker`, with Start menu and desktop
shortcuts and an uninstaller. The app lives in the tray; closing the window keeps the overlays and audio
running, and **Quit** is on the tray menu.

The installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC" the first
time: **More info → Run anyway**.

### Updates

The installed app checks GitHub Releases shortly after it starts and every four hours, downloads a newer
version in the background, and offers **Restart and update** in the title bar, the tray menu and
Settings. Settings live in `%APPDATA%\Legends Tracker`, outside the install folder, so they survive
updates and uninstalls.

### Releasing a new version

1. Bump `version` in `package.json` (e.g. 1.0.0 → 1.1.0) and commit. The updater only offers a higher
   version.
2. Run:

   ```bash
   npm run release
   ```

   It pushes the commit and its version tag. GitHub Actions (`.github/workflows/release.yml`) then builds
   the installer from that commit on a clean Windows machine, runs the tests, creates the release as a
   draft, uploads the installer with `latest.yml` and its blockmap, checks all three arrived, and
   publishes. Every installed copy picks it up on its next check. `gh run watch` follows the build.

Running the Release workflow by hand (Actions → Release → Run workflow) is a dry run: it builds the
installer and attaches it to the run, publishing nothing. Every push to `main` also runs the type-check
and tests (`ci.yml`).

`npm run dist` builds the installer into `dist\` without publishing anything.

## Running from source

Double-click **`Start Legends Tracker.cmd`** (after `npm install` and `npm run build`).

```bash
npm install
```

```bash
npm run build
```

```bash
npm test
```

`npm run dev` runs with hot reload. Settings live in `%APPDATA%\Legends Tracker`
(`settings.json`, `triggers.json`, `spell-rules.json`, `casts.json`, and a `sounds` folder).
Setting `EQL_USER_DATA` to another folder runs against a separate profile.

## Damage meter

The Live page's first card, and a floating overlay of its own. Every combat line the game prints is
read into it: your melee, spells, DoT ticks and damage shields, your pet's, your group's, strangers
fighting near you, and everything hitting your side.

- **Fights and sessions.** A fight opens on the first blow between your side and an enemy and
  closes when the last enemy it engaged dies, or after ten seconds without a blow (Settings). It is
  named after the mob that took the most ("a fetid fiend +2"). A session is everything since you
  entered the zone, or pressed **New session**; the Overall figures read from it. Both are picked
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

`spells_us.txt` is caret-delimited: 0 id, 1 name, 8 cast ms, 10 recast ms, 11 duration formula,
12 duration cap (ticks), 28 beneficial, 36–51 class levels (255 = cannot cast), 75 icon, 172 effects
(`slot|spa|base|…` joined by `$`). `spells_us_str.txt`: id, caster-me, caster-other, cast-on-you,
cast-on-other, spell-gone. Icons are cut from `uifiles\default\SpellsNN.tga`: 40×40, 36 per sheet.

## Triggers

Custom alerts for any log line: plain text (anywhere in the line, ignoring case) or a regular
expression, with snippets `{C}` (your character), `{S1}` (any text), `{N1}` (a number) and
`${Name}` (a named capture). Actions: speak, play a sound, show text, start a timer (with a warning,
ended speech and end-early phrases). Each trigger has a live test box: paste a log line to see the
match, the captures and exactly what it would do.

The sound library is the game's own `AudioTriggers\default` and `shared` folders plus the app's
`sounds` folder.

## Audio

Speech is rendered by Windows' own speech engine (a resident PowerShell process driving
`System.Speech`) to WAV, then mixed with alert sounds in one audio context on the device you
choose. Speech follows that device instead of the system default. Phrases are cached. Speech plays
one phrase at a time, and the backlog is capped so warnings about a finished fight get dropped.

## Overlays

Transparent windows that let clicks through, never take focus (EverQuest drops keyboard input the
moment it loses focus), stay out of Alt-Tab, and re-assert always-on-top every two seconds. The game
must be windowed or borderless. **Arrange** lifts all of that so they can be dragged and resized.
Timer bars sort soonest-first and can group under each target's name. A meter overlay is the damage
meter's list; Windows keeps forwarding mouse moves to it while it ignores clicks, so hovering its
header hands it the mouse for its controls and moving off hands it back.

By default the overlays show only while the game (or this app's own window) has focus, and hide when
you tab to anything else; audio cues play regardless. A resident PowerShell loop reads the foreground
window's process four times a second, and watches for `eqgame.exe`: when the game closes, every timer is
cleared.

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

## Layout

| Path | What |
|---|---|
| `src/core` | Log parsing and tailing, spell book, duration model, spell tracker, triggers, archiver, log check, the damage meter (`combatLines` reads the lines, `combatMeter` keeps the fights, `combatView` sums them for display). Plain TypeScript with no Electron dependency, so it is unit-tested directly |
| `src/main` | Electron main process: windows, tray, overlays, speech, icons, persistence, the engine that joins it all |
| `src/preload` | The IPC bridge |
| `src/renderer` | The React UI (`index.html`), overlay windows (`overlay.html`), hidden audio mixer (`audio.html`) |
| `tests` | Vitest; fixtures are real rows from the client's spell files and real lines from the test character's log |
| `defaults/triggers.json` | Triggers installed on first run |

## Licence and credits

MIT (see `LICENSE`). Legends Tracker is a fan-made tool, not affiliated with or endorsed by Daybreak
Game Company. EverQuest and EverQuest Legends are trademarks of Daybreak Game Company LLC. The app
reads spell data and icons from your own game installation at runtime and ships none of the game's
files, apart from a few spell-file rows used as test fixtures. Per-rank duration bonuses are from the
community's EQL spell upgrade (mote) guide.
