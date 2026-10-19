import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import { handle } from './handle'
import { log } from '../log'
import { SCHEMAS } from '../schema'
import { parseJson } from '../../core/json'
import { applySetup, buildSetup, readSetup, setupSummary, SETUP_SECTIONS, type SetupRead, type SetupSectionId } from '../../core/setup'
import type { AppSettings, SpellRule, Trigger } from '../../shared/types'
import type { AppContext } from '../context'

// "Share my setup" (FEAT-028), on Settings › General: one file out; a file in is read and listed first,
// the sections ticked are applied, and the setup as it was is kept for Undo.

/** Registered by registerAppIpc. */
export function setupHandlers(ctx: AppContext): void {
  const { store, windows } = ctx
  /** The file last opened, until applied or another is opened. */
  let opened: SetupRead | null = null
  /** The setup before the last apply, for Undo. */
  let before: { settings: AppSettings; triggers: Trigger[]; rules: Record<string, SpellRule> } | null = null

  const write = (next: { settings: AppSettings; triggers: Trigger[]; rules: Record<string, SpellRule> }) => {
    ctx.saveSettings(next.settings)
    ctx.saveTriggers(next.triggers)
    store.rules.set(next.rules)
    ctx.engine.reconfigure()
  }
  const current = () => ({ settings: store.settings.get(), triggers: store.triggers.get(), rules: store.rules.get() })

  handle('setup:export', async () => {
    const r = await windows.saveDialog({ defaultPath: 'legends-tracker-setup.json', filters: [{ name: 'Setup files', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return false
    const file = buildSetup(store.settings.get(), store.triggers.get(), store.rules.get(), SCHEMAS, app.getVersion(), new Date())
    await fs.writeFile(r.filePath, JSON.stringify(file, null, 2), 'utf8')
    return true
  })
  handle('setup:open', async () => {
    const r = await windows.openDialog({ filters: [{ name: 'Setup files', extensions: ['json'] }], properties: ['openFile'] })
    const file = r.filePaths[0]
    if (r.canceled || !file) return null
    let read: SetupRead | null = null
    try {
      read = readSetup(parseJson(await fs.readFile(file, 'utf8')), store.settings.get(), SCHEMAS)
    } catch (e) {
      log.warn(`Setup import: could not read ${file}`, e)
    }
    if (!read) {
      windows.showError(`${basename(file)} could not be read.`, 'It is not a Legends Tracker setup file (Settings › General › Share my setup writes one).')
      return null
    }
    opened = read
    return { file: basename(file), version: read.version, sections: setupSummary(read), newer: read.newer }
  })
  handle('setup:apply', (picked) => {
    if (!opened) throw new Error('Open a setup file first.')
    const ids = picked.filter((p): p is SetupSectionId => SETUP_SECTIONS.some((s) => s.id === p))
    if (!ids.length) return false
    before = current()
    write(applySetup(opened, ids, before))
    opened = null
    return true
  })
  handle('setup:undo', () => {
    if (!before) return false
    write(before)
    before = null
    return true
  })
}
