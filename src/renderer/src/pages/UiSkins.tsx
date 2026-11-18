import { useEffect } from 'react'
import { useActions, useSettled } from '../state'
import { useInvoke } from '../hooks'
import { useCharacterChoice } from '../character'
import { who } from '../../../core/format'
import { startKey, type SkinBuild } from '../../../core/skinBuild'
import { Ago, ErrorText, Switch } from '../components/ui'
import { SkinBuildOutcome, useSkinBuild } from '../components/SkinBuild'

/**
 * Settings › UI: Live's player models, for anyone (src/core/liveModels.ts), then what the UI skins in the game folder offer through a legends-tracker.json in their folder
 * (src/core/skinBuild.ts): a rebuild, run after a game patch or a bag swap, and a command to run each time
 * the game starts, which runs only once switched on here, with the whole command in view.
 */
export function UiSkins() {
  const { character } = useCharacterChoice('inventory')
  const builds = useInvoke('skins:builds')
  const rebuild = useSkinBuild(character)
  return (
    <>
      <div className="page-head">
        <p>
          How the game looks: Live&apos;s player models, and your UI skins (rebuilding them, and what runs each time the game starts). A skin offers its part in a
          legends-tracker.json in its folder; one without the file shows nothing here.
        </p>
      </div>
      <div className="stack">
        <LiveModels />
        {builds.error && <ErrorText>Could not look at the skins: {builds.error}</ErrorText>}
        {builds.data && !builds.data.length && <div className="card muted">No UI skin in the game folder offers anything here.</div>}
        {builds.data?.map((b) => (
          <div key={b.skin} className="card stack gap-12">
            <h2>{b.skin}</h2>
            <div className="row">
              <button className="btn" disabled={!!rebuild.busy} title={b.command.join(' ')} onClick={() => void rebuild.run(b.skin)}>
                {rebuild.busy === b.skin ? 'Rebuilding…' : b.label}
              </button>
              <span className="faint small">
                After a game patch, or a bag swapped for a bigger one: rebuilt from the game&apos;s own windows and {character ? `${who(character)}'s` : 'the'} inventory export.
              </span>
            </div>
            {rebuild.result?.skin === b.skin && <SkinBuildOutcome build={rebuild} character={character} />}
            {b.onGameStart && <GameStart build={b} />}
          </div>
        ))}
      </div>
    </>
  )
}

/** A skin's game-start command: its switch, the command it runs, and how it last went. */
function GameStart({ build }: { build: SkinBuild }) {
  const { patchSettings } = useActions()
  const enabled = useSettled((s) => s.settings.skinStartCommands)
  const start = build.onGameStart!
  const key = startKey(start.command)
  const on = enabled.includes(key)
  const set = (v: boolean) =>
    void patchSettings((s) => ({ ...s, skinStartCommands: v ? [...s.skinStartCommands.filter((k) => k !== key), key] : s.skinStartCommands.filter((k) => k !== key) }))
  const last = build.lastStart
  return (
    <div className="stack gap-8">
      <label className="row">
        <Switch on={on} onChange={set} />
        {start.label}
        <span className="faint small">each time the game starts</span>
      </label>
      <span className="faint small">Runs this program, in the skin&apos;s folder; switch it on only if you trust where the skin came from:</span>
      <code className="mono small">{start.command.join(' ')}</code>
      {last && (
        <span className={`small ${last.ok ? 'faint' : ''}`}>
          {last.ok ? 'Last ran ' : 'Failed '}
          <Ago t={last.at} />
          {last.output ? `: ${last.output.split('\n').pop()}` : ''}
        </span>
      )}
    </div>
  )
}

/** Live's newer ("Luclin") player models: the switch, and whether the game's file loads them now. */
function LiveModels() {
  const { patchSettings } = useActions()
  const on = useSettled((s) => s.settings.liveModels)
  const status = useInvoke('skins:liveModels')
  const { reload } = status
  // The lines go in or out as the setting is saved: look again a moment later.
  useEffect(() => {
    const t = setTimeout(reload, 600)
    return () => clearTimeout(t)
  }, [on, reload])
  const s = status.data
  return (
    <div className="card stack gap-8">
      <h2>Player models</h2>
      <label className="row">
        <Switch on={on} onChange={(v) => void patchSettings((x) => ({ ...x, liveModels: v }))} />
        Live&apos;s player models (Luclin-style)
        <span className="faint small">instead of the classic ones</span>
      </label>
      <span className="faint small">
        The game ships Live&apos;s newer player-race models and their animations but never loads them. Switched on, Legends Tracker adds the lines that load them to the game&apos;s
        Resources\GlobalLoad.txt each time the game starts (its launcher puts the file back every time), so keep Legends Tracker running when you start the game. Switching it off
        takes the lines out again. Vah Shir and Half Dark Elf keep their own models.
      </span>
      {status.error && <ErrorText>{status.error}</ErrorText>}
      {s?.error && <span className="small">Could not read GlobalLoad.txt: {s.error}</span>}
      {s && !s.error && (
        <span className="faint small">
          {s.lines
            ? `The game's file loads them now (${s.lines} lines); a game already running shows them after a restart.`
            : on
              ? 'Added the next time the game starts.'
              : 'The game loads the classic models.'}
        </span>
      )}
      {s?.last && !s.last.ok && (
        <span className="small">
          Failed <Ago t={s.last.at} />: {s.last.output}
        </span>
      )}
    </div>
  )
}
