import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CharacterPicker } from '../../renderer/src/components/CharacterPicker'
import { ago } from '../../renderer/src/api'
import { useApp } from '../../renderer/src/state'
import { useInvoke } from '../../renderer/src/hooks'
import { useRemembered } from '../../renderer/src/remember'
import { usePickedCharacter } from '../../renderer/src/character'
import { useNow } from '../../renderer/src/components/TimerBars'
import { Disclosure, ErrorText, FilterBox, GameCommand, Info, Pending, Segmented, SortTh, Tabs, Tip, ToggleChip, type Sort } from '../../renderer/src/components/ui'
import { duration, num, when, who, wikiUrl } from '../../core/format'
import {
  STANDING_MAX,
  STANDINGS,
  standingBand,
  type ConBasis,
  type FactionCon,
  type FactionMob,
  type FactionRow,
  type FactionRowAchievement,
  type FactionStandingNow
} from './core'
import { Doing, Flags, PlanTab, sourceNote, useChoices, usePlanSettings } from './planPage'
import { waysToRaise, type PlanActivity } from './planner'
import type { FactionLookup, LookupHit } from './lookup'

// Where the character stands with each faction, from the game's factions export, and the faction
// changes the log recorded, from the character's log and its archives. The log never prints a
// standing, only each change and when one can go no further, so without an export this is the net
// of those. The Plan tab (planPage.tsx) plans the faction achievements still to do.

type View = 'standings' | 'plan'
const VIEWS: [View, string][] = [
  ['standings', 'Standings'],
  ['plan', 'Plan']
]

const HOW = (
  <>
    <div>
      <b>Standing</b> is the factions export (<code>/outputfile faction</code>) plus every change the log recorded since, so it keeps up as you play. It is what the achievements
      count.
    </div>
    <div>
      <b>Con</b> is what NPCs see: the standing plus your race’s, your deity’s and the best of your three classes’ modifiers, from the game’s own table. Race and classes are the
      Stats page’s, kept up by /who; set your deity there (none set counts as Agnostic, which has no modifiers). The bands, from:
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: '0 14px', whiteSpace: 'normal' }}>
      {STANDINGS.map((b) => (
        <span key={b.word}>
          {b.word} <span className="mono">{Number.isFinite(b.min) ? num(b.min).replace('-', '−') : 'below'}</span>
        </span>
      ))}
    </div>
    <div>
      <b>Net change</b> adds up the log’s “Your faction standing with … has been adjusted by N” lines. <b>Maxed</b> (or bottomed): the game said it “could not possibly get any
      better” (or worse), or it is at 2000 (or −2000).
    </div>
  </>
)

type SortKey = 'name' | 'standing' | 'ach' | 'net' | 'changes' | 'cap' | 'last'

/** Which factions to list: all, or the ones whose achievement is still open. */
type Show = 'all' | 'open'

const SHOWN: Record<Show, (r: FactionRow) => boolean> = {
  all: () => true,
  open: (r) => !!r.achievement && r.achievement.done !== true
}

/** Open achievements first, nearest to done first; then the done ones; then factions without one. */
const achOrder = (r: FactionRow) => (!r.achievement ? -Infinity : r.achievement.done ? -1 : (r.standing?.value ?? -STANDING_MAX - 1))

const CAP_ORDER = { top: 2, bottom: 0 }

const SORT_VALUE: Record<SortKey, (r: FactionRow) => string | number> = {
  name: (r) => r.name.toLowerCase(),
  standing: (r) => r.standing?.value ?? -Infinity,
  ach: achOrder,
  net: (r) => r.net,
  changes: (r) => r.changes,
  cap: (r) => (r.cap ? CAP_ORDER[r.cap] : 1),
  last: (r) => r.last
}

function bySort(sort: Sort<SortKey>) {
  const value = SORT_VALUE[sort.key] ?? SORT_VALUE.last
  return (a: FactionRow, b: FactionRow) => {
    const x = value(a)
    const y = value(b)
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.name.localeCompare(b.name)
  }
}

