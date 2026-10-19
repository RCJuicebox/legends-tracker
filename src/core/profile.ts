import { join } from 'node:path'

// A second player on one PC (FEAT-041): `--profile <name>` (or `--profile=<name>`) keeps their settings,
// timers and logs in a folder of their own, %APPDATA%\Legends Tracker\profiles\<name>, and runs beside the
// first player's copy, since the one-copy lock is kept in the settings folder. EQL_USER_DATA still wins.

/** A profile's name: letters, digits, spaces, dashes and underscores, as a folder can be named. */
const NAME = /^[\w -]{1,40}$/

/** The profile asked for on the command line, or '' for none (or a name that cannot be a folder). */
export function profileName(argv: readonly string[]): string {
  let name = ''
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile') name = argv[i + 1] ?? ''
    else if (argv[i].startsWith('--profile=')) name = argv[i].slice('--profile='.length)
  }
  name = name.trim()
  return NAME.test(name) && name !== '.' && name !== '..' ? name : ''
}

/** Where settings live: EQL_USER_DATA's folder, a profile's, or the usual one. */
export function settingsFolder(argv: readonly string[], appData: string, scratch: string | undefined): string {
  if (scratch) return scratch
  const name = profileName(argv)
  const base = join(appData, 'Legends Tracker')
  return name ? join(base, 'profiles', name) : base
}
