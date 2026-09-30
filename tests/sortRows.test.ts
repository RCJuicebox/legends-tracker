import { describe, expect, it } from 'vitest'
import { sortRows } from '../src/core/sort'

describe('sortRows', () => {
  const rows = [
    { name: 'bravo', n: 2 },
    { name: 'Alpha', n: null },
    { name: 'charlie', n: 1 },
    { name: 'alpha', n: 3 }
  ]
  const values = { name: (r: (typeof rows)[number]) => r.name, n: (r: (typeof rows)[number]) => r.n }

  it('sorts by the key asked for, either way, text as words', () => {
    expect(sortRows(rows, { key: 'n', dir: 1 }, values).map((r) => r.n)).toEqual([1, 2, 3, null])
    expect(sortRows(rows, { key: 'name', dir: 1 }, values).map((r) => r.name)).toEqual(['Alpha', 'alpha', 'bravo', 'charlie'])
  })

  it('puts a row with nothing to sort by last, whichever way', () => {
    expect(sortRows(rows, { key: 'n', dir: -1 }, values).map((r) => r.n)).toEqual([3, 2, 1, null])
    // The rows given are left as they were.
    expect(rows.map((r) => r.n)).toEqual([2, null, 1, 3])
  })
})
