// Builds src/shared/game/crawlRoutes.json, the Dungeon Crawl routes (src/features/crawl): for each zone
// below, where its rare creatures pop, the shortest way to swim past all of them from the zone-in, and
// that way as lines the maps can draw. The ways are real ones: the zone's own geometry (its .s3d in the
// game folder) is cut into small cells, and the paths run through the open ones, so no leg crosses a wall.
//
//   node scripts/crawl-routes.mjs "<EverQuest Legends folder>"
//
// A zone's rares are the game's own Hunter list for it (Resources\Achievements), and what play has
// shown Legends adds (RARES below, each with who said so). Their spots are TAKP's (takpSpawns.json).
// Only zones swum through are done so far: a path here may go straight up or down, which walking may not.
//
// It also finds the zone's places to sit: where enough spawn spots are in a straight open line, within a
// spell's reach, to kill what pops without moving (the zone itself, where things respawn; not a crawl).

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const OUT = new URL('../src/shared/game/crawlRoutes.json', import.meta.url)
const TAKP = JSON.parse(readFileSync(new URL('../src/shared/game/takpSpawns.json', import.meta.url), 'utf8'))

/**
 * The zones done, by short name. `also`: rares Legends has beyond the Hunter list, as the log names
 * them, with why. `with`: a rare TAKP has no spot for, found where another is. `start`: the label on
 * the game's map the run starts by. `floors`: the zone's depths top first, each from the height it
 * starts at (the last has no bottom), cut where the game's map has no lines between two levels.
 * `avoid`: mobs no place to sit may have in sight (a raid boss the nearest-mob key would pick).
 * `sitUnder`: places to sit whose mobs are under this level come first (the player's ask, 2026-11-19: 40 at
 * first, then 50 once mobs in their forties proved no trouble).
 */
const ZONES = {
  kedge: {
    start: /^to_Dagnor/i,
    floors: [
      ['Top', 200],
      ['High', 65],
      ['Upper', -35],
      ['Middle', -105],
      ['Lower', -175],
      ['Bottom', null]
    ],
    avoid: ['Phinigel Autropos'],
    sitUnder: 50,
    also: [
      { name: 'a golden haired mermaid', why: 'con' },
      { name: 'Auraline', why: 'con' },
      { name: 'Cauldronbubble', why: 'con' },
      { name: 'Estrella of Gloomwater', why: 'guess' },
      // The tainted and the corrupted seahorse were guessed rares at first: a crawl does not ask for them (the player, 2026-11-20).
      { name: 'Nyrein the Beguiled', why: 'guess' },
      { name: 'Priestess Auraia', why: 'guess' }
    ]
  }
}

/** A cell's side, in the game's units: a tunnel two cells wide is still found. */
const CELL = 4
/** Spots this close by the way between them (not through walls) are one stop. */
const STOP_REACH = 90
/** A rare's spot counts as a stop of its own when it pops there at least this often, or has this few spots. */
const SURE_CHANCE = 10
const SURE_SPOTS = 2

/** How far a mob can be seen and cast on from a place to sit: most spells reach this far. */
const SIGHT = 200
/** A place to sit has at least this many spawn spots of mobs worth killing in sight. */
const CAMP_SPOTS = 4
/** A mob whose highest level is under this is small fry (Kedge's sailfins are level 1): seen, not counted. */
const SMALL_FRY = 20
/** A mob this near comes at whoever sits there on its own, by classic's aggro reach. */
const AGGRO = 70
/** A spot on a timer this long is a named's or a boss's. */
const NAMED_SEC = 3600
/** The most places kept for a zone. */
const CAMPS = 12

const game = process.argv[2]
if (!game) throw new Error('Give the EverQuest Legends folder: node scripts/crawl-routes.mjs "<folder>"')

// ---- the game's files ----

