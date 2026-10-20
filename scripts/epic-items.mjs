// Builds src/shared/game/epicItems.json, the epic quest pieces the Epics module tracks, out of the
// eqlwiki's "Epic Items To Keep" checklist by Manlaan (https://eqlwiki.com/User:Manlaan/Epic_Items_To_Keep):
// for each class, what to keep for its epic quest, pre-Kunark, as a tree. A bullet is a piece: what
// it is, where it comes from and how ("Kill Lady Vox (raid)", "Forage", "Craft (Tailoring 36)"); a
// bullet with bullets under it is a quest or a craft whose reward the pieces under it make, so the
// reward in hand covers them. The page marks some entries (unverified) and one (doesn't drop).
//
//   node scripts/epic-items.mjs
//
// SEQO (https://github.com/RealMaeel/seqo, MIT) reads the same page into its own Epics view; its
// epics.js gave the finished epics' names and the Shadow Knight's Decrepit Sheath and Corrupted
// Ghoulbane recipes (verified there against the wiki's Shadow Knight Epic Quest page, 2026-10-11),
// which the checklist page does not spell out.

import { writeFileSync } from 'node:fs'

const API = 'https://eqlwiki.com/api.php'
const PAGE = 'User:Manlaan/Epic_Items_To_Keep'
const OUT = new URL('../src/shared/game/epicItems.json', import.meta.url)
const UA = 'LegendsTracker-data-script (+https://github.com/RCJuicebox/legends-tracker)'

/** The finished epic of each class, by name: in hand, nothing of the class is needed. None known for two. */
const EPICS = {
  Bard: ['Singing Short Sword'],
  Beastlord: [],
  Berserker: [],
  Cleric: ['Water Sprinkler of Nem Ankh'],
  Druid: ["Nature Walker's Scimitar"],
  Enchanter: ['Staff of the Serpent'],
  Magician: ['Orb of Mastery'],
  Monk: ['Celestial Fists'],
  Necromancer: ['Scythe of the Shadowed Soul'],
  Paladin: ['Fiery Defender'],
  Ranger: ['Earthcaller', 'Swiftwind'],
  Rogue: ['Ragebringer'],
  'Shadow Knight': ["Innoruuk's Curse"],
  Shaman: ['Spear of Fate'],
  Warrior: ['Jagged Blade of War'],
  Wizard: ['Staff of the Four']
}

/**
 * Steps the page leaves out, each wrapping pieces it lists (and adding any it does not) under the
 * reward they make. `parts` is each piece's count; a piece the page lists is moved under the step.
 * @type {Record<string, { item: string, how: string, parts: Record<string, number> }[]>}
 */
const SUPPLEMENT = {
  'Shadow Knight': [
    { item: 'Decrepit Sheath', how: 'Hand in to Zarvarg Nullheart (Shadow Knight Epic Quest)', parts: { 'Drake Spine': 1, 'Decrepit Hide': 1, 'Enchanted Platinum Bar': 1 } },
    {
      item: 'Corrupted Ghoulbane',
      how: 'Hand in to Zarvarg Nullheart (Shadow Knight Epic Quest)',
      parts: { Ghoulbane: 1, 'Soul Leech, Dark Sword of Blood': 1, 'Blade of Abrogation': 1, 'Decrepit Sheath': 1 }
    }
  ]
}