/** "Faction723": a faction the game has no name for. */
const UNNAMED = /^Faction\d+$/

/** +3, −2 (a true minus), 0: the sign says the direction as well as the colour. */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')
/** A standing, with a true minus. */
const plain = (n: number) => (n < 0 ? `−${-n}` : String(n))
const tone = (n: number) => (n > 0 ? 'ok-text' : n < 0 ? 'bad-text' : 'faint')

/** The class in a con's sum: the best of the character's classes ("Bard +50, the best of Monk, Bard and Enchanter"). */
function classPart(basis: ConBasis, c: FactionCon): string {
  const best = basis.classes[c.clsIndex]
  if (!best) return 'no class'
  const all = basis.classes
  return all.length > 1 ? `${best} ${signed(c.cls)}, the best of ${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}` : `${best} ${signed(c.cls)}`
}

/** How a standing was reached (the export's value, and what the log added since), and what NPCs con from it. */
function standingNote(s: FactionStandingNow, basis: ConBasis | null): string {
  const c = s.con
  const band = standingBand(c?.value ?? s.value)
  const next = band.next ? ` ${band.next.points} more to ${band.next.word}.` : ''
  const from = !s.since && s.sinceAll ? `${plain(s.value)} in the factions export.` : `${plain(s.atExport)} in the factions export, ${signed(s.since)} from the log since.`
  const part = s.sinceAll ? '' : ' The log saw more changes since than it keeps, so it may be further off: type /outputfile faction to refresh it.'
  const con =
    c && basis
      ? ` NPCs con ${plain(c.value)}, ${band.word}: ${basis.race} ${signed(c.race)}, ${classPart(basis, c)}, ${basis.deity || 'Agnostic (no deity set)'} ${signed(c.deity)}.`
      : ' The con word is the standing alone: set your race on the Stats page to add your modifiers.'
  return `${from}${con}${next}${part}`
}

/** Characters with a log in the game's Logs folder or a factions export, and the one picked on the character pages. */
function useFactionCharacter() {
  const { state } = useApp()
  const logsQ = useInvoke('logs:list', [], [state.settings.installDir, state.settings.logFile])
  const exportsQ = useInvoke('character:exports', [], [state.settings.installDir])
  const [picked, setPicked] = usePickedCharacter()
  const available = useMemo(() => [...new Set([...(logsQ.data ?? []).map((l) => l.character), ...(exportsQ.data?.factions ?? [])])].sort(), [logsQ.data, exportsQ.data])
  const character = picked && available.includes(picked) ? picked : state.characterKey || available[0] || ''
  return { available, character, setCharacter: setPicked, ready: !!logsQ.data, error: logsQ.error, reload: logsQ.reload }
}

