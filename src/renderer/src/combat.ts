import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { useInvoke } from './hooks'
import type { CombatSnapshot, MeterSpan, Segment } from '../../shared/types'

// The damage meter's data in a window: the snapshot the main process pushes, and any older
// segment picked from it, fetched once (a closed fight never changes).

/** The live meter snapshot, pushed by the main process twice a second while anything changes. */
export function useCombat(): CombatSnapshot | null {
  const q = useInvoke<CombatSnapshot>('combat:get')
  const setData = q.setData
  useEffect(() => api.on('state:combat', (v: CombatSnapshot) => setData(v)), [setData])
  return q.data
}

/** The selection a meter shows: the live segment (or the last one when nothing is live), or a segment by id. */
export const LIVE = 'live'

/**
 * The segment to show for a selection. A live segment comes straight from the snapshot; a closed one
 * is fetched and kept. With nothing live, `live` falls back to the newest closed one, so a meter
 * keeps showing the fight that just ended until the next begins.
 */
export function useSegment(snap: CombatSnapshot | null, span: MeterSpan, selection: string): Segment | null {
  const cache = useRef(new Map<string, Segment>())
  const [, bump] = useState(0)
  const live = span === 'fight' ? snap?.liveFight : snap?.liveSession
  const newest = span === 'fight' ? snap?.fights[0] : snap?.sessions[0]
  const wanted = selection === LIVE ? (live ? live.id : (newest?.id ?? '')) : selection
  const fromSnapshot = useMemo(() => {
    if (!snap) return null
    if (snap.liveFight?.id === wanted) return snap.liveFight
    if (snap.liveSession?.id === wanted) return snap.liveSession
    return null
  }, [snap, wanted])
  useEffect(() => {
    if (!wanted || fromSnapshot || cache.current.has(wanted)) return
    let on = true
    api.invoke<Segment | null>('combat:segment', wanted).then(
      (seg) => {
        if (!on || !seg) return
        cache.current.set(wanted, seg)
        if (cache.current.size > 40) cache.current.delete(cache.current.keys().next().value!)
        bump((n) => n + 1)
      },
      () => {}
    )
    return () => {
      on = false
    }
  }, [wanted, fromSnapshot])
  return fromSnapshot ?? cache.current.get(wanted) ?? null
}
