import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type AppState } from './api'
import type { AppSettings, ArchiveStatus, CharacterSettings, FeedItem, TimerView, WatchStatus } from '../../shared/types'

interface Ctx {
  state: AppState
  saveSettings: (s: AppSettings) => Promise<void>
  patchSettings: (fn: (s: AppSettings) => AppSettings) => Promise<void>
  saveCharacter: (c: CharacterSettings) => Promise<void>
}

const StateContext = createContext<Ctx | null>(null)

export function StateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    void api.invoke<AppState>('app:state').then(setState)
    const set = <K extends keyof AppState>(key: K) => (value: AppState[K]) => setState((s) => (s ? { ...s, [key]: value } : s))
    const offs = [
      api.on('state:status', set('status') as (v: WatchStatus) => void),
      api.on('state:timers', set('timers') as (v: TimerView[]) => void),
      api.on('state:archive', set('archive') as (v: ArchiveStatus) => void),
      api.on('state:settings', set('settings') as (v: AppSettings) => void),
      api.on('state:character', set('character') as (v: CharacterSettings) => void),
      api.on('state:arranging', set('arranging') as (v: boolean) => void),
      api.on('state:devices', set('devices') as (v: AppState['devices']) => void),
      api.on('state:voices', (v: { voices: string[]; error: string }) => setState((s) => (s ? { ...s, voices: v.voices, speechError: v.error } : s))),
      api.on('state:feed', (item: FeedItem) => setState((s) => (s ? { ...s, feed: [...s.feed.slice(-299), item] } : s)))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const saveSettings = useCallback(async (next: AppSettings) => {
    setState((s) => (s ? { ...s, settings: next } : s))
    await api.invoke('settings:save', next)
    const fresh = await api.invoke<AppState>('app:state')
    setState((s) => (s ? { ...s, character: fresh.character, characterKey: fresh.characterKey } : s))
  }, [])

  const patchSettings = useCallback(
    async (fn: (s: AppSettings) => AppSettings) => {
      if (state) await saveSettings(fn(state.settings))
    },
    [state, saveSettings]
  )

  const saveCharacter = useCallback(async (c: CharacterSettings) => {
    setState((s) => (s ? { ...s, character: c } : s))
    await api.invoke('character:save', c)
  }, [])

  if (!state) return <div className="empty">Loading…</div>
  return <StateContext.Provider value={{ state, saveSettings, patchSettings, saveCharacter }}>{children}</StateContext.Provider>
}

export function useApp(): Ctx {
  const ctx = useContext(StateContext)
  if (!ctx) throw new Error('useApp outside StateProvider')
  return ctx
}
