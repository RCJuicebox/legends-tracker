import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { JsonFile, readJsonFile, writeFileAtomic } from './storeCore'
import { isCharacterKey } from '../core/validate'
import {
  BAG_LAYOUT_FILE,
  SKIN_BUILD_FILE,
  isSkinName,
  parseSkinBuild,
  readBagSlots,
  sanitizeColumns,
  tailOutput,
  type BagLayoutView,
  type SkinBuild,
  type SkinBuildResult
} from '../core/skinBuild'
import { log } from './log'

/** The rebuild commands the player has agreed to, kept with the settings in `path` (the newest fifty). */
export function approvedCommands(path: string): { has: (command: string) => boolean; add: (command: string) => void } {
  const read = readJsonFile(path)
  const list = read.state === 'ok' && Array.isArray(read.value) ? read.value.filter((c): c is string => typeof c === 'string') : []
  const file = new JsonFile<string[]>(path, list)
  return { has: (c) => file.get().includes(c), add: (c) => file.set([...file.get(), c].slice(-50)) }
}

/** Long enough for a script that reads the game's files; a hung one is stopped. */
const TIMEOUT_MS = 120_000

/** The skins in the game's uifiles folder that ask for a rebuild button (src/core/skinBuild.ts). */
export async function listSkinBuilds(gameDir: string): Promise<SkinBuild[]> {
  if (!gameDir) return []
  const root = join(gameDir, 'uifiles')
  let names: string[]
  try {
    names = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  const found = await Promise.all(names.filter(isSkinName).map((skin) => readSkinBuild(root, skin)))
  return found.filter((b): b is SkinBuild => b !== null).sort((a, b) => a.skin.localeCompare(b.skin))
}

async function readSkinBuild(root: string, skin: string): Promise<SkinBuild | null> {
  try {
    return parseSkinBuild(skin, await fs.readFile(join(root, skin, SKIN_BUILD_FILE), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Runs a skin's rebuild, as its own file names it now (never a command a page sends), with no shell.
 * The character the page shows goes to the command as EQL_CHARACTER, so a script can read that
 * character's export. A command not run before is not run until the player has seen it whole and
 * said yes (`approve`): a skin downloaded from anywhere could name any program (LT-442). Each one
 * agreed to is kept in `approved`, exactly as it was shown.
 */
export async function runSkinBuild(
  gameDir: string,
  skin: string,
  character: string,
  approved: { has: (command: string) => boolean; add: (command: string) => void },
  approve = false
): Promise<SkinBuildResult> {
  const build = isSkinName(skin) && gameDir ? await readSkinBuild(join(gameDir, 'uifiles'), skin) : null
  if (!build) return { skin: String(skin), ok: false, output: `The ${String(skin)} skin no longer asks for a rebuild.` }
  const key = JSON.stringify(build.command)
  if (!approved.has(key)) {
    if (!approve) return { skin, ok: false, output: '', confirm: build.command }
    approved.add(key)
    log.info(`Rebuild command for the ${skin} skin agreed to: ${build.command.join(' ')}`)
  }
  const env = { ...process.env, ...(isCharacterKey(character) ? { EQL_CHARACTER: character } : {}) }
  return new Promise((resolve) => {
    execFile(build.command[0], build.command.slice(1), { env, windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = tailOutput(`${stdout}\n${stderr}`)
      if (err) log.warn(`Rebuilding the ${skin} skin failed`, err)
      resolve({ skin, ok: !err, output: err && !output ? err.message : output })
    })
  })
}

/** A skin that keeps a bag layout, as its own file says now; null for any other. */
async function layoutSkin(gameDir: string, skin: unknown): Promise<(SkinBuild & Required<Pick<SkinBuild, 'bagLayout'>>) | null> {
  const build = isSkinName(skin) && gameDir ? await readSkinBuild(join(gameDir, 'uifiles'), skin) : null
  return build?.bagLayout ? { ...build, bagLayout: build.bagLayout } : null
}

/**
 * A skin's bag layout (src/core/skinBuild.ts): its rules, the choices saved in its folder, and the
 * bags the character's inventory export holds, read from `exportPath` ('' for no character).
 */
export async function readBagLayout(gameDir: string, skin: string, exportPath: string): Promise<BagLayoutView | null> {
  const build = await layoutSkin(gameDir, skin)
  if (!build) return null
  const spec = build.bagLayout
  const saved = readJsonFile(join(gameDir, 'uifiles', build.skin, BAG_LAYOUT_FILE))
  const columns = saved.state === 'ok' && saved.value && typeof saved.value === 'object' ? sanitizeColumns((saved.value as { columns?: unknown }).columns, spec) : {}
  let text = ''
  let exportedAt = 0
  let error = exportPath ? '' : 'No character chosen.'
  if (exportPath) {
    try {
      const [t, st] = await Promise.all([fs.readFile(exportPath, 'utf8'), fs.stat(exportPath)])
      text = t
      exportedAt = st.mtimeMs
    } catch (e) {
      error = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : (e as Error).message
    }
  }
  return { skin: build.skin, spec, columns, bags: readBagSlots(text, spec), exportedAt, error }
}

/** Keeps a skin's bag layout in its folder, held to what the skin allows; returns what was kept. */
export async function saveBagLayout(gameDir: string, skin: string, columns: unknown): Promise<Record<string, number>> {
  const build = await layoutSkin(gameDir, skin)
  if (!build) throw new Error(`The ${String(skin)} skin does not keep a bag layout.`)
  const kept = sanitizeColumns(columns, build.bagLayout)
  await writeFileAtomic(join(gameDir, 'uifiles', build.skin, BAG_LAYOUT_FILE), JSON.stringify({ version: 1, columns: kept }, null, 2))
  return kept
}
