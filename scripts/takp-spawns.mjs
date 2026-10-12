// Builds src/shared/game/takpSpawns.json, the classic spawn tables the Slayer plan works from, out of
// TAKP's AllaClone (https://www.takproject.net/allaclone/, whose robots.txt allows it): for each zone
// EverQuest Legends has, every mob with its race and levels, and every spawn group with its classic
// respawn, the mobs it rolls (with their chance) and where its spots are. Legends is not classic: the
// plan scales the timers by what the player's own log has timed, and its own kills always come first.
//
//   node scripts/takp-spawns.mjs "<EverQuest Legends folder>"
//
// One page every 1.5 s, two a zone: a few minutes. The zones are those the game's Resources\ZoneNames.txt
// marks as open; a zone's id is the one its mobs' ids carry (zone id × 1000 + n).

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://www.takproject.net/allaclone/'
const OUT = new URL('../src/shared/game/takpSpawns.json', import.meta.url)
const UA = 'LegendsTracker-data-script (+https://github.com/RCJuicebox/legends-tracker)'
const DELAY_MS = 1500
const CONTINENTS = ['antonica', 'odus', 'faydwer', 'planes', 'kunark', 'velious']

const game = process.argv[2]
if (!game) throw new Error('Give the EverQuest Legends folder: node scripts/takp-spawns.mjs "<folder>"')
const open = new Map()
for (const line of readFileSync(join(game, 'Resources', 'ZoneNames.txt'), 'latin1').split(/\r?\n/)) {
  const [id, name, lo] = line.split('^')
  if (name && lo && lo !== '0') open.set(Number(id), name)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function page(path) {
  await sleep(DELAY_MS)
  const res = await fetch(BASE + path, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.text()
}

const seconds = (s) => {
  let t = 0
  for (const m of s.matchAll(/(\d+)\s*(day|hour|min|sec)/g)) t += Number(m[1]) * { day: 86400, hour: 3600, min: 60, sec: 1 }[m[2]]
  return t
}
const mobName = (s) => s.replace(/^#/, '').replace(/_/g, ' ').trim()
const decode = (s) =>
  s
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()

const shorts = new Set()
for (const c of CONTINENTS) for (const m of (await page(`static/${c}.php`)).matchAll(/zone\.php\?name=([a-z0-9_]+)/g)) shorts.add(m[1])
console.log(`${shorts.size} zones on TAKP`)

const zones = {}
for (const short of [...shorts].sort()) {
  const bestiary = await page(`zone.php?name=${short}`)
  const races = new Map()
  for (const m of bestiary.matchAll(/<a href=npc\.php\?id=(\d+)>([^<]*)<\/a><\/td><td[^>]*>\s*(\d+)\s*-\s*(\d+)\s*<\/td><td[^>]*>([^<]*)<\/td>/g))
    races.set(Number(m[1]), { race: decode(m[5]), lo: Number(m[3]), hi: Number(m[4]) })
  // The zone's id: the one most of its mobs' ids carry.
  const ids = new Map()
  for (const id of races.keys()) ids.set(Math.floor(id / 1000), (ids.get(Math.floor(id / 1000)) ?? 0) + 1)
  const id = [...ids].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (id === undefined || !open.has(id)) continue
  const html = await page(`zone.php?name=${short}&mode=spawngroups`)
  const npcs = []
  const index = new Map()
  const groups = new Map()
  const GROUP = /<li><a href=spawngroup\.php\?id=(\d+)>[^<]*<\/a> \((-?[\d.]+) \/ (-?[\d.]+) \/ (-?[\d.]+)\) \(respawn time : ([^)]*)\)<ul>(.*?)<\/ul>/gs
  for (const g of html.matchAll(GROUP)) {
    let group = groups.get(g[1])
    if (!group) {
      const rolls = []
      for (const n of g[6].matchAll(/<a href=npc\.php\?id=(\d+)>([^<]*)<\/a>, chance (\d+)% \(level (\d+)\)/g)) {
        const npcId = Number(n[1])
        if (!index.has(npcId)) {
          const r = races.get(npcId)
          index.set(npcId, npcs.length)
          npcs.push([mobName(decode(n[2])), r?.race ?? '', r?.lo ?? Number(n[4]), r?.hi ?? Number(n[4])])
        }
        rolls.push([index.get(npcId), Number(n[3])])
      }
      group = [seconds(g[5]), rolls, []]
      groups.set(g[1], group)
    }
    // The spot as the game's map files draw it: /loc's y and x, negated, and its height.
    group[2].push(-Math.round(Number(g[3])), -Math.round(Number(g[2])), Math.round(Number(g[4])))
  }
  zones[short] = { id, name: open.get(id), npcs, groups: [...groups.values()].filter((g) => g[1].length) }
  console.log(`${short} (${id}, ${open.get(id)}): ${npcs.length} mobs, ${groups.size} groups`)
}

const missing = [...open].filter(([id]) => !Object.values(zones).some((z) => z.id === id)).map(([, n]) => n)
console.log(`Not on TAKP: ${missing.join(', ')}`)
const date = new Date().toISOString().slice(0, 10)
writeFileSync(OUT, JSON.stringify({ source: `TAKP AllaClone, ${BASE}, read ${date}`, zones }) + '\n')
console.log(`Wrote ${OUT.pathname}`)
