import { handle } from './handle'
import { sanitizeStockCounts, sanitizeStockItem, stringsArg } from '../../core/validate'
import type { AppContext } from '../context'

// What happens in play: the damage meter, loot, buffs, respawns, motes and the mote stock.

export function registerPlayIpc(ctx: AppContext): void {
  const { engine } = ctx

  handle('combat:get', () => engine.combat.snapshot())
  handle('combat:segment', (id) => (typeof id === 'string' ? engine.combat.segment(id) : null))
  handle('combat:sessionTimeline', (id) => (typeof id === 'string' ? engine.combat.meter.sessionTimeline(id) : null))
  handle('combat:newSession', () => engine.combat.newSession())
  handle('combat:addMember', (name) => {
    if (typeof name === 'string') engine.meter.addMember(name.slice(0, 64))
    engine.groupChanged()
    return engine.combat.snapshot()
  })
  handle('combat:removeMember', (name) => {
    if (typeof name === 'string') engine.meter.removeMember(name)
    engine.groupChanged()
    return engine.combat.snapshot()
  })
  handle('combat:clearGroup', () => {
    engine.meter.clearGroup()
    engine.groupChanged()
    return engine.combat.snapshot()
  })
  handle('combat:rebuild', (minutes) => engine.rebuildCombat(Math.max(1, Math.min(1440, Number(minutes) || 60))))

  handle('loot:get', () => engine.combat.lootView())
  handle('respawns:get', () => engine.combat.respawnView())
  handle('respawns:forget', (key) => {
    if (typeof key === 'string') engine.respawns.forget(key)
    return engine.combat.respawnView()
  })
  handle('buffs:get', () => engine.buffView())
  handle('buffs:setWanted', (list) => engine.setWantedBuffs(Array.isArray(list) ? stringsArg(list, 2000, 120) : null))

  handle('motes:get', () => engine.moteView())
  handle('motes:start', () => engine.motes.startManual(Date.now()))
  handle('motes:stop', () => engine.motes.stop(Date.now()))
  handle('motes:pause', (at) => engine.motes.pause(typeof at === 'number' && Number.isFinite(at) ? at : Date.now(), Date.now()))
  handle('motes:resume', () => engine.motes.resume(Date.now()))
  handle('motes:rescan', () => engine.rebuildMoteHistory())
  handle('motes:setKind', (id, kind) => {
    if (typeof id === 'string' && (kind === 'crawl' || kind === 'instance')) engine.motes.setKind(id, kind)
    return engine.moteView()
  })
  handle('motes:forget', (id) => {
    if (typeof id === 'string') engine.motes.forget(id)
    return engine.moteView()
  })

  handle('stock:get', () => engine.stock.view())
  handle('stock:counts', (counts) => engine.stock.setCounts(sanitizeStockCounts(counts)))
  handle('stock:item', (input) => {
    const item = sanitizeStockItem(input)
    if (!item) throw new Error('Not an item to plan.')
    return engine.stock.setItem(item)
  })
  handle('stock:autoAdd', (on) => engine.stock.setAutoAdd(on === true))
  handle('stock:apply', () => engine.stock.applyPlan())
}
