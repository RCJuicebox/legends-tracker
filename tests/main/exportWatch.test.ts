import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExportWatch } from '../../src/main/exportWatch'
import { log } from '../../src/main/log'

// The look the Achievements and Gear pages take at their export every few seconds: a call back once
// the game has written it again and the file has settled, and nothing otherwise.

describe('ExportWatch, noticing an export written again', () => {
  const game = mkdtempSync(join(tmpdir(), 'lt-export-watch-'))
  const path = (c: string) => join(game, `${c}-Inventory.txt`)
  /** Writes a character's export as written `ago` ms ago, and says when that is to the file. */
  const write = (c: string, ago: number) => {
    writeFileSync(path(c), 'x')
    const at = new Date(Date.now() - ago)
    utimesSync(path(c), at, at)
    return statSync(path(c)).mtimeMs
  }

  function setup(o: { folder?: string; shown?: () => boolean; changed?: (c: string) => Promise<void> } = {}) {
    const calls: string[] = []
    const watch = new ExportWatch('Inventory', path, () => o.folder ?? game, o.shown ?? (() => true), o.changed ?? (async (c) => void calls.push(c)))
    return { watch, calls }
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('calls back once the export has been written again and has settled', async () => {
    const { watch, calls } = setup()
    // Nothing followed yet.
    await watch.poll()
    watch.follow('Tester_neriak')
    // No export yet: quiet.
    await watch.poll()
    expect(calls).toEqual([])
    // Written a moment ago: left to settle.
    write('Tester_neriak', 200)
    await watch.poll()
    expect(calls).toEqual([])
    write('Tester_neriak', 5000)
    await watch.poll()
    expect(calls).toEqual(['Tester_neriak'])
    watch.stop()
  })

  it('leaves alone an export already read, and one no page could be showing', async () => {
    const modified = write('Tester_qeynos', 5000)
    let shown = true
    const { watch, calls } = setup({ shown: () => shown })
    watch.follow('Tester_qeynos')
    watch.seen(modified)
    await watch.poll()
    expect(calls).toEqual([])
    // Followed again (a page asked for it anew): read again once seen.
    watch.follow('Tester_qeynos')
    shown = false
    await watch.poll()
    expect(calls).toEqual([])
    shown = true
    await watch.poll()
    expect(calls).toEqual(['Tester_qeynos'])
    // No character, or no game folder: no look.
    watch.follow('')
    await watch.poll()
    const blind = setup({ folder: '' })
    blind.watch.follow('Tester_qeynos')
    await blind.watch.poll()
    expect([...calls, ...blind.calls]).toEqual(['Tester_qeynos'])
    watch.stop()
  })

  it('takes one look at a time, and logs a look that fails', async () => {
    write('Tester_neriak', 5000)
    let release = () => {}
    const calls: string[] = []
    const { watch } = setup({ changed: (c) => (calls.push(c), new Promise<void>((r) => (release = r))) })
    watch.follow('Tester_neriak')
    const first = watch.poll()
    // A second look while the first is still reading is skipped.
    await new Promise((r) => setTimeout(r, 50))
    await watch.poll()
    release()
    await first
    expect(calls).toEqual(['Tester_neriak'])

    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const failing = setup({ changed: async () => Promise.reject(new Error('the page went away')) })
    failing.watch.follow('Tester_neriak')
    await failing.watch.poll()
    expect(warn).toHaveBeenCalledWith('Inventory poll failed', expect.any(Error))
    // It looks again next time.
    await failing.watch.poll()
    expect(warn).toHaveBeenCalledTimes(2)
    failing.watch.stop()
    watch.stop()
  })

  it('keeps one timer however often it is followed, until stopped', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { watch } = setup()
    watch.follow('Tester_neriak')
    watch.follow('Tester_qeynos')
    expect(vi.getTimerCount()).toBe(1)
    watch.stop()
    expect(vi.getTimerCount()).toBe(0)
    watch.stop()
  })
})
