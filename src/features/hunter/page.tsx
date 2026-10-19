import { useMemo, useState } from 'react'
import { CharacterPicker } from '../../renderer/src/components/CharacterPicker'
import { ago, api } from '../../renderer/src/api'
import { useInvoke, useVisibleInterval } from '../../renderer/src/hooks'
import { useActions, useLive, useSettled } from '../../renderer/src/state'
import { DEFAULT_ACHIEVEMENT_OPTIONS } from '../../shared/overlays'
import { useNow } from '../../renderer/src/components/TimerBars'
import { FilterBox, GameCommand, Info, Pending, Tip, ToggleChip } from '../../renderer/src/components/ui'
import { showToast } from '../../renderer/src/toast'
import { duration, num, who } from '../../core/format'
import { usePlanCharacter } from '../slayer/page'
import { clock } from '../slayer/core'
import { SpawnMap } from '../slayer/SpawnMap'
import { hunterHere, hunterMatch, type HunterNamed } from './core'

// Plan › Hunter: each Hunter achievement not done, the named it still wants, and what classic's spawn
// tables say of each (core.ts), the zones quickest to finish first. The achievements overlay shows
// the zone the player is in (Overlays).

const HOW = (
  <>
    <div>
      <b>What is left</b> is your achievements export (<code>/outputfile achievements</code>), less the named your log has shown you killing since.
    </div>
    <div>
      <b>Spawns</b> are TAKP’s classic spawn tables: the spots a named can pop at, how often it rolls there against its placeholders, and its timer. Legends’ respawns run quicker
      than classic, one timer for a zone, so a zone runs on the respawn your Respawns page has timed there. Legends has changed some spawns too: take the odds as a lead.
    </div>
    <div>
      <b>The wait</b> is how long its spots are cleared, on average, before the named pops: its timer over how often it is up. A zone’s named pop side by side, so a zone takes as
      long as its longest wait; the quickest zones come first.
    </div>
  </>
)

/** How a named spawns, short: "1 spot · 10% · 6:00 · ≈ 1 h". */
function NamedSpawn({ n }: { n: HunterNamed }) {
  if (!n.spawn && n.legends)
    return (
      <Tip
        className="mono sl-spawn"
        text={`Legends’ own, not in TAKP’s tables: the spots ${n.legends.said.replace(/,.*$/, '')} found${n.legends.ph ? `; it pops in place of ${n.legends.ph.join(' or ')}` : ''}. Its odds and timer are not known; Map shows where.`}
      >
        {' '}
        ({n.legends.spots === 1 ? '1 spot' : `${num(n.legends.spots)} spots`}
        {n.legends.ph ? ` · PH ${n.legends.ph.join(' or ')}` : ''})
      </Tip>
    )
  if (!n.spawn) return <span className="faint small"> (not in TAKP’s tables)</span>
  const s = n.spawn
  const odds = s.up >= 1 ? 'always up' : `${num(Math.round(s.up * 100))}%`
  const timer = `${clock(s.timer)}${s.timerFrom === 'timed' ? ' (timed by your log)' : s.timerFrom === 'zone' ? ' (the zone’s respawn as you timed it)' : ' (classic)'}`
  return (
    <Tip
      className="mono sl-spawn"
      text={`${s.name}, level ${s.lo === s.hi ? s.lo : `${s.lo}–${s.hi}`}: ${s.spots === 1 ? 'one spot' : `${num(s.spots)} spots`}, up ${odds} of the time, respawn ${timer}. ${
        s.up >= 1
          ? `Up now: the first kill waits nothing, the next its timer, ${clock(s.timer)}.`
          : `Clearing its spots, it pops in about ${duration(n.wait ?? s.timer)} on average.`
      }`}
    >
      {' '}
      ({s.spots === 1 ? '1 spot' : `${num(s.spots)} spots`} · {odds} · {clock(s.timer)} · {s.up >= 1 ? `up now, then every ${clock(s.timer)}` : `≈ ${duration(n.wait ?? s.timer)}`})
    </Tip>
  )
}

/** What the Respawns records say of a named: when it died last, and whether it is back. */
function Seen({ n }: { n: HunterNamed }) {
  return (
    <Tip
      className="faint small"
      text={
        n.seen
          ? 'From the Respawns records: every death the log saw in the zone, and the respawn it timed'
          : 'The log has not seen it die; the Respawns page times a spawn from its deaths'
      }
    >
      {' '}
      · {n.seen ?? 'not seen die in your log'}
    </Tip>
  )
}

