import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { JsonFile, readJsonFile, writeFileAtomic } from './storeCore'
import { isCharacterKey } from '../core/validate'
import { parseJson } from '../core/json'
import {
  BAG_LAYOUT_FILE,
  SKIN_BUILD_FILE,
  isSkinName,
  parseSkinBuild,
  parseSkinGroupHealth,
  readBagSlots,
  sanitizeColumns,
  startKey,
  tailOutput,
  type BagLayoutView,
  type SkinBuild,
  type SkinBuildResult,
  type SkinStartRun
} from '../core/skinBuild'
import type { GroupHealthProfile } from '../core/groupHealth'
import { log } from './log'
import { newerBuildWrote } from './schema'

/** The rebuild commands the player has agreed to, kept with the settings in `path` (the newest fifty). */
export function approvedCommands(path: string): { has: (command: string) => boolean; add: (command: string) => void } {
  const read = readJsonFile(path)
  const list = read.state === 'ok' && Array.isArray(read.value) ? read.value.filter((c): c is string => typeof c === 'string') : []
  const file = new JsonFile<string[]>(path, list)
  if (newerBuildWrote(path)) file.freeze('written by a newer version')
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
  return found
    .filter((b): b is SkinBuild => b !== null)
    .map((b) => (lastStarts.has(b.skin) ? { ...b, lastStart: lastStarts.get(b.skin) } : b))
    .sort((a, b) => a.skin.localeCompare(b.skin))
}

/** How each skin's game-start command went this session, for Settings › UI. */
const lastStarts = new Map<string, SkinStartRun>()

/** A game-start command gets less time than a rebuild: it races the game's own loading. */
const START_TIMEOUT_MS = 60_000

/**
 * Runs the game-start command of each skin whose file names one the player has switched on (`enabled`,
 * startKey of the command exactly as shown), with no shell, in the skin's own folder, the character
 * being played as EQL_CHARACTER. A skin whose file now names another command runs nothing.
 */
export async function runGameStart(gameDir: string, character: string, enabled: readonly string[]): Promise<SkinStartRun[]> {
  if (!enabled.length) return []
  const builds = (await listSkinBuilds(gameDir)).filter((b) => b.onGameStart && enabled.includes(startKey(b.onGameStart.command)))
  const env = { ...process.env, ...(isCharacterKey(character) ? { EQL_CHARACTER: character } : {}) }
  return Promise.all(
    builds.map(
      (b) =>
        new Promise<SkinStartRun>((resolve) => {
          const [program, ...rest] = b.onGameStart!.command
          const cwd = join(gameDir, 'uifiles', b.skin)
          execFile(program, rest, { cwd, env, windowsHide: true, timeout: START_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            const output = tailOutput(`${stdout}\n${stderr}`)
            const run = { at: Date.now(), ok: !err, output: err && !output ? err.message : output }
            lastStarts.set(b.skin, run)
            if (err) log.warn(`The ${b.skin} skin's game-start command failed`, err)
            else log.info(`The ${b.skin} skin's game-start command ran: ${output.split('\n').pop() ?? ''}`)
            resolve(run)
          })
        })
    )
  )
}

/** Every skin folder in the game's uifiles, and whether its file says how it draws the group health bars (FEAT-040). */
export async function listSkins(gameDir: string): Promise<{ skin: string; profile: boolean }[]> {
  if (!gameDir) return []
  const root = join(gameDir, 'uifiles')
  let names: string[]
  try {
    names = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  const skins = names.filter(isSkinName).sort((a, b) => a.localeCompare(b))
  return Promise.all(skins.map(async (skin) => ({ skin, profile: !!(await readSkinGroupHealth(gameDir, skin)) })))
}

/** How a skin draws the group health bars, as its own file says (FEAT-040); null when it says nothing. */
export async function readSkinGroupHealth(gameDir: string, skin: string): Promise<GroupHealthProfile | null> {
  if (!gameDir || !isSkinName(skin)) return null
  try {
    return parseSkinGroupHealth(await fs.readFile(join(gameDir, 'uifiles', skin, SKIN_BUILD_FILE), 'utf8')) ?? null
  } catch {
    return null
  }
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
    // In the skin's own folder, where its script is ("build.py" in the format's example, LT-608).
    const cwd = join(gameDir, 'uifiles', build.skin)
    execFile(build.command[0], build.command.slice(1), { cwd, env, windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
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

/** A JSON file in a skin's folder, or null when it is missing or will not parse (said in the log, left where it is). */
async function readSkinJson(path: string): Promise<unknown> {
  let text: string
  try {
    text = await fs.readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read ${path}`, e)
    return null
  }
  try {
    return parseJson(text)
  } catch (e) {
    log.warn(`${path} does not read as JSON; the skin's defaults are used`, e)
    return null
  }
}

/**
 * A skin's bag layout (src/core/skinBuild.ts): its rules, the choices saved in its folder, and the
 * bags the character's inventory export holds, read from `exportPath` ('' for no character).
 */
export async function readBagLayout(gameDir: string, skin: string, exportPath: string): Promise<BagLayoutView | null> {
  const build = await layoutSkin(gameDir, skin)
  if (!build) return null
  const spec = build.bagLayout
  // Read as it is, not with the start-up reader: that waits on a held file with the main thread
  // stopped, and would set a bad file aside inside the game's folder (LT-610).
  const saved = await readSkinJson(join(gameDir, 'uifiles', build.skin, BAG_LAYOUT_FILE))
  const columns = saved && typeof saved === 'object' ? sanitizeColumns((saved as { columns?: unknown }).columns, spec) : {}
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
