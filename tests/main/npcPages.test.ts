import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { NpcPages } from '../../src/main/sources/npcPages'
import type { WikiPage } from '../../src/main/sources/wiki'
import { tempDir } from '../tempDir'

// One eqlwiki NPC-page source for the Slayer counts (a mob's race) and the faction plan (what a camp's
// named mob's page says), with one cache: a fake wiki answers by title (LT-624).

const PAGE = (race: string, hp: string) => `{{Namedmobpage\n| name = X\n| race = ${race}\n| hp = ${hp}\n| respawn_time = 6:40\n}}`

let dir: string
beforeEach(async () => {
  dir = tempDir('lt-npc-')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function fakeWiki(pages: Record<string, string>) {
  const asked: string[][] = []
  const fetch = async (titles: string[]) => {
    asked.push(titles)
    return new Map<string, WikiPage>(titles.flatMap((t) => (pages[t] ? [[t, { title: t, content: pages[t], revid: 1 } as WikiPage]] : [])))
  }
  return { asked, fetch }
}

describe('NpcPages', () => {
  it('reads a page once for both readers, under every title it may have, and keeps it', async () => {
    const w = fakeWiki({ 'Lesser Blade Fiend': PAGE('Dervish', '1,512'), 'Ambassador DVinn': PAGE('Dark Elf', '3000') })
    const n = new NpcPages({ dir, pages: w.fetch })
    expect(n.race('lesser blade fiend')).toBeUndefined()
    expect(await n.lookUp(['lesser blade fiend', 'a nobody'])).toBe(true)
    // Found under its Title-Case title, though asked as the log writes it.
    expect(n.race('lesser blade fiend')).toBe('Dervish')
    expect(n.race('a nobody')).toBeNull()
    expect(w.asked[0]).toEqual(['Lesser blade fiend', 'Lesser Blade Fiend', 'A nobody', 'A Nobody'])
    // The faction plan asks about the same name and a new one: only the new one goes to the wiki.
    const info = await n.lookup(['Lesser Blade Fiend - The Estate of Unrest', 'Ambassador D`Vinn'], 1000)
    expect(info).toEqual({
      'lesser blade fiend': { found: true, hp: 1512, respawnSec: 400 },
      'ambassador d`vinn': { found: true, hp: 3000, respawnSec: 400 }
    })
    expect(w.asked[1]).toEqual(['Ambassador D`Vinn', 'Ambassador DVinn', "Ambassador D'Vinn"])
    expect(n.race('Ambassador D`Vinn')).toBe('Dark Elf')
    // Kept: a new reader of the folder knows them without asking.
    const again = new NpcPages({ dir, pages: w.fetch })
    await again.ready()
    expect(again.race('ambassador d`vinn')).toBe('Dark Elf')
    expect(await again.lookUp(['Ambassador D`Vinn'])).toBe(false)
    expect(w.asked).toHaveLength(2)
  })

  it('brings over the two files kept before, each side asked again only for what it lacks', async () => {
    const now = Date.now()
    await fs.writeFile(join(dir, 'npc-races.json'), JSON.stringify({ version: 2, races: { 'an ire ghast': { race: 'Ghast', at: now } } }))
    await fs.writeFile(join(dir, 'faction-npcs.json'), JSON.stringify({ version: 3, npcs: { 'gate guard bram': { found: true, hp: 1512, at: now } } }))
    const w = fakeWiki({ 'Gate Guard Bram': PAGE('Kaladim Citizen', '1512'), 'An ire ghast': PAGE('Ghast', '9000') })
    const n = new NpcPages({ dir, pages: w.fetch })
    await n.ready()
    expect(n.race('an ire ghast')).toBe('Ghast')
    expect(n.race('Gate Guard Bram')).toBeUndefined()
    expect(existsSync(join(dir, 'npc-pages.json'))).toBe(true)
    expect(existsSync(join(dir, 'npc-races.json'))).toBe(false)
    // The faction side knows Bram already; the ghast's page is read for its info.
    expect(await n.lookup(['Gate Guard Bram', 'an ire ghast'], 1000)).toEqual({
      'gate guard bram': { found: true, hp: 1512 },
      'an ire ghast': { found: true, hp: 9000, respawnSec: 400 }
    })
    expect(w.asked).toEqual([['An ire ghast', 'An Ire Ghast']])
    // And the Slayer side asks for Bram's race alone.
    expect(await n.lookUp(['Gate Guard Bram', 'an ire ghast'])).toBe(true)
    expect(w.asked[1]).toEqual(['Gate Guard Bram'])
    expect(n.race('Gate Guard Bram')).toBe('Kaladim Citizen')
  })

  it('asks again about a name with no page a week on, so a page added since is read (LT-538)', async () => {
    const weekAgo = Date.now() - 8 * 24 * 3600_000
    await fs.writeFile(
      join(dir, 'npc-pages.json'),
      JSON.stringify({
        version: 1,
        npcs: { 'a nobody': { at: weekAgo, found: false, race: null, info: {} }, 'a newer nobody': { at: Date.now(), found: false, race: null, info: {} } }
      })
    )
    const w = fakeWiki({ 'A nobody': PAGE('Gnoll', '100') })
    const n = new NpcPages({ dir, pages: w.fetch })
    await n.ready()
    // Stale: not known, so the counts ask again; a miss of today stays a miss.
    expect(n.race('a nobody')).toBeUndefined()
    expect(n.race('a newer nobody')).toBeNull()
    expect(await n.lookUp(['a nobody', 'a newer nobody'])).toBe(true)
    expect(w.asked).toEqual([['A nobody', 'A Nobody']])
    expect(n.race('a nobody')).toBe('Gnoll')
  })

  it('keeps what it has when the wiki cannot be reached, and does not ask again for a while', async () => {
    let calls = 0
    const n = new NpcPages({
      dir,
      pages: async () => {
        calls++
        throw new Error('offline')
      }
    })
    expect(await n.lookUp(['a nobody'])).toBe(false)
    expect(await n.lookUp(['a nobody'])).toBe(false)
    expect(calls).toBe(1)
    expect(n.race('a nobody')).toBeUndefined()
  })
})
