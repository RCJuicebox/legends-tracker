import { useEffect } from 'react'
import { api } from '../api'
import { useInvoke } from '../hooks'
import type { PetView } from '../../../shared/ipc'

// The pet, as the main process follows it in the log: what it wears (the last `/pet inventory check`
// list), the last one summoned, and every pet the character's classes can summon.

export type PetState = PetView

export function usePet(character: string, classes: string[], level: number) {
  const q = useInvoke('pet:state', [character, classes, level])
  const setData = q.setData
  useEffect(
    () =>
      api.on('state:pet', (s: Omit<PetState, 'spells' | 'spellsLoaded'>) =>
        setData((prev) => (prev && s.character === prev.character ? { ...prev, gear: s.gear, summon: s.summon } : prev))
      ),
    [setData]
  )
  return q
}
