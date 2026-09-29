import { linkTexts, plainText } from '../../core/wikiItem'

// eqlwiki's quest pages, as far as planning faction goes. They are free-form walkthroughs, written
// by players, with a table at the top and each reward's faction lines in a block of their own:
//
//   {| class="questTopTable"
//   ! ''' Start Zone: '''
//   | [[Qeynos|South Qeynos]]
//   |-
//   ! ''' Quest Giver: '''
//   | [[Tabure Ahendle]]
//   ...
//   '''Hand [[Tabure Ahendle]] 4 [[Kobold Hide]]s.'''
//   <div class="facblock">
//   * Your faction standing with [[Steel Warriors]] has been adjusted by 20.
//   * Your faction standing with [[Guards of Qeynos]] got better. (+5)
//   </div>
//
// Each faction block is one step: what it does to each faction, and what is handed in for it, read
// from the walkthrough line before it. Some pages leave a block unclosed, running into the next
// hand-in, and some write the faction lines with no block at all; a block ends at the first line that
// is not a faction line, and a run of faction lines outside one is a block too. A line's links after
// what the NPC gives back ("he'll give you an item called [[Grilled Rat Ears]]") or how the item is
// made ("(made via [[Blacksmithing]] 2 [[Small Pieces of Ore]] …") are not what is handed in. Many pages come from classic EverQuest's logs, which said
// only "got better" or "got worse"; where no one has added the amount in brackets, it is left for
// the planner to guess. What the walkthrough says about the item before it is handed in is kept
// too: that it is combined from ten of something ("Combine 10 x [[Fire Beetle Eye]]s"), or taken
// from a mob ("kill Nillipuss multiple times to get four [[Jumjum Stalk]]s").

export interface QuestHandIn {
  /** The item's page, as linked. */
  item: string
  count: number
  /** An NPC gives it earlier in the walkthrough ("You receive a Sealed Letter"): a step of a chain, not a thing to bring again and again. */
  given?: boolean
  /** The walkthrough makes it from several of another item. */
  madeOf?: { item: string; count: number }
  /** The walkthrough takes it from a mob: "a froglok tad", "Nillipuss". */
  from?: string
}

export interface QuestStep {
  /** By faction as the page links it: the amount, or +1 / -1 where the page gives only the direction. */
  hits: Record<string, number>
  /** The factions whose amounts the page does not give. */
  guessed: string[]
  handIn: QuestHandIn[]
  /** Who it is handed to, when the line says; '' when it does not. */
  npc: string
  /** The walkthrough line the hand-in was read from, as plain text; '' when none was found. */
  line: string
  /** A count the line gives apart from any item ("Hand 4 of them"), for the one item left once places and people are set aside. */
  count?: number
  /** What the NPC gives back for it, as the line says ("he'll give you an item called [[Grilled Rat Ears]]"). */
  gives?: string[]
}

export interface QuestPage {
  page: string
  givers: string[]
  zones: string[]
  level: number | null
  steps: QuestStep[]
}

/** The cell under a heading of the quest's top table: "! ''' Quest Giver: '''" then "| [[X]]". */
function topCell(text: string, heading: string): string {
  const m = new RegExp(`${heading}:?\\s*'*\\s*\\n\\s*\\|\\s*([^\\n]*)`, 'i').exec(text)
  return m ? m[1].trim() : ''
}

const cellNames = (cell: string): string[] => {
  const links = linkTexts(cell)
  if (links.length) return [...new Set(links.map((l) => l.replace(/\s*\(NPC\)$/i, '')))]
  const plain = plainText(cell)
  return plain ? plain.split(/\s*[,/]\s*|\s+and\s+/).filter(Boolean) : []
}

