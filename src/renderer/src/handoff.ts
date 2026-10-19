// What one page asks another to open when it sends the player there: a spell's row on Spell Timers,
// a trigger on Triggers. Taken once by the page it is for (LT-691).

const wanted = new Map<string, string>()

/** Asks `page` to open `what` when it is next drawn. */
export function handOff(page: string, what: string): void {
  wanted.set(page, what)
}

/** What another page asked this one to open, once; undefined when nothing was. */
export function takeHandOff(page: string): string | undefined {
  const v = wanted.get(page)
  wanted.delete(page)
  return v
}
