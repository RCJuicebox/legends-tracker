import { describe, expect, it } from 'vitest'
import { parseToolsItemPage, toolsItemSlugs, toolsSlugs } from '../../src/core/toolsItem'
import { isLore, normalizeEra, restrictions } from '../../src/core/gearFinder'
import { parseStatsBlock } from '../../src/core/inventory'
import { procOf, wornEffectOf } from '../../src/core/itemEffects'
import { itemPageUrl } from '../../src/core/wikiItem'

// eqlegendstools.com's item pages, as the site lays them out (trimmed): the tooltip's lines become an
// eqlwiki-style stats block that the stats, slot, proc and focus readers read as they read the wiki's.

const page = (title: string, flags: string, lines: string[]) => `
  <main>
    <nav class="breadcrumbs"><span class="breadcrumb-current">${title}</span></nav>
    <div class="page-title"><p class="eyebrow">Weapon</p><h1>${title}</h1></div>
    <aside class="tooltip-card">
      <p class="tooltip-flags">${flags}</p>
      <ul class="tooltip-lines">
        ${lines.map((l) => `<li>${l}</li>`).join('')}
      </ul>
    </aside>
  </main>`

const fang = page('Doll&#39;s Fang', 'No Trade', [
  'Slot: PRIMARY SECONDARY',
  'Skill: Hand to Hand Atk Delay: 20',
  'DMG: 14 Dmg Bonus: 10',
  'Effect: <button class="effect-tooltip-trigger" type="button" data-effect-tooltip="proc:Lifedraw">Lifedraw</button> (Combat) at Level 1',
  'WT: 0.5 Size: SMALL',
  'Class: MNK BST',
  'Drops From: <a class="source-zone-link" href="/zones/nektropos-castle/">Nektropos Castle</a>: Alexa Everling',
  'Farming Speed: <span class="farming-speed">Fair</span><span> — Can be farmed with a reasonable time investment.</span>'
])

const signet = page('Signet Ring of Lord Everling', 'Lore Equipped · No Trade', [
  'Slot: FINGER',
  'HP: +15 MANA: +15',
  'STR: +7 INT: +7 DEX: +5',
  'SV MAGIC: +5',
  'Focus Effect: <button class="effect-tooltip-trigger">Mana Preservation III</button>',
  'WT: 0.1 Size: TINY',
  'Class: SHD NEC WIZ MAG ENC',
  'Drops From: Nektropos Castle: Lord Rikantus Everling, Alexa Everling'
])

describe("eqlegendstools.com's item pages", () => {
  it('reads a weapon: its slots, skill, damage and delay, its proc, and where it drops', () => {
    const it = parseToolsItemPage(fang, 'dolls-fang')!
    expect(it.title).toBe("Doll's Fang")
    expect(it.url).toBe('https://eqlegendstools.com/items/dolls-fang/')
    expect(itemPageUrl(it)).toBe(it.url)
    const r = restrictions(it.statsblock)
    expect(r.slots).toEqual(['PRIMARY', 'SECONDARY'])
    expect(r.classes).toEqual(['MNK', 'BST'])
    expect(r.skill).toBe('Hand to Hand')
    const s = parseStatsBlock(it.statsblock)
    expect([s.damage, s.delay, s.skill]).toEqual([14, 20, 'Hand to Hand'])
    expect(procOf(it.statsblock)).toBe('Lifedraw')
    expect(wornEffectOf(it.statsblock)).toBe('')
    expect(isLore(it.statsblock)).toBe(false)
    expect(it.zones).toEqual(['Nektropos Castle'])
    expect(it.mobs).toEqual(['Alexa Everling'])
    // The drop and farming lines are where it comes from, not stats.
    expect(it.statsblock).not.toMatch(/Drops From|Farming Speed/)
  })

  it('reads stats, a focus effect and Lore, and puts Nektropos Castle in era', () => {
    const it = parseToolsItemPage(signet, 'signet-ring-of-lord-everling')!
    const s = parseStatsBlock(it.statsblock)
    expect(s.stats).toEqual({ STR: 7, INT: 7, DEX: 5 })
    expect(Object.values(s.pools)).toEqual([15, 15])
    expect(it.focus).toBe('Mana Preservation III')
    expect(isLore(it.statsblock)).toBe(true)
    expect(it.mobs).toEqual(['Lord Rikantus Everling', 'Alexa Everling'])
    expect(it.era).toBe('Nektropos')
    expect(normalizeEra(it.era)).toBe('Classic')
  })

  it('keeps no page that is not a piece of equipment', () => {
    expect(parseToolsItemPage(page('Nektropos Private Chamber Key', 'Lore', ['WT: 0.1 Size: TINY']), 'nektropos-private-chamber-key')).toBeNull()
    expect(parseToolsItemPage('<html><body>Not found</body></html>', 'gone')).toBeNull()
  })

  it('lists the item pages in the sitemap, and the slugs an item may have', () => {
    const xml = `<urlset>
      <url><loc>https://eqlegendstools.com/items/</loc></url>
      <url><loc>https://eqlegendstools.com/items/gear/</loc></url>
      <url><loc>https://eqlegendstools.com/items/pyrosilk-robe/</loc></url>
      <url><loc>https://eqlegendstools.com/zones/nektropos-castle/</loc></url>
      <url><loc>https://eqlegendstools.com/items/dolls-fang/</loc></url>
    </urlset>`
    expect(toolsItemSlugs(xml)).toEqual(['pyrosilk-robe', 'dolls-fang'])
    expect(toolsSlugs("Hierophant's Crook")).toEqual(['hierophants-crook', 'hierophant-s-crook'])
    expect(toolsSlugs('Pyrosilk Robe')).toEqual(['pyrosilk-robe'])
  })
})
