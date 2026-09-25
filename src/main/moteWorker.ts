import { parentPort, workerData } from 'node:worker_threads'
import { scanMoteHistory } from './moteHistory'

// Rebuilds mote history off the main process thread: reads every archive and the live log flat out,
// posting progress as it goes and the finished history at the end.
const job = workerData as { logPath: string; archiveDir: string; stem: string }

scanMoteHistory({ ...job, progress: (message, fraction) => parentPort!.postMessage({ kind: 'progress', message, fraction }) }).then(
  (r) => parentPort!.postMessage({ kind: 'done', state: r.state, lastTime: r.lastTime }),
  (e: unknown) => parentPort!.postMessage({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
)
