import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, errorMessage, type AppState, type FeedEntry } from './api'
import { FEED_MAX } from './constants'
import { showError } from './toast'
import type { AppSettings, ArchiveStatus, CharacterSettings, FeedItem, TimerView, WatchStatus } from '../../shared/types'

type Patch = (s: AppSettings) => AppSettings

interface Ctx {
  state: AppState
  saveSettings: (s: AppSettings) => Promise<void>
  /**
   * Changes the settings at once on screen and saves them. With `debounceMs` the save waits until
   * the changes stop (a slider being dragged); the change still shows immediately.
   */
  patchSettings: (fn: Patch, opts?: { debounceMs?: number }) => Promise<void>
  saveCharacter: (c: CharacterSettings) => Promise<void>
  /** The state as it is now, for a callback that runs after its render (an undo, a timer). */
  latest: () => AppState
}

const StateContext = createContext<Ctx | null>(null)

let feedId = 0
const numbered = (item: FeedItem): FeedEntry => ({ ...item, id: ++feedId })

export function StateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const stateRef = useRef<AppState | null>(null)
  stateRef.current = state
  // The settings as the player last set them, ahead of React's render and of the save.
  const settingsRef = useRef<AppSettings | null>(null)
  // Changes made on screen but not yet written. An echo of an older save that arrives meanwhile is
  // taken, with these laid over it again, so a slider being dragged never jumps back.
  const pending = useRef<{ fns: Patch[]; timer: ReturnType<typeof setTimeout> | null }>({ fns: [], timer: null })

  const showSettings = useCallback((next: AppSettings) => {
    settingsRef.current = next
    setState((s) => (s ? { ...s, settings: next } : s))
  }, [])

  const takeSettings = useCallback(
    (incoming: AppSettings) => showSettings(pending.current.fns.reduce((s, fn) => fn(s), incoming)),
    [showSettings]
  )

  useEffect(() => {
    let live = true
    setError('')
    api.invoke<AppState>('app:state').then(
      (s) => {
        if (!live) return
        settingsRef.current = s.settings
        setState({ ...s, feed: s.feed.map(numbered) })
      },
      (e) => live && setError(errorMessage(e))
    )
    const set = <K extends keyof AppState>(key: K) => (value: AppState[K]) => setState((s) => (s ? { ...s, [key]: value } : s))
    const offs = [
      api.on('state:status', set('status') as (v: WatchStatus) => void),
      api.on('state:timers', set('timers') as (v: TimerView[]) => void),
      api.on('state:archive', set('archive') as (v: ArchiveStatus) => void),
      api.on('state:settings', (v: AppSettings) => takeSettings(v)),
      api.on('state:character', set('character') as (v: CharacterSettings) => void),
      api.on('state:arranging', set('arranging') as (v: boolean) => void),
      api.on('state:devices', set('devices') as (v: AppState['devices']) => void),
      api.on('state:voices', (v: { voices: string[]; error: string }) => setState((s) => (s ? { ...s, voices: v.voices, speechError: v.error } : s))),
      api.on('state:feed', (item: FeedItem) => setState((s) => (s ? { ...s, feed: [...s.feed.slice(-(FEED_MAX - 1)), numbered(item)] } : s)))
    ]
    return () => {
      live = false
      offs.forEach((off) => off())
    }
  }, [attempt, takeSettings])

  const write = useCallback(async () => {
    const p = pending.current
    if (p.timer) clearTimeout(p.timer)
    p.timer = null
    p.fns = []
    const next = settingsRef.current
    if (!next) return
    try {
      await api.invoke('settings:save', next)
      const fresh = await api.invoke<AppState>('app:state')
      setState((s) => (s ? { ...s, character: fresh.character, characterKey: fresh.characterKey } : s))
    } catch (e) {
      // What was typed stays on screen rather than snapping back mid-edit (typing 200 passes
      // through 2); the next change that is accepted saves it all.
      showError('Could not save settings', e)
    }
  }, [])

  const patchSettings = useCallback(
    async (fn: Patch, opts?: { debounceMs?: number }) => {
      if (!settingsRef.current) return
      showSettings(fn(settingsRef.current))
      const p = pending.current
      p.fns.push(fn)
      if (opts?.debounceMs) {
        if (p.timer) clearTimeout(p.timer)
        p.timer = setTimeout(() => void write(), opts.debounceMs)
        return
      }
      await write()
    },
    [showSettings, write]
  )

  const saveSettings = useCallback((next: AppSettings) => patchSettings(() => next), [patchSettings])

  const saveCharacter = useCallback(async (c: CharacterSettings) => {
    setState((s) => (s ? { ...s, character: c } : s))
    try {
      await api.invoke('character:save', c)
    } catch (e) {
      showError('Could not save the character', e)
    }
  }, [])

  // A save still waiting when the window closes goes out now.
  useEffect(() => {
    const flush = () => {
      if (pending.current.timer) void write()
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [write])

  const latest = useCallback(() => stateRef.current!, [])
  const value = useMemo(() => (state ? { state, saveSettings, patchSettings, saveCharacter, latest } : null), [state, saveSettings, patchSettings, saveCharacter, latest])

  if (!value) {
    if (!error) return <div className="empty">Loading…</div>
    return (
      <div className="boot-error" role="alert">
        <h1>Legends Tracker could not start</h1>
        <p>The window could not get its state from the app: {error}</p>
        <p className="muted small">If this keeps happening, restart the app. The log folder has the log to attach to a bug report.</p>
        <div className="row">
          <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
          <button className="btn" onClick={() => void api.invoke('app:openLogs').catch(() => {})}>
            Open log folder
          </button>
        </div>
      </div>
    )
  }
  return <StateContext.Provider value={value}>{children}</StateContext.Provider>
}

export function useApp(): Ctx {
  const ctx = useContext(StateContext)
  if (!ctx) throw new Error('useApp outside StateProvider')
  return ctx
}
