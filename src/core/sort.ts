// Rows in a table's chosen order: the sorting behind SortTh, kept apart from the page so tests can run it.

/** A table's sort: the column and which way. */
export type Sort<K extends string> = { key: K; dir: 1 | -1 }

/**
 * Rows in a SortTh's order: `values` gives each key's value for a row. A row with nothing to sort by
 * (null, undefined, NaN) goes last either way; text sorts as words, ignoring case.
 */
export function sortRows<T, K extends string>(rows: readonly T[], sort: Sort<K>, values: Record<K, (r: T) => number | string | null | undefined>): T[] {
  const value = values[sort.key]
  const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))
  return [...rows].sort((a, b) => {
    const x = value(a)
    const y = value(b)
    if (blank(x) || blank(y)) return blank(x) === blank(y) ? 0 : blank(x) ? 1 : -1
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, undefined, { sensitivity: 'base' }) : x! < y! ? -1 : x! > y! ? 1 : 0
    return c * sort.dir
  })
}
