import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { tempDir } from '../tempDir'
import { defaultSettings } from '../../src/main/storeCore'
import type { AppSettings, SpellRule, Trigger } from '../../src/shared/types'

// Share my setup's channels (FEAT-028): a file written, opened, applied in part, and undone.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), dir: '', open: '', save: '', errors: [] as string[] }))

vi.mock('electron', () => ({
  app: { getPath: () => h.dir, getVersion: () => '2.16.0', isPackaged: false, isReady: () => false, on: () => {} },
  ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} }
}))

let OWN = { senderFrame: { url: '' } }
const call = (channel: string, ...args: unknown[]) => Promise.resolve(h.handlers.get(channel)!(OWN, ...args))

const GAZE: Trigger = {
  id: 'a1f0c9d2-4e3b-4a71-9c58-7d21b8e40021',
  name: 'Gaze',
  folder: '',
  enabled: true,
  comment: '',
  cooldownSec: 0,
  phrases: [{ text: 'Gaze', regex: false }],
  actions: []
}
const state = { settings: defaultSettings(), triggers: [] as Trigger[], rules: {} as Record<string, SpellRule> }

beforeAll(async () => {
  h.dir = tempDir('lt-ipc-setup-')
  process.env['EQL_USER_DATA'] = h.dir
  const { rendererUrl } = await import('../../src/main/push')
  OWN = { senderFrame: { url: rendererUrl() + 'index.html' } }
  const ctx = {
    store: {
      settings: { get: () => state.settings },
      triggers: { get: () => state.triggers },
      rules: { get: () => state.rules, set: (r: Record<string, SpellRule>) => void (state.rules = r) }
    },
    engine: { reconfigure: () => {} },
    saveSettings: (s: AppSettings) => (state.settings = s),
    saveTriggers: (t: Trigger[]) => void (state.triggers = t),
    windows: {
      openDialog: async () => ({ canceled: !h.open, filePaths: h.open ? [h.open] : [] }),
      saveDialog: async () => ({ canceled: !h.save, filePath: h.save }),
      showError: (title: string) => void h.errors.push(title)
    }
  }
  const { setupHandlers } = await import('../../src/main/ipc/setup')
  setupHandlers(ctx as never)
})

describe('the setup channels', () => {
  it('writes a setup, opens it, applies what is ticked and undoes it', async () => {
    state.triggers = [GAZE]
    state.settings = { ...defaultSettings(), uiScale: 1.25 }
    h.save = join(h.dir, 'setup.json')
    expect(await call('setup:export')).toBe(true)
    expect(JSON.parse(readFileSync(h.save, 'utf8')).app).toBe('legends-tracker-setup')
    // On another PC: no triggers, the usual scale.
    state.triggers = []
    state.settings = defaultSettings()
    h.open = h.save
    const preview = (await call('setup:open')) as { sections: { id: string }[]; version: string }
    expect(preview.version).toBe('2.16.0')
    expect(preview.sections.map((s) => s.id)).toContain('triggers')
    expect(await call('setup:apply', ['triggers', 'nonsense'])).toBe(true)
    expect(state.triggers.map((t) => t.name)).toEqual(['Gaze'])
    expect(state.settings.uiScale).toBe(defaultSettings().uiScale)
    expect(await call('setup:undo')).toBe(true)
    expect(state.triggers).toEqual([])
    expect(await call('setup:undo')).toBe(false)
  })

  it('says a file is not a setup, takes a cancel quietly, and applies nothing unopened', async () => {
    h.open = join(h.dir, 'other.json')
    writeFileSync(h.open, '[1, 2]')
    expect(await call('setup:open')).toBeNull()
    writeFileSync(h.open, 'not json')
    expect(await call('setup:open')).toBeNull()
    expect(h.errors).toEqual(['other.json could not be read.', 'other.json could not be read.'])
    h.open = ''
    expect(await call('setup:open')).toBeNull()
    h.save = ''
    expect(await call('setup:export')).toBe(false)
    await expect(call('setup:apply', ['triggers'])).rejects.toThrow('Open a setup file first.')
  })
})
