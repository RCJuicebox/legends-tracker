// A bug report's text with player and guild names swapped for the test characters' (FEAT-039), as the
// fixtures are: no real player in a report a player attaches to a public issue. Names are those the app
// knows (your characters, the people /who showed) and those the lines themselves give away (who tells,
// says or joins, a /who line's name and guild); what anyone said is cut to "…".

/** The test characters (CONTRIBUTING.md), handed out in order; past them, Player13 and on. */
const STAND_INS = ['Kelwyn', 'Aldric', 'Brenna', 'Corvin', 'Dorran', 'Elspeth', 'Fenwick', 'Garrick', 'Hollis', 'Isolde', 'Jorund', 'Kestrel']

/** A line's speaker, a /who line's name and guild, someone joining: where the log names a player. */
const NAMED = [
  /^\[[^\]]+\] ([A-Z][a-z]+) (?:tells|says|shouts|auctions|told)\b/,
  /^\[[^\]]+\] ([A-Z][a-z]+) has (?:joined|left) the (?:group|raid)\b/,
  /^\[[^\]]+\] ([A-Z][a-z]+) invites you to join\b/,
  /^\[[^\]]+\] (?:AFK |LFG |<LINKDEAD>)*\[\d+ [^\]]*\] ([A-Z][a-z]+)\b/
]
const GUILD = /<([^>]+)>/
/** What someone said: from the opening quote to the end. */
const SAID = /^(\[[^\]]+\] .*?\b(?:tells?|says?|shouts?|auctions?|told)\b[^']*?), '.*$/

export interface Anonymizer {
  /** The text with each name swapped and each saying cut. */
  apply(text: string): string
  /** The swaps made, real name to stand-in, for the person filing to check (never written into the report). */
  readonly swaps: ReadonlyMap<string, string>
}

/**
 * `known`: names to swap whatever the lines say; `lines` are looked through for more. A name the length of
 * a stand-in's or shorter than three letters is still swapped: a short name is a name.
 */
export function anonymizer(known: Iterable<string>, lines: readonly string[] = []): Anonymizer {
  const swaps = new Map<string, string>()
  const guilds = new Map<string, string>()
  const add = (name: string) => {
    const n = name.trim()
    if (!n || n === 'You' || swaps.has(n) || STAND_INS.includes(n)) return
    swaps.set(n, STAND_INS[swaps.size] ?? `Player${swaps.size + 1}`)
  }
  for (const n of known) add(n.charAt(0).toUpperCase() + n.slice(1).toLowerCase())
  for (const line of lines) {
    for (const re of NAMED) {
      const m = re.exec(line)
      if (m) add(m[1])
    }
    const g = GUILD.exec(line)
    if (g && !guilds.has(g[1]) && !/^LINKDEAD$/i.test(g[1])) guilds.set(g[1], `Guild${guilds.size + 1}`)
  }
  const names = [...swaps.keys()].sort((a, b) => b.length - a.length)
  // As the log writes them, a letter on neither side (an underscore is fine: eqlog_Kelwyn_neriak); all lower case
  // only against an underscore, so a character named Bear leaves "a cave bear" alone.
  const lower = names.map((n) => escape(n.toLowerCase())).join('|')
  const pattern = names.length ? new RegExp(`(?<![A-Za-z])(${names.map(escape).join('|')})(?![A-Za-z])|(?<=_)(${lower})(?![A-Za-z])|(?<![A-Za-z])(${lower})(?=_)`, 'g') : null
  const byLower = new Map([...swaps].map(([k, v]) => [k.toLowerCase(), v]))
  return {
    swaps,
    apply(text) {
      let out = text
        .split('\n')
        .map((l) => l.replace(SAID, "$1, '…'"))
        .join('\n')
      for (const [g, stand] of guilds) out = out.split(`<${g}>`).join(`<${stand}>`)
      if (pattern) out = out.replace(pattern, (m) => (m === m.toLowerCase() ? (byLower.get(m) ?? m).toLowerCase() : (byLower.get(m.toLowerCase()) ?? m)))
      return out
    }
  }
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
