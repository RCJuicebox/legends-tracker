import type { SpellBook } from './spells'
import { SELF } from './combatLines'

/** What a landing line says: on whom, which spells print it, and its message as it reads on you. */
export interface Landing {
  target: string
  spells: string[]
  text: string
}

/**
 * Spells by the message their landing prints, for the damage meter's incoming procs: "You feel very
 * dispelled." on you, "<name> feels very dispelled." on anyone else (the spell file keeps the second
 * with its leading space). Several spells may print one message: Strip, Pillage and Purge Enchantment,
 * among others, all print "You feel very dispelled.".
 */
export class LandingIndex {
  private readonly onYou = new Map<string, string[]>()
  /** Keyed by the message after the name, its leading space and all; the value's text is the "on you" form. */
  private readonly onOther = new Map<string, { spells: string[]; text: string }>()

  constructor(book: SpellBook) {
    for (const s of book.all()) {
      if (s.landSelf) push(this.onYou, s.landSelf, s.name)
      // A message of one word or none ("'s eyes glaze over." aside) names nobody; only " x y." is a landing on someone.
      if (s.landOther?.startsWith(' ') && s.landOther.length > 3) {
        const had = this.onOther.get(s.landOther)
        if (had) {
          if (!had.spells.includes(s.name)) had.spells.push(s.name)
        } else this.onOther.set(s.landOther, { spells: [s.name], text: s.landSelf || `Someone${s.landOther}` })
      }
    }
  }

  /** The landing a line is, or undefined. */
  find(text: string): Landing | undefined {
    const mine = this.onYou.get(text)
    if (mine) return { target: SELF, spells: mine, text }
    // The longest message that ends the line, so the name before it is the shortest that reads as one.
    for (let i = text.indexOf(' '); i > 0; i = text.indexOf(' ', i + 1)) {
      const hit = this.onOther.get(text.slice(i))
      if (hit) return { target: text.slice(0, i), spells: hit.spells, text: hit.text }
    }
    return undefined
  }
}

function push(m: Map<string, string[]>, k: string, name: string): void {
  const had = m.get(k)
  if (!had) m.set(k, [name])
  else if (!had.includes(name)) had.push(name)
}
