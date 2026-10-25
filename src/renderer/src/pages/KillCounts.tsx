import { useMemo, useState } from 'react'
import { useInvoke, useVisibleInterval } from '../hooks'
import { useRemembered } from '../remember'
import { useCharacterChoice } from '../character'
import { CharacterPicker } from '../components/CharacterPicker'
import { Ago, FilterBox, Info, Pending, type Sort, SortTh } from '../components/ui'
import { num } from '../../../core/format'
import type { MobKills } from '../../../features/slayer/core'

// Respawns › Kill counts: how often the character has killed each mob, zone by zone with every
// instance of a zone together, counted over its logs and archives (the Slayer counts' log history).

const HOW =
  'Every kill your log saw, counted over the live log and its archives, and the same character’s log on your other PCs (Settings › Log files). ' +
  'A kill is a mob slain by you or by a killer with a one-word name: your pet, your group, or another player near enough for your log to see it, so a raid’s kills count too. ' +
  'Mobs’ own pets are left out. The instances of a zone (Nektropos Castle 4 (Refined)) count as the zone.'

/** The table draws this many rows at most; the filter narrows the rest. */
const SHOWN = 500

type SortKey = 'mob' | 'zone' | 'kills' | 'last'

const SORT_VALUE: Record<SortKey, (r: MobKills) => string | number> = {
  mob: (r) => r.mob.toLowerCase(),
  zone: (r) => r.zone.toLowerCase(),
  kills: (r) => r.kills,
  last: (r) => r.last
}

export function KillCounts() {
  const chars = useCharacterChoice('achievements', { withLogs: true })
  const character = chars.character
  const q = useInvoke(character ? 'slayer:kills' : null, [character])
  useVisibleInterval(q.reload, 60_000, !!character)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useRemembered<Sort<SortKey>>('kills.sort', { key: 'kills', dir: -1 })

  const all = q.data?.character === character ? q.data.rows : null
  const rows = useMemo(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const value = SORT_VALUE[sort.key] ?? SORT_VALUE.kills
    return (all ?? [])
      .filter((r) => words.every((w) => r.mob.toLowerCase().includes(w) || r.zone.toLowerCase().includes(w)))
      .sort((a, b) => {
        const x = value(a)
        const y = value(b)
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || b.kills - a.kills
      })
  }, [all, filter, sort])
  const kills = rows.reduce((n, r) => n + r.kills, 0)

  return (
    <>
      <div className="card row mb-16">
        <FilterBox placeholder="Filter by mob or zone…" label="Filter kill counts" value={filter} onChange={setFilter} width={240} />
        <Info label="What is counted" text={HOW} />
        <span className="spacer" />
        <CharacterPicker character={character} available={chars.available} onPick={chars.setCharacter} />
      </div>

      {!chars.ready ? (
        <Pending error={chars.error} retry={chars.reload} what="your characters" />
      ) : !character ? (
        <div className="card empty">No character log found yet.</div>
      ) : !all ? (
        <Pending error={q.error} retry={q.reload} doing="Counting kills in your logs" />
      ) : !rows.length ? (
        <div className="card empty">{all.length ? `No mob or zone matches "${filter.trim()}".` : 'No kills in your logs yet.'}</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="small muted" style={{ padding: '10px 14px' }}>
            {num(kills)} kill{kills === 1 ? '' : 's'} of {num(rows.length)} mob{rows.length === 1 ? '' : 's'}
            {filter.trim() ? ' matching' : ''}
            {rows.length > SHOWN ? `; the first ${num(SHOWN)} shown, a filter narrows them` : ''}.
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <SortTh k="mob" sort={sort} onSort={setSort}>
                    Mob
                  </SortTh>
                  <SortTh k="zone" sort={sort} onSort={setSort}>
                    Zone
                  </SortTh>
                  <SortTh k="kills" sort={sort} onSort={setSort} num>
                    Kills
                  </SortTh>
                  <SortTh k="last" sort={sort} onSort={setSort}>
                    Last killed
                  </SortTh>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, SHOWN).map((r) => (
                  <tr key={`${r.zone}|${r.mob}`}>
                    <td>{r.mob}</td>
                    <td className="muted">{r.zone}</td>
                    <td className="num mono">{num(r.kills)}</td>
                    <td className="nowrap">{r.last ? <Ago t={r.last} /> : <span className="faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
