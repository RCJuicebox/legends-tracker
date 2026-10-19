import { parentPort } from 'node:worker_threads'
import { captureRect, gdiAvailable } from './screenPixels'
import { GroupHealthLoop } from './groupHealthLoop'
import type { GroupHealthFromWorker, GroupHealthToWorker } from './groupHealth'

// The group health watch, off the main process thread: finding the Group window means reading a whole
// monitor (some 70 ms on a 3440 × 1440 screen), which the timers and the log should never feel. The
// loop itself is groupHealthLoop.ts; this file gives it the screen, the clock and the port. A ping
// answers whether the Windows calls (koffi) load inside the worker, which only a packaged build lays
// out the way an installed copy does (the smoke test asks).

const port = parentPort!
const post = (m: GroupHealthFromWorker) => port.postMessage(m)

const loop = new GroupHealthLoop({ capture: captureRect, post, now: Date.now, later: (fn, ms) => setTimeout(fn, ms) })

port.on('message', (m: GroupHealthToWorker) => {
  if (m.kind === 'ping') {
    try {
      post({ kind: 'pong', koffi: gdiAvailable() })
    } catch (e) {
      post({ kind: 'pong', koffi: false, error: e instanceof Error ? e.message : String(e) })
    }
    return
  }
  loop.message(m)
})
