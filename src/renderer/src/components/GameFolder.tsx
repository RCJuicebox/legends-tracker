import { useEffect, useState } from 'react'
import { api } from '../api'
import { useApp } from '../state'
import type { GameFolderCheck } from '../../../shared/types'

const who = (names: string[]) => names.map((n) => n.replace('_', ' · ')).join(', ')

/** Finds the game folder again, or lets the player point at it. Reports what happened in a line under the buttons. */
function useFolderActions() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const find = async () => {
    setBusy(true)
    setMessage('')
    const dir = await api.invoke<string>('game:find')
    setBusy(false)
    setMessage(dir ? '' : 'Could not find it on any drive. Choose the folder yourself.')
  }
  const choose = async () => {
    setMessage('')
    const r = await api.invoke<{ canceled: boolean; picked: string; dir: string }>('game:choose')
    if (!r.canceled && !r.dir) setMessage(`${r.picked} is not an EverQuest Legends folder: it has no spells_us.txt. Pick the folder the game is installed in.`)
  }
  return { busy, message, find, choose }
}

/** The Settings card: the folder, what it holds, and ways to change it. */
export function GameFolderCard() {
  const { state, patchSettings } = useApp()
  const dir = state.settings.installDir
  const [check, setCheck] = useState<GameFolderCheck | null>(null)
  const { busy, message, find, choose } = useFolderActions()
  useEffect(() => {
    let live = true
    const t = setTimeout(() => void api.invoke<GameFolderCheck>('game:check').then((c) => live && setCheck(c)), 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [dir, state.status.spellsLoaded])

  const rows: [boolean, string, string][] = check
    ? [
        [check.spells, 'Spell data', check.spells ? `spells_us.txt, ${state.status.spellsLoaded.toLocaleString()} spells` : 'No spells_us.txt here: spell timers need it'],
        [check.logs.length > 0, 'Character logs', check.logs.length ? who(check.logs) : 'None in Logs yet. Type /log on in game to start one'],
        [check.inventory.length > 0, 'Inventory files', check.inventory.length ? who(check.inventory) : 'None yet. Type /outputfile inventory in game to write one'],
        [check.achievements.length > 0, 'Achievement files', check.achievements.length ? who(check.achievements) : 'None yet. Type /outputfile achievements in game to write one']
      ]
    : []

  return (
    <div className="stack" style={{ gap: 10 }}>
      <label className="field">
        <span>EverQuest Legends folder</span>
        <div className="row">
          <input className="grow" value={dir} placeholder="Not found yet" onChange={(e) => patchSettings((x) => ({ ...x, installDir: e.target.value }))} />
          <button className="btn" onClick={() => void choose()}>
            Choose…
          </button>
          <button className="btn" disabled={busy} onClick={() => void find()}>
            {busy ? 'Looking…' : 'Find automatically'}
          </button>
        </div>
      </label>
      {message && <div className="notice bad small">{message}</div>}
      {check && dir && !check.exists && <div className="notice bad small">That folder does not exist.</div>}
      {check?.exists && (
        <table className="table small">
          <tbody>
            {rows.map(([ok, label, detail]) => (
              <tr key={label}>
                <td style={{ width: 24 }}>{ok ? <span className="chip ok">✓</span> : <span className="chip warn">–</span>}</td>
                <td className="nowrap" style={{ fontWeight: 600, width: 170 }}>
                  {label}
                </td>
                <td className={ok ? '' : 'muted'}>{detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Shown on the Live page when there is no usable game folder: first runs where detection failed. */
export function GameFolderPrompt() {
  const { state } = useApp()
  const { busy, message, find, choose } = useFolderActions()
  const s = state.settings
  if (s.installDir && !state.status.spellError) return null
  return (
    <div className="notice bad stack" style={{ marginBottom: 16, gap: 8 }}>
      <div>
        <b>{s.installDir ? `No EverQuest Legends game files in ${s.installDir}.` : 'Could not find your EverQuest Legends folder.'}</b> The tracker reads
        your logs, spell data, inventory and achievement files from it. Point it at the folder the game is installed in, usually
        …\Daybreak Game Company\Installed Games\EverQuest Legends.
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => void choose()}>
          Choose folder…
        </button>
        <button className="btn" disabled={busy} onClick={() => void find()}>
          {busy ? 'Looking…' : 'Find it again'}
        </button>
      </div>
      {message && <div className="small">{message}</div>}
    </div>
  )
}
