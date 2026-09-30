import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { useInvoke } from './hooks'
import type { CombatSnapshot, MeterSpan, Segment } from '../../shared/types'

/** How often a page showing the open session fetches it again while it changes. */
const SESSION_REFRESH_MS = 2000

// The damage meter's data in a window: the snapshot the main process pushes, and any older
// segment picked from it, fetched once (a closed fight never changes).

/** The live meter snapshot, pushed by the main process twice a second while anything changes. */
export function useCombat(): CombatSnapshot | null {
  const q = useInvoke('combat:get')
  const setData = q.setData
  useEffect(() => api.on('state:combat', (v: CombatSnapshot) => setData(v)), [setData])
  return q.data
}

/** The selection a meter shows: the live segment (or the last one when nothing is live), or a segment by id. */
export const LIVE = 'live'

/**
 * The segment to show for a selection. The live fight comes straight from the snapshot; the open
 * session, which the snapshot only sums up, is fetched, and again every SESSION_REFRESH_MS while it
 * changes; a closed one is fetched once and kept. With nothing live, `live` falls back to the newest
 * closed one, so a meter keeps showing the fight that just ended until the next begins.
 */
export function useSegment(snap: CombatSnapshot | null, span: MeterSpan, selection: string): Segment | null {
  const cache = useRef(new Map<string, Segment>())
  const [, bump] = useState(0)
  const live = span === 'fight' ? snap?.liveFight : snap?.liveSession
  const newest = span === 'fight' ? snap?.fights[0] : snap?.sessions[0]
  const wanted = selection === LIVE ? (live ? live.id : (newest?.id ?? '')) : selection
  const fromSnapshot = useMemo(() => (snap?.liveFight?.id === wanted ? snap.liveFight : null), [snap, wanted])
  const openSession = snap?.liveSession?.id === wanted ? snap.liveSession : null
  const [session, setSession] = useState<Segment | null>(null)
  const fetchedAt = useRef(0)
  const wantedNow = useRef(wanted)
  wantedNow.current = wanted
  // A new summary pushed means the session changed: fetched again once SESSION_REFRESH_MS has gone by.
  useEffect(() => {
    if (!openSession) return
    const had = session?.id === openSession.id
    const t = setTimeout(
      () => {
        fetchedAt.current = Date.now()
        api.invoke('combat:segment', openSession.id).then(
          (seg) => {
            if (seg && seg.id === wantedNow.current) setSession(seg)
          },
          () => {}
        )
      },
      had ? Math.max(0, SESSION_REFRESH_MS - (Date.now() - fetchedAt.current)) : 0
    )
    return () => clearTimeout(t)
  }, [openSession, session?.id])
  useEffect(() => {
    if (!wanted || fromSnapshot || openSession || cache.current.has(wanted)) return
    let on = true
    api.invoke('combat:segment', wanted).then(
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
  }, [wanted, fromSnapshot, openSession])
  return fromSnapshot ?? (openSession && session?.id === openSession.id ? session : null) ?? cache.current.get(wanted) ?? null
}
