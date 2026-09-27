import { useEffect } from 'react'
import { api } from '../api'
import { useInvoke } from '../hooks'
import type { PetGearReading } from '../../../core/pets'

// The pet, as the main process follows it in the log: what it wears (the last `/pet inventory check`
// list), the last one summoned, and every pet the character's classes can summon.

export interface PetState {
  character: string
  gear: PetGearReading | null
  summon: { spell: string; at: number } | null
  spells: { spell: string; level: number; classes: string[] }[]
  spellsLoaded: boolean
}

export function usePet(character: string, classes: string[], level: number) {
  const q = useInvoke<PetState>('pet:state', [character, classes, level])
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
