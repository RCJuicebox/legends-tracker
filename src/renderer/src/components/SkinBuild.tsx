import { useState } from 'react'
import { act } from '../toast'
import { who } from '../../../core/format'
import { ErrorText, GameCommand } from './ui'
import type { SkinBuildResult } from '../../../core/skinBuild'

// Rebuilding a UI skin from the inventory export (src/core/skinBuild.ts): the run and its outcome, shared
// by Settings › UI's buttons and Tradeskills › Bag layout.

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
