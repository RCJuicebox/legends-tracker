// Number and name formatting shared by the pages. Each keeps the exact output its callers had.

/** A number with thousands separators, rounded to a whole number: 12,345. */
export const num = (n: number) => Math.round(n).toLocaleString()

/** A number with thousands separators, as it is (no rounding). */
export const numExact = (n: number) => n.toLocaleString()

/** A fraction as a percentage to two places: 0.1234 → "12.34%". */
export const fractionPct = (x: number) => `${(x * 100).toFixed(2)}%`

/** A percentage rounded to one place: 12.345 → "12.3%". */
export const roundPct = (n: number) => `${Math.round(n * 10) / 10}%`

/** A character key as the game names its files, for display: "Name_server" → "Name · server". */
export const who = (key: string) => key.replace('_', ' · ')

/** Several character keys, for display. */
export const whoList = (keys: string[]) => keys.map(who).join(', ')

/** An item's page on eqlwiki. */
export const wikiUrl = (title: string) => `https://eqlwiki.com/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}`
