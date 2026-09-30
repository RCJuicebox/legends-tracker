import { useCallback, useEffect, useRef } from 'react'
import { api } from './api'
import { useInvoke } from './hooks'
import { recall, useRemembered } from './remember'
import { showError } from './toast'
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

/** A character's record, and a way to change it; changes save at once. */
export function useCharacterRecord(key: string) {
  const q = useInvoke(key ? 'character:get' : null, [key])
  const setData = q.setData
  const latest = useRef<CharacterSettings | null>(null)
  latest.current = q.data
  // The character being played can also change on the Spell Timers page.
  useEffect(() => api.on('state:character', () => q.reload()), [q])
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
export function recordClasses(c: CharacterSettings | null | undefined): string[] {
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
export function recordIksar(c: CharacterSettings | null | undefined): boolean {
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
