// Builds src/shared/game/skyQuests.json, the Plane of Sky class quests the Sky module tracks, out of the
// eqlwiki's Plane of Sky page (https://eqlwiki.com/Plane_of_Sky, "Plane of Sky Class Quests"): for each
// class, its quest giver and every Test, with the reward, the words that start it, the Wind Rune it
// takes and the items it takes, each with where it drops: the island, and the mob.
//
//   node scripts/sky-quests.mjs
//
// The page, then the pages of the items its tables give no source for, read through the wiki's API.
// The tables write an item's source as "(7-SotS)": the island, then the mob, shortened; MOBS below
// spells each out. An item with none there (Brass Knuckles, the Efreeti weapons) takes its own page's
// "drops from" list, each mob placed on its island by the page's island list.

import { writeFileSync } from 'node:fs'

const API = 'https://eqlwiki.com/api.php'
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** @returns {Promise<any>} */
async function api(params) {
  const res = await fetch(`${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`eqlwiki: ${res.status}`)
  return res.json()
}

const page = /** @type {{ parse?: { wikitext: string, revid: number } }} */ (await api({ action: 'parse', page: 'Plane_of_Sky', prop: 'wikitext|revid' })).parse
if (!page) throw new Error('eqlwiki: no page in the answer')
const text = page.wikitext

/** "[[Wind Rune Meda]]" → "Wind Rune Meda". */
const link = (s) => s.match(/\[\[([^\]|]+)/)?.[1].trim()
/** Every link in a piece of wikitext. */
const links = (s) => [...s.matchAll(/\[\[([^\]|]+)/g)].map((m) => m[1].trim())
/** A cell's list items. */
const items = (cell) => [...cell.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1])
/** A mob's name for matching: case and a leading "the" ignored. */
const mobKey = (s) => s.toLowerCase().replace(/^the /, '')

// Each mob the island list names (boss, common, other): its island (1.5 is Noble Island), and its name as the list writes it.
/** @type {Map<string, { island: number, mob: string }>} */
const islandOf = new Map()
for (const m of text.matchAll(/\n== Island (\d+(?:\.5)?):[^=]*==\n([\s\S]*?)(?=\n==[^=])/g))
  for (const line of m[2].split('\n').filter((l) => /^\* (Boss|Common|Other):/.test(l)))
    for (const mob of links(line)) islandOf.set(mobKey(mob), { island: Number(m[1]), mob: mob.replace(/^the /, 'The ') })
if (islandOf.size < 20) throw new Error('The island list is not where it was: read the page and mend the script.')

const start = text.indexOf('== Plane of Sky Class Quests')
const end = text.indexOf('\n= Random Drop Items', start)
if (start < 0 || end < 0) throw new Error('The class quests section is not where it was: read the page and mend the script.')
const parts = text.slice(start, end).split(/\n=== \[\[([^\]]+)\]\] Tests ===\n/)

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
      const at = li.match(/\((\d)(?:-(\w+))?\)/)
      const mob = at?.[2] ? (MOBS[at[2]] ?? at[2]) : undefined
      return {
        name: link(li),
        drops: at ? [{ island: Number(at[1]), ...(mob ? { mob } : {}) }] : [],
        ...(li.includes('SkyNoDrop') ? { noDrop: true } : {})
      }
    })
    if (!rewards.length || !runes.length || runes.some((r) => !r) || needs.some((n) => !n.name)) throw new Error(`${cls}: ${name} did not read whole`)
    quests.push({ cls, giver, name: name.trim(), say: say.trim(), rewards, runes, items: needs })
  }
}
if (quests.length < 90) throw new Error(`Only ${quests.length} quests read: the tables have changed shape.`)

// The items the tables give no source for: their own pages' "drops from", fifty pages a request.
const unsourced = [...new Set(quests.flatMap((q) => q.items.filter((i) => !i.drops.length).map((i) => i.name)))]
const dropsOf = new Map()
for (let i = 0; i < unsourced.length; i += 50) {
  await sleep(1000)
  const answer = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: unsourced.slice(i, i + 50).join('|') })
  const renamed = new Map((answer.query.redirects ?? []).map((r) => [r.to, r.from]))
  for (const p of answer.query.pages) {
    const wikitext = p.revisions?.[0]?.slots.main.content ?? ''
    const from = wikitext.match(/\|dropsfrom\s*=([\s\S]*?)\n\|/)?.[1] ?? ''
    // The mobs listed under the Plane of Sky's own heading.
    const sky = from.split(/\n(?=\[\[)/).find((part) => link(part) === 'Plane of Sky') ?? ''
    const mobs = links(sky).slice(1)
    dropsOf.set(renamed.get(p.title) ?? p.title, mobs)
  }
}
for (const q of quests)
  for (const item of q.items) {
    if (item.drops.length) continue
    for (const mob of dropsOf.get(item.name) ?? []) {
      const placed = islandOf.get(mobKey(mob))
      if (!placed) throw new Error(`${item.name} drops from ${mob}, whom the island list does not place.`)
      item.drops.push(placed)
    }
  }
const lost = [...new Set(quests.flatMap((q) => q.items.filter((i) => !i.drops.length).map((i) => i.name)))]
if (lost.length) console.log(`No Plane of Sky source for: ${lost.join(', ')}`)

const date = new Date().toISOString().slice(0, 10)
writeFileSync(OUT, JSON.stringify({ source: `eqlwiki.com, Plane of Sky, revision ${page.revid}, read ${date}`, quests }, null, 1) + '\n')
console.log(`${quests.length} quests → ${OUT.pathname}`)
