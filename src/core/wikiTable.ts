// Wiki tables ({| … |}) as rows of cells, for pages whose figures sit in tables: the Pet Guide, the
// tradeskill pages.

/** A wikitable as rows of cell texts, rowspans filled in, with its header names. */
export function parseWikiTables(wikitext: string): { headers: string[]; rows: string[][] }[] {
  const out: { headers: string[]; rows: string[][] }[] = []
  for (const m of wikitext.matchAll(/\{\|([\s\S]*?)\n\|\}/g)) {
    const headers: string[] = []
    const rows: string[][] = []
    const carry: { text: string; left: number }[] = []
    for (const chunk of m[1].split(/\n\|-/)) {
      const cells: string[] = []
      for (const raw of chunk.split('\n')) {
        const line = raw.trim()
        if (line.startsWith('!')) headers.push(...line.slice(1).split('!!').map((h) => cellText(h)))
        else if (line.startsWith('|') && !line.startsWith('|+') && !line.startsWith('|}')) cells.push(...splitCells(line.slice(1)))
      }
      if (!cells.length) continue
      const row: string[] = []
      let k = 0
      for (let col = 0; k < cells.length || carry[col]?.left > 0; col++) {
        const c = carry[col]
        if (c && c.left > 0) {
          row.push(c.text)
          c.left--
          continue
        }
        const cell = cells[k++]
        const span = Number(/rowspan="?(\d+)/i.exec(cell)?.[1] ?? 1)
        const text = cellText(cell)
        if (span > 1) carry[col] = { text, left: span - 1 }
        row.push(text)
      }
      rows.push(row)
    }
    out.push({ headers, rows })
  }
  return out
}

/** Cells on one line split on "||", leaving links' pipes alone. */
function splitCells(line: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    if (line.startsWith('[[', i)) depth++
    if (line.startsWith(']]', i)) depth = Math.max(0, depth - 1)
    if (depth === 0 && line.startsWith('||', i)) {
      out.push(cur)
      cur = ''
      i++
      continue
    }
    cur += line[i]
  }
  out.push(cur)
  return out
}

/** A cell without its attributes (style="…"|) and bold marks; links are kept, for finding the spell. */
export function cellText(cell: string): string {
  let s = cell
  // Attributes end at the first pipe outside a link.
  const outside = s.replace(/\[\[[^\]]*\]\]/g, (l) => '_'.repeat(l.length))
  const bar = outside.indexOf('|')
  if (bar >= 0 && /=/.test(outside.slice(0, bar))) s = s.slice(bar + 1)
  return s.replace(/'''/g, '').trim()
}

