import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useDebounced, useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { showError } from '../toast'
import { itemKey, mergeLevel, parseStatsBlock, scaledStats, wornTotals, SHIELD_NAME, type ItemStats } from '../../../core/inventory'
import type { CharacterSheet, InventoryView, ItemInfo } from '../../../shared/types'

// What the Gear and Stats pages (and the Gear tools) share: which character, its inventory and sheet,
// and what the worn gear adds up to.

interface Exports {
  current: string
  achievements: string[]
  inventory: string[]
}

/** How often to look again for an export that is not there yet. */
const EXPORT_POLL_MS = 5000

/** How long typing into the character sheet waits before it is written to disk. */
const SHEET_SAVE_MS = 300

/**
 * The character whose exports a page shows: the one being played, unless another was picked. Looks
 * again when the game writes an export, and every few seconds while the character has none yet, so
 * a page waiting for one fills in on its own.
 */
export function useExportCharacter(kind: 'inventory' | 'achievements', rememberKey: string) {
  const q = useInvoke<Exports>('character:exports')
  const reload = q.reload
  const [picked, setPicked] = useRemembered<string>(rememberKey, '')
  const exports = q.data
  const available = exports?.[kind] ?? []
  const character = picked && available.includes(picked) ? picked : exports?.current || available[0] || ''
  const waiting = !!exports && !available.includes(character)
  useEffect(() => {
    const offs = [api.on('state:inventory', reload), api.on('state:achievements', reload)]
    return () => offs.forEach((off) => off())
  }, [reload])
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(reload, EXPORT_POLL_MS)
    return () => clearInterval(t)
  }, [waiting, reload])
  return { exports, available, character, setCharacter: setPicked, error: q.error, reload }
}

/**
 * A character's inventory and its sheet. Sheet changes show at once and are written to disk once
 * typing stops; one still waiting is written when the character changes or the page closes.
 * `updateSheet` takes an updater, so a change that lands after an await builds on the latest sheet.
 */
export function useInventory(character: string, ready: boolean, exportsKey = '') {
  const inv = useInvoke<InventoryView>(ready ? 'inventory:load' : null, [character], [exportsKey])
  const sheetQ = useInvoke<CharacterSheet>(ready ? 'character:sheet' : null, [character])
  const setView = inv.setData
  const [sheet, setSheet] = useState<CharacterSheet | null>(null)
  const sheetRef = useRef<CharacterSheet | null>(null)
  // Whose sheet is showing: after a switch, the old one shows until the new one arrives, but no
  // change is taken for it.
  const sheetFor = useRef('')
  const characterRef = useRef(character)
  characterRef.current = character

  useEffect(() => {
    if (!ready) return
    return api.on('state:inventory', (v: InventoryView) => v.character === character && setView(v))
  }, [character, ready, setView])

  useEffect(() => {
    if (!sheetQ.data) return
    sheetRef.current = sheetQ.data
    sheetFor.current = characterRef.current
    setSheet(sheetQ.data)
  }, [sheetQ.data])

  const save = useDebounced((who: string, s: CharacterSheet) => {
    api.invoke('character:saveSheet', who, s).catch((e) => showError('Could not save the character sheet', e))
  }, SHEET_SAVE_MS)
  const flush = save.flush
  // The old character's last change goes out before the new one loads.
  useEffect(() => flush, [character, flush])
  useEffect(() => {
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [flush])

  const call = save.call
  const updateSheet = useCallback(
    (fn: (s: CharacterSheet) => CharacterSheet) => {
      const cur = sheetRef.current
      if (!cur || sheetFor.current !== characterRef.current) return
      const next = fn(cur)
      sheetRef.current = next
      setSheet(next)
      call(characterRef.current, next)
    },
    [call]
  )
  const reload = useCallback(() => {
    inv.reload()
    sheetQ.reload()
  }, [inv.reload, sheetQ.reload])

  return { view: inv.data, setView, sheet, updateSheet, error: inv.error || sheetQ.error, reload }
}

/** An item's stats at its merge level, if the wiki has it. */
export function statsFor(items: Record<string, ItemInfo>, name: string): ItemStats | null {
  const info = items[itemKey(name)]
  return info?.found ? scaledStats(parseStatsBlock(info.statsblock), mergeLevel(name)) : null
}

export type WornSummary = ReturnType<typeof wornSummary>

/** What the worn gear adds up to, with the player's typed-in AC where they gave one. */
export function wornSummary(view: InventoryView, sheet: CharacterSheet | null) {
  const worn = view.inventory?.worn ?? []
  const totals = wornTotals(
    worn,
    (it) => statsFor(view.items, it.name),
    (it) => sheet?.acOverrides[itemKey(it.name)]
  )
  const secondary = worn.find((it) => it.location === 'Secondary')
  const shieldByName = !!secondary && SHIELD_NAME.test(secondary.name)
  const shield = sheet?.shield ?? shieldByName
  const shieldAC = shield && secondary ? (sheet?.acOverrides[itemKey(secondary.name)] ?? statsFor(view.items, secondary.name)?.ac ?? 0) : 0
  return { totals, secondary, shield, shieldByName, shieldAC }
}
