/**
 * Overlays show while the game has focus, while this app's own window does (so arranging and the
 * demo work), and always while arranging. Otherwise they hide, unless the setting is off.
 */
export function overlaysVisible(opts: { onlyWithGame: boolean; arranging: boolean; state: { foregroundName: string; foregroundPid: number }; ownPid: number }): boolean {
  if (!opts.onlyWithGame || opts.arranging) return true
  const { foregroundName, foregroundPid } = opts.state
  return foregroundName === 'eqgame' || foregroundPid === opts.ownPid
}
