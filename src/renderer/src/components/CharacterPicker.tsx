import { useSettled } from '../state'
import { who } from '../../../core/format'

/**
 * Which character a page shows. The pages that read the game's exports (Stats, Gear, Achievements,
 * Factions, Tradeskills, Motes) show one picked character, which need not be the one being played:
 * this names it (a list to pick from when there are several), says when it is not the one played,
 * and gives a way back to that one.
 */
export function CharacterPicker({ character, available, onPick }: { character: string; available: string[]; onPick: (key: string) => void }) {
  const played = useSettled((s) => s.characterKey)
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const other = !!played && !!character && !same(character, played)
  const canGoBack = other && available.some((a) => same(a, played))
  return (
    <div className="row tight" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {available.length > 1 ? (
        <select aria-label="Character" value={character} onChange={(e) => onPick(e.target.value)}>
          {available.map((c) => (
            <option key={c} value={c}>
              {who(c)}
            </option>
          ))}
        </select>
      ) : character ? (
        <span className="chip" title="The character this page shows">
          {who(character)}
        </span>
      ) : null}
      {other && (
        <span className="chip warn" title={`The character being played is ${who(played)}`}>
          not the one playing
        </span>
      )}
      {canGoBack && (
        <button className="btn small" onClick={() => onPick(played)}>
          Back to {who(played).split(' · ')[0]}
        </button>
      )}
    </div>
  )
}
