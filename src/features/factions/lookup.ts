import { usualAmount, type FactionSourceTallies, type SharedFrom, type SourceKind } from './attribution'
import { NO_MOB, type FactionPageData, type FactionSources } from './core'
import { factionNamer, zoneKey, type Guesses } from './planner'

// Two questions the Standings tab answers from what the logs and eqlwiki say: what moved this
// faction, and what does this mob or NPC do to my factions. The logs' answers are the game's own
// amounts; the wiki's only say which way, so their amounts are the logs' usual ones, guessed.

/** One mob or NPC that moved a faction in the player's logs. */
export interface FactionMover {
  kind: SourceKind
  zone: string
  name: string
  /** Times it moved the faction, and the points it moved it by in all. */
  n: number
  total: number
  /** What one usually moved it by. */
  amount: number
  /** The player's other characters whose logs saw it; `own` when this character's did too. */
  others: string[]
  own: boolean
}

/**
 * What raises a faction, from its eqlwiki page among `pages`, found as the planner finds them: King
 * Ak'Anon for King Ak`Anon, a name with " (Faction)", and the pages named otherwise than the game.
 * Null when there is no page for it.
 */
export function sourcesOf(faction: string, pages: FactionPageData[]): FactionSources | null {
  const name = factionNamer([faction])
  const p = pages.find((pg) => name(pg.page) === faction)
  return p ? { page: p.page, ...p.raise } : null
}

/** What moved a faction in the logs, most points first (either way). */
export function moversOf(faction: string, sources: FactionSourceTallies, from: SharedFrom = {}, limit = 12): FactionMover[] {
  const want = faction.toLowerCase()
  const out: FactionMover[] = []
  for (const [k, t] of Object.entries(sources.acts)) {
    const hit = Object.entries(t.hits).find(([f]) => f.toLowerCase() === want)
    if (!hit) continue
    const amounts = hit[1]
    let n = 0
    let total = 0
    for (const [a, c] of Object.entries(amounts)) {
      n += c
      total += Number(a) * c
    }
    if (!n) continue
    const shared = from[k]
    out.push({ kind: t.kind, zone: t.zone, name: t.name, n, total, amount: usualAmount(amounts), others: shared?.others ?? [], own: shared ? shared.own : true })
  }
  return out.sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || b.n - a.n).slice(0, limit)
}

/** What one kill or hand-in does to a faction. */
export interface LookupHit {
  faction: string
  /** A unit's amount; 0 with `capped` when the log saw only "could not possibly get any better (worse)". */
  amount: number
  /** The wiki says which way, not how much: the logs' usual amount stands in. */
  guessed?: boolean
  capped?: 'top' | 'bottom'
}

/** A mob or NPC and what it does to the factions, from the logs or eqlwiki. */
export interface FactionLookup {
  kind: SourceKind
  name: string
  zone: string
  from: 'log' | 'wiki'
  /** Log: times seen, the other characters whose logs saw it, and whether this character's did. */
  n?: number
  others?: string[]
  own?: boolean
  /** Wiki: its note ("Quest NPC", "Wizard Guildmaster"). */
  note?: string
  hits: LookupHit[]
}

const byWeight = (a: LookupHit, b: LookupHit) => Math.abs(b.amount) - Math.abs(a.amount) || a.faction.localeCompare(b.faction)

/**
 * Mobs and NPCs whose name holds `query`, with what each does to the factions: the logs' own tallies
 * first, then the wiki's faction pages for any the logs have not seen there. `name` puts a wiki
 * faction name the game's way.
 */
export function lookUp(
  query: string,
  sources: FactionSourceTallies,
  from: SharedFrom,
  pages: FactionPageData[],
  name: (faction: string) => string,
  guesses: Guesses,
  limit = 15
): FactionLookup[] {
  const q = query.trim().toLowerCase()
  if (q.length < 3) return []
  const results: FactionLookup[] = []
  const seen = new Set<string>()
  for (const [k, t] of Object.entries(sources.acts)) {
    if (!t.name.toLowerCase().includes(q)) continue
    const hits: LookupHit[] = Object.entries(t.hits).map(([f, amounts]) => ({ faction: f, amount: usualAmount(amounts) }))
    for (const [caps, capped] of [
      [t.top, 'top'],
      [t.bottom, 'bottom']
    ] as const)
      for (const f of caps) if (!hits.some((h) => h.faction === f)) hits.push({ faction: f, amount: 0, capped })
    const shared = from[k]
    results.push({
      kind: t.kind,
      name: t.name,
      zone: t.zone,
      from: 'log',
      n: t.n,
      others: shared?.others ?? [],
      own: shared ? shared.own : true,
      hits: hits.sort(byWeight)
    })
    seen.add(`${t.name.toLowerCase()}|${zoneKey(t.zone)}`)
  }
  const wiki = new Map<string, FactionLookup>()
  for (const p of pages) {
    const f = name(p.page)
    for (const [side, mobs] of [
      ['raise', p.raise.mobs],
      ['lower', p.lower.mobs]
    ] as const) {
      for (const m of mobs) {
        if (NO_MOB.test(m.name) || !m.name.toLowerCase().includes(q)) continue
        const k = `${m.name.toLowerCase()}|${zoneKey(m.zone)}`
        if (seen.has(k)) continue
        const r = wiki.get(k) ?? { kind: 'kill' as const, name: m.name, zone: m.zone, from: 'wiki' as const, ...(m.note ? { note: m.note } : {}), hits: [] }
        if (!r.hits.some((h) => h.faction === f)) r.hits.push({ faction: f, amount: side === 'raise' ? guesses.killUp : guesses.killDown, guessed: true })
        wiki.set(k, r)
      }
    }
  }
  for (const r of wiki.values()) results.push({ ...r, hits: r.hits.sort(byWeight) })
  // The name itself first, then names that start with it, then the logs' (most seen) before the wiki's.
  const rank = (r: FactionLookup) => (r.name.toLowerCase().replace(/^(?:an?|the)\s+/, '') === q.replace(/^(?:an?|the)\s+/, '') ? 0 : r.name.toLowerCase().startsWith(q) ? 1 : 2)
  return results.sort((a, b) => rank(a) - rank(b) || (a.from === b.from ? 0 : a.from === 'log' ? -1 : 1) || (b.n ?? 0) - (a.n ?? 0) || a.name.localeCompare(b.name)).slice(0, limit)
}
