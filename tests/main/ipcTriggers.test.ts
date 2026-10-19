import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { tempDir } from '../tempDir'
import type { Trigger } from '../../src/shared/types'

// The Triggers page's file channels (FEAT-029, FEAT-043): a GINA package written out and read back
// through the real zip code, and the shipped triggers read from the build's own file.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), dir: '', open: '', save: '', errors: [] as string[] }))

vi.mock('electron', () => ({
  app: { getPath: () => h.dir, getVersion: () => 'test', isPackaged: false, isReady: () => false, on: () => {} },
  ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} }
}))

let OWN = { senderFrame: { url: '' } }
const call = (channel: string, ...args: unknown[]) => Promise.resolve(h.handlers.get(channel)!(OWN, ...args))

const TRIGGER: Trigger = {
  id: 'a1f0c9d2-4e3b-4a71-9c58-7d21b8e40001',
  name: 'Fear landed',
  enabled: true,
  folder: 'Tests',
  comment: '',
  cooldownSec: 0,
  phrases: [{ text: '{S} is afraid', regex: false }],
  actions: [
    { type: 'speak', text: '{S} feared', interrupt: false },
    { type: 'timer', name: 'Fear', durationSec: 18, color: '#c050c0', overlay: 'targets', warnSec: 3, warnSpeech: '', endSpeech: '', restart: 'restart', endEarly: [] }
  ]
}

beforeAll(async () => {
  h.dir = tempDir('lt-ipc-triggers-')
  process.env['EQL_USER_DATA'] = h.dir
  const { rendererUrl } = await import('../../src/main/push')
  OWN = { senderFrame: { url: rendererUrl() + 'index.html' } }
  const defaults = join(h.dir, 'triggers.json')
  writeFileSync(defaults, JSON.stringify([TRIGGER]))
  const ctx = {
    store: { defaultTriggersPath: defaults, triggers: { get: () => [] } },
    engine: {},
    windows: {
      openDialog: async () => ({ canceled: !h.open, filePaths: h.open ? [h.open] : [] }),
      saveDialog: async () => ({ canceled: !h.save, filePath: h.save }),
      showError: (title: string) => void h.errors.push(title)
    }
  }
  const { registerTriggerIpc } = await import('../../src/main/ipc/triggers')
  registerTriggerIpc(ctx as never)
})

describe('the triggers file channels', () => {
  it('gives the shipped triggers, for a profile missing one', async () => {
    expect(await call('triggers:defaults')).toMatchObject([{ id: TRIGGER.id, name: 'Fear landed' }])
  })

  it('writes a GINA package and reads it back', async () => {
    h.save = join(h.dir, 'out.gtp')
    expect(await call('triggers:exportGina', [TRIGGER])).toBe(true)
    expect(existsSync(h.save)).toBe(true)
    h.open = h.save
    const back = (await call('triggers:importGina')) as Trigger[]
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ name: 'Fear landed', folder: 'Tests', phrases: [{ text: '{S} is afraid' }] })
    expect(back[0].actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'timer', durationSec: 18 })]))
  })

  it('says why a file did not import, and takes a cancel quietly', async () => {
    h.open = join(h.dir, 'not-a-package.gtp')
    writeFileSync(h.open, 'not a zip')
    expect(await call('triggers:importGina')).toBeNull()
    h.open = join(h.dir, 'empty.xml')
    writeFileSync(h.open, '<SharedData></SharedData>')
    expect(await call('triggers:importGina')).toBeNull()
    expect(h.errors).toEqual(['not-a-package.gtp could not be imported.', 'empty.xml could not be imported.'])
    h.open = ''
    expect(await call('triggers:importGina')).toBeNull()
    h.save = ''
    expect(await call('triggers:exportGina', [TRIGGER])).toBe(false)
    await expect(call('triggers:exportGina', 'x')).rejects.toThrow('Nothing to export')
  })
})
