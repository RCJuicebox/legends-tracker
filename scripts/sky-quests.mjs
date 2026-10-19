// Builds src/shared/game/skyQuests.json, the Plane of Sky class quests the Sky module tracks, out of the
// eqlwiki's Plane of Sky page (https://eqlwiki.com/Plane_of_Sky, "Plane of Sky Class Quests"): for each
// class, its quest giver and every Test, with the reward, the words that start it, the Wind Rune it
// takes and the items it takes, each with the island and the mob it drops from.
//
//   node scripts/sky-quests.mjs
//
// One page, read once through the wiki's API. The tables write an item's source as "(7-SotS)": the
// island, then the mob, shortened; MOBS below spells each out, from the page's own island list.

import { writeFileSync } from 'node:fs'

const API = 'https://eqlwiki.com/api.php?action=parse&page=Plane_of_Sky&prop=wikitext|revid&format=json&formatversion=2'
const OUT = new URL('../src/shared/game/skyQuests.json', import.meta.url)
const UA = 'LegendsTracker-data-script (+https://github.com/RCJuicebox/legends-tracker)'

/** The tables' short names for the mobs items drop from, as the page's island list names them. */
const MOBS = {
  PoS: 'Protector of Sky',
  Gorga: 'Gorgalosk',
  KoS: 'Keeper of Souls',
  SL: 'The Spiroc Lord',
  BZ: 'Bazzt Zzzt',
  SotS: 'Sister of the Spire',
  EoV: 'Eye of Veeshan',
  Trash: 'any mob on the island'
}

const res = await fetch(API, { headers: { 'User-Agent': UA } })
if (!res.ok) throw new Error(`eqlwiki: ${res.status}`)
const page = /** @type {{ parse?: { wikitext: string, revid: number } }} */ (await res.json()).parse
if (!page) throw new Error('eqlwiki: no page in the answer')
const text = page.wikitext

const start = text.indexOf('== Plane of Sky Class Quests')
const end = text.indexOf('\n= Random Drop Items', start)
if (start < 0 || end < 0) throw new Error('The class quests section is not where it was: read the page and mend the script.')
const parts = text.slice(start, end).split(/\n=== \[\[([^\]]+)\]\] Tests ===\n/)

/** "[[Wind Rune Meda]]" → "Wind Rune Meda". */
const link = (s) => s.match(/\[\[([^\]|]+)/)?.[1].trim()
/** A cell's list items. */
const items = (cell) => [...cell.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1])

const quests = []
for (let i = 1; i < parts.length; i += 2) {
  const cls = parts[i]
  const section = parts[i + 1]
  const giver = link(section.match(/'''Quest Giver:'''\s*(\[\[[^\]]+\]\])/)?.[1] ?? '')
  if (!giver) throw new Error(`${cls}: no quest giver`)
  const table = section.slice(section.indexOf('{|'), section.lastIndexOf('|}'))
  // The first two pieces are the table's opening and its heading row.
  for (const row of table.split(/\n\|-\n/).slice(2)) {
    const cells = []
    for (const line of row.split('\n')) {
      if (/^\|(?![-}])/.test(line)) cells.push(line.slice(1).trim())
      else if (cells.length) cells[cells.length - 1] += '\n' + line
    }
    if (cells.length !== 5) throw new Error(`${cls}: a row of ${cells.length} cells, not 5`)
    const [rewardCell, name, say, runeCell, itemCell] = cells
    const rewards = [...rewardCell.matchAll(/\{\{:([^}]+)\}\}/g)].map((m) => m[1].trim())
    const runes = items(runeCell).map(link)
    const needs = items(itemCell).map((li) => {
      const item = link(li)
      const at = li.match(/\((\d)(?:-(\w+))?\)/)
      return {
        name: item,
        ...(at ? { island: Number(at[1]) } : {}),
        ...(at?.[2] ? { from: MOBS[at[2]] ?? at[2] } : {}),
        ...(li.includes('SkyNoDrop') ? { noDrop: true } : {})
      }
    })
    if (!rewards.length || !runes.length || runes.some((r) => !r) || needs.some((n) => !n.name)) throw new Error(`${cls}: ${name} did not read whole`)
    quests.push({ cls, giver, name: name.trim(), say: say.trim(), rewards, runes, items: needs })
  }
}
if (quests.length < 90) throw new Error(`Only ${quests.length} quests read: the tables have changed shape.`)

const date = new Date().toISOString().slice(0, 10)
writeFileSync(OUT, JSON.stringify({ source: `eqlwiki.com, Plane of Sky, revision ${page.revid}, read ${date}`, quests }, null, 1) + '\n')
console.log(`${quests.length} quests → ${OUT.pathname}`)
