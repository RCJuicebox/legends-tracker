// What eqlwiki's page for a named NPC tells the faction planner. Allakhazam's faction pages list live
// EverQuest's NPCs, and Legends never had many of them (Goriba Thurgorson in North Kaladim, Kugaran in
// Grobb): eqlwiki, Legends' own wiki, has a page for every named NPC of its zones, so one of
// Allakhazam's that it lacks is not planned. Its page also gives the NPC's health (Legends made some guildmasters unkillable:
// Founy Jestands has 2,500,000), its respawn, and at times what a kill does to each faction in
// Legends' own amounts (Guard Gonin: Ebon Mask +5, where Allakhazam has +1).

/** What eqlwiki says of one named NPC. */
export interface NpcInfo {
  /** eqlwiki has a page for it. */
  found: boolean
  hp?: number
  respawnSec?: number
  /** What a kill does to each faction the page gives an amount for, as the page names them: - its own, + its foes. */
  hits?: Record<string, number>
}

/** Health past this is no camp: more than any raid boss of the era (Lord Nagafen has 32,000), so one of Legends' guildmasters made not to be killed. */
export const TOO_TOUGH_HP = 250_000

/** "Corporal Lancot - North Qeynos" → "Corporal Lancot": Allakhazam's telling apart of two NPCs of one name off. */
export const bareNpc = (name: string) => name.replace(/\s+-\s+.*$/, '').trim()

/** A named NPC, as against one of many alike ("a bandit", "orc pawn", "A Dwarven Bandit"). */
export const isNamedNpc = (name: string) => {
  const n = bareNpc(name)
  return /^[A-Z]/.test(n) && !/^(?:A|An|The)\s/.test(n)
}

/** The titles eqlwiki may keep a name's page under: as written, and with its backtick dropped or made an apostrophe (Ambassador DVinn, Tani N`Mar). */
export function npcTitles(name: string): string[] {
  const n = bareNpc(name)
  const t = n.charAt(0).toUpperCase() + n.slice(1)
  return [...new Set([t, t.replace(/`/g, ''), t.replace(/`/g, "'")])]
}

/** A field's text without links, tags or bold: "[[Kaladim|North Kaladim]]" → "North Kaladim". */
const plain = (s: string) =>
  s
    .replace(/<ref[\s\S]*?(?:<\/ref>|\/>)/gi, '')
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\[https?:\S+\s*([^\]]*)\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '')
    .trim()

/** A template's fields, by lower-cased name, each with every line up to the next field. */
function fields(content: string): Map<string, string> {
  const out = new Map<string, string>()
  let key = ''
  for (const line of content.split('\n')) {
    const m = /^\s*\|\s*([A-Za-z_][\w ]*?)\s*=(.*)$/.exec(line)
    if (m) {
      key = m[1].toLowerCase()
      out.set(key, m[2])
    } else if (/^\s*\}\}\s*$/.test(line)) key = ''
    else if (key) out.set(key, `${out.get(key)}\n${line}`)
  }
  return out
}

/** "2,500,000", "5000ish", "Under 10k", "20000 (10,000 triggered)": the first number; undefined for none. */
export function parseHp(text: string): number | undefined {
  const m = /(\d[\d,]*(?:\.\d+)?)(?:\s*([km])(?![a-z]))?/i.exec(plain(text))
  if (!m) return undefined
  const n = Number(m[1].replace(/,/g, '')) * (m[2] ? (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : 1)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

/**
 * "6:40", "1:00:00", "6m 40s", "4 minutes 24 seconds", "9 mins; orc pawn as PH.": seconds; undefined
 * for none. Of "20 min - 1 hr", the first.
 */
export function parseRespawn(text: string): number | undefined {
  const t = plain(text).toLowerCase()
  const clock = /(\d+):(\d{2})(?::(\d{2}))?/.exec(t)
  if (clock) {
    const [a, b] = [Number(clock[1]), Number(clock[2])]
    const sec = clock[3] === undefined ? a * 60 + b : a * 3600 + b * 60 + Number(clock[3])
    return sec > 0 ? sec : undefined
  }
  let sec = 0
  let end = -1
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(d(?:ays?)?|h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)(?![a-z])/g)) {
    // Parts of one time follow each other ("6m 40s"); anything else between ends it.
    if (end >= 0 && !/^[\s,]*(?:and\s+)?$/.test(t.slice(end, m.index))) break
    const u = m[2][0]
    sec += Number(m[1]) * (u === 'd' ? 86_400 : u === 'h' ? 3600 : u === 'm' ? 60 : 1)
    end = m.index + m[0].length
  }
  return sec > 0 ? Math.round(sec) : undefined
}

/** A faction list's entries that give an amount, "* [[Miners Guild 628]] <span class='profac'>(-5)</span>": own factions go down, foes up. */
function factionAmounts(text: string | undefined, sign: 1 | -1, into: Record<string, number>): void {
  for (const line of (text ?? '').split('\n')) {
    const link = /^\s*\*\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/.exec(line)
    const amount = link ? /\(\s*[+-]?(\d+)\s*\)/.exec(line.replace(/<[^>]+>/g, '')) : null
    if (link && amount && Number(amount[1]) > 0) into[link[1].trim()] = sign * Number(amount[1])
  }
}

/** What an NPC's page gives ({{Namedmobpage}}): health, respawn and kill amounts, those it has. */
export function parseNpcPage(content: string): Omit<NpcInfo, 'found'> {
  const f = fields(content)
  const hp = parseHp(f.get('hp') ?? '')
  const respawnSec = parseRespawn(f.get('respawn_time') ?? '')
  const hits: Record<string, number> = {}
  factionAmounts(f.get('factions'), -1, hits)
  factionAmounts(f.get('opposing_factions'), 1, hits)
  return { ...(hp ? { hp } : {}), ...(respawnSec ? { respawnSec } : {}), ...(Object.keys(hits).length ? { hits } : {}) }
}
