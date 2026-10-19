import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'

// The layers in CONTRIBUTING.md, checked on every import of every file under src (LT-640): the lint's
// path patterns cover the folders they spell out, and a new folder needs no new globs here. Each file's
// layer is from its folder, or in a feature module from its name: every .tsx and the page workers the
// renderer's (and its hooks, use*.ts), main.ts and any *Source.ts main's, every other .ts core's.

type Layer = 'core' | 'shared' | 'main' | 'preload' | 'renderer'

const SRC = resolve(__dirname, '..', 'src')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !n.endsWith('.d.ts') ? [p] : []
  })
}

/** A file's layer by where it is and, in a feature module, by its name. */
export function layerOf(path: string): Layer {
  const rel = relative(SRC, path).replace(/\\/g, '/')
  const [top, , ...rest] = rel.split('/')
  if (top === 'core' || top === 'shared' || top === 'main' || top === 'preload' || top === 'renderer') return top
  if (top !== 'features') throw new Error(`A file outside the layers: ${rel}`)
  const name = rest.at(-1) ?? rel.split('/')[1]
  // The list of pages, every page, its hooks, and the page's Web Workers and their clients are the renderer's.
  if (rel === 'features/index.ts' || name.endsWith('.tsx') || /(?:Worker|Runner)\.ts$/.test(name) || /^use[A-Z]\w*\.ts$/.test(name)) return 'renderer'
  if (name === 'main.ts' || /Source\.ts$/.test(name)) return 'main'
  return 'core'
}

/** What each layer may import as a value; a type import may also reach `types`. */
const MAY: Record<Layer, { values: Layer[]; types: Layer[]; packages: 'any' | 'browser' | 'none' }> = {
  core: { values: ['core', 'shared'], types: ['core', 'shared'], packages: 'any' },
  shared: { values: ['shared'], types: ['shared', 'core'], packages: 'none' },
  main: { values: ['core', 'shared', 'main'], types: ['core', 'shared', 'main'], packages: 'any' },
  preload: { values: ['core', 'shared', 'preload'], types: ['core', 'shared', 'preload'], packages: 'any' },
  renderer: { values: ['core', 'shared', 'renderer'], types: ['core', 'shared', 'renderer', 'main'], packages: 'browser' }
}

const NODE = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])

interface Import {
  from: string
  spec: string
  typeOnly: boolean
}

/** Every import, export-from and dynamic import of a file, with whether it brings types alone. */
function importsOf(path: string): Import[] {
  const text = readFileSync(path, 'utf8')
  const out: Import[] = []
  const re = /^\s*(import|export)\s+(type\s+)?([^'"`;]*?)\s*from\s*'([^']+)'|^\s*import\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/gm
  for (const m of text.matchAll(re)) {
    const spec = m[4] ?? m[5] ?? m[6]
    const names = m[3] ?? ''
    // `import { type A, type B } from` brings types alone too.
    const braces = /^\{([^}]*)\}$/.exec(names.trim())
    const allTypes =
      !!braces &&
      braces[1]
        .split(',')
        .filter((n) => n.trim())
        .every((n) => /^\s*type\s/.test(n))
    out.push({ from: path, spec, typeOnly: !!m[2] || allTypes })
  }
  return out
}

/** The file a relative import names, or null for a package. */
function target(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ''))
  for (const p of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (existsSync(p) && statSync(p).isFile()) return p
  // A JSON table or a stylesheet is data, in its importer's own layer.
  return base
}

const ALL = files(SRC)

describe('the layers', () => {
  it('finds every file a layer', () => {
    expect(ALL.length).toBeGreaterThan(250)
    for (const f of ALL) expect(() => layerOf(f), f).not.toThrow()
  })

  it("keeps every import to what CONTRIBUTING's table allows its layer", () => {
    const wrong: string[] = []
    for (const f of ALL) {
      const layer = layerOf(f)
      const may = MAY[layer]
      for (const i of importsOf(f)) {
        const where = `${relative(SRC, f).replace(/\\/g, '/')} imports ${i.spec}`
        const t = target(f, i.spec)
        if (t === null) {
          if (i.typeOnly) continue
          const pkg = i.spec
          if (pkg === 'electron' && layer !== 'main' && layer !== 'preload') wrong.push(`${where}: Electron is the main process's`)
          else if (may.packages === 'none') wrong.push(`${where}: ${layer} imports no package`)
          else if (may.packages === 'browser' && NODE.has(pkg)) wrong.push(`${where}: the renderer is a browser page`)
          continue
        }
        if (!t.startsWith(SRC) || !/\.tsx?$/.test(t)) continue
        const to = layerOf(t)
        if (!(i.typeOnly ? may.types : may.values).includes(to)) wrong.push(`${where}: ${layer} may not import ${to}${i.typeOnly ? ' types' : ''}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('keeps each feature module to itself: one feature imports no other but those it is built on (LT-635)', () => {
    // Hunter is the Slayer plan's other page: its named, spawns and map are Slayer's, and Slayer's
    // steps show the Hunter named of their zone. Anything else two features share goes in core.
    const BUILT_ON: Record<string, string[]> = { hunter: ['slayer'], slayer: ['hunter'] }
    const wrong: string[] = []
    for (const f of ALL) {
      const own = /[\\/]features[\\/]([^\\/]+)[\\/]/.exec(f)?.[1]
      if (!own) continue
      for (const i of importsOf(f)) {
        const t = target(f, i.spec)
        const theirs = t && /[\\/]features[\\/]([^\\/]+)[\\/]/.exec(t)?.[1]
        if (theirs && theirs !== own && !i.typeOnly && !BUILT_ON[own]?.includes(theirs)) wrong.push(`${relative(SRC, f).replace(/\\/g, '/')} imports ${i.spec}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('classes a feature file by its name', () => {
    expect(layerOf(join(SRC, 'features', 'slayer', 'page.tsx'))).toBe('renderer')
    expect(layerOf(join(SRC, 'features', 'slayer', 'main.ts'))).toBe('main')
    expect(layerOf(join(SRC, 'features', 'slayer', 'liveSource.ts'))).toBe('main')
    expect(layerOf(join(SRC, 'features', 'factions', 'planWorker.ts'))).toBe('renderer')
    expect(layerOf(join(SRC, 'features', 'factions', 'plan', 'steps.ts'))).toBe('core')
    expect(layerOf(join(SRC, 'features', 'factions', 'plan', 'usePlanSearch.ts'))).toBe('renderer')
    expect(layerOf(join(SRC, 'features', 'index.ts'))).toBe('renderer')
  })
})
