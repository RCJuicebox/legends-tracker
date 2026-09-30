import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { api, errorMessage, type AppState, type FeedEntry } from './api'
import { FEED_MAX } from './constants'
import { showError } from './toast'
import { moveRemembered } from './movedSettings'
import type { AppSettings, ArchiveStatus, CharacterSettings, FeedItem, TimerView, WatchStatus } from '../../shared/types'

type Patch = (s: AppSettings) => AppSettings

/** What this window's storage still holds that belongs in settings.json (movedSettings.ts). */
function movedFromStorage(settings: AppSettings): { settings: AppSettings; keys: string[] } {
  try {
    return moveRemembered(settings, localStorage)
  } catch {
    return { settings, keys: [] }
  }
}
function forget(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Moved again next start: what settings.json has wins.
  }
}

/** What changes as the game is played: pushed every second or on every line. */
type LiveKey = 'status' | 'timers' | 'feed' | 'archive'
export type LiveState = Pick<AppState, LiveKey>
/** Everything else: settings, the character, devices. Changes when the player changes something. */
export type SettledState = Omit<AppState, LiveKey>

interface Ctx {
  /** The settled part of the state; `useLive` has the part that changes while playing. */
  state: SettledState
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
/**
 * The live part is held outside React and read through `useLive(select)`, so a component renders
 * again only when the value it picked changes, not on every status tick or feed line.
 */
class LiveStore {
  private value: LiveState | null = null
  private readonly listeners = new Set<() => void>()
  get = (): LiveState | null => this.value
  set(next: LiveState | null | ((s: LiveState | null) => LiveState | null)): void {
    this.value = typeof next === 'function' ? next(this.value) : next
    for (const l of this.listeners) l()
  }
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}
const LiveContext = createContext<LiveStore | null>(null)

const LIVE: LiveKey[] = ['status', 'timers', 'feed', 'archive']
const split = (s: AppState): [SettledState, LiveState] => {
  const { status, timers, feed, archive, ...settled } = s
  return [settled, { status, timers, feed, archive }]
}

let feedId = 0
const numbered = (item: FeedItem): FeedEntry => ({ ...item, id: ++feedId })

export function StateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SettledState | null>(null)
  const [liveStore] = useState(() => new LiveStore())
  const setLive = useCallback((next: (s: LiveState | null) => LiveState | null) => liveStore.set(next), [liveStore])
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const stateRef = useRef<SettledState | null>(null)
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

  const takeSettings = useCallback((incoming: AppSettings) => showSettings(pending.current.fns.reduce((s, fn) => fn(s), incoming)), [showSettings])

  useEffect(() => {
    let live = true
    setError('')
    api.invoke('app:state').then(
      (s) => {
        if (!live) return
        const moved = movedFromStorage(s.settings)
        settingsRef.current = moved.settings
        const [settled, now] = split({ ...s, settings: moved.settings, feed: s.feed.map(numbered) })
        liveStore.set(now)
        setState(settled)
        // Forgotten here only once settings.json has them.
        if (moved.keys.length)
          api.invoke('settings:save', moved.settings).then(
            () => moved.keys.forEach(forget),
            (e) => showError('Could not move the faction plan and the setup checklist into settings.json', e)
          )
      },
      (e) => live && setError(errorMessage(e))
    )
    const set =
      <K extends keyof AppState>(key: K) =>
      (value: AppState[K]) =>
        (LIVE as string[]).includes(key) ? setLive((s) => (s ? { ...s, [key]: value } : s)) : setState((s) => (s ? { ...s, [key]: value } : s))
    const offs = [
      api.on('state:status', set('status') as (v: WatchStatus) => void),
      api.on('state:timers', set('timers') as (v: TimerView[]) => void),
      api.on('state:archive', set('archive') as (v: ArchiveStatus) => void),
      api.on('state:settings', (v: AppSettings) => takeSettings(v)),
      api.on('state:character', set('character') as (v: CharacterSettings) => void),
      api.on('state:arranging', set('arranging') as (v: boolean) => void),
      api.on('state:devices', set('devices') as (v: AppState['devices']) => void),
      api.on('state:voices', (v: { voices: string[]; error: string }) => setState((s) => (s ? { ...s, voices: v.voices, speechError: v.error } : s))),
      api.on('state:feed', (item: FeedItem) => setLive((s) => (s ? { ...s, feed: [...s.feed.slice(-(FEED_MAX - 1)), numbered(item)] } : s)))
    ]
    return () => {
      live = false
      offs.forEach((off) => off())
    }
  }, [attempt, takeSettings, liveStore, setLive])

  const write = useCallback(async () => {
    const p = pending.current
    if (p.timer) clearTimeout(p.timer)
    p.timer = null
    p.fns = []
    const next = settingsRef.current
    if (!next) return
    try {
      await api.invoke('settings:save', next)
      const fresh = await api.invoke('app:state')
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

  const latest = useCallback((): AppState => ({ ...stateRef.current!, ...liveStore.get()! }), [liveStore])
  const value = useMemo(() => (state ? { state, saveSettings, patchSettings, saveCharacter, latest } : null), [state, saveSettings, patchSettings, saveCharacter, latest])

  if (!value || !liveStore.get()) {
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
  return (
    <StateContext.Provider value={value}>
      <LiveContext.Provider value={liveStore}>{children}</LiveContext.Provider>
    </StateContext.Provider>
  )
}

export function useApp(): Ctx {
  const ctx = useContext(StateContext)
  if (!ctx) throw new Error('useApp outside StateProvider')
  return ctx
}

/**
 * A value from the state that changes while playing (the watch status, timers, the feed,
 * archiving). The component renders again only when that value changes, so pick the smallest
 * thing needed, and return a part of the state rather than a new object.
 */
export function useLive<T>(select: (s: LiveState) => T): T {
  const live = useContext(LiveContext)
  if (!live) throw new Error('useLive outside StateProvider')
  return useSyncExternalStore(live.subscribe, () => select(live.get()!))
}
