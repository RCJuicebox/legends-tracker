import { join } from 'node:path'
import { copyFile, mkdir, readdir } from 'node:fs/promises'

// The app's own map set in the game folder: maps\LegendsTracker, a copy of the game's maps that the
// app's marks are written into (Plan › Hunter's named, a Dungeon Crawl's route), so the game's own
// files stay as they are. The player picks the set in the game's map window.

/** The map set's folder name under the game's maps. */
const MAP_SET = 'LegendsTracker'

/**
 * The map set made ready: its folder, with every map of the game's it lacks copied in (so the set
 * draws each zone whole). The game's own files are only read.
 */
export async function mapSet(installDir: string): Promise<{ maps: string; set: string }> {
  if (!installDir) throw new Error('Choose the game folder on Settings › General first.')
  const maps = join(installDir, 'maps')
  const set = join(maps, MAP_SET)
  await mkdir(set, { recursive: true })
  const have = new Set(await readdir(set))
  for (const f of await readdir(maps, { withFileTypes: true })) if (f.isFile() && /\.txt$/i.test(f.name) && !have.has(f.name)) await copyFile(join(maps, f.name), join(set, f.name))
  return { maps, set }
}
