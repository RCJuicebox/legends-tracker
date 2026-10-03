import { useState } from 'react'
import { useInvoke } from '../hooks'
import { act } from '../toast'
import { Ago, ErrorText, GameCommand, Pending } from '../components/ui'
import { BAG_KINDS, bagCells, bagGrid, type BagKind, type BagLayoutView, type BagSlot, type SkinBuild, type SkinBuildResult } from '../../../core/skinBuild'

// Tradeskills › Bag layout: for a UI skin that draws each bag as a block of cells (src/core/skinBuild.ts),
// how many cells go on a line, bag by bag, saved in the skin's folder and put in game by its rebuild.

const KIND_TITLES: Record<BagKind, string> = { General: 'Bags', Bank: 'Bank', SharedBank: 'Shared bank' }
const KIND_SHORT: Record<BagKind, string> = { General: 'Bag', Bank: 'Bank', SharedBank: 'Shared' }

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
        Rebuilt from {character ? `${character}'s` : 'the'} export. In game: <GameCommand cmd={`/loadskin ${r.skin} 1`} />
      </span>
    )
  if (r.confirm)
    return (
      <div className="notice stack gap-6" role="alert">
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

/** A bag's cells in their lines: the bag's own slot first, then its contents. */
function BagPreview({ cells, columns }: { cells: number; columns: number }) {
  const { across } = bagGrid(cells, columns)
  return (
    <div className="bag-preview" style={{ gridTemplateColumns: `repeat(${across}, 7px)` }} aria-hidden>
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} className={i === 0 ? 'bag' : undefined} />
      ))}
    </div>
  )
}

export function BagLayout({ build, character }: { build: SkinBuild; character: string }) {
  const layout = useInvoke('skins:layout', [build.skin, character])
  const rebuild = useSkinBuild(character)
  /** Changes not saved yet: a number, or null for back to the skin's default. */
  const [edits, setEdits] = useState<Record<string, number | null>>({})
  const [saving, setSaving] = useState(false)
  const view = layout.data
  if (!view) return <Pending what="the bag layout" error={layout.error} retry={layout.reload} />

  const saved = (b: BagSlot) => view.columns[b.location] ?? null
  const columnsOf = (b: BagSlot) => {
    const e = edits[b.location]
    return e === undefined ? (saved(b) ?? view.spec.defaults[b.kind]) : (e ?? view.spec.defaults[b.kind])
  }
  const changed = Object.keys(edits).length > 0
  const set = (b: BagSlot, n: number | null) => {
    const next = { ...edits }
    const target = n === null || n === view.spec.defaults[b.kind] ? null : Math.max(1, Math.min(view.spec.maxColumns, n))
    if (target === saved(b)) delete next[b.location]
    else next[b.location] = target
    setEdits(next)
  }

  const saveAndRebuild = async () => {
    setSaving(true)
    const columns: Record<string, number> = { ...view.columns }
    for (const [loc, n] of Object.entries(edits)) {
      if (n === null) delete columns[loc]
      else columns[loc] = n
    }
    // act() says what went wrong itself; a layout that was not saved is not rebuilt.
    const kept = await act('skins:saveLayout', view.skin, columns)
    if (kept) {
      setEdits({})
      layout.reload()
      await rebuild.run(view.skin)
    }
    setSaving(false)
  }

  return (
    <div className="stack gap-12">
      <div className="card stack gap-8">
        <div className="row">
          <span>
            How the <b>{view.skin}</b> skin lays out each bag: its own slot, then its contents, so many to a line. A bag keeps room for at least {view.spec.minSlots} slots.
          </span>
          <span className="spacer" />
          <ExportAge view={view} />
        </div>
        <div className="row">
          <button className="btn primary" disabled={!changed || saving || !!rebuild.busy} onClick={() => void saveAndRebuild()}>
            {saving || rebuild.busy ? 'Rebuilding…' : 'Save and rebuild'}
          </button>
          <button className="btn ghost" disabled={!changed || saving} onClick={() => setEdits({})}>
            Undo changes
          </button>
          <SkinBuildOutcome build={rebuild} character={character} />
        </div>
      </div>
      {BAG_KINDS.filter((k) => view.spec.slots[k] > 0).map((kind) => (
        <div key={kind} className="card">
          <h3 className="mt-0">{KIND_TITLES[kind]}</h3>
          <table className="table bag-layout">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Bag</th>
                <th className="num">Slots</th>
                <th>Per line</th>
                <th>Layout</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.bags
                .filter((b) => b.kind === kind)
                .map((b) => {
                  const cols = columnsOf(b)
                  const cells = bagCells(b.slots, view.spec)
                  const { lines, across } = bagGrid(cells, cols)
                  const isDefault = cols === view.spec.defaults[b.kind]
                  return (
                    <tr key={b.location} className={edits[b.location] !== undefined ? 'changed' : undefined}>
                      <td>
                        {KIND_SHORT[b.kind]} {b.location.replace(/^\D+/, '')}
                      </td>
                      <td className={b.name ? undefined : 'muted'}>{b.name || 'empty'}</td>
                      <td className="num">{b.slots || '—'}</td>
                      <td>
                        <span className="row tight">
                          <button className="btn small ghost" aria-label={`Fewer per line in ${b.location}`} disabled={cols <= 1} onClick={() => set(b, cols - 1)}>
                            −
                          </button>
                          <input
                            className="bag-cols"
                            type="number"
                            min={1}
                            max={view.spec.maxColumns}
                            value={cols}
                            aria-label={`Cells per line in ${b.location}`}
                            onChange={(e) => set(b, Math.floor(Number(e.target.value)) || 1)}
                          />
                          <button
                            className="btn small ghost"
                            aria-label={`More per line in ${b.location}`}
                            disabled={cols >= view.spec.maxColumns}
                            onClick={() => set(b, cols + 1)}
                          >
                            +
                          </button>
                        </span>
                      </td>
                      <td>
                        <span className="row tight">
                          <span className="mono">
                            {lines} × {across}
                          </span>
                          <BagPreview cells={cells} columns={cols} />
                        </span>
                      </td>
                      <td>
                        {!isDefault && (
                          <button className="btn small ghost" onClick={() => set(b, null)} title={`Back to the skin's ${view.spec.defaults[b.kind]} per line`}>
                            Default
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function ExportAge({ view }: { view: BagLayoutView }) {
  if (view.error === 'missing')
    return (
      <span className="small muted">
        No inventory export yet: <GameCommand cmd="/outputfile inventory" />
      </span>
    )
  if (view.error) return <ErrorText>{view.error}</ErrorText>
  return (
    <span className="small faint">
      Bags from the inventory export, <Ago t={view.exportedAt} />
    </span>
  )
}
