import { describe, expect, it } from 'vitest'
import { appendFileSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { InventoryFiles } from '../../src/main/inventory'
import type { ItemCatalog } from '../../src/main/items'
import { tempDir } from '../tempDir'

// The Gear page's inventory view carries what the character's log saw looted after the export was
// written: read on from the line before the export, a little more at each look, afresh for a new export.

describe('gear looted since the inventory export', () => {
  const game = tempDir('lt-inventory-loot-')
  const character = 'Tester_neriak'
  const exportPath = join(game, `${character}-Inventory.txt`)
  const logPath = join(game, 'Logs', `eqlog_${character}.txt`)
  const catalog = { lookup: async () => ({}) } as unknown as ItemCatalog
  const stamp = (min: number) => `[Thu Oct 22 20:${String(min).padStart(2, '0')}:00 2026]`
  const writeExport = (min: number) => {
    writeFileSync(exportPath, ['Location\tName\tID\tCount\tSlots', 'General 1\tStar Ruby\t1\t1\t0', ''].join('\r\n'))
    const at = new Date(2026, 9, 22, 20, min, 0, 500)
    utimesSync(exportPath, at, at)
  }

  it('reads the log from the export on, and again from the next export', async () => {
    mkdirSync(join(game, 'Logs'), { recursive: true })
    writeFileSync(
      logPath,
      [
        `${stamp(0)} --You have looted a Shadow Rage Helm +4 from Cleric of Innoruuk's corpse.--`,
        `${stamp(5)} You have entered The Plane of Fear.`,
        `${stamp(10)} --You have looted a Shadow Rage Helm +4 from Cleric of Innoruuk's corpse.--`,
        ''
      ].join('\r\n')
    )
    writeExport(5)
    const files = new InventoryFiles(
      game,
      () => game,
      catalog,
      () => {},
      () => false
    )
    let view = await files.load(character)
    expect(view.looted).toEqual({ kept: [{ name: 'Shadow Rage Helm +4', count: 1, at: new Date(2026, 9, 22, 20, 10).getTime() }], merged: [] })

    // More loot: the next look reads only the new lines.
    appendFileSync(logPath, `${stamp(12)} You looted an Indicolite Bracer +4 from Reward Chest to create an Indicolite Bracer +6\r\n`)
    view = await files.load(character)
    expect(view.looted?.kept[0].count).toBe(1)
    expect(view.looted?.merged.map((m) => m.name)).toEqual(['Indicolite Bracer +6'])

    // A new export knows all of that: nothing looted since.
    writeExport(15)
    view = await files.load(character)
    expect(view.looted).toEqual({ kept: [], merged: [] })
    files.stop()
  })

  it('looks up an item the wiki has no page for in the gear from eqlegendstools.com', async () => {
    const files = new InventoryFiles(
      game,
      () => game,
      catalog,
      () => {},
      () => false
    )
    const robe = {
      title: 'Pyrosilk Robe',
      statsblock: 'Slot: CHEST<br>',
      icon: 0,
      focus: '',
      era: 'Nektropos',
      zones: [],
      mobs: [],
      quest: false,
      crafted: false,
      url: 'https://eqlegendstools.com/items/pyrosilk-robe/'
    }
    files.extraItems = async () => [robe]
    const items = await files.lookup(['Pyrosilk Robe +4', 'Star Ruby'])
    expect(items['pyrosilk robe']).toEqual({ title: 'Pyrosilk Robe', found: true, statsblock: 'Slot: CHEST<br>', icon: 0, url: robe.url })
    expect(items['star ruby']).toBeUndefined()
    files.stop()
  })

  it('leaves it out without a log', async () => {
    const empty = tempDir('lt-inventory-nolog-')
    writeFileSync(join(empty, `${character}-Inventory.txt`), 'Location\tName\tID\tCount\tSlots\r\n')
    const files = new InventoryFiles(
      empty,
      () => empty,
      catalog,
      () => {},
      () => false
    )
    const view = await files.load(character)
    expect(view.inventory).not.toBeNull()
    expect(view.looted).toBeUndefined()
    files.stop()
  })
})
