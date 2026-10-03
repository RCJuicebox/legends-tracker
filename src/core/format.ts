// Number, time and name formatting shared by the pages and the main process: one clock, one way of
// writing a length of time, a percentage, a day. A page with a figure to show uses these, not its own.

/** A true minus sign (U+2212) in place of a leading hyphen: "−702", as the plan and the meter print it (LT-470). */
const minus = (s: string) => (s.startsWith('-') ? `−${s.slice(1)}` : s)

/** A number with thousands separators, rounded to a whole number: 12,345, −702. */
export const num = (n: number) => minus(Math.round(n).toLocaleString())

/** A number with thousands separators, as it is (no rounding). */
export const numExact = (n: number) => n.toLocaleString()

/** A character key as the game names its files, for display: "Name_server" → "Name · server". */
export const who = (key: string) => key.replace('_', ' · ')

/** Several character keys, for display. */
export const whoList = (keys: string[]) => keys.map(who).join(', ')

/** An item's page on eqlwiki. */
export const wikiUrl = (title: string) => `https://eqlwiki.com/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}`

/** A value rounded to so many decimal places, as a number: round(1.2345, 2) → 1.23. */
export const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places

/** A whole number with thousands separators, anything else to one place: 1,415 or 12.5. */
export const num1 = (n: number) => minus(Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1))

/** A change, with its sign always shown: "+12", "−3.5", "0". */
export const signed = (n: number) => (n > 0 ? `+${num1(n)}` : n < 0 ? num1(n) : '0')

/**
 * A fraction as a percentage, to so many places with the trailing zeros left off: 0.1234 → "12%",
 * pct(0.1234, 1) → "12.3%", pct(0.12, 1) → "12%". Every page's percentages go through this.
 */
export const pct = (fraction: number, places = 0) => `${Number((fraction * 100).toFixed(places))}%`

/**
 * Seconds as a timer shows them: "4:05", "1:02:09"; "∞" for no end. Rounded to the second first,
 * so 59.6 s is "1:00", never "0:60"; never below "0:00".
 */
export function clock(sec: number): string {
  if (!Number.isFinite(sec)) return '∞'
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** A length of time in words: "40 s", "12 min", "3 h 20 min", "3 h"; "permanent" for no end. */
export function duration(sec: number): string {
  if (!Number.isFinite(sec)) return 'permanent'
  const s = Math.max(0, Math.round(sec))
  if (s < 90) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

/** The time of day, in the viewer's own clock: "21:05" or "9:05 PM", with the seconds when asked. */
export const timeOfDay = (t: number, seconds = false) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) })

/** A day: "Fri, Sep 25", with the year when it is not this one ("Thu, Aug 7, 2025"). */
export function day(t: number, now = Date.now()): string {
  const d = new Date(t)
  const year = d.getFullYear() !== new Date(now).getFullYear()
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) })
}

/** A day and the time of day: "Fri, Sep 25, 21:05". */
export const when = (t: number, now = Date.now()) => `${day(t, now)}, ${timeOfDay(t)}`