/** An .s3d's members by name: a PFS archive of zlib blocks, its directory at the end. */
function archive(buf) {
  const dir = buf.readUInt32LE(0)
  if (buf.toString('latin1', 4, 8) !== 'PFS ') throw new Error('not a PFS archive')
  const n = buf.readUInt32LE(dir)
  const entries = []
  for (let i = 0; i < n; i++) entries.push({ id: buf.readUInt32LE(dir + 4 + i * 12), at: buf.readUInt32LE(dir + 8 + i * 12), size: buf.readUInt32LE(dir + 12 + i * 12) })
  const inflate = (e) => {
    const parts = []
    let p = e.at
    let got = 0
    while (got < e.size) {
      const deflated = buf.readUInt32LE(p)
      const part = inflateSync(buf.subarray(p + 8, p + 8 + deflated))
      parts.push(part)
      got += part.length
      p += 8 + deflated
    }
    return Buffer.concat(parts).subarray(0, e.size)
  }
  const list = inflate(entries.find((e) => e.id === 0x61580ac9))
  const names = []
  for (let i = 0, p = 4; i < list.readUInt32LE(0); i++) {
    const len = list.readUInt32LE(p)
    names.push(list.toString('latin1', p + 4, p + 4 + len).replace(/\0+$/, ''))
    p += 4 + len
  }
  const files = entries.filter((e) => e.id !== 0x61580ac9).sort((a, b) => a.at - b.at)
  return new Map(files.map((e, i) => [names[i].toLowerCase(), () => inflate(e)]))
}

/**
 * A zone's triangles out of its .wld, flattened nine numbers each, as the maps put them: the map's x is
 * the file's -y, its y the file's -x. Every 0x36 fragment is a mesh: a centre, then vertices as scaled shorts.
 */
function triangles(wld) {
  const count = wld.readUInt32LE(8)
  const out = []
  let p = 28 + wld.readUInt32LE(20)
  for (let f = 0; f < count; f++) {
    const size = wld.readUInt32LE(p)
    const type = wld.readUInt32LE(p + 4)
    const b = wld.subarray(p + 8, p + 8 + size)
    p += 8 + size
    if (type !== 0x36) continue
    const [cx, cy, cz] = [b.readFloatLE(24), b.readFloatLE(28), b.readFloatLE(32)]
    const [nv, nuv, nn, nc, np] = [0, 1, 2, 3, 4].map((i) => b.readUInt16LE(76 + i * 2))
    const scale = 1 / (1 << b.readUInt16LE(94))
    const vert = (i) => [-(cy + b.readInt16LE(96 + i * 6 + 2) * scale), -(cx + b.readInt16LE(96 + i * 6) * scale), cz + b.readInt16LE(96 + i * 6 + 4) * scale]
    const polys = 96 + nv * 6 + nuv * 4 + nn * 3 + nc * 4
    for (let i = 0; i < np; i++) {
      // A polygon's flag 0x10 is one walked through (a water's surface): not a wall.
      if (b.readUInt16LE(polys + i * 8) & 0x10) continue
      for (let k = 1; k <= 3; k++) out.push(...vert(b.readUInt16LE(polys + i * 8 + k * 2)))
    }
  }
  return out
}

/** The game's Hunter list for each place: "Hunter of Kedge Keep" → its rares, as the client's files give them. */
function hunterLists() {
  const dir = join(game, 'Resources', 'Achievements')
  const ids = new Map()
  for (const line of readFileSync(join(dir, 'AchievementsClient.txt'), 'latin1').split(/\r?\n/)) {
    const [id, name] = line.split('^')
    const m = /^Hunter of (.+)$/.exec(name ?? '')
    if (m) ids.set(id, m[1].trim())
  }
  const out = new Map()
  for (const line of readFileSync(join(dir, 'AchievementComponentsClient.txt'), 'latin1').split(/\r?\n/)) {
    const [id, , , , text] = line.split('^')
    const place = ids.get(id)
    if (place && text && !/^(?:Hunter|Conqueror) of |^Complete the achievement/i.test(text)) out.set(place, [...(out.get(place) ?? []), text.trim()])
  }
  return out
}

// ---- the zone as cells ----

