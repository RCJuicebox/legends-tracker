// The speech queue's order: one phrase at a time, the backlog capped (a warning about a finished
// fight is worse than losing it), and an urgent phrase (a charm breaking, a groupmate at 20%) at the
// front, after any urgent one already waiting, never the one dropped for room (LT-719).

/** Puts `item` in the queue, taking one out first when it is full: the oldest that is not urgent, else the oldest. */
export function queueSpeech<T extends { urgent?: boolean }>(queue: T[], item: T, max: number): void {
  if (queue.length >= max) {
    const i = queue.findIndex((q) => !q.urgent)
    queue.splice(i < 0 ? 0 : i, 1)
  }
  if (item.urgent) {
    const at = queue.findIndex((q) => !q.urgent)
    if (at < 0) queue.push(item)
    else queue.splice(at, 0, item)
  } else queue.push(item)
}
