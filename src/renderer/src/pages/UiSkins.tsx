import { useActions, useSettled } from '../state'
import { useInvoke } from '../hooks'
import { useCharacterChoice } from '../character'
import { who } from '../../../core/format'
import { startKey, type SkinBuild } from '../../../core/skinBuild'
import { Ago, ErrorText, Switch } from '../components/ui'
import { SkinBuildOutcome, useSkinBuild } from '../components/SkinBuild'

/**
 * Settings › UI: what the UI skins in the game folder offer through a legends-tracker.json in their folder
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
          Your UI skins: rebuilding them, and what runs each time the game starts. A skin offers these in a legends-tracker.json in its folder; one without the file shows nothing
          here.
        </p>
      </div>
      <div className="stack">
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
