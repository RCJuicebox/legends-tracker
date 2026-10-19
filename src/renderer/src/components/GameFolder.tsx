import { useEffect, useState } from 'react'
import { api, errorMessage } from '../api'
import { useActions, useLive, useSettled } from '../state'
import { whoList as who } from '../../../core/format'
import { MAX_LOG_FOLDERS, type GameFolderCheck } from '../../../shared/types'
import type { LogFolderView } from '../../../shared/ipc'
import { WithCommands } from './ui'

/** Finds the game folder again, or lets the player point at it. Reports what happened in a line under the buttons. */
function useFolderActions() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const find = async () => {
    setBusy(true)
    setMessage('')
    try {
      const dir = await api.invoke('game:find')
      setMessage(dir ? '' : 'Could not find it on any drive. Choose the folder yourself.')
    } catch (e) {
      setMessage(`Could not look for it: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const choose = async () => {
    setMessage('')
    try {
      const r = await api.invoke('game:choose')
      if (!r.canceled && !r.dir) setMessage(`${r.picked} is not an EverQuest Legends folder: it has no spells_us.txt. Pick the folder the game is installed in.`)
    } catch (e) {
      setMessage(`Could not use that folder: ${errorMessage(e)}`)
    }
  }
  return { busy, message, find, choose }
}

/** The Settings card: the folder, what it holds, and ways to change it. */
export function GameFolderCard() {
  const { patchSettings } = useActions()
  const spellsLoaded = useLive((l) => l.status.spellsLoaded)
  const dir = useSettled((s) => s.settings.installDir)
  const [check, setCheck] = useState<GameFolderCheck | null>(null)
  const [checkError, setCheckError] = useState('')
  const { busy, message, find, choose } = useFolderActions()
  useEffect(() => {
    let live = true
    const t = setTimeout(
      () =>
        api.invoke('game:check').then(
          (c) => {
            if (!live) return
            setCheck(c)
            setCheckError('')
          },
          (e) => live && setCheckError(errorMessage(e))
        ),
      300
    )
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [dir, spellsLoaded])

  const rows: [boolean, string, string][] = check
    ? [
        [check.spells, 'Spell data', check.spells ? `spells_us.txt, ${spellsLoaded.toLocaleString()} spells` : 'No spells_us.txt here: spell timers need it'],
        [check.logs.length > 0, 'Character logs', check.logs.length ? who(check.logs) : 'None in Logs yet. Type /log on in game to start one'],
        [check.inventory.length > 0, 'Inventory files', check.inventory.length ? who(check.inventory) : 'None yet. Type /outputfile inventory in game to write one'],
        [check.achievements.length > 0, 'Achievement files', check.achievements.length ? who(check.achievements) : 'None yet. Type /outputfile achievements in game to write one'],
        [check.factions.length > 0, 'Faction files', check.factions.length ? who(check.factions) : 'None yet. Type /outputfile faction in game to write one']
      ]
    : []

  return (
    <div className="stack gap-12">
      {checkError && <div className="notice bad">Could not look in the folder: {checkError}</div>}
      <label className="field">
        <span>EverQuest Legends folder</span>
        <div className="row">
          <input
            className="grow"
            value={dir}
            placeholder="Not found yet"
            // Saved once typing stops: each save looks in the folder again and may read the spell data (LT-393).
            onChange={(e) => patchSettings((x) => ({ ...x, installDir: e.target.value }), { debounceMs: 400 })}
          />
          <button className="btn" onClick={() => void choose()}>
            Choose…
          </button>
          <button className="btn" disabled={busy} onClick={() => void find()}>
            {busy ? 'Looking…' : 'Find automatically'}
          </button>
        </div>
      </label>
      {message && (
        <div className="notice bad small" role="status">
          {message}
        </div>
      )}
      {check && dir && !check.exists && <div className="notice bad small">That folder does not exist.</div>}
      {check?.exists && (
        <div className="table-scroll">
          <table className="table small">
            <tbody>
              {rows.map(([ok, label, detail]) => (
                <tr key={label}>
                  <td style={{ width: 24 }}>{ok ? <span className="chip ok">found</span> : <span className="chip warn">missing</span>}</td>
                  <td className="nowrap" style={{ fontWeight: 600, width: 170 }}>
                    {label}
                  </td>
                  <td className={ok ? '' : 'muted'}>
                    <WithCommands text={detail} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Shown on the Live page when there is no usable game folder: first runs where detection failed. */
export function GameFolderPrompt() {
  const installDir = useSettled((s) => s.settings.installDir)
  const spellError = useLive((l) => l.status.spellError)
  const { busy, message, find, choose } = useFolderActions()
  if (installDir && !spellError) return null
  return (
    <div className="notice bad stack gap-8 mb-16">
      <div>
        <b>{installDir ? `No EverQuest Legends game files in ${installDir}.` : 'Could not find your EverQuest Legends folder.'}</b> The tracker reads your logs, spell data,
        inventory, achievement and faction files from it. Point it at the folder the game is installed in, usually …\Daybreak Game Company\Installed Games\EverQuest Legends.
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => void choose()}>
          Choose folder…
        </button>
        <button className="btn" disabled={busy} onClick={() => void find()}>
          {busy ? 'Looking…' : 'Find it again'}
        </button>
      </div>
      {message && (
        <div className="small" role="status">
          {message}
        </div>
      )}
    </div>
  )
}

/** How long the Settings card waits between looks at other PCs' folders (main looks again no sooner anyway). */
const FOLDER_LOOK_MS = 30_000

/**
 * Settings › Log files: the Logs folders of other PCs the player plays on, whether each answers and whose
 * logs it holds, and adding or taking one off. Added only through the folder picker (logs:addFolder).
 */
export function OtherLogFolders() {
  const { patchSettings } = useActions()
  const dirs = useSettled((s) => s.settings.logFolders)
  const [looks, setLooks] = useState<LogFolderView[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let live = true
    const read = () =>
      api.invoke('logs:folders').then(
        (l) => live && setLooks(l),
        (e) => live && setMessage(`Could not look at the folders: ${errorMessage(e)}`)
      )
    void read()
    const t = setInterval(() => void read(), FOLDER_LOOK_MS)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [dirs])

  const add = async () => {
    setMessage('')
    try {
      const r = await api.invoke('logs:addFolder')
      if (r.problem) setMessage(r.problem)
    } catch (e) {
      setMessage(`Could not add that folder: ${errorMessage(e)}`)
    }
  }
  const lookAgain = async () => {
    setBusy(true)
    setMessage('')
    try {
      setLooks(await api.invoke('logs:folders', true))
    } catch (e) {
      setMessage(`Could not look at the folders: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const remove = (dir: string) => patchSettings((x) => ({ ...x, logFolders: x.logFolders.filter((d) => d !== dir) }))

  return (
    <div className="stack gap-12">
      <div className="field">
        <p className="hint">
          Play on another PC too? Add its Logs folder and each character&apos;s log there counts toward that character here: motes, Slayer and Hunter kills, factions, AAs, skills,
          casts and purchases. Share the folder on that PC (right-click EverQuest Legends\Logs, Properties, Sharing; reading is enough), then add it here as{' '}
          <span className="mono">{'\\\\THATPC\\Logs'}</span>. It is only ever read. Timers, overlays and the meter stay with this PC&apos;s log.
        </p>
      </div>
      {dirs.length > 0 && (
        <div className="table-scroll">
          <table className="table small">
            <tbody>
              {dirs.map((dir) => {
                const l = looks?.find((x) => x.dir.toLowerCase() === dir.toLowerCase())
                const held = l?.characters.length ? who(l.characters) : ''
                return (
                  <tr key={dir}>
                    <td style={{ width: 24 }}>
                      {!l ? <span className="chip">looking</span> : l.reachable ? <span className="chip ok">answering</span> : <span className="chip warn">not answering</span>}
                    </td>
                    <td className="mono" style={{ wordBreak: 'break-all' }}>
                      {dir}
                    </td>
                    <td className={l?.reachable && held ? '' : 'muted'}>
                      {!l
                        ? ''
                        : l.reachable
                          ? held || 'No character logs in it yet'
                          : `Is that PC on, with the folder shared? What was read from it before still counts${held ? ` (${held})` : ''}.`}
                    </td>
                    <td style={{ width: 1 }}>
                      <button className="btn small ghost" aria-label={`Remove ${dir}`} onClick={() => void remove(dir)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        <button className="btn" disabled={dirs.length >= MAX_LOG_FOLDERS} onClick={() => void add()}>
          Add folder…
        </button>
        {dirs.length > 0 && (
          <button className="btn" disabled={busy} onClick={() => void lookAgain()}>
            {busy ? 'Looking…' : 'Look again'}
          </button>
        )}
      </div>
      {message && (
        <div className="notice bad small" role="status">
          {message}
        </div>
      )}
    </div>
  )
}
