/** A local calendar day, "2026-09-24", for a time in ms. Log timestamps are local time, so days are too. */
export function localDay(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
