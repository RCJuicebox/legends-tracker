import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A test's scratch folders, removed after its file (tests/setup.ts): the tests used to leave thousands
// in %TEMP% (LT-643).

const made: string[] = []

/** A new empty folder in the system's temp folder, its name starting with `prefix`; gone after the file. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

/** Removes every folder tempDir made in this file (a busy one is tried again, then left). */
export function removeTempDirs(): void {
  for (const dir of made.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    } catch {
      // A file a test left open on Windows: the folder stays, as before.
    }
  }
}
