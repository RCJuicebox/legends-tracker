import { createContext } from 'react'
import type { PageId } from './main'

/** The Motes page's tabs: what was looted, and the three ways to spend it. */
export type MotesTab = 'runs' | 'merge' | 'planner' | 'spells'

/** The Settings page's tabs: the app's own settings, then what were pages of their own. */
export type SettingsTab = 'general' | 'overlays' | 'audio' | 'logs' | 'sources'

/** The pages another page can open on a given tab, and their tabs. */
interface TabOf {
  motes: MotesTab
  settings: SettingsTab
}

/** Where each of those pages keeps its tab (remember.ts): `go` sets it before opening the page. */
export const TAB_KEY: { [P in keyof TabOf]: string } = { motes: 'motes.tab', settings: 'settings.tab' }

/** Goes to a page of the main window, on one of its tabs when one is named. */
export type Go = <P extends PageId>(page: P, tab?: P extends keyof TabOf ? TabOf[P] : never) => void

/**
 * `go`, for what is drawn on any page and has somewhere to send the player (a load error, to
 * Settings › Data sources). Null outside the main window.
 */
export const GoContext = createContext<Go | null>(null)