const FACBLOCK_OPEN = /<div\s+class\s*=\s*["']facblock["']\s*>/i
const HAS_FACTION = /Your faction (?:standing )?with\b/i
/** What a faction block holds besides its faction lines: blank lines, a template ({{exp}}), its own tags. */
const BLOCK_FILLER = /^\s*(?:\{\{[^}]*\}\}|<\/?div[^>]*>|\*)?\s*$/i
// "has been adjusted by 5", "got better. (+5)", and P99's "'''has gotten worse'''.<span class='profac'>(-1)</span>".
const FACTION_LINE =
  /Your faction (?:standing )?with\s+(?:\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|([^.\n[]+?))\s+(?:has been adjusted by\s+(-?\d+)|(?:'{2,3})?(?:got|has gotten|could not possibly get any)\s+(better|worse)\.?(?:'{2,3})?\.?\s*(?:<span[^>]*>\s*)?(?:\(\s*([+-]?\d+)\s*\))?)/gi

interface Block {
  start: number
  end: number
  lines: string[]
  div: boolean
}
const blockOf = (b: Block) => ({ start: b.start, end: b.end, body: b.lines.join('\n') })
/** A walkthrough line that hands something over, where a step's lead ends; not a faction line ("Circle of Unseen Hands", "Tradefolk"). */
const isHandInLine = (line: string) => !HAS_FACTION.test(line) && /\[\[/.test(line) && HANDING.test(line) && !DIALOGUE.test(line)

/**
 * A page's faction blocks, where each starts and ends: each <div class="facblock">, up to its </div>,
 * the next block or the next step's hand-in line (some pages never close one, and that hand-in would
 * be read into it), and each run of faction lines written outside any, up to its first other line.
 */
function factionBlocks(text: string): { start: number; end: number; body: string }[] {
  const blocks: { start: number; end: number; body: string }[] = []
  let cur: Block | null = null
  let at = 0
  for (const line of text.split('\n')) {
    const next = at + line.length + 1
    const open = FACBLOCK_OPEN.test(line)
    const faction = HAS_FACTION.test(line)
    if (cur && (open || (cur.div ? isHandInLine(line) : !(faction || BLOCK_FILLER.test(line))))) {
      blocks.push(blockOf(cur))
      cur = null
    }
    if (!cur && (open || faction)) cur = { start: at, end: next, lines: [], div: open }
    if (cur) {
      cur.lines.push(line)
      cur.end = next
      if (cur.div && /<\/div>/i.test(line)) {
        blocks.push(blockOf(cur))
        cur = null
      }
    }
    at = next
  }
  if (cur) blocks.push(blockOf(cur))
  return blocks.filter((b) => HAS_FACTION.test(b.body))
}

/** A faction block's lines. */
function factionHits(block: string): { hits: Record<string, number>; guessed: string[] } {
  const hits: Record<string, number> = {}
  const guessed: string[] = []
  for (const m of block.matchAll(FACTION_LINE)) {
    const faction = (m[1] ?? m[2] ?? '').replace(/_/g, ' ').trim()
    if (!faction) continue
    if (m[3] !== undefined) hits[faction] = parseInt(m[3], 10)
    else {
      const sign = m[4].toLowerCase() === 'better' ? 1 : -1
      // "got better. (+5)": the amount someone added in brackets.
      if (m[5] !== undefined) hits[faction] = sign * Math.abs(parseInt(m[5], 10))
      else {
        hits[faction] = sign
        guessed.push(faction)
      }
    }
  }
  return { hits, guessed }
}

const WORD_COUNTS: Record<string, number> = {
  a: 1,
  an: 1,
  the: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  twenty: 20
}
const countOf = (w: string) => (/^\d+$/.test(w) ? parseInt(w, 10) : WORD_COUNTS[w.toLowerCase()])
const HANDING = /\b(?:hand|give|turn(?:ed|ing|s)? in|return|bring|deliver|offer|trade)\w*\b/i
/** What an NPC says, quoted under a walkthrough step (": Marda says, '…'"), is not an instruction. */
const DIALOGUE = /^\s*:|\bsays,?\s*'|\btells you,?\s*'/i
/** A link right after these words is who it goes to, not what. */
const TO_WHOM = /(?:\bhand|\bgive|\bto|\bfor|\breturn(?:ed)?(?: to)?|\bbring(?: it)? to)\s*'*$/i
const LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g
/** "… to Mojax Hikspin." at the end of a line: who it goes to, when the name is not linked. */
const TO_NAMED = /\bto\s+((?:[A-Z][\w`']*)(?:\s+(?:[A-Z][\w`']*|of|the))*)\s*[.:'!]*\s*$/
/** "Hand 4 of them", "bring four": a count said apart from the item. */
const LOOSE_COUNT = /\b(?:hand|give|bring|turn in|return)\w*\s+(?:him\s+|her\s+|them\s+)?(\d+|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty)\b/i
// Where a line goes on to what the NPC gives back, or how the item is made: what it links after that is not handed in.
const GIVEN_BACK = /\b(?:(?:he|she|they|it)(?:'ll|\s+will)?\s+(?:give|hand)s?\s+you|gives?\s+you|you(?:'ll|\s+will)?\s+(?:receive|get)|in return|rewards?\s+you)\b/i
const MADE = /\bmade\s+(?:via|from|with|by)\b|\(\s*made\b/i

/** What a walkthrough line hands in and to whom, and what the NPC gives back for it. */
export function readHandIn(whole: string, givers: string[] = []): { handIn: QuestHandIn[]; npc: string; count?: number; gives?: string[] } {
  // Cut off after the first link: a line that opens with what is received ("You receive a
  // [[Moonstone]]. Give to …") goes on to hand that in.
  const first = whole.indexOf('[[')
  const rest = first < 0 ? '' : whole.slice(first)
  const back = rest.search(GIVEN_BACK)
  const cut = Math.min(...[back, rest.search(MADE)].filter((i) => i > 0), Infinity)
  const line = cut < Infinity ? whole.slice(0, first + cut) : whole
  // What the NPC gives back: the links of the sentence that says so.
  const gives =
    back > 0 && back === cut
      ? [
          ...rest
            .slice(back)
            .split(/\.(?=\s|'|$)/)[0]
            .matchAll(LINK)
        ].map((m) => m[1].replace(/_/g, ' ').trim())
      : []
  const handIn: QuestHandIn[] = []
  let npc = ''
  const isGiver = (name: string) => givers.some((g) => g.toLowerCase() === name.toLowerCase())
  for (const m of line.matchAll(LINK)) {
    const target = m[1].replace(/_/g, ' ').trim()
    const label = (m[2] ?? m[1]).replace(/_/g, ' ').trim()
    const before = line.slice(0, m.index)
    const after = line.slice(m.index + m[0].length)
    const counted = /(?:^|[\s('])(\d+|[a-z]+)\)?\s*(?:x\s*)?'*$/i.exec(before)
    const times = /^s?\s*(?:x|×)\s*(\d+)/i.exec(after)
    const n = times ? parseInt(times[1], 10) : counted ? countOf(counted[1]) : undefined
    if (isGiver(label) || isGiver(target) || (!npc && n === undefined && TO_WHOM.test(before))) {
      npc ||= label.replace(/\s*\(NPC\)$/i, '')
      continue
    }
    handIn.push({ item: target, count: n && n > 0 ? n : 1 })
  }
  const plain = plainText(line)
  if (!npc) npc = TO_NAMED.exec(plain)?.[1] ?? ''
  // One item with no count of its own: a count said elsewhere in the line is its.
  const loose = LOOSE_COUNT.exec(plain)
  const count = loose ? countOf(loose[1]) : undefined
  if (count && handIn.length === 1 && handIn[0].count === 1) handIn[0].count = count
  return { handIn, npc, ...(count ? { count } : {}), ...(gives.length ? { gives } : {}) }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const bare = (item: string) => escape(item.replace(/\s*\([^)]*\)\s*$/, ''))

/** Whether the text has an NPC hand the item over: "You receive a [[Sealed Letter]]", "gives you the Note". */
function givenBefore(text: string, item: string): boolean {
  return new RegExp(`(?:receive[sd]?|gives? you|hands? you|given)\\s+(?:an?\\s+|the\\s+|\\d+\\s+|a\\s+stack\\s+of\\s+)?'*(?:\\[\\[)?(?:[^\\]|\\n]*\\|)?${bare(item)}`, 'i').test(
    text
  )
}

/** "Combine 10 x [[Fire Beetle Eye]]s …": what the handed-in item is made of. */
const COMBINE = /\bcombine\s+(\d+|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty)\s*(?:x\s*)?'*\[\[([^\]|#]+)/i

/** The mob a sentence has you kill to get the item: "kill an "orc apprentice" to loot an [[Illegible Cantrip]]". */
function killedFor(lead: string, item: string): string | undefined {
  const name = bare(item)
  for (const sentence of lead.split(/(?<=[.!?])\s+|\n/)) {
    if (!new RegExp(name, 'i').test(sentence)) continue
    const plain = plainText(sentence)
    const killed =
      /\bkill(?:ing|ed)?\s+(?:any\s+|an?\s+|the\s+|some\s+)?["']?([A-Za-z`'][\w`' ]*?)["']?(?=\s+(?:multiple|several|many|a few|over|until|to|for|and|in|at|near|who|which|that)\b|\s*[,.;(]|$)/i.exec(
        plain
      )
    // "kill Nillipuss mutliple times": the name, without how often.
    if (killed) return killed[1].replace(/(?:\s+\w+)?\s+times$/i, '').trim()
    const dropped = /\bdrops? from\s+(?:any\s+)?(\w[\w ]*?)(?=\s+in\b|[,.;]|$)/i.exec(plain)
    if (dropped) return dropped[1].trim()
  }
  return undefined
}

/** A quest page's steps; null when it has no faction blocks. */
export function parseQuestPage(page: string, text: string): QuestPage | null {
  const givers = cellNames(topCell(text, 'Quest Giver'))
  const zones = cellNames(topCell(text, 'Start Zone'))
  const level = /\d+/.exec(topCell(text, 'Minimum Level'))
  const steps: QuestStep[] = []
  let from = 0
  for (const b of factionBlocks(text)) {
    const { hits, guessed } = factionHits(b.body)
    const lead = text.slice(from, b.start)
    from = b.end
    if (!Object.keys(hits).length) continue
    // The last line before the block that hands something over, not counting what NPCs say.
    const lines = lead.split('\n').filter((l) => /\[\[/.test(l) && HANDING.test(l) && !DIALOGUE.test(l))
    const raw = lines.length ? lines[lines.length - 1] : ''
    const { handIn, npc, count, gives } = raw ? readHandIn(raw, givers) : { handIn: [], npc: '', count: undefined, gives: undefined }
    // What the walkthrough says of each item before it is handed in.
    const earlier = text.slice(0, b.start)
    const combine = COMBINE.exec(lead)
    for (const h of handIn) {
      if (givenBefore(earlier, h.item)) h.given = true
      if (combine && handIn.length === 1 && combine[2].trim().toLowerCase() !== h.item.toLowerCase()) h.madeOf = { item: combine[2].trim(), count: countOf(combine[1]) ?? 1 }
      const mob = killedFor(lead, h.madeOf?.item ?? h.item)
      if (mob) h.from = mob
    }
    steps.push({ hits, guessed, handIn, npc, line: plainText(raw).slice(0, 200), ...(count ? { count } : {}), ...(gives?.length ? { gives } : {}) })
  }
  if (!steps.length) return null
  return { page, givers, zones, level: level ? parseInt(level[0], 10) : null, steps }
}
