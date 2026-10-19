import { copyFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { log } from './log'
import { readJsonFile } from './storeCore'

// Every file the settings store keeps has a schema version, recorded in schema.json beside them. A
// build that changes a file's shape bumps its number here and adds a migration; a file at an older
// number is backed up (settings.pre-2.json) and brought forward as it is read. A file at a newer
// number was written by a newer build (the player went back a version): it is read as well as it can
// be but never written, so the newer build finds it untouched.

/** The schema each file is at in this build. */
export const SCHEMAS: Readonly<Record<string, number>> = {
  'settings.json': 1,
  'triggers.json': 1,
  'spell-rules.json': 1,
  'casts.json': 2,
  'motes.json': 1,
  'mote-stock.json': 1,
  'respawns.json': 2,
  'buffs.json': 1,
  // The features' own files beside them (LT-639): recorded too, so a build that changes one's shape
  // bumps it here and an older build, finding the newer number, leaves the file alone.
  'slayer-plan.json': 1,
  'slayer-facts.json': 1,
  'map-marks.json': 1,
  'faction-follow.json': 1,
  'tradeskills.json': 1,
  'pets.json': 1,
  'skin-commands.json': 1
}

/** Brings one file from the schema before `to` up to `to`. */
export interface Migration {
  file: string
  to: number
  run: (value: unknown) => unknown
}

/** Every migration, oldest first. */
const MIGRATIONS: readonly Migration[] = [
  // Spawn points (a record with `names`). Nothing to change: the bump keeps an older build, which would
  // drop the names, from writing the file.
  { file: 'respawns.json', to: 2, run: (v) => v },
  // Casts by character (LT-525). Those kept before are put under '', and the store gives them to the
  // character the log being followed is (the one they were mostly cast by).
  { file: 'casts.json', to: 2, run: (v) => ({ '': v }) }
]

export type SchemaState = { state: 'current' } | { state: 'migrated'; from: number; backup: string } | { state: 'newer'; version: number }

/**
 * A value read from `path`, recorded at schema `from`, brought to this build's schema. A backup of
 * the file as it was is made first. Unknown files and missing values come back untouched.
 */
export function upgrade(
  path: string,
  value: unknown,
  from: number,
  schemas: Readonly<Record<string, number>> = SCHEMAS,
  migrations: readonly Migration[] = MIGRATIONS
): { value: unknown; state: SchemaState } {
  const file = basename(path)
  const target = schemas[file]
  if (target === undefined || value === undefined || from === target) return { value, state: { state: 'current' } }
  if (from > target) return { value, state: { state: 'newer', version: from } }
  const backup = join(dirname(path), `${basename(file, '.json')}.pre-${target}.json`)
  try {
    copyFileSync(path, backup)
  } catch (e) {
    log.warn(`Could not back up ${path} before bringing it up to date`, e)
  }
  let v: unknown = value
  for (const m of migrations.filter((x) => x.file === file && x.to > from && x.to <= target).sort((a, b) => a.to - b.to)) {
    v = m.run(v)
    log.info(`${file}: brought from schema ${m.to - 1} to ${m.to}`)
  }
  return { value: v, state: { state: 'migrated', from, backup } }
}

/**
 * The schema a newer build recorded for this file in schema.json beside it, or null when this build's
 * is as new: a feature's own file is then read but never written this run (LT-639).
 */
export function newerBuildWrote(path: string, schemas: Readonly<Record<string, number>> = SCHEMAS): number | null {
  const ours = schemas[basename(path)]
  if (ours === undefined) return null
  const r = readJsonFile(join(dirname(path), 'schema.json'), { setAside: false })
  const recorded = r.state === 'ok' && r.value && typeof r.value === 'object' ? (r.value as Record<string, unknown>)[basename(path)] : undefined
  return typeof recorded === 'number' && recorded > ours ? recorded : null
}
