import { captureScreens, discardScreens, ocrImage } from './ocr'
import { composeRows, countsFromComposite, findMoteRows, rows as ocrRows, statsWindowFromScreen } from '../core/screenText'
import type { Windows } from './windows'
import type { MoteScreenRead, StatsScreenRead } from '../shared/ipc'

// Reading the game's windows off the screen with Windows' OCR. The main window steps aside for a
// moment so it does not cover the game, then every monitor is captured and read. Nothing here touches
// the game's process.

/** Steps the main window aside, captures every monitor, and hands the captures over. */
async function withScreens<T>(windows: Windows, read: (shots: string[]) => Promise<T>): Promise<T> {
  const back = windows.stepAside()
  let shots: string[] = []
  try {
    await new Promise((r) => setTimeout(r, 900))
    shots = await captureScreens()
    return await read(shots)
  } finally {
    void discardScreens(shots)
    back()
  }
}

/**
 * Reads the in-game Inventory window's Stats tab: a first read of each monitor finds the window, a
 * second reads just that area at four times the size, where the small font's slashes survive better.
 */
export function readStatsFromScreen(windows: Windows): Promise<StatsScreenRead> {
  return withScreens(windows, async (shots) => {
    // Only the monitor the window is on counts: other windows can carry a stray "AC" or "Luck".
    let best: { path: string; first: ReturnType<typeof statsWindowFromScreen> } | null = null
    for (const path of shots) {
      const first = statsWindowFromScreen(await ocrImage(path, 2))
      if (first.area && Object.keys(first.values).length > Object.keys(best?.first.values ?? {}).length) best = { path, first }
    }
    if (!best) return { values: {}, rows: [], screens: shots.length }
    const a = best.first.area!
    const second = statsWindowFromScreen(await ocrImage(best.path, 4, { width: a.w, height: a.h, rowHeight: a.h, pieces: [{ from: a, x: 0, y: 0 }] }))
    return { values: { ...best.first.values, ...second.values }, rows: second.rows.length ? second.rows : best.first.rows, screens: shots.length }
  })
}

/**
 * Reads mote counts off the game's currency window, open wherever it is. Two reads: the first finds
 * the mote rows; the second reads a small image rebuilt from just those rows, each name set close
 * beside its count, because OCR misses lone digits far out in a column.
 */
export function readMotesFromScreen(windows: Windows): Promise<MoteScreenRead> {
  return withScreens(windows, async (shots) => {
    const found: Record<string, number> = {}
    const rowsRead: string[] = []
    let sample: string[] = []
    for (const path of shots) {
      const words = await ocrImage(path, 2)
      const moteRows = findMoteRows(words)
      if (moteRows.length) {
        const layout = composeRows(moteRows)
        const second = countsFromComposite(await ocrImage(path, 3, layout), moteRows, layout)
        moteRows.forEach((row, i) => {
          const n = second[i] ?? row.count
          if (n === null) return
          found[row.rank] = n
          rowsRead.push(`${row.text.replace(/\s*\d[\d,.]*$/, '')} → ${n}`)
        })
      }
      if (!sample.length) sample = ocrRows(words).map((x) => x.text).filter((t) => /potential|mote/i.test(t)).slice(0, 20)
    }
    return { counts: found, rows: rowsRead, nearMisses: rowsRead.length ? [] : sample, screens: shots.length }
  })
}
