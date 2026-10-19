import { useActions, useSettled } from '../state'
import { useInvoke } from '../hooks'
import { showToast } from '../toast'
import { who } from '../../../core/format'

/**
 * The character followed, in the title bar, and a switch to another of the game folder's logs (FEAT-041):
 * the Logs page's Follow, from any page. Shown with two or more logs to choose from.
 */
export function CharacterSwitch() {
  const logFile = useSettled((s) => s.settings.logFile)
  const installDir = useSettled((s) => s.settings.installDir)
  const { patchSettings } = useActions()
  const logs = useInvoke('logs:list', [], [installDir]).data ?? []
  if (logs.length < 2) return null
  const followed = logs.find((l) => l.path === logFile)
  return (
    <select
      className="titlebar-switch"
      aria-label="Character followed"
      title="The character followed: timers, the meter, the overlays and the character pages"
      value={logFile}
      onChange={(e) => {
        const to = logs.find((l) => l.path === e.target.value)
        if (!to) return
        void patchSettings((x) => ({ ...x, logFile: to.path }))
        showToast(`Now following ${who(to.character)}.`)
      }}
    >
      {!followed && <option value={logFile}>{logFile ? 'Another log' : 'No character'}</option>}
      {logs.map((l) => (
        <option key={l.path} value={l.path}>
          {who(l.character)}
        </option>
      ))}
    </select>
  )
}