export function Hunter() {
  const chars = usePlanCharacter()
  const character = chars.character
  const q = useInvoke(character ? 'hunter:plan' : null, [character])
  useVisibleInterval(q.reload, 60_000)
  const now = useNow(30_000)
  const [maps, setMaps] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const zoneNow = useLive((l) => l.status.zone)
  // The achievements overlay's Hunter rows: the switch under Settings › Overlays, here too (LT-677).
  const { patchSettings } = useActions()
  const achOverlay = useSettled((s) => s.settings.overlays.find((o) => o.kind === 'achievements'))
  const onOverlay = (achOverlay?.achievements ?? DEFAULT_ACHIEVEMENT_OPTIONS).hunter ?? true
  const setOnOverlay = (on: boolean) =>
    void patchSettings((s) => ({
      ...s,
      overlays: s.overlays.map((o) => (o.kind === 'achievements' ? { ...o, achievements: { ...DEFAULT_ACHIEVEMENT_OPTIONS, ...o.achievements, hunter: on } } : o))
    }))
  const data = q.data
  // The achievements of the zone the player is in: marked, and lifted to the top while there (LT-672).
  const hereSet = useMemo(() => new Set(data && zoneNow ? hunterHere(data.zones, zoneNow).map((z) => z.achievement) : []), [data, zoneNow])
  const shown = useMemo(
    () =>
      (data?.zones ?? [])
        .map((z, i) => ({ z, i }))
        .filter(({ z }) => hunterMatch(z, filter))
        .sort((a, b) => Number(hereSet.has(b.z.achievement)) - Number(hereSet.has(a.z.achievement)) || a.i - b.i),
    [data, filter, hereSet]
  )
  const toggleMap = (a: string) => setMaps((m) => (m.has(a) ? new Set([...m].filter((x) => x !== a)) : new Set([...m, a])))
  /** Marks the named of these zones on the game's map (the Hunter set holds only these); none clears it. Said in a toast (LT-674). */
  const mark = async (zones: NonNullable<typeof data>['zones']) => {
    const marks = zones.map((z) => ({ zone: z.zone, mobs: [], named: z.left.map((n) => n.name) }))
    try {
      const r = await api.invoke('slayer:mark', marks, 'hunter')
      showToast(
        marks.length
          ? `Marked ${num(r.spots)} spot${r.spots === 1 ? '' : 's'} in ${marks.length === 1 ? zones[0].zone : `${r.zones} zones`}: pick the LegendsTracker map set in the game’s map window.`
          : 'Hunter marks cleared from the LegendsTracker map set.'
      )
    } catch (e) {
      showToast(`Could not mark the map: ${e instanceof Error ? e.message : String(e)}`, { tone: 'bad' })
    }
  }
  const left = data ? data.zones.reduce((s, z) => s + z.left.length, 0) : 0
  const setBroken = async (achievement: string, broken: boolean) => {
    try {
      await api.invoke('hunter:broken', achievement, broken)
      q.reload()
    } catch (e) {
      showToast(`Could not save that: ${e instanceof Error ? e.message : String(e)}`, { tone: 'bad' })
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hunter</h1>
          <div className="lead">
            The named each Hunter achievement still wants, and where and how often they spawn
            {data?.export ? (
              <>
                . Counts are {data.export.file} (written by the game {ago(data.export.modified, now)}) plus your kills since; type <GameCommand cmd="/outputfile achievements" /> in
                game to refresh it.
              </>
            ) : (
              '.'
            )}{' '}
            <Info label="How it is worked out" text={HOW} />
          </div>
        </div>
        <div className="actions">
          <CharacterPicker character={character} available={chars.available} onPick={chars.setCharacter} />
        </div>
      </div>

      {!chars.ready ? (
        <Pending error={chars.error} retry={chars.reload} what="your characters" />
      ) : !character ? (
        <div className="card empty">No character yet. Choose the game folder on the Settings page, then play with logging on (/log on).</div>
      ) : !data ? (
        <Pending error={q.error} retry={q.reload} doing="Reading your kills" />
      ) : !data.export ? (
        <div className="card empty">
          No achievements export for {who(character)} yet. Type <GameCommand cmd="/outputfile achievements" /> in game.
        </div>
      ) : (
        <>
          {!data.zones.length && (
            <div className="card empty mb-16">{data.broken.length ? 'Every Hunter achievement that works is done.' : 'Every Hunter achievement is done.'}</div>
          )}
          {data.zones.length > 0 && (
            <>
              <div className="card row mb-16">
                <span>
                  <b>{data.zones.length}</b> Hunter achievement{data.zones.length === 1 ? '' : 's'} to go, <b>{num(left)}</b> named
                </span>
                <FilterBox placeholder="Find a zone or named…" label="Find a zone, achievement or named" value={filter} onChange={setFilter} width={240} />
                <span className="spacer" />
                {achOverlay && (
                  <ToggleChip
                    on={onOverlay}
                    onChange={setOnOverlay}
                    title="Show the named left in the zone you are in on the achievements overlay, for every character (the switch under Settings › Overlays)"
                  >
                    On the overlay
                  </ToggleChip>
                )}
                <Tip text="Puts a blue dot at every spot the named left pop at, every zone’s, on the game’s own map: in a map set of its own, LegendsTracker (a copy of the game’s maps, so its own stay as they are). Pick it in the map window. A zone’s Mark marks that zone alone.">
                  <button className="btn small" onClick={() => void mark(data.zones)}>
                    Mark every zone on the game’s map
                  </button>
                </Tip>
                <button className="btn small ghost" onClick={() => void mark([])} title="Take the Hunter marks off the LegendsTracker map set">
                  Clear marks
                </button>
              </div>
              <div className="card mb-16">
                {!shown.length && <div className="faint small">Nothing to go matches “{filter.trim()}”.</div>}
                <ol className="fp-steps">
                  {shown.map(({ z, i }) => (
                    <li key={z.achievement} className={`fp-step${hereSet.has(z.achievement) ? ' now' : ''}`}>
                      <span className="fp-num">{i + 1}</span>
                      <div className="fp-body">
                        <div className="fp-head">
                          <span className="fp-zone">{z.zone}</span>
                          {hereSet.has(z.achievement) && (
                            <Tip className="chip fp-now-chip" text="The zone you are in">
                              You are here
                            </Tip>
                          )}
                          <span className="small">{z.achievement}</span>
                          <span className="spacer" />
                          <span className="mono small">
                            {z.left.length} of {z.total} left
                          </span>
                          <Tip
                            className="mono fp-time"
                            text={z.wait === null ? 'A named here is not in TAKP’s tables: no time for the zone' : 'The longest wait of the named left: they pop side by side'}
                          >
                            {z.wait === null ? '—' : `≈ ${duration(z.wait)}`}
                          </Tip>
                          <button
                            className="btn small ghost"
                            onClick={() => toggleMap(z.achievement)}
                            aria-expanded={maps.has(z.achievement)}
                            title="Where the named left spawn, on the game’s own map of the zone"
                          >
                            Map
                          </button>
                          <button className="btn small ghost" onClick={() => void mark([z])} title="Mark this zone’s named alone on the game’s map (the LegendsTracker map set)">
                            Mark
                          </button>
                          <button
                            className="btn small ghost"
                            onClick={() => void setBroken(z.achievement, true)}
                            title="It does not work in Legends: leave it out of the plans and the overlay until you say it works again"
                          >
                            Doesn’t work
                          </button>
                        </div>
                        <div className="small">
                          {z.left.map((n) => (
                            <div key={n.name}>
                              <b>{n.name}</b>
                              <NamedSpawn n={n} />
                              <Seen n={n} />
                            </div>
                          ))}
                        </div>
                        {z.since.length > 0 && <div className="faint small">Killed since your export: {z.since.join(', ')}</div>}
                        {maps.has(z.achievement) && <SpawnMap zone={z.zone} mobs={z.left.map((n) => n.name)} />}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
          {data.broken.length > 0 && (
            <div className="card mb-16">
              <h2>
                Not working <span className="faint small">{data.broken.length}</span>
              </h2>
              <div className="faint small mb-8">
                Hunter achievements you said do not work in Legends: left out of the plans, the Slayer plan’s steps and the overlay, for every character.
              </div>
              {data.broken.map((b) => (
                <div key={b} className="row tight small">
                  <span>{b}</span>
                  <button className="btn small ghost" onClick={() => void setBroken(b, false)}>
                    Works again
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
