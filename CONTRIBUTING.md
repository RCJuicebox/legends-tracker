# Contributing

How the code is laid out and the habits that keep it that way. The README's [Layout](README.md#layout)
says what each folder holds; this says how to work in them.

## Before a commit

```bash
npm run check
```

That is the type-check, the lint (oxlint, with the layer rules below), the format check (Prettier:
no semicolons, single quotes, 180 columns, LF line ends), knip (no export, file or package that
nothing uses; the entry points are in `knip.json`) and the tests. `npm run format` fixes the
formatting. `npm run coverage` runs the tests with coverage and fails when a folder falls below its
floor in `vitest.config.ts`; raise a floor when you add tests, never lower one to get a change in.
After `npm run build`, `npm run smoke` starts the built app on a throwaway profile. CI runs all of it.

A change a player would notice gets a line in `CHANGELOG.md` under **Unreleased**: a bold lead
saying what changed, then a sentence or two. That section becomes the release notes and the in-app
update notice. `npm run release` (after bumping `package.json`) pushes the commit and its tag; the
Release workflow does the rest.

## The layers

| Layer | May import | Must not import |
|---|---|---|
| `src/core` | `src/shared` | Electron, `main`, `renderer`, `preload` |
| `src/shared` | types from `core` | anything else from another layer |
| `src/main`, `src/preload` | `core`, `shared` | the renderer |
| `src/renderer` | `core`, `shared`, types from `main` | Node modules, Electron, `main`, `preload` |

A feature module (`src/features/<name>/`) keeps one feature whole; its files follow their layer's
rules by name: every `.tsx` the renderer's, `main.ts` and any `*Source.ts` main's, every other `.ts`
core's. The lint enforces all of it (`.oxlintrc.json`). Core code runs in tests and workers, so it
takes what it needs as arguments rather than reaching for Electron or the disk.

A new feature module:

1. Its logic in `core.ts` (and more core files as it grows), tested directly.
2. Its main side in `main.ts`: a class implementing `AppFeature` (`src/main/appFeature.ts`), with
   `register(ctx)` for its channels, Data Sources rows and engine feature, `flush()` for what it keeps
   and a static `consumers` for its log-history counts; built in `src/main/context.ts` and listed in
   `ctx.features`. Anything it keeps is listed in the README's "Your data".
3. Its page in `page.tsx`, listed in `src/features/index.ts` (id, group, label, icon).
4. Its channels in `src/shared/ipc.ts`, each with its argument and result types; a handler checks
   every argument it stores or builds a path from (`src/core/validate.ts` has the helpers:
   `isCharacterKey`, `isRecordKey`, `textArg`, `intArg`, `stringsArg`). A new channel answers the
   main window only unless `handle.ts` lists another page for it.

## Conventions

- **Log lines**: a pattern more than one reader needs goes in `src/core/phrases.ts`, one regular
  expression per wording, anchored. A pattern that starts `^(.+)` gets a cheap `includes`/
  `startsWith` look before it runs: most lines are not it.
- **Numbers, times and days** go through `src/core/format.ts` (`num`, `num1`, `pct`, `clock`,
  `duration`, `timeOfDay`, `day`, `when`), never a page's own helper.
- **Pages**: waits use `Pending` (`doing=` for anything but "Loading …"), errors `LoadError` or
  `ErrorText`, ages `<Ago>`, filters `FilterBox`, tabs `Tabs`, choices `Segmented`, and anything that
  cannot be undone a `ConfirmButton` or `showUndo`. Web data is **Refreshed**; a log is **Read again**.
- **Places**: what is set once and seldom opened is a tab of Settings, not a page; what one page
  alone uses is set on that page. A page others open on a given tab names its tabs in
  `src/renderer/src/nav.ts` and is opened with `go(page, tab)`.
- **Files the app keeps** are written through `JsonFile` (`src/main/storeCore.ts`): a `.tmp` file
  renamed over, tried again while another program holds it. Settings-store files have a schema number
  in `src/main/schema.ts`; a change of shape bumps it and adds a migration.
- **IPC families** name what they read or keep, not the page that asks: `character:` is the record,
  the sheet and which exports a character has; `inventory:` the inventory export and the wiki's word
  on items; `gear:` the item catalog and what worn gear does (foci, effects); `stats:` what goes into
  a character's stats beyond the sheet (skill caps, AAs, the in-game stats window). A page calls as
  many families as it reads: Gear calls all four.
- **Game facts** found in play go in `docs/formulas.md` with the date and the reading that settled
  them. A guess stays marked as one in the code until a reading settles it.
- **Words**: British spelling in what the app shows ("colour", "optimiser"); plain sentences, no
  server-code jargon in labels.

## Glossary

| Word | Means |
|---|---|
| character key | `Name_server`, as the game names its files (`eqlog_Name_server.txt`) |
| record | the character's classes, levels, race, deity and focus, kept in the settings, edited on Stats |
| sheet | what the player has told the tracker about a character that no file records (`CharacterSheet`): AC typed in for items, the shield choice and the stats inputs, kept in `characters\<key>.json` |
| stats inputs | the Stats page's part of the sheet (`StatsInputs`, `src/core/statsInputs.ts`): classes, level, skills, AC inputs, stances |
| Motes | the page for motes coming and going: the runs they dropped on, then where they go (the best merge, the merge planner, spell upgrades). The gear finder (`src/core/gearFinder.ts`, Gear › Upgrade finder) looks for better items, not merges |
| export | a file the game writes on `/outputfile inventory`, `achievements` or `faction` |
| log history | every consumer's counts over a character's live log and archives (`log-history.json`) |
| source | a row on Data Sources: something read from the game, the log or the web, and how it fared |
| host | the one overlay window per monitor that draws its overlays as regions |

## Tests and fixtures

Fixtures are real: rows from the client's spell files, lines from a real log. Names in them are
changed to the test characters (Kelwyn, Aldric, Brenna, Corvin, Dorran and so on) before they are
committed: no real player or guild names in the repository.