const key = (name) =>
  name
    .toLowerCase()
    .replace(/^(?:an?|the)\s+/, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()

class Grid {
  constructor(tris) {
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < tris.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], tris[i])
      hi[i % 3] = Math.max(hi[i % 3], tris[i])
    }
    this.lo = lo.map((v) => v - CELL * 2)
    this.n = hi.map((v, i) => Math.ceil((v - this.lo[i]) / CELL) + 3)
    const [nx, ny, nz] = this.n
    this.solid = new Uint8Array(nx * ny * nz)
    // Each triangle marked by points close enough that no cell it passes through is missed.
    const step = CELL * 0.35
    for (let t = 0; t < tris.length; t += 9) {
      const a = tris.slice(t, t + 3)
      const b = tris.slice(t + 3, t + 6)
      const c = tris.slice(t + 6, t + 9)
      const long = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]))
      const m = Math.max(1, Math.ceil(long / step))
      for (let i = 0; i <= m; i++)
        for (let j = 0; j <= m - i; j++) {
          const u = i / m
          const v = j / m
          const w = 1 - u - v
          this.solid[this.cell(a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v, a[2] * w + b[2] * u + c[2] * v)] = 1
        }
    }
  }
  cell(x, y, z) {
    const [nx, ny] = this.n
    return (Math.floor((z - this.lo[2]) / CELL) * ny + Math.floor((y - this.lo[1]) / CELL)) * nx + Math.floor((x - this.lo[0]) / CELL)
  }
  at(c) {
    const [nx, ny] = this.n
    const ix = c % nx
    const iy = Math.floor(c / nx) % ny
    const iz = Math.floor(c / (nx * ny))
    return [this.lo[0] + (ix + 0.5) * CELL, this.lo[1] + (iy + 0.5) * CELL, this.lo[2] + (iz + 0.5) * CELL]
  }
  inside(x, y, z) {
    return [x, y, z].every((v, i) => v >= this.lo[i] && v < this.lo[i] + this.n[i] * CELL)
  }

  /**
   * The open cells that can be reached from a point: `id` numbers them from 0 (-1 for the rest),
   * `cells` gives each one's cell back. Null when the open space runs off the zone's edge (a hole in
   * the walls: the paths would go round the outside).
   */
  reach(from) {
    const [nx, ny, nz] = this.n
    const id = new Int32Array(this.solid.length).fill(-1)
    // A label sits on the floor it names: the first open cell at or above it is where one stands.
    let start = -1
    for (let up = 0; up <= 5 && start < 0; up++)
      if (this.inside(from[0], from[1], from[2] + up * CELL) && !this.solid[this.cell(from[0], from[1], from[2] + up * CELL)])
        start = this.cell(from[0], from[1], from[2] + up * CELL)
    if (start < 0) return null
    const cells = [start]
    id[start] = 0
    let leaked = false
    for (let q = 0; q < cells.length; q++) {
      const c = cells[q]
      const ix = c % nx
      const iy = Math.floor(c / nx) % ny
      const iz = Math.floor(c / (nx * ny))
      if (ix === 0 || iy === 0 || iz === 0 || ix === nx - 1 || iy === ny - 1 || iz === nz - 1) {
        leaked = true
        continue
      }
      for (const d of [1, -1, nx, -nx, nx * ny, -nx * ny]) {
        const o = c + d
        if (this.solid[o] || id[o] >= 0) continue
        id[o] = cells.length
        cells.push(o)
      }
    }
    this.id = id
    this.cells = Int32Array.from(cells)
    // How near a wall each open cell is, in cells, up to 3: the paths keep off the walls where there is room.
    const near = new Uint8Array(cells.length).fill(3)
    let edge = []
    for (let i = 0; i < cells.length; i++)
      for (const d of [1, -1, nx, -nx, nx * ny, -nx * ny])
        if (this.solid[cells[i] + d]) {
          near[i] = 0
          edge.push(i)
          break
        }
    for (let layer = 1; layer < 3; layer++) {
      const next = []
      for (const i of edge)
        for (const d of [1, -1, nx, -nx, nx * ny, -nx * ny]) {
          const o = id[cells[i] + d]
          if (o >= 0 && near[o] > layer) {
            near[o] = layer
            next.push(o)
          }
        }
      edge = next
    }
    this.near = near
    return leaked ? null : cells.length
  }

  /** The open cell nearest a point, a few cells around it searched; -1 when none is. Reached cells only, once `reach` ran. */
  open(p, within = 6) {
    if (!this.inside(...p)) return -1
    const [nx, ny] = this.n
    const c = this.cell(...p)
    let best = -1
    let bestD = Infinity
    for (let dz = -within; dz <= within; dz++)
      for (let dy = -within; dy <= within; dy++)
        for (let dx = -within; dx <= within; dx++) {
          const o = c + dx + dy * nx + dz * nx * ny
          if (o < 0 || o >= this.solid.length || this.solid[o] || (this.id && this.id[o] < 0)) continue
          // Room around it counts for it: a spot is not put against a wall when the tunnel's middle is as near.
          const d = Math.hypot(dx, dy, dz) + (this.near ? 2 - Math.min(2, this.near[this.id[o]]) : 0)
          if (d < bestD) {
            bestD = d
            best = o
          }
        }
    return best
  }

  /** From one open cell to every other: how far by the open cells, and each one's cell before on the way. */
  spread(from) {
    const [nx, ny] = this.n
    const { id, cells, near, solid } = this
    const dist = new Float64Array(cells.length).fill(Infinity)
    const prev = new Int32Array(cells.length).fill(-1)
    const moves = []
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) moves.push([dx, dy, dz, dx + dy * nx + dz * nx * ny, Math.hypot(dx, dy, dz) * CELL])
    // A binary heap of [distance, cell number], as two arrays.
    const hd = []
    const hi = []
    const push = (d, i) => {
      let k = hd.length
      hd.push(d)
      hi.push(i)
      while (k > 0) {
        const up = (k - 1) >> 1
        if (hd[up] <= d) break
        hd[k] = hd[up]
        hi[k] = hi[up]
        k = up
      }
      hd[k] = d
      hi[k] = i
    }
    const pop = () => {
      const top = [hd[0], hi[0]]
      const d = hd.pop()
      const i = hi.pop()
      const n = hd.length
      if (n) {
        let k = 0
        for (;;) {
          let child = 2 * k + 1
          if (child >= n) break
          if (child + 1 < n && hd[child + 1] < hd[child]) child++
          if (hd[child] >= d) break
          hd[k] = hd[child]
          hi[k] = hi[child]
          k = child
        }
        hd[k] = d
        hi[k] = i
      }
      return top
    }
    const s = id[from]
    dist[s] = 0
    push(0, s)
    while (hd.length) {
      const [d, i] = pop()
      if (d > dist[i]) continue
      const c = cells[i]
      for (const [dx, dy, dz, off, len] of moves) {
        const o = id[c + off]
        if (o < 0) continue
        // No cutting a corner: a move aslant needs the cells it passes between open too.
        if (dx && dy && (solid[c + dx] || solid[c + dy * nx])) continue
        if (dx && dz && (solid[c + dx] || solid[c + dz * nx * ny])) continue
        if (dy && dz && (solid[c + dy * nx] || solid[c + dz * nx * ny])) continue
        if (dx && dy && dz && (solid[c + dx + dy * nx] || solid[c + dx + dz * nx * ny] || solid[c + dy * nx + dz * nx * ny])) continue
        const nd = d + len * (near[o] === 0 ? 1.5 : near[o] === 1 ? 1.2 : near[o] === 2 ? 1.05 : 1)
        if (nd < dist[o]) {
          dist[o] = nd
          prev[o] = i
          push(nd, o)
        }
      }
    }
    return { dist, prev }
  }

  /** Whether the straight line between two points stays in open cells, off the walls where `off` says. */
  clear(a, b, off) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const n = Math.max(1, Math.ceil(len / (CELL * 0.4)))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const o = this.id[this.cell(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)]
      if (o < 0 || this.near[o] < off) return false
    }
    return true
  }

  /** The way a spread found to a cell, as few straight pieces as stay open: points from the spread's start. */
  path(prev, to) {
    const raw = []
    for (let i = this.id[to]; i >= 0; i = prev[i]) raw.push(this.at(this.cells[i]))
    raw.reverse()
    const out = [raw[0]]
    let i = 0
    while (i < raw.length - 1) {
      let j = raw.length - 1
      // The farthest point seen straight from here, keeping a cell off the walls; any open line where none is.
      while (j > i + 1 && !this.clear(raw[i], raw[j], 1)) j--
      if (j === i + 1) {
        let k = raw.length - 1
        while (k > i + 1 && !this.clear(raw[i], raw[k], 0)) k--
        j = Math.min(k, i + 8)
        while (j > i + 1 && !this.clear(raw[i], raw[j], 0)) j--
      }
      out.push(raw[j])
      i = j
    }
    return out
  }
}

