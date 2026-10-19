import { useState } from 'react'
import { api } from '../../renderer/src/api'
import { showToast } from '../../renderer/src/toast'
import type { FoundSpot } from '../../shared/game/legendsSpawns'
import type { PlayerLocation } from '../../shared/tracking'
import { zoneKey } from '../../core/zones'

// "Found it here" on a named of Plan › Hunter (FEAT-020): a spot the player found it at in play, as
// /loc prints it or as y, x, with a few words, kept in hunter-spots.json and drawn and marked as
// Legends' own spawns are. The spots already found are listed with a ✕ to forget one.

export function FoundHere({
  zone,
  name,
  spots,
  location,
  onChange
}: {
  zone: string
  name: string
  /** The spots found for this named. */
  spots: FoundSpot[]
  /** The player's last /loc, if any. */
  location: PlayerLocation | null
  onChange: (all: FoundSpot[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [spot, setSpot] = useState('')
  const [words, setWords] = useState('')
  const here = location && zoneKey(location.zone) === zoneKey(zone) ? location : null
  const save = async () => {
    try {
      onChange(await api.invoke('hunter:found', zone, name, spot, words))
      showToast(`Kept a spot for ${name}: on its map, and marked with the zone's named.`)
      setSpot('')
      setWords('')
      setOpen(false)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { tone: 'bad' })
    }
  }
  const forget = async (s: FoundSpot) => onChange(await api.invoke('hunter:unfound', zone, name, s.on))
  return (
    <span className="hu-found">
      {spots.map((s) => (
        <span key={s.on} className="chip pill gold ml-6" title={s.where ?? 'Found by you'}>
          you found it at {s.at[0]}, {s.at[1]}
          <button className="link-button inline" aria-label={`Forget the spot at ${s.at[0]}, ${s.at[1]}`} onClick={() => void forget(s)}>
            ✕
          </button>
        </span>
      ))}
      {!open ? (
        <button className="link-button inline small ml-6" onClick={() => setOpen(true)}>
          Found it here
        </button>
      ) : (
        <span className="row tight small hu-found-form">
          <input
            value={spot}
            onChange={(e) => setSpot(e.target.value)}
            placeholder="Your Location is 661.88, -301.44, -40.42"
            aria-label={`Where you found ${name}: /loc as the game prints it, or y, x`}
            size={34}
          />
          {here && (
            <button className="btn small ghost" onClick={() => setSpot(`${here.y}, ${here.x}, ${here.z}`)} title="Your last /loc in this zone">
              Use my /loc
            </button>
          )}
          <input value={words} onChange={(e) => setWords(e.target.value)} placeholder="a few words (by the bridge)" aria-label="A few words about the spot" size={22} />
          <button className="btn small" disabled={!spot.trim()} onClick={() => void save()}>
            Keep
          </button>
          <button className="btn small ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </span>
      )}
    </span>
  )
}
