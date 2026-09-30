# Notes for coding agents

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: the layers, the conventions and the checks all apply.

- Run `npm run check` before every commit, and `npm run coverage` when tests change.
- The checkout is LF (`.gitattributes`, Prettier `endOfLine: lf`); write files so they stay LF.
- After a change that shows in the UI, rebuild (`npm run build`) and restart the running copy
  (`Restart Legends Tracker.cmd`, or `npx electron . --quit` then start it again): a running copy
  keeps the code it started with.
- Try things on a scratch profile (`EQL_USER_DATA=<folder>`), never the player's own settings; close
  scratch copies with `EQL_USER_DATA=<folder> npx electron . --quit` when done.
- Keep real player and guild names out of commits; tests use the test characters.
- Ask before pushing or releasing: both are public.