const length = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]), 0)

// ---- the order ----

/** The shortest way from node 0 through every other, each once, not coming back: the order after 0. */
function tour(d) {
  const n = d.length - 1
  if (n <= 0) return []
  if (n > 18) throw new Error(`${n} stops: too many to order exactly`)
  const full = 1 << n
  const best = new Float64Array(full * n).fill(Infinity)
  const from = new Int8Array(full * n).fill(-1)
  for (let j = 0; j < n; j++) best[(1 << j) * n + j] = d[0][j + 1]
  for (let set = 1; set < full; set++)
    for (let j = 0; j < n; j++) {
      const at = best[set * n + j]
      if (!(set & (1 << j)) || at === Infinity) continue
      for (let k = 0; k < n; k++) {
        if (set & (1 << k)) continue
        const next = (set | (1 << k)) * n + k
        const nd = at + d[j + 1][k + 1]
        if (nd < best[next]) {
          best[next] = nd
          from[next] = j
        }
      }
    }
  let last = 0
  for (let j = 1; j < n; j++) if (best[(full - 1) * n + j] < best[(full - 1) * n + last]) last = j
  const order = []
  for (let set = full - 1, j = last; j >= 0;) {
    order.push(j + 1)
    const p = from[set * n + j]
    set &= ~(1 << j)
    j = p
  }
  return order.reverse()
}

