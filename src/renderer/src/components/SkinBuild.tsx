import { useState } from 'react'
import { useInvoke } from '../hooks'
import { act } from '../toast'
import { useCharacterChoice } from '../character'
import { who } from '../../../core/format'
import { ErrorText, GameCommand } from './ui'
import type { SkinBuildResult } from '../../../core/skinBuild'

// Rebuilding a UI skin from the inventory export (src/core/skinBuild.ts): the buttons on Settings ›
// General's Game card, and the run and its outcome that Tradeskills › Bag layout shares.

/** Running a skin's rebuild, with the first-run agreement its command needs (LT-442). */
export function useSkinBuild(character: string) {
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<SkinBuildResult | null>(null)
  const run = async (skin: string, approve = false) => {
    setBusy(skin)
    setResult(null)
    const r = await act('skins:build', skin, character, approve)
    setBusy('')
    if (r) setResult(r)
    return r
  }
  return { busy, result, run, clear: () => setResult(null) }
}

/** What a rebuild came to: the /loadskin line, the command to agree to, or what went wrong. */
export function SkinBuildOutcome({ build, character }: { build: ReturnType<typeof useSkinBuild>; character: string }) {
  const r = build.result
  if (!r) return null
  if (r.ok)
    return (
      <span>
        Rebuilt from {character ? `${who(character)}'s` : 'the'} export. In game: <GameCommand cmd={`/loadskin ${r.skin} 1`} />
      </span>
    )
  if (r.confirm)
    return (
      <div className="notice stack gap-8" role="alert">
        <span>The {r.skin} skin asks to run this program, which this app has not run before. Run it only if you trust where the skin came from:</span>
        <code className="mono small">{r.confirm.join(' ')}</code>
        <span className="row tight">
          <button className="btn small primary" onClick={() => void build.run(r.skin, true)}>
            Run it
          </button>
          <button className="btn small ghost" onClick={build.clear}>
            Cancel
          </button>
        </span>
      </div>
    )
  return (
    <ErrorText>
      Could not rebuild {r.skin}: {r.output || 'no output'}
    </ErrorText>
  )
}

/**
 * A button for each UI skin that asks to be rebuilt from the inventory export (a legends-tracker.json
 * in its folder), beside the game folder on Settings › General, for the character the character
 * pages show. Nothing shows when no skin asks.
 */
export function SkinRebuilds() {
  const { character } = useCharacterChoice('inventory')
  const builds = useInvoke('skins:builds')
  const rebuild = useSkinBuild(character)
  if (!builds.data?.length) return null
  return (
    <div className="row small">
      <span className="faint">UI skins rebuilt from {character ? `${who(character)}'s` : 'the'} inventory export:</span>
      {builds.data.map((b) => (
        <button key={b.skin} className="btn" disabled={!!rebuild.busy} title={b.command.join(' ')} onClick={() => void rebuild.run(b.skin)}>
          {rebuild.busy === b.skin ? 'Rebuilding…' : b.label}
        </button>
      ))}
      <SkinBuildOutcome build={rebuild} character={character} />
    </div>
  )
}