export function Factions() {
  const chars = useFactionCharacter()
  const character = chars.character
  const q = useInvoke(character ? 'factions:get' : null, [character])
  const view = q.data
  const [filter, setFilter] = useState('')
  const [showUnnamed, setShowUnnamed] = useRemembered('factions.unnamed', false)
  const [show, setShow] = useRemembered<Show>('factions.show', 'all')
  const [sort, setSort] = useRemembered<Sort<SortKey>>('factions.sort', { key: 'last', dir: -1 })
  const [open, setOpen] = useState<string | null>(null)
  const [tab, setTab] = useRemembered<View>('factions.view', 'standings')
  const [look, setLook] = useState('')
  const [query, setQuery] = useState('')
  // A lookup is asked for once typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQuery(look.trim()), 250)
    return () => clearTimeout(t)
  }, [look])
  const lookupQ = useInvoke(character && query.length >= 3 ? 'factions:lookup' : null, [character, query])
  // The ways to raise each faction (the Plan tab's catalog, every faction's) are read once a row is first opened.
  const [wantWays, setWantWays] = useState(false)
  useEffect(() => {
    if (open) setWantWays(true)
  }, [open])
  const waysQ = useInvoke(wantWays && character ? 'factions:plan' : null, [character, false, true])
  const viewing: View = tab === 'plan' ? 'plan' : 'standings'
  const now = useNow(30_000)

  // New changes show up as they happen, since the log is read on from where it stopped, and a new
  // export within a few seconds of the game writing it.
  const reload = q.reload
  useEffect(() => {
    const t = setInterval(reload, 10_000)
    return () => clearInterval(t)
  }, [reload])

  const hasExport = !!view?.export
  const unnamed = useMemo(() => (view?.factions ?? []).filter((r) => UNNAMED.test(r.name)).length, [view])
  const achCount = useMemo(() => {
    const withAch = (view?.factions ?? []).filter((r) => r.achievement)
    return { all: withAch.length, open: withAch.filter(SHOWN.open).length }
  }, [view])
  // A remembered filter the data cannot serve (no achievements known, or one no longer offered) shows everything.
  const showing: Show = achCount.all && Object.hasOwn(SHOWN, show) ? show : 'all'
  const withAchColumn = showing !== 'all'
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (view?.factions ?? []).filter((r) => SHOWN[showing](r) && (showUnnamed || !UNNAMED.test(r.name)) && (!f || r.name.toLowerCase().includes(f))).sort(bySort(sort))
  }, [view, filter, sort, showUnnamed, showing])
  const cols = 5 + (hasExport ? 1 : 0) + (withAchColumn ? 1 : 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Factions</h1>
          <p>
            {view?.export ? (
              <>
                Where {who(character) || 'your character'} stands with each faction, from {view.export.file} (written by the game {ago(view.export.modified, now)}), plus the
                changes the log recorded since. Type <GameCommand cmd="/outputfile faction" /> in game to refresh it; this page follows the file.
              </>
            ) : (
              <>
                Faction changes the log recorded for {who(character) || 'your character'}, from its log and its archives. The log does not print your standing, so this is the net
                of what it saw. Type <GameCommand cmd="/outputfile faction" /> in game to see where you stand with every faction.
              </>
            )}{' '}
            <Info label="How it is counted" text={HOW} />
          </p>
        </div>
        <div className="actions">
          <CharacterPicker character={character} available={chars.available} onPick={chars.setCharacter} />
        </div>
      </div>

      <div className="row mb-12">
        <Tabs label="Factions view" value={viewing} onChange={setTab} tabs={VIEWS} />
      </div>

      {viewing === 'plan' ? (
        !chars.ready ? (
          <Pending error={chars.error} retry={chars.reload} what="your characters" />
        ) : !character ? (
          <div className="card empty">
            No character yet. Choose the game folder on the Settings page, then play with logging on (/log on) or type <GameCommand cmd="/outputfile faction" /> in game.
          </div>
        ) : (
          <PlanTab key={character} character={character} view={view ?? null} />
        )
      ) : (
        <>
          {view?.exportError && (
            <div className="notice bad mb-16" role="alert">
              Could not read the factions export: {view.exportError}. Showing the log’s changes only.
            </div>
          )}
          {hasExport && !view?.conBasis && (
            <div className="notice mb-16">
              The con words are the standing alone: {who(character)}’s race is not known yet. Type <GameCommand cmd="/who" /> in game, or set it on the Stats page, for what NPCs
              really see.
            </div>
          )}

          <div className="card row mb-16">
            <FilterBox placeholder="Filter by faction…" label="Filter factions" value={filter} onChange={setFilter} width={260} />
            {achCount.all > 0 && (
              <Segmented
                label="Which factions"
                value={showing}
                onChange={setShow}
                options={[
                  ['all', 'All'],
                  ['open', `Achievements to Do (${achCount.open})`]
                ]}
              />
            )}
            {unnamed > 0 && (
              <ToggleChip on={showUnnamed} onChange={setShowUnnamed} title={`${unnamed} faction${unnamed === 1 ? '' : 's'} the game lists by number only, such as Faction723`}>
                Unnamed ({unnamed})
              </ToggleChip>
            )}
            <FilterBox placeholder="What does a mob or NPC do?" label="Look up a mob or NPC" value={look} onChange={setLook} width={250} />
            <span className="spacer" />
            <span className="faint small">{view ? `${view.factions.length} faction${view.factions.length === 1 ? '' : 's'} on record` : ''}</span>
          </div>

          {query.length >= 3 && !!character && <LookupResults query={query} results={lookupQ.data?.results ?? null} error={lookupQ.error} view={view ?? null} />}

          {!chars.ready ? (
            <Pending error={chars.error} retry={chars.reload} what="your characters" />
          ) : !character ? (
            <div className="card empty">
              No character yet. Choose the game folder on the Settings page, then play with logging on (/log on) or type <GameCommand cmd="/outputfile faction" /> in game.
            </div>
          ) : !view ? (
            <Pending error={q.error} retry={q.reload} what="the factions" hint="The first look reads the whole log and its archives." />
          ) : !rows.length ? (
            <div className="card empty">
              {view.factions.length ? (
                'Nothing matches the filter.'
              ) : (
                <>
                  No faction changes in this log or its archives yet. Type <GameCommand cmd="/outputfile faction" /> in game to see every standing, or kill something with a faction
                  and it appears here.
                </>
              )}
            </div>
          ) : (
            <div className="card" style={{ padding: 0 }}>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <SortTh k="name" sort={sort} onSort={setSort}>
                        Faction
                      </SortTh>
                      {hasExport && (
                        <SortTh k="standing" sort={sort} onSort={setSort} title="From the factions export, plus what the log recorded since">
                          Standing
                        </SortTh>
                      )}
                      {withAchColumn && (
                        <SortTh k="ach" sort={sort} onSort={setSort} title="EverQuest › Progression: done at the maximum standing, 2000">
                          Achievement
                        </SortTh>
                      )}
                      <SortTh k="net" sort={sort} onSort={setSort} num title="Every change the log recorded, added up">
                        Net change
                      </SortTh>
                      <SortTh k="changes" sort={sort} onSort={setSort} num title="How many changes the log recorded">
                        Changes
                      </SortTh>
                      <SortTh k="cap" sort={sort} onSort={setSort} title="Whether it can get no better, or no worse">
                        At the cap
                      </SortTh>
                      <SortTh k="last" sort={sort} onSort={setSort}>
                        Last changed
                      </SortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const key = r.name.toLowerCase()
                      const isOpen = open === key
                      const toggle = () => setOpen(isOpen ? null : key)
                      return (
                        <Fragment key={key}>
                          <tr className={`clickable${isOpen ? ' selected' : ''}`} onClick={toggle}>
                            <td>
                              <Disclosure open={isOpen} onToggle={toggle} stop>
                                {r.name}
                              </Disclosure>
                            </td>
                            {hasExport && (
                              <td className="nowrap">
                                <Standing s={r.standing} basis={view?.conBasis ?? null} />
                              </td>
                            )}
                            {withAchColumn && (
                              <td className="nowrap">
                                <AchievementCell a={r.achievement} s={r.standing} />
                              </td>
                            )}
                            <td className={`num mono ${tone(r.net)}`}>{r.changes ? signed(r.net) : <span className="faint">—</span>}</td>
                            <td className="num mono">{r.changes || '—'}</td>
                            <td>
                              {r.cap === 'top' ? (
                                <span className="chip ok" title="It can get no better">
                                  maxed
                                </span>
                              ) : r.cap === 'bottom' ? (
                                <span className="chip bad" title="It can get no worse">
                                  bottomed
                                </span>
                              ) : (
                                <span className="faint">—</span>
                              )}
                            </td>
                            <td className="faint small nowrap" title={r.last ? when(r.last) : 'The log has no changes for it'}>
                              {r.last ? ago(r.last, now) : '—'}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={cols} style={{ background: 'var(--bg-2)' }}>
                                <History
                                  r={r}
                                  character={character}
                                  basis={view?.conBasis ?? null}
                                  ways={waysQ.data ? { activities: waysQ.data.catalog.activities, logPace: waysQ.data.catalog.killsPerHour } : null}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}

/** A faction's achievement: done, or the points still to go to 2000. */
function AchievementCell({ a, s }: { a: FactionRowAchievement | null; s: FactionStandingNow | null }) {
  if (!a) return <span className="faint">—</span>
  const why =
    a.from === 'achievements'
      ? 'from your achievements export'
      : a.from === 'log'
        ? 'as the game said after your achievements export'
        : a.from === 'standing'
          ? 'from your standing'
          : ''
  if (a.done) {
    return (
      <Tip className="chip ok" text={`${a.name}: done, ${why}`}>
        done
      </Tip>
    )
  }
  if (a.done === null || !s) {
    return (
      <Tip className="chip" text={`${a.name}. Type /outputfile faction in game to see how far there is to go.`}>
        open
      </Tip>
    )
  }
  return (
    <Tip className="row tight" text={`${a.name}: open, ${why}. Done at ${STANDING_MAX}.`}>
      <span className="chip warn">open</span>
      <span className="faint small">{STANDING_MAX - s.value} to go</span>
    </Tip>
  )
}

/** The standing, what NPCs con from it and what is left to the next con. */
function Standing({ s, basis }: { s: FactionStandingNow | null; basis: ConBasis | null }) {
  if (!s) {
    return (
      <Tip className="faint" text="The factions export does not list it">
        —
      </Tip>
    )
  }
  const band = standingBand(s.con?.value ?? s.value)
  return (
    <Tip className="row tight" text={standingNote(s, basis)}>
      <span className="mono" style={{ minWidth: '4.5ch', textAlign: 'right' }}>
        {s.sinceAll ? '' : '≈'}
        {plain(s.value)}
      </span>
      <span className={`chip${band.tone === 'plain' ? '' : ` ${band.tone}`}`}>{band.word}</span>
      {band.next && (
        <span className="faint small">
          {band.next.points} to {band.next.word}
        </span>
      )}
    </Tip>
  )
}

/** Mobs by zone, zones in the order the page first names them. */
function byZone(mobs: FactionMob[]): [string, FactionMob[]][] {
  const zones = new Map<string, FactionMob[]>()
  for (const m of mobs) {
    const z = m.zone || 'Somewhere'
    zones.set(z, [...(zones.get(z) ?? []), m])
  }
  return [...zones]
}

/** What raises a faction, from its eqlwiki page: fetched when the row is opened, and kept a week. */
function Sources({ name }: { name: string }) {
  const q = useInvoke('factions:sources', [name])
  if (!q.data) return <Pending error={q.error} retry={q.reload} what="what raises it, from eqlwiki" />
  const s = q.data.sources
  if (!s) return <span className="faint">eqlwiki has no faction page for {name}, so what raises it is not known here.</span>
  const link = (title: string, text = title) => (
    <a href={wikiUrl(title)} target="_blank" rel="noreferrer">
      {text}
    </a>
  )
  const none = !s.mobs.length && !s.quests.length && !s.zones.length
  return (
    <div className="stack gap-6">
      <span className="faint">
        What raises it, from eqlwiki’s {link(s.page, s.page)} page (community-kept, so treat these as leads).{none ? ' The page lists nothing yet.' : ''}
      </span>
      {s.mobs.length > 0 && (
        <div>
          <b>Kill</b>
          <ul className="faction-sources">
            {byZone(s.mobs).map(([zone, mobs]) => (
              <li key={zone}>
                <span className="faint">{zone}:</span>{' '}
                {mobs.map((m, i) => (
                  <Fragment key={m.name + i}>
                    {i > 0 && ', '}
                    {link(m.name)}
                    {m.note && <span className="faint"> ({m.note})</span>}
                  </Fragment>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.quests.length > 0 && (
        <div>
          <b>Quests</b>{' '}
          {s.quests.map((t, i) => (
            <Fragment key={t + i}>
              {i > 0 && ', '}
              {link(t)}
            </Fragment>
          ))}
        </div>
      )}
      {s.zones.length > 0 && (
        <div>
          <b>Zones</b>{' '}
          {s.zones.map((t, i) => (
            <Fragment key={t + i}>
              {i > 0 && ', '}
              {link(t)}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

function History({ r, character, basis, ways }: { r: FactionRow; character: string; basis: ConBasis | null; ways: Catalog | null }) {
  return (
    <div className="stack gap-6 small" style={{ padding: '6px 4px' }}>
      {r.achievement && (
        <span>
          Achievement: <b>{r.achievement.name}</b>, done at the maximum standing ({STANDING_MAX}).
        </span>
      )}
      {r.standing && <span>{standingNote(r.standing, basis)}</span>}
      <Moved name={r.name} character={character} />
      {(r.standing?.value ?? 0) < STANDING_MAX && <Ways r={r} character={character} ways={ways} />}
      <Sources name={r.name} />
      <span className="faint">
        {r.first ? `First seen in the log ${when(r.first)}. ` : ''}
        {r.recent.length
          ? r.changes > r.recent.length
            ? `The last ${r.recent.length} of ${r.changes} changes, newest first:`
            : 'Every change, newest first:'
          : r.first
            ? 'No changes recorded, only the cap.'
            : 'The log has no changes for it.'}
      </span>
      {r.recent.length > 0 && (
        <div className="row tight">
          {r.recent.map((c, i) => (
            <span key={i} className="chip" title={when(c.at)}>
              <span className={`mono ${tone(c.amount)}`}>{signed(c.amount)}</span> <span className="faint">{when(c.at)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** The Plan tab's ways to raise a faction, with the log's kill pace. */
type Catalog = { activities: PlanActivity[]; logPace: number | null }

/** Other characters' names for a sentence: "Kelwyn's", "Kelwyn's and Aldric's". */
const theirs = (keys: string[]) => keys.map((k) => `${k.split('_')[0]}'s`).join(' and ')

/** What moved the faction in the logs: this character's, and the player's other characters'. */
function Moved({ name, character }: { name: string; character: string }) {
  const q = useInvoke('factions:moved', [character, name])
  if (!q.data) return q.error ? <span className="faint">Could not read what moved it: {q.error}</span> : null
  const movers = q.data.movers
  if (!movers.length) return null
  return (
    <div>
      <b>What moved it in your logs</b>
      <ul className="faction-sources">
        {movers.map((m) => (
          <li key={`${m.kind}|${m.zone}|${m.name}`}>
            <span className={`mono ${tone(m.amount)}`}>{signed(m.amount)}</span> each ×{m.n.toLocaleString()} = <span className={`mono ${tone(m.total)}`}>{signed(m.total)}</span>{' '}
            {m.kind === 'kill' ? 'killing' : 'hand-ins to'} <b>{m.name}</b> <span className="faint">({m.zone || 'somewhere'})</span>
            {m.others.length > 0 && <span className="faint"> · {m.own ? `and in ${theirs(m.others)} log` : `from ${theirs(m.others)} log`}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The quickest ways to take the faction to 2000, as the Plan tab reckons them. */
function Ways({ r, character, ways }: { r: FactionRow; character: string; ways: Catalog | null }) {
  const settings = usePlanSettings(ways?.logPace ?? null)
  const [choices] = useChoices(character)
  const list = useMemo(
    () => (ways ? waysToRaise(ways.activities, r.name, r.standing?.value ?? 0, settings, choices).slice(0, 3) : null),
    [ways, r.name, r.standing, settings, choices]
  )
  if (!list) return <Pending inline doing="Working out the quickest ways to raise it" />
  if (!list.length) return null
  return (
    <div>
      <b>Quickest ways to {STANDING_MAX}</b> <span className="faint">(as the Plan tab reckons them, each on its own)</span>
      <ul className="faction-sources">
        {list.map((w) => (
          <li key={w.activity.id}>
            <span className="mono">×{w.units.toLocaleString()}</span> ≈ <span className="mono">{duration(w.seconds)}</span> · <Doing a={w.activity} />{' '}
            <span className="faint">
              · {w.activity.zone || 'somewhere'} · {sourceNote(w.activity)}
            </span>{' '}
            <Flags a={w.activity} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** How a hit bears on the character: helps an achievement, sets one back, or takes a faction further below zero. */
function hitTone(h: LookupHit, row: FactionRow | undefined): string {
  if (h.capped || !h.amount) return ''
  const open = !!row?.achievement && row.achievement.done !== true
  const v = row?.standing?.value
  if (h.amount > 0) return open ? 'ok' : ''
  if (open) return 'warn'
  if (v !== undefined && v < 0) return 'bad'
  return ''
}

/** Mobs and NPCs whose name holds what was typed, with what each does to the factions. */
function LookupResults({ query, results, error, view }: { query: string; results: FactionLookup[] | null; error: string; view: { factions: FactionRow[] } | null }) {
  const byName = useMemo(() => new Map((view?.factions ?? []).map((r) => [r.name.toLowerCase(), r])), [view])
  let body: ReactNode
  if (!results) body = error ? <ErrorText>Could not look it up: {error}</ErrorText> : <Pending inline doing="Looking it up" />
  else if (!results.length)
    body = (
      <span className="faint">
        No kill or hand-in in your logs that moved a faction, and no eqlwiki faction page, names a mob or NPC with “{query}” in it: most likely it moves no faction.
      </span>
    )
  else
    body = (
      <div className="stack gap-10">
        {results.map((x) => (
          <div key={`${x.from}|${x.kind}|${x.zone}|${x.name}`} className="stack gap-4">
            <div className="row tight">
              <span className={`chip fp-kind ${x.kind}`}>{x.kind === 'kill' ? 'Kill' : 'Hand-in'}</span>
              <b>{x.name}</b>
              <span className="faint small">{x.zone || 'somewhere'}</span>
              {x.note && <span className="faint small">· {x.note}</span>}
              <span className="spacer" />
              <span className="faint small">
                {x.from === 'wiki'
                  ? 'eqlwiki: which way only, amounts guessed'
                  : `${x.own === false && x.others?.length ? `${theirs(x.others)} log` : x.others?.length ? `your log and ${theirs(x.others)}` : 'your log'} (${(x.n ?? 0).toLocaleString()} ${x.kind === 'kill' ? 'kills' : 'hand-ins'})`}
              </span>
            </div>
            <div className="row tight fp-effects">
              {x.hits.map((h) => {
                const row = byName.get(h.faction.toLowerCase())
                const v = row?.standing?.value
                const open = !!row?.achievement && row.achievement.done !== true
                const where = v === undefined ? 'standing not known' : `at ${plain(v)}`
                const ach = open ? ', achievement still to do' : row?.achievement?.done ? ', achievement done' : ''
                const guess = h.guessed ? '. The wiki says which way; the amount is your logs’ usual one.' : ''
                return (
                  <span key={h.faction} className={`chip ${hitTone(h, row)}`.trim()} title={`${h.faction}: ${where}${ach}${guess}`}>
                    {h.capped ? (h.capped === 'top' ? 'maxed' : 'bottomed') : `${signed(h.amount)}${h.guessed ? '?' : ''}`} {h.faction}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  return (
    <div className="card mb-16">
      <h2>
        What it does <span className="faint small">“{query}”</span>
      </h2>
      <p className="faint small">
        Green helps an achievement still to do, amber sets one back, red takes a faction further below zero. Hover a faction for where you stand with it.
      </p>
      {body}
    </div>
  )
}
