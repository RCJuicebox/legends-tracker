import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultSettings } from '../../src/main/storeCore'
import type { AppSettings, CharacterSettings } from '../../src/shared/types'

// settings:save (ipc/app.ts) against a stand-in context: what a page sends is checked, and what it
// cannot know as well as the main process does is kept from the settings already saved.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), dir: '' }))

/** Anything: callable, any property is another, and never a promise. */
function stub(): unknown {
  const fn = function () {}
  return new Proxy(fn, {
    get: (_t, p) => (p === 'then' ? undefined : p === Symbol.toPrimitive ? () => '' : p === Symbol.iterator ? undefined : stub()),
    apply: () => stub()
  })
}

vi.mock('electron', () => {
  const any = stub()
  return {
    app: { getPath: () => h.dir, getVersion: () => 'test', isPackaged: false, on: () => {} },
    ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} },
    BrowserWindow: any,
    Notification: any,
    dialog: any,
    nativeTheme: any,
    screen: any,
    session: any,
    shell: any
  }
})

let saved: AppSettings = defaultSettings()
let own = { senderFrame: { url: '' } }
const save = (s: unknown) => h.handlers.get('settings:save')!(own, s)

beforeAll(async () => {
  h.dir = mkdtempSync(join(tmpdir(), 'lt-settings-'))
  process.env['EQL_USER_DATA'] = h.dir
  const { rendererUrl } = await import('../../src/main/push')
  own = { senderFrame: { url: rendererUrl() + 'index.html' } }
  const { registerAppIpc } = await import('../../src/main/ipc/app')
  const parts: Record<string, unknown> = {
    store: { settings: { get: () => saved } },
    saveSettings: (next: AppSettings) => {
      saved = next
      return next
    }
  }
  registerAppIpc(new Proxy(parts, { get: (t, p: string) => (p in t ? t[p] : stub()) }) as never)
})

const character = (level: number): CharacterSettings => ({ level, classLevels: { Druid: level }, focusSources: [] })

describe('settings:save', () => {
  it("keeps the character records already saved: a page's copy of them may be behind", async () => {
    saved = { ...defaultSettings(), characters: { Tester_neriak: character(50) } }
    // The page was opened before Tester_qeynos was saved, and Tester_neriak went up a level since.
    const page = { ...defaultSettings(), characters: { Tester_neriak: character(40) }, achievementCues: false }
    await save(page)
    expect(saved.achievementCues).toBe(false)
    expect(saved.characters).toEqual({ Tester_neriak: character(50) })
  })

  it('keeps the overlays arranged once arranged, whatever an older page says', async () => {
    saved = { ...defaultSettings(), setup: { hidden: false, accepted: [], arranged: true } }
    await save({ ...defaultSettings(), setup: { hidden: true, accepted: ['sound'], arranged: false } })
    expect(saved.setup).toEqual({ hidden: true, accepted: ['sound'], arranged: true })
  })

  it('keeps the faction plan a page sends, checked', async () => {
    saved = defaultSettings()
    const factionPlan = { assumptions: { travelMin: 500, goal: 'positive' }, choices: { Tester_neriak: { locks: { 'Guards of Qeynos': 'a1' }, excluded: ['a2'], perHour: {} } } }
    await save({ ...defaultSettings(), factionPlan })
    expect(saved.factionPlan).toEqual({ assumptions: { travelMin: 120, goal: 'positive' }, choices: factionPlan.choices })
  })
})
