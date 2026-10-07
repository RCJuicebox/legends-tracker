import { parentPort } from 'node:worker_threads'
import { barFill, barsArea, findGroupBars, GroupHealthAlarm, type GroupBar } from '../core/groupHealth'
import { captureRect } from './screenPixels'
import type { GroupHealthFromWorker, GroupHealthToWorker, ScreenArea } from './groupHealth'

// The group health watch, off the main process thread: finding the Group window means reading a whole
// monitor (some 70 ms on a 3440 × 1440 screen), which the timers and the log should never feel. Until
// it is found, one monitor is searched every few seconds; then only its bars are copied, five times a
// second, and each member going low is posted to the main process to say.

/** Between samples of the bars once found. */
const SAMPLE_MS = 200
/** Between searches for the window while it is not found: one monitor each time. */
const SEARCH_MS = 4000
/** A search again while it is found, for members who joined below the rows already read. */
const RECHECK_MS = 15_000
/** Samples in a row a bar cannot be read before the window is looked for again (a second). */
const LOST_SAMPLES = 5

const port = parentPort!
const post = (m: GroupHealthFromWorker) => port.postMessage(m)

let on = false
let areas: ScreenArea[] = []
/** The monitor to search next; the one the window was last on goes first. */
let nextArea = 0
let bars: GroupBar[] = []
let lost = 0
let lastSearch = 0
let timer: NodeJS.Timeout | null = null
const alarm = new GroupHealthAlarm(25, 35)

const same = (a: GroupBar[], b: GroupBar[]) => a.length === b.length && a.every((x, i) => x.left === b[i].left && x.right === b[i].right && x.top === b[i].top)

/** Looks for the window on one monitor, or on monitor `only` when given; true when it is there. */
function search(only?: number): boolean {
  lastSearch = Date.now()
  if (!areas.length) return false
  const i = only ?? nextArea % areas.length
  const a = areas[i]
  const found = findGroupBars(captureRect(a.x, a.y, a.width, a.height))
  if (!found.length) {
    if (only === undefined) nextArea = i + 1
    return false
  }
  nextArea = i
  if (!same(found, bars)) {
    // The same rows somewhere else (the window was moved) keep what was said; other rows start over.
    if (found.length !== bars.length) alarm.reset()
    bars = found
    post({ kind: 'bars', bars })
  }
  lost = 0
  return true
}

function sample(): void {
  const area = barsArea(bars)
  const frame = captureRect(area.x, area.y, area.width, area.height)
  const fills = bars.map((b) => barFill(frame, b))
  if (fills.some((f) => f === null)) lost++
  else lost = 0
  for (const low of alarm.update(fills)) post({ kind: 'low', ...low })
}

function step(): void {
  timer = null
  if (!on) return
  try {
    const now = Date.now()
    if (!bars.length) {
      if (now - lastSearch >= SEARCH_MS) search()
    } else if (lost >= LOST_SAMPLES || now - lastSearch >= RECHECK_MS) {
      // Gone from where it was: it is looked for on its own monitor, then the others in turn.
      if (!search(nextArea % Math.max(1, areas.length)) && lost >= LOST_SAMPLES) {
        bars = []
        alarm.reset()
        post({ kind: 'bars', bars })
      }
    } else sample()
  } catch (e) {
    post({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    bars = []
  }
  timer = setTimeout(step, bars.length ? SAMPLE_MS : 500)
}

port.on('message', (m: GroupHealthToWorker) => {
  if (m.kind === 'config') {
    areas = m.areas
    alarm.setLine(m.belowPct, m.rearmPct)
    const was = on
    on = m.on
    if (on && !was) {
      lastSearch = 0
      if (!timer) step()
    }
  } else if (m.kind === 'search') {
    // Someone joined or left: looked for at once, not at the next search or recheck.
    lastSearch = 0
    if (bars.length) lost = LOST_SAMPLES
  }
})
