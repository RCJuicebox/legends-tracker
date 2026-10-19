import { useCallback, useEffect, useMemo, useRef } from 'react'
import { api } from './api'
import { useInvoke } from './hooks'
import { recall, useRemembered } from './remember'
import { showError } from './toast'
import { useSettled } from './state'
import { classIdOf, className, type ClassName } from '../../shared/game/classes'
import type { CharacterSettings } from '../../shared/types'
import type { StatsInputs } from '../../core/statsInputs'

// One character record (classes with their levels, race, focus) per character, kept by main in the
// settings and read by every page: Spell Timers, Stats, Gear, Spell upgrades, Buffs.

/** The character picked on the Achievements, Stats, Gear and Tradeskills pages: one choice for them all. */
const PICK_KEY = 'character'

export function usePickedCharacter(): [string, (key: string) => void] {
  // Each page used to remember its own; the Gear page's choice carries over.
  return useRemembered<string>(PICK_KEY, recall<string>(PICK_KEY, '') || recall<string>('inv.character', ''))
}

/**
 * The character a page is for (LT-636): the one picked on any character page, else the one being
 * played, else the first. The choice is among the characters with this kind of export, and with
 * `withLogs` those with a log too (the Plan pages plan from the log alone). The list is looked at
 * again when the game writes an export, so a character's first one adds it at once.
 */
export function useCharacterChoice(kind: 'inventory' | 'achievements' | 'factions', o: { withLogs?: boolean } = {}) {
  const characterKey = useSettled((s) => s.characterKey)
  const installDir = useSettled((s) => s.settings.installDir)
  const logFile = useSettled((s) => s.settings.logFile)
  const exportsQ = useInvoke('character:exports', [], [installDir])
  const logsQ = useInvoke(o.withLogs ? 'logs:list' : null, [], [installDir, logFile])
  const [picked, setPicked] = usePickedCharacter()
  const exports = exportsQ.data
  const logs = logsQ.data
  const available = useMemo(
    () => (o.withLogs ? [...new Set([...(logs ?? []).map((l) => l.character), ...(exports?.[kind] ?? [])])].sort() : (exports?.[kind] ?? [])),
    [o.withLogs, logs, exports, kind]
  )
  const character = picked && available.includes(picked) ? picked : characterKey || exports?.current || available[0] || ''
  const reloadExports = exportsQ.reload
  const reloadLogs = logsQ.reload
  // A new export is pushed as the game writes it (ExportWatch): no polling for one (LT-398).
  useEffect(() => {
    const offs = [api.on('state:inventory', reloadExports), api.on('state:achievements', reloadExports)]
    return () => offs.forEach((off) => off())
  }, [reloadExports])
  const reload = useCallback(() => {
    reloadExports()
    if (o.withLogs) reloadLogs()
  }, [reloadExports, reloadLogs, o.withLogs])
  return {
    exports,
    available,
    character,
    setCharacter: setPicked,
    ready: o.withLogs ? !!logs : !!exports,
    error: logsQ.error || exportsQ.error,
    reload
  }
}

/** A character's record, and a way to change it; changes save at once. */
export function useCharacterRecord(key: string) {
  const q = useInvoke(key ? 'character:get' : null, [key])
  const { setData, reload } = q
  const latest = useRef<CharacterSettings | null>(null)
  latest.current = q.data
  // The character being played can also change on the Spell Timers page. Subscribed once, not on
  // every render (q is a fresh object each time, LT-395).
  useEffect(() => api.on('state:character', () => reload()), [reload])
  const save = useCallback(
    async (patch: (c: CharacterSettings) => CharacterSettings) => {
      const cur = latest.current
      if (!cur || !key) return
      const next = patch(cur)
      setData(next)
      try {
        setData(await api.invoke('character:put', key, next))
      } catch (e) {
        showError('Could not save the character', e)
      }
    },
    [key, setData]
  )
  return { record: q.data, save, error: q.error, reload: q.reload }
}

/** The record's classes as the tracker's ids, in the player's order. */
function recordClasses(c: CharacterSettings | null | undefined): string[] {
  return Object.keys(c?.classLevels ?? {}).flatMap((name) => {
    const id = classIdOf(name)
    return id ? [id] : []
  })
}

/**
 * The character's level: its highest class level, else the record's own. Unsettled for the AC sums
 * (Iksar bonus, Monk weight caps, anti-twink cap): `/who` shows the lowest, and no reading with a class
 * below 50 has told which the game uses there.
 */
export function recordLevel(c: CharacterSettings | null | undefined): number {
  const levels = Object.values(c?.classLevels ?? {}).filter((l): l is number => typeof l === 'number')
  return levels.length ? Math.max(...levels) : (c?.level ?? 50)
}

/** Iksar or not: the only race the AC sums tell apart. */
function recordIksar(c: CharacterSettings | null | undefined): boolean {
  return (c?.race ?? '').toLowerCase() === 'iksar'
}

/** Sets the classes in order, each at its level (a class already there keeps its level). */
export function withClasses(c: CharacterSettings, ids: string[], levelFor: (id: string) => number): CharacterSettings {
  const classLevels: CharacterSettings['classLevels'] = {}
  for (const id of ids) {
    const name = className(id) as ClassName
    classLevels[name] = levelFor(id)
  }
  return { ...c, classLevels }
}

/** A Stats sheet with the record's classes, level and race in place of its own, once the record has classes. */
export function withRecord(s: StatsInputs, c: CharacterSettings | null | undefined): StatsInputs {
  const ids = recordClasses(c)
  if (!ids.length) return s
  return { ...s, classes: [ids[0], ids[1] ?? '', ids[2] ?? ''], level: recordLevel(c), race: recordIksar(c) ? 'iksar' : 'other' }
}
