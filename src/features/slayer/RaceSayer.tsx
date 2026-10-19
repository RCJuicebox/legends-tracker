import { api } from '../../renderer/src/api'
import { useInvoke } from '../../renderer/src/hooks'
import { showToast } from '../../renderer/src/toast'
import { num } from '../../core/format'

// Kills no race was found for, each with a race to say it is (FEAT-021): what the player says is kept
// in slayer-races.json for every character, outranks eqlwiki's, and settles the overlay's guesses. The
// races said are listed with an undo.

/** "half elf" → "Half Elf". */
const title = (k: string) => k.replace(/\b[a-z]/g, (c) => c.toUpperCase())

export function RaceSayer({ unplaced, onSaid }: { unplaced: { name: string; n: number }[]; onSaid?: () => void }) {
  const q = useInvoke('slayer:said')
  const said = q.data?.races ?? {}
  const say = async (mob: string, race: string | null) => {
    try {
      const races = await api.invoke('slayer:sayRace', mob, race)
      q.setData((had) => (had ? { ...had, races } : had))
      showToast(race ? `${mob} counts as ${title(race)} from now on, for every character.` : `${mob}: back to what eqlwiki and its name say.`)
      onSaid?.()
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { tone: 'bad' })
    }
  }
  const saidList = Object.entries(said)
  if (!unplaced.length && !saidList.length) return null
  return (
    <div className="card mb-16 small">
      {unplaced.length > 0 && (
        <>
          <b>Kills no race was found for</b>{' '}
          <span className="faint">(eqlwiki has no race for them and the name gives none, so they count toward nothing until you say what they are):</span>
          <ul className="sl-say">
            {unplaced.map((u) => (
              <li key={u.name}>
                {u.name} <span className="faint">×{num(u.n)}</span>{' '}
                <select aria-label={`What race ${u.name} is`} value="" disabled={!q.data} onChange={(e) => e.target.value && void say(u.name, e.target.value)}>
                  <option value="">Count as…</option>
                  {(q.data?.names ?? []).map((r) => (
                    <option key={r} value={r}>
                      {title(r)}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </>
      )}
      {saidList.length > 0 && (
        <div className="mt-12">
          <span className="faint">You said: </span>
          {saidList.map(([mob, race]) => (
            <span key={mob} className="chip pill ml-6" title="Kept for every character, over what eqlwiki says">
              {mob} → {title(race)}
              <button className="link-button inline ml-6" aria-label={`Forget that ${mob} is ${title(race)}`} onClick={() => void say(mob, null)}>
                Undo
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