// ---- each zone ----

const round = (v) => Math.round(v)
const hunters = hunterLists()
const zones = {}
for (const [short, conf] of Object.entries(ZONES)) {
  const takp = TAKP.zones[short]
  const s3d = archive(readFileSync(join(game, `${short}.s3d`)))
  const grid = new Grid(triangles(s3d.get(`${short}.wld`)()))

  // Where the run starts: the zone line's label on the game's own map.
  const labels = readFileSync(join(game, 'maps', `${short}_1.txt`), 'latin1').split(/\r?\n/)
  const startRow = labels
    .map((l) =>
      l
        .slice(2)
        .split(',')
        .map((v) => v.trim())
    )
    .find((p) => p.length >= 8 && conf.start.test(p.slice(7).join(',')))
  if (!startRow) throw new Error(`${short}: no start label on the game's map`)
  const start = startRow.slice(0, 3).map(Number)
  const open = grid.reach(start)
  if (!open) throw new Error(`${short}: its open space runs off the zone's edge, or the start is in a wall`)
  console.log(`${takp.name}: ${grid.n.join('×')} cells, ${open} open and reached`)

  // Its rares: the game's Hunter list, then what Legends adds.
  const rares = [
    ...(hunters.get(takp.name) ?? []).map((name) => ({ name, why: 'hunter' })),
    ...conf.also.filter((a) => !(hunters.get(takp.name) ?? []).some((h) => key(h) === key(a.name)))
  ]
  // Each rare's spots: TAKP's groups that roll it, each spot with the chance it is the one.
  const spots = []
  for (const r of rares) {
    const k = key(r.with ?? r.name)
    const mine = takp.groups.filter(([, rolls]) => rolls.some(([i]) => key(takp.npcs[i][0]) === k))
    const count = mine.reduce((s, g) => s + g[2].length / 3, 0)
    if (!count) console.warn(`  ${r.name}: no spot in TAKP's tables`)
    for (const [, rolls, flat] of mine) {
      const total = Math.max(
        100,
        rolls.reduce((s, [, c]) => s + c, 0)
      )
      const chance = Math.round((rolls.filter(([i]) => key(takp.npcs[i][0]) === k).reduce((s, [, c]) => s + c, 0) * 100) / total)
      for (let p = 0; p + 2 < flat.length; p += 3) {
        const at = [flat[p], flat[p + 1], flat[p + 2]]
        let spot = spots.find((s) => s.at.every((v, i) => v === at[i]))
        if (!spot) {
          const cell = grid.open(at)
          if (cell < 0) {
            console.warn(`  ${r.name}: its spot ${at.join(', ')} is not in open water`)
            continue
          }
          spot = { at, cell, rares: [] }
          spots.push(spot)
        }
        spot.rares.push({ name: r.name, why: r.why, chance, sure: chance >= SURE_CHANCE || count <= SURE_SPOTS })
      }
    }
  }

  // How far each spot is from each other, by the open cells.
  const startCell = grid.open(start)
  const spreads = spots.map((s) => grid.spread(s.cell))
  const between = (i, j) => spreads[i].dist[grid.id[spots[j].cell]]

  // Stops: the spots some rare is sure at, those within reach of each other by the way between them
  // as one. A spot of long odds (a roamer's, one of sixteen) is no stop: it goes with the stop nearest
  // it, drawn faintly when it is out of that stop's reach. The game's map shows which rares are up.
  const isSure = (i) => spots[i].rares.some((r) => r.sure)
  const stops = []
  for (const i of spots.map((_, i) => i).filter(isSure)) {
    const near = stops.map((st) => ({ st, d: Math.min(...st.spots.map((j) => between(i, j))) })).sort((a, b) => a.d - b.d)[0]
    if (near && near.d <= STOP_REACH) near.st.spots.push(i)
    else stops.push({ spots: [i], far: [] })
  }
  for (const st of stops) {
    // Where the stop is drawn: the spot the others are nearest to in all.
    st.main = st.spots.map((i) => ({ i, sum: st.spots.reduce((s, j) => s + between(i, j), 0) })).sort((a, b) => a.sum - b.sum)[0].i
  }
  for (const i of spots.map((_, i) => i).filter((i) => !isSure(i))) {
    const near = stops.map((st) => ({ st, d: Math.min(...st.spots.filter(isSure).map((j) => between(i, j))) })).sort((a, b) => a.d - b.d)[0]
    if (!near) throw new Error(`${short}: no rare with a sure spot`)
    if (near.d <= STOP_REACH) near.st.spots.push(i)
    else near.st.far.push(i)
  }

  // The order: every stop once, the shortest way from the start. How far is the way's own length, as
  // drawn: the spread's distances lean off the walls, which no swimmer pays for.
  const startSpread = grid.spread(startCell)
  const nodes = [null, ...stops]
  const way = (a, b) => grid.path(a ? spreads[a.main].prev : startSpread.prev, spots[b.main].cell)
  const d = nodes.map((a, i) => nodes.map((b, j) => (i === j ? 0 : !b ? Infinity : length(way(a, b)))))
  const ordered = tour(d)
  let from = null
  let total = 0
  const outStops = []
  for (const n of ordered) {
    const st = nodes[n]
    const main = spots[st.main]
    const pts = way(from, st)
    const len = length(pts)
    total += len
    const byName = new Map()
    for (const [list, far] of [
      [st.spots, false],
      [st.far, true]
    ])
      for (const i of list)
        for (const r of spots[i].rares) {
          const had = byName.get(r.name)
          byName.set(r.name, {
            name: r.name,
            why: r.why,
            chance: Math.max(r.chance, had?.chance ?? 0),
            spots: (had?.spots ?? 0) + 1,
            ...(far && (!had || had.far) ? { far: true } : {})
          })
        }
    outStops.push({
      at: main.at,
      rares: [...byName.values()].sort((a, b) => Number(!!a.far) - Number(!!b.far) || b.chance - a.chance || a.name.localeCompare(b.name)),
      spots: st.spots.map((i) => spots[i].at),
      ...(st.far.length ? { far: st.far.map((i) => spots[i].at) } : {}),
      leg: pts.flat().map(round),
      length: round(len)
    })
    console.log(
      `  ${outStops.length}. ${[...byName.values()].map((r) => `${r.name}${r.far ? ' (far)' : ''} ${r.chance}%`).join(', ')} @ ${main.at.join(', ')} · ${round(len)} · ${pts.length} points · ${st.spots.length} spots, ${st.far.length} far`
    )
    from = st
  }
  console.log(`  ${round(total)} in all`)

  // ---- places to sit ----
  // A place to sit and kill what pops: an open cell that has enough spawn spots in a straight open line
  // within a spell's reach. Every spot of the zone, each with what it rolls.
  const under = conf.sitUnder ?? Infinity
  const rareKeys = new Set(rares.map((r) => key(r.name)))
  const points = []
  for (const [sec, rolls, flat] of takp.groups) {
    const total = Math.max(
      100,
      rolls.reduce((sum, [, c]) => sum + c, 0)
    )
    const mobs = rolls.map(([i, c]) => {
      const [name, , lo, hi] = takp.npcs[i]
      // A named: a rare of the zone, what alone holds a spot on a long timer, or a name with no "a" or "an"
      // before it (the tainted seahorse: no rare a crawl asks for, and still nothing a room's levels count).
      const named = rareKeys.has(key(name)) || (sec >= NAMED_SEC && rolls.length === 1) || !/^an? /i.test(name)
      // How many of its levels are under the level wanted: all of a 35 to 37's, one in three of a 39 to 41's.
      const low = Math.max(0, Math.min(hi, under - 1) - lo + 1) / (hi - lo + 1)
      return { name, lo, hi, chance: (c * 100) / total, named, low }
    })
    // How much of the time the spot holds something worth a spell, and something of the levels wanted.
    const real = mobs.filter((m) => m.hi >= SMALL_FRY)
    const worth = real.reduce((sum, m) => sum + m.chance, 0) / 100
    const wanted = real.reduce((sum, m) => sum + m.chance * m.low, 0) / 100
    const kind = worth < 0.5 ? 'small' : wanted >= worth / 2 ? 'want' : 'over'
    const avoid = mobs.some((m) => (conf.avoid ?? []).some((a) => key(a) === key(m.name)))
    for (let p = 0; p + 2 < flat.length; p += 3) {
      const cell = grid.open([flat[p], flat[p + 1], flat[p + 2]])
      if (cell >= 0) points.push({ at: [flat[p], flat[p + 1], flat[p + 2]], eye: grid.at(cell), sec, mobs, kind, avoid })
    }
  }
  // Every other open cell each way with room around it, and what it sees.
  const [gx, gy] = grid.n
  const seats = []
  for (let i = 0; i < grid.cells.length; i++) {
    const c = grid.cells[i]
    if (grid.near[i] < 1 || (c % gx) % 2 || (Math.floor(c / gx) % gy) % 2 || Math.floor(c / (gx * gy)) % 2) continue
    const at = grid.at(c)
    const sees = []
    for (let p = 0; p < points.length; p++) {
      const e = points[p].eye
      const dist = Math.hypot(e[0] - at[0], e[1] - at[1], e[2] - at[2])
      if (dist <= SIGHT && grid.clear(at, e, 0)) sees.push([p, dist])
    }
    const of = (kind) => sees.filter(([p]) => points[p].kind === kind)
    const want = of('want')
    const over = of('over')
    if (want.length + over.length < CAMP_SPOTS || sees.some(([p]) => points[p].avoid)) continue
    const real = [...want, ...over]
    seats.push({ cell: c, at, sees, want: want.length, over: over.length, mean: real.reduce((sum, [, d]) => sum + d, 0) / real.length })
  }
  // The best first. Places with enough spots of the levels wanted come before any other: among them the
  // more of those and the fewer above them the better, then the nearer. A seat that sees mostly what a
  // kept one sees is the same room.
  const camps = []
  const keep = (list, kinds) => {
    for (const seat of list) {
      if (camps.length >= CAMPS) break
      const mine = seat.sees.filter(([p]) => kinds.includes(points[p].kind)).map(([p]) => p)
      if (camps.some((k) => mine.filter((p) => k.set.has(p)).length * 2 >= mine.length)) continue
      camps.push({ ...seat, set: new Set(seat.sees.filter(([p]) => points[p].kind !== 'small').map(([p]) => p)) })
    }
  }
  keep(
    seats.filter((s) => s.want >= CAMP_SPOTS).sort((a, b) => b.want - b.over - (a.want - a.over) || b.want - a.want || a.mean - b.mean),
    ['want']
  )
  const low = camps.length
  keep(
    seats.sort((a, b) => b.want + b.over - (a.want + a.over) || a.over - b.over || a.mean - b.mean),
    ['want', 'over']
  )
  const outCamps = camps.map((k, n) => {
    const pts = grid.path(startSpread.prev, k.cell)
    const byName = new Map()
    for (const [p] of k.sees)
      for (const m of points[p].mobs) {
        const had = byName.get(key(m.name))
        byName.set(key(m.name), {
          name: m.name,
          lo: Math.min(m.lo, had?.lo ?? m.lo),
          hi: Math.max(m.hi, had?.hi ?? m.hi),
          spots: (had?.spots ?? 0) + 1,
          chance: Math.max(Math.round(m.chance), had?.chance ?? 0),
          ...(m.named ? { named: true } : {}),
          ...(m.hi < SMALL_FRY ? { small: true } : {})
        })
      }
    const of = (kind) => k.sees.filter(([p]) => points[p].kind === kind)
    const flat = (list) => list.map(([p, d]) => [...points[p].at, round(d)])
    const real = [...of('want'), ...of('over')]
    const secs = real.map(([p]) => points[p].sec).sort((a, b) => a - b)
    const camp = {
      at: k.at.map(round),
      spots: flat(of('want')),
      ...(k.over ? { over: flat(of('over')) } : {}),
      ...(of('small').length ? { small: flat(of('small')) } : {}),
      close: real.filter(([, d]) => d <= AGGRO).length,
      mobs: [...byName.values()].sort((a, b) => Number(!!a.small) - Number(!!b.small) || a.lo - b.lo || a.hi - b.hi || a.name.localeCompare(b.name)),
      respawn: secs[secs.length >> 1],
      way: pts.flat().map(round),
      length: round(length(pts))
    }
    console.log(
      `  sit ${n < low ? 'low ' : 'high'} @ ${camp.at.join(', ')}: ${k.want} spots under ${under}, ${k.over} over (${camp.close} close, ${of('small').length} small fry), ${round(k.mean)} away on average, ${camp.length} from the zone-in · ${camp.mobs.map((m) => `${m.name}${m.named ? '*' : ''} ${m.lo}-${m.hi} ×${m.spots} ${m.chance}%`).join(', ')}`
    )
    return camp
  })
  // How far each stop is from each other and from the start (row and column 0), in the order above: what is left can be ordered again as a run goes.
  const seq = [0, ...ordered]
  zones[short] = {
    name: takp.name,
    start: start.map(round),
    floors: conf.floors.map(([name, from]) => ({ name, from })),
    stops: outStops,
    ...(conf.sitUnder ? { sitUnder: conf.sitUnder } : {}),
    camps: outCamps,
    dist: seq.map((i) => seq.map((j) => (i === j || j === 0 ? 0 : round(d[i][j]))))
  }
}

writeFileSync(
  OUT,
  JSON.stringify({ source: 'scripts/crawl-routes.mjs: the game’s zone geometry and Hunter lists, TAKP’s spawn spots', cell: CELL, zones }).replace(
    /("(?:kedge|[a-z0-9]+)":\{"name")/g,
    '\n$1'
  ) + '\n'
)
console.log(`Wrote ${OUT.pathname}`)
