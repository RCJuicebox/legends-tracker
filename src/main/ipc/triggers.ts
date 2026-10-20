import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import { handle } from './handle'
import { log } from '../log'
import { testTrigger } from '../../core/triggers'
import { respawnTimerSpec, respawnTrigger, respawnTriggerId, type RespawnTimerSpec } from '../../core/respawns'
import { parseJson } from '../../core/json'
import { sanitizeRespawnTimer, sanitizeSpawnLink, sanitizeTrigger, sanitizeTriggers } from '../../core/validate'
import type { AppContext } from '../context'
import { ginaToTriggers, triggersToGina } from '../../core/gina'
import { readJsonFile } from '../storeCore'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { createWriteStream } from 'node:fs'

/** GINA's package: a zip holding ShareData.xml (FEAT-029). */
const SHARE_DATA = 'sharedata.xml'

/** ShareData.xml out of a .gtp file, as text. */
function readGtp(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('could not open the package'))
      const fail = (e: unknown) => {
        zip.close()
        reject(e)
      }
      zip.on('error', fail)
      zip.on('end', () => reject(new Error('there is no ShareData.xml in it')))
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.toLowerCase().split('/').pop() !== SHARE_DATA) return zip.readEntry()
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return fail(e2 ?? new Error('could not read ShareData.xml'))
          const parts: Buffer[] = []
          stream.on('data', (c: Buffer) => parts.push(c))
          stream.on('error', fail)
          stream.on('end', () => {
            zip.close()
            resolve(Buffer.concat(parts).toString('utf8').replace(/^﻿/, ''))
          })
        })
      })
      zip.readEntry()
    })
  })
}

/** A .gtp file holding `xml` as its ShareData.xml. */
function writeGtp(file: string, xml: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    zip.addBuffer(Buffer.from(xml, 'utf8'), 'ShareData.xml')
    zip.end()
    const out = createWriteStream(file)
    out.on('close', () => resolve())
    out.on('error', reject)
    zip.outputStream.on('error', reject).pipe(out)
  })
}

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
      parsed = parseJson(await fs.readFile(file, 'utf8'))
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
  // The triggers this build ships, for those a profile is missing (FEAT-043: a new one reaches an old profile this way).
  handle('triggers:defaults', () => {
    const read = readJsonFile(store.defaultTriggersPath, { setAside: false })
    return (read.state === 'ok' ? sanitizeTriggers(read.value) : null) ?? []
  })
  // GINA's packages (FEAT-029): a .gtp (or its ShareData.xml) in, a .gtp out.
  handle('triggers:importGina', async () => {
    const r = await windows.openDialog({ filters: [{ name: 'GINA packages', extensions: ['gtp', 'xml'] }], properties: ['openFile'] })
    const file = r.filePaths[0]
    if (r.canceled || !file) return null
    try {
      const xml = file.toLowerCase().endsWith('.xml') ? await fs.readFile(file, 'utf8') : await readGtp(file)
      const list = sanitizeTriggers(ginaToTriggers(xml)) ?? []
      if (!list.length) {
        windows.showError(`${basename(file)} could not be imported.`, 'It holds no GINA triggers.')
        return null
      }
      return list
    } catch (e) {
      log.warn(`GINA import: could not read ${file}`, e)
      windows.showError(`${basename(file)} could not be imported.`, (e as Error).message)
      return null
    }
  })
  handle('triggers:exportGina', async (input) => {
    const list = sanitizeTriggers(input)
    if (!list?.length) throw new Error('Nothing to export: not a list of triggers.')
    const r = await windows.saveDialog({ defaultPath: 'legends-tracker.gtp', filters: [{ name: 'GINA packages', extensions: ['gtp'] }] })
    if (r.canceled || !r.filePath) return false
    await writeGtp(r.filePath, triggersToGina(list))
    return true
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
    // A spawn point's timer starts at a death of any of its mobs; a pinned one's, at a kill a /loc puts there.
    const spawn = engine.respawns.spawnOf(spec.name)
    saveTimer(spawn ? { ...spec, ...spawn } : spec)
    return engine.combat.respawnView()
  })

  function saveTimer(spec: RespawnTimerSpec): void {
    const list = store.triggers.get()
    const id = respawnTriggerId(spec.name)
    const existing = list.find((t) => t.id === id)
    const trigger = respawnTrigger(spec, existing)
    ctx.saveTriggers(existing ? list.map((t) => (t.id === id ? trigger : t)) : [...list, trigger])
  }

  // Spawn points live with the respawn records; their timers are triggers like any other, so they are
  // made to match here: a link's names go into its timer, and an unlink takes the timer with it.
  handle('respawns:link', (input) => {
    const link = sanitizeSpawnLink(input)
    if (!link) throw new Error('A spawn point needs a zone, a name and at least two mobs, or one pinned to a spot.')
    engine.respawns.link(link)
    const timer = store.triggers.get().find((t) => t.id === respawnTriggerId(link.name))
    const spec = timer && respawnTimerSpec(timer)
    if (spec) saveTimer({ ...spec, name: link.name, ...(engine.respawns.spawnOf(link.name) ?? { names: link.names }) })
    return engine.combat.respawnView()
  })
  handle('respawns:unlink', (key) => {
    if (typeof key !== 'string') throw new Error('Not a spawn point.')
    const name = engine.respawns.records[key]?.name
    if (engine.respawns.unlink(key) && name) {
      const id = respawnTriggerId(name)
      ctx.saveTriggers(store.triggers.get().filter((t) => t.id !== id))
    }
    return engine.combat.respawnView()
  })
  handle('respawns:removeTimer', (name) => {
    if (typeof name !== 'string') throw new Error('Not a name.')
    const id = respawnTriggerId(name)
    ctx.saveTriggers(store.triggers.get().filter((t) => t.id !== id))
    return engine.combat.respawnView()
  })
}
