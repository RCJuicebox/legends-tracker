import { createContext } from 'react'

/**
 * Goes to a page of the main window, for what is drawn on any page and has somewhere to send the
 * player (a load error, to Data Sources). Null outside the main window.
 */
export const GoContext = createContext<((page: string) => void) | null>(null)
