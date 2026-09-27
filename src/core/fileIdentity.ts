// A file's identity (volume and file index), to tell a log replaced at the same path from the same
// log grown. FAT, exFAT and some network drives report no file index (0), or one that changes; there
// the identity is unknown ('') and only a file that shrank counts as replaced.

let warned = false

export function fileIdentity(st: { dev: bigint | number; ino: bigint | number }, onUnknown?: () => void): string {
  if (BigInt(st.ino) === 0n) {
    if (!warned) onUnknown?.()
    warned = true
    return ''
  }
  return `${st.dev}:${st.ino}`
}

/** Whether a file seen now is the one seen before: the same identity, or either unknown and no smaller. */
export function sameFile(was: { id: string; size: number }, now: { id: string; size: number }): boolean {
  if (now.size < was.size) return false
  return !was.id || !now.id || was.id === now.id
}
