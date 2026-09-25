import { parentPort, workerData } from 'node:worker_threads'
import { scanMoteHistory, type MoteScanJob } from './moteHistory'

// Rebuilds mote history off the main process thread: reads every archive and live log flat out,
// posting progress as it goes and the finished history at the end.
scanMoteHistory(workerData as MoteScanJob, (message, fraction) => parentPort!.postMessage({ kind: 'progress', message, fraction })).then(
  (result) => parentPort!.postMessage({ kind: 'done', result }),
  (e: unknown) => parentPort!.postMessage({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
)
