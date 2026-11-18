import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { liveModelArchives, liveModelLines, withLiveModels, withoutLiveModels, type LiveModelsStatus } from '../core/liveModels'
import { log } from './log'

let last: LiveModelsStatus['last']

const loadFile = (gameDir: string): string => join(gameDir, 'Resources', 'GlobalLoad.txt')

/** The file as the game reads it: one byte a character, so nothing in it changes on the way back. */
async function readLoad(gameDir: string): Promise<string> {
  return fs.readFile(loadFile(gameDir), 'latin1')
}

/** Which of the archives the lines may load the game folder has. */
async function archivesIn(gameDir: string): Promise<Set<string>> {
  const names = new Set((await fs.readdir(gameDir)).map((n) => n.toLowerCase()))
  return new Set(liveModelArchives().filter((a) => names.has(`${a.toLowerCase()}.s3d`)))
}

/**
 * Adds the lines that load Live's player models to the game's GlobalLoad.txt (`on`), or takes them out.
 * Run as the game starts, after its launcher has put the file back, and when the switch changes. The file
 * is written only when it changes.
 */
export async function setLiveModels(gameDir: string, on: boolean): Promise<void> {
  if (!gameDir) return
  try {
    const text = await readLoad(gameDir)
    const have = on ? await archivesIn(gameDir) : null
    const edit = have ? withLiveModels(text, (a) => have.has(a)) : withoutLiveModels(text)
    if (edit.problem) throw new Error(edit.problem)
    if (edit.text !== text) await fs.writeFile(loadFile(gameDir), edit.text, 'latin1')
    const output = on
      ? `${edit.models} Live player models load ahead of the classic ones`
      : edit.removed
        ? `Took out ${edit.removed} lines: the classic models load`
        : 'The classic models load'
    last = { at: Date.now(), ok: true, output }
    log.info(`Live player models: ${output}`)
  } catch (e) {
    last = { at: Date.now(), ok: false, output: (e as Error).message }
    log.warn(`Live player models: could not ${on ? 'add' : 'take out'} the GlobalLoad.txt lines`, e)
  }
}

export async function liveModelsStatus(gameDir: string): Promise<LiveModelsStatus> {
  if (!gameDir) return { lines: 0, last, error: 'No game folder chosen.' }
  try {
    return { lines: liveModelLines(await readLoad(gameDir)), last, error: '' }
  } catch (e) {
    return { lines: 0, last, error: (e as Error).message }
  }
}
