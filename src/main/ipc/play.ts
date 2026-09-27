import { handle } from './handle'
import { sanitizeStockCounts, sanitizeStockItem } from '../../core/validate'
import type { AppContext } from '../context'

// What happens in play: the damage meter, loot, buffs, respawns, motes and the mote stock.

export function registerPlayIpc(ctx: AppContext): void {
  const { engine } = ctx

  handle('combat:get', () => engine.combatSnapshot())
  handle('combat:segment', (id) => (typeof id === 'string' ? engine.combatSegment(id) : null))
  handle('combat:newSession', () => engine.newCombatSession())
  handle('combat:addMember', (name) => {
    if (typeof name === 'string') engine.meter.addMember(name.slice(0, 64))
    engine.groupChanged()
    return engine.combatSnapshot()
  })
  handle('combat:removeMember', (name) => {
    if (typeof name === 'string') engine.meter.removeMember(name)
    engine.groupChanged()
    return engine.combatSnapshot()
  })
  handle('combat:clearGroup', () => {
    engine.meter.clearGroup()
    engine.groupChanged()
    return engine.combatSnapshot()
  })
  handle('combat:rebuild', (minutes) => engine.rebuildCombat(Math.max(1, Math.min(1440, Number(minutes) || 60))))

  handle('loot:get', () => engine.lootView())
  handle('respawns:get', () => engine.respawnView())
  handle('respawns:forget', (key) => {
    if (typeof key === 'string') engine.respawns.forget(key)
    return engine.respawnView()
  })
  handle('buffs:get', () => engine.buffView())
  handle('buffs:setWanted', (list) => engine.setWantedBuffs(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 2000) : null))

  handle('motes:get', () => engine.moteView())
  handle('motes:start', () => engine.motes.startManual(Date.now()))
  handle('motes:stop', () => engine.motes.stop(Date.now()))
  handle('motes:pause', (at) => engine.motes.pause(typeof at === 'number' ? at : Date.now(), Date.now()))
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