/** @returns {Promise<any>} */
async function api(params) {
  const res = await fetch(`${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`eqlwiki: ${res.status}`)
  return res.json()
}

const page = /** @type {{ parse?: { wikitext: string, revid: number } }} */ (await api({ action: 'parse', page: PAGE, prop: 'wikitext|revid', redirects: '1' })).parse
if (!page) throw new Error('eqlwiki: no page in the answer')
const text = page.wikitext.replace(/[’‘]/g, "'").replace(/[“”]/g, '"')

/**
 * @typedef {{ item?: string, quest?: string, qty: number, how: string, zone?: string, unverified?: true, note?: string, parts: Step[] }} Step
 */

/** "[[Lord Nagafen]]" → "Lord Nagafen"; "[[a tentacle terror (Unrest)|a tentacle terror]]" → its shown name. */
const LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
const flat = (s) => s.replace(LINK, (_, a, b) => (b ?? a).trim())
const links = (s) => [...s.matchAll(LINK)].map((m) => (m[2] ?? m[1]).trim())
/** The page's "(NPC)", "(Permafrost)", "(Mob)" after a name tell its pages apart; the game names none so. */
const PAGE_TAGS = /\s*\((?:NPC|Mob|God|Unrest|Permafrost|Deathfist)\)/g
const named = (s) => s.replace(PAGE_TAGS, '').replace(/\s+/g, ' ').trim()
const tidy = (s) =>
  s
    .replace(PAGE_TAGS, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—.,:]+|[\s\-–—.,:]+$/g, '')
    .trim()
/** A note after the piece, its brackets off: "(+1900 +2350)" → "+1900 +2350". */
const noted = (s) => tidy(s).replace(/^\((.*)\)$/, '$1')

/** One bullet of the checklist as a step, or two when one kill gives two pieces ("for [[Envy]] and [[Woe]]"). */
function readBullet(raw) {
  let line = raw.trim()
  const depth = (line.match(/^[:*]+/)?.[0].length ?? 1) - 1
  line = line.replace(/^[:*]+\s*/, '')
  const unverified = /\(unverified\)/i.test(line) || /\(doesn'?t drop\)/i.test(line)
  const note = /\(doesn'?t drop\)/i.test(line) ? 'The wiki says it does not drop now' : ''
  line = line.replace(/\((?:unverified|doesn'?t drop)\)\s*/gi, '')

  /** @type {Step[]} */
  const steps = []
  const make = (o) => ({ qty: 1, how: '', ...o, ...(unverified ? { unverified: true } : {}), parts: [] })
  const noteOf = (extra) => {
    const n = [note, extra].filter(Boolean).join('. ')
    return n ? { note: n } : {}
  }

  // "[[Zone]] - ...", "[[Najena]] or [[Temple of Cazic-Thule]] - ..." or "Sol A - ...": where, then what is done there.
  let zone
  const where = /^((?:\[\[[^\]]+\]\]|[A-Z][\w' ]*?)(?: or \[\[[^\]]+\]\])*) - (.+)$/.exec(line)
  if (where && !/^(?:Complete|Craft|Buy|Purchase)$/.test(flat(where[1]))) {
    zone = flat(where[1])
    line = where[2]
    if (zone === 'Various') zone = undefined
  }

  // "Complete [[Quest]] quest for [[Reward]]" / "Complete [[Quest]] quest": what the pieces under it make.
  const complete = /^(.*?)Complete (\[\[[^\]]+\]\]) ?(?:quest|Quest)?(?: for (.+))?$/i.exec(line)
  if (complete) {
    const quest = links(complete[2])[0]
    const by = tidy(flat(complete[1]))
    const how = `Complete ${quest}${by ? ` (${by})` : ''}`
    const rewards = complete[3] ? links(complete[3]) : []
    if (rewards.length) for (const r of rewards) steps.push(make({ item: named(r), quest, how, ...(zone ? { zone } : {}), ...noteOf('') }))
    else steps.push(make({ quest, how, ...(zone ? { zone } : {}), ...noteOf('') }))
    return { depth, steps }
  }
  // "Craft [[Shadow Silk]] (Tailoring 36)": the pieces under it are its recipe.
  const craft = /^Craft (\[\[[^\]]+\]\])\s*(?:\(([^)]*)\))?$/i.exec(line)
  if (craft) {
    steps.push(make({ item: named(links(craft[1])[0]), how: craft[2] ? `Craft (${craft[2]})` : 'Craft', ...(zone ? { zone } : {}), ...noteOf('') }))
    return { depth, steps }
  }
  // "Buy 4x [[X]]", "Buy and Enchant 2x [[X]]", "Purchase [[X]]", "1x [[X]]" (a recipe's part).
  const got = /^(?:(Buy and Enchant|Buy|Purchase)\s+)?(?:(\d+)x\s*)?(\[\[[^\]]+\]\])\s*(.*)$/i.exec(line)
  if (got && !/ for /.test(line)) {
    const verb = got[1] ? got[1].replace(/^Buy and Enchant$/i, 'Buy and enchant').replace(/^Purchase$/i, 'Buy') : ''
    steps.push(make({ item: named(links(got[3])[0]), qty: got[2] ? Number(got[2]) : 1, how: verb, ...(zone ? { zone } : {}), ...noteOf(noted(flat(got[4]))) }))
    return { depth, steps }
  }
  // "Kill [[Mob]] (raid) for [[Item]]", "Forage [[Item]]", "Pick up [[Item]] at +1300, +560", "Pickpocket [[NPC]] for [[Item]]".
  const forAt = line.lastIndexOf(' for ')
  if (forAt > 0) {
    const how = tidy(flat(line.slice(0, forAt)))
    const rest = line.slice(forAt + 5)
    const qty = Number(/^(\d+)x\s*/.exec(rest)?.[1] ?? 1)
    const items = links(rest)
    const after = noted(flat(rest.replace(/^(\d+)x\s*/, '').replace(/^.*\]\]/, '')))
    for (const i of items)
      steps.push(make({ item: named(i), qty, how: /^[A-Z]/.test(how) && !/^(Kill|Pickpocket)/.test(how) ? `Kill ${how}` : how, ...(zone ? { zone } : {}), ...noteOf(after) }))
    return { depth, steps }
  }
  const take = /^(Forage|Pick ?[Uu]p|Pickup)\s+(\[\[[^\]]+\]\])\s*(.*)$/i.exec(line)
  if (take) {
    const at = noted(flat(take[3]))
    const verb = /^Forage/i.test(take[1]) ? 'Forage' : 'Pick up'
    steps.push(make({ item: named(links(take[2])[0]), how: at ? `${verb} ${at}` : verb, ...(zone ? { zone } : {}), ...noteOf('') }))
    return { depth, steps }
  }
  throw new Error(`A bullet the script cannot read: ${raw}`)
}

/** @type {{ cls: string, epic: string[], steps: Step[] }[]} */
const classes = []
for (const m of text.matchAll(/\n= ([^=\n]+?) =\n([\s\S]*?)(?=\n= |\n\{\{DEFAULTSORT)/g)) {
  const cls = m[1].trim()
  if (cls === 'Overview') continue
  if (!(cls in EPICS)) throw new Error(`A class the script does not know: ${cls}`)
  const body = m[2].slice(m[2].indexOf('{{CheckboxList}}') + '{{CheckboxList}}'.length, m[2].indexOf('{{end}}'))
  /** @type {Step[]} */
  const steps = []
  /** The last step at each depth: a deeper bullet goes under it. */
  /** @type {Step[]} */
  const open = []
  for (const raw of body.split('\n')) {
    if (!/^[:*]*\*/.test(raw.trim())) continue
    const { depth, steps: read } = readBullet(raw)
    const into = depth === 0 ? steps : open[depth - 1]?.parts
    if (!into) throw new Error(`${cls}: a bullet deeper than the one before it: ${raw}`)
    into.push(...read)
    open.length = depth
    open[depth] = read[read.length - 1]
  }
  classes.push({ cls, epic: EPICS[cls], steps })
}
if (classes.length !== 16) throw new Error(`${classes.length} classes read, not 16: the page has changed shape.`)

// A recipe's part the page says nothing of (":* 1x [[Shadow Silk]]") that the class's own list has a step
// for (the craft, the quest) takes that step's place: the Robe of the Lost Circle is made of the Shadow Silk
// crafted and the Needle of the Void quested, so those steps go under it.
for (const c of classes) {
  const reparent = (step) => {
    for (let i = 0; i < step.parts.length; i++) {
      const part = step.parts[i]
      const at = part.how || part.parts.length ? -1 : c.steps.findIndex((s) => s !== step && s.item && s.item === part.item)
      if (at >= 0) step.parts[i] = { ...c.steps.splice(at, 1)[0], qty: part.qty }
      reparent(step.parts[i])
    }
  }
  for (const s of [...c.steps]) reparent(s)
}

// The steps the page leaves out: each piece they take is moved under them from the class's own list.
for (const [cls, extra] of Object.entries(SUPPLEMENT)) {
  const c = classes.find((x) => x.cls === cls)
  if (!c) throw new Error(`${cls}: not on the page`)
  for (const e of extra) {
    /** @type {Step} */
    const step = { item: e.item, qty: 1, how: e.how, parts: [] }
    for (const [item, qty] of Object.entries(e.parts)) {
      const at = c.steps.findIndex((s) => s.item === item)
      const found = at >= 0 ? c.steps.splice(at, 1)[0] : undefined
      // A piece the page lists elsewhere (the Breastplate's bars) is taken again here, as this step takes it.
      const listed = found ?? c.steps.flatMap((s) => s.parts).find((s) => s.item === item)
      step.parts.push(found ? { ...found, qty } : { item, qty, how: listed?.how ?? '', ...(listed?.zone ? { zone: listed.zone } : {}), parts: [] })
    }
    c.steps.push(step)
  }
}

const pieces = classes.flatMap((c) => {
  const all = (s) => [s, ...s.parts.flatMap(all)]
  return c.steps.flatMap(all)
})
if (pieces.filter((s) => s.item).length < 100) throw new Error(`Only ${pieces.length} pieces read: the page has changed shape.`)

const out = {
  source: `eqlwiki.com, Epic Items To Keep (Manlaan), revision ${page.revid}, read ${new Date().toLocaleDateString('en-CA')}`,
  url: 'https://eqlwiki.com/User:Manlaan/Epic_Items_To_Keep',
  classes
}
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
console.log(`${classes.length} classes, ${pieces.length} steps → ${OUT.pathname}`)
