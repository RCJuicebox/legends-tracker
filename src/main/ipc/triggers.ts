import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import { handle } from './handle'
import { log } from '../log'
import { testTrigger } from '../../core/triggers'
import { respawnTrigger, respawnTriggerId } from '../../core/respawns'
import { sanitizeRespawnTimer, sanitizeTrigger, sanitizeTriggers } from '../../core/validate'
import type { AppContext } from '../context'

// Triggers, and the respawn timers that are triggers under the hood.

export function registerTriggerIpc(ctx: AppContext): void {
  const { store, engine, windows } = ctx

  handle('triggers:get', () => store.triggers.get())
  handle('triggers:save', (input) => {
    const list = sanitizeTriggers(input)
    if (!list) throw new Error('Triggers were not saved: they were not a list.')
    ctx.saveTriggers(list)
    return engine.triggers.errors
  })
  handle('triggers:test', (input, line) => {
    const t = sanitizeTrigger(input)
    if (!t) throw new Error('Not a trigger.')
    return testTrigger(t, typeof line === 'string' ? line : '', engine.status.character || 'You')
  })
  // A file that is not a trigger list gets a message box and null, the same as cancelling.
  handle('triggers:import', async () => {
    const r = await windows.openDialog({ filters: [{ name: 'Trigger files', extensions: ['json'] }], properties: ['openFile'] })
    const file = r.filePaths[0]
    if (r.canceled || !file) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (e) {
      log.warn(`Trigger import: could not read ${file}`, e)
      windows.showError(`${basename(file)} could not be imported.`, e instanceof SyntaxError ? `It is not valid JSON: ${e.message}` : (e as Error).message)
      return null
    }
    const inner = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as { triggers?: unknown }).triggers : parsed
    const list = sanitizeTriggers(inner)
    if (!list) {
      windows.showError(`${basename(file)} could not be imported.`, 'It holds no list of triggers: expected a JSON list, or an object with a "triggers" list.')
      return null
    }
    return list
  })
  handle('triggers:export', async (input) => {
    const list = sanitizeTriggers(input)
    if (!list) throw new Error('Nothing to export: not a list of triggers.')
    const r = await windows.saveDialog({ defaultPath: 'eql-triggers.json', filters: [{ name: 'Trigger files', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return false
    await fs.writeFile(r.filePath, JSON.stringify(list, null, 2), 'utf8')
    return true
  })

  // A respawn timer is an ordinary trigger, made or remade here and editable on the Triggers page.
  handle('respawns:setTimer', (input) => {
    const spec = sanitizeRespawnTimer(input)
    if (!spec) throw new Error('The timer was not saved: it needs a name and a length.')
    const list = store.triggers.get()
    const id = respawnTriggerId(spec.name)
    const existing = list.find((t) => t.id === id)
    const trigger = respawnTrigger(spec, existing)
    ctx.saveTriggers(existing ? list.map((t) => (t.id === id ? trigger : t)) : [...list, trigger])
    return engine.combat.respawnView()
  })
  handle('respawns:removeTimer', (name) => {
    if (typeof name !== 'string') throw new Error('Not a name.')
    const id = respawnTriggerId(name)
    ctx.saveTriggers(store.triggers.get().filter((t) => t.id !== id))
    return engine.combat.respawnView()
  })
}
