import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useRemembered } from '../remember'
import { showError } from '../toast'
import { itemKey, type InvItem } from '../../../core/inventory'
import { ANY_SLOT, canWear, eraOf, restrictions, type Wearer } from '../../../core/gearFinder'
import { focusValue, type FocusWorth } from '../../../core/itemFocus'
import type { Piece, PieceSource } from '../../../core/gearOptimizer'
import type { CatalogItem } from '../../../core/wikiItem'
import type { InventoryView } from '../../../shared/types'
import type { FocusData } from '../../../shared/ipc'

// ---- focus effects ----
// Which focus lines touch the character's spells, which they want, what the catalog and what they
// own offer on each, and what a set of foci is worth to them.

/** Points, to start with, for a focus that made every spell cast 10% better. */
const DEFAULT_FOCUS_POINTS = 300

/** A focus effect on something the character owns, and how they have it. */
export interface OwnedFocus {
  focus: string
  eff: number
  item: InvItem
  from: PieceSource
  /** The exaltation it comes from, when it is not the item's own. */
  via: string
}

/** A catalog item carrying a line's focus. */
export interface FocusCandidate {
  item: CatalogItem
  focus: string
  eff: number
  era: string
  owned: boolean
}

export function useFocusModel({
  view,
  items,
  classes,
  level,
  zones,
  eraStatus,
  wearer,
  owned,
  pieces,
  fociOf,
  shownEras
}: {
  view: InventoryView
  items: CatalogItem[] | undefined
  classes: string[]
  level: number
  zones: Map<string, string>
  eraStatus: Record<string, 'in' | 'out'> | undefined
  wearer: Wearer
  owned: Set<string>
  pieces: Piece[]
  fociOf: (item: InvItem) => { name: string; via: string }[]
  shownEras: string[]
}) {
  const [points, setPoints] = useRemembered<number>('finder.focusPoints.v2', DEFAULT_FOCUS_POINTS)
  const [days, setDays] = useRemembered<number>('focus.days', 14)
  const [focusOff, setFocusOff] = useRemembered<string[] | null>(`focus.off.${view.character}`, null)
  const [enough, setEnoughAll] = useRemembered<Record<string, string>>(`focus.enough.${view.character}`, {})

  const [report, setReport] = useState<FocusData | null>(null)
  useEffect(() => {
    if (!items || !classes.length) return
    let live = true
    const names = [...new Set(items.map((it) => it.focus).filter(Boolean))]
    api.invoke('gear:foci', names, classes, level, view.character, days).then(
      (r) => live && setReport(r),
      (e) => live && showError('Could not read the focus effects', e)
    )
    return () => {
      live = false
    }
  }, [items, classes, level, view.character, days])
  // Only lines that touch a spell the character casts are worth anything.
  const lines = useMemo(() => (report?.lines ?? []).filter((l) => l.share > 0), [report])
  const idleLines = useMemo(() => (report?.lines ?? []).filter((l) => l.share === 0), [report])
  // Wanted unless turned off. Out of the box that is every line but reagents: Legends' spell file
  // lists no reagents, so there is no telling which spells use one.
  const off = useMemo(() => focusOff ?? lines.filter((l) => l.kind === 'reagent').map((l) => l.key), [focusOff, lines])
  const wanted = useMemo(() => new Set(lines.map((l) => l.key).filter((k) => !off.includes(k))), [lines, off])
  const setWanted = (keys: string[], on: boolean) => setFocusOff(on ? off.filter((k) => !keys.includes(k)) : [...new Set([...off, ...keys])])

  const available = useMemo(() => {
    const out = new Map<string, FocusCandidate[]>()
    if (!report || !items) return out
    const hidden = new Set(shownEras)
    for (const it of items) {
      const f = it.focus && report.foci[it.focus]
      // A rank capped too low for the character's spells does nothing for them.
      if (!f || f.eff <= 0 || /^Summoned:/i.test(it.title)) continue
      const { era } = eraOf(it, zones, eraStatus)
      if (hidden.has(era) || !canWear(restrictions(it.statsblock), wearer, ANY_SLOT)) continue
      out.set(f.line, [...(out.get(f.line) ?? []), { item: it, focus: it.focus, eff: f.eff, era, owned: owned.has(itemKey(it.title)) }])
    }
    for (const list of out.values()) list.sort((a, b) => b.eff - a.eff || Number(b.owned) - Number(a.owned) || a.item.title.localeCompare(b.item.title))
    return out
  }, [report, items, shownEras, zones, eraStatus, wearer, owned])

  const ownedFoci = useMemo(() => {
    const out = new Map<string, OwnedFocus[]>()
    if (!report) return out
    for (const p of pieces) {
      // Only what the character could wear: another class's item is no focus to them.
      if (p.from !== 'worn' && p.r && !canWear(p.r, wearer, ANY_SLOT)) continue
      for (const f of fociOf(p.item)) {
        const info = report.foci[f.name]
        if (!info) continue
        out.set(info.line, [...(out.get(info.line) ?? []), { focus: f.name, eff: info.eff, item: p.item, from: p.from, via: f.via }])
      }
    }
    for (const list of out.values()) list.sort((a, b) => b.eff - a.eff || Number(b.from === 'worn') - Number(a.from === 'worn'))
    return out
  }, [pieces, report, fociOf, wearer])
  const worth = useMemo<FocusWorth | null>(
    () => (report ? { points, wanted, enough, foci: report.foci, shares: Object.fromEntries(report.uses.map((u) => [u.name, u.share])) } : null),
    [report, points, wanted, enough]
  )
  const setEnough = (line: string, focus: string | null) => {
    const next = { ...enough }
    if (focus) next[line] = focus
    else delete next[line]
    setEnoughAll(next)
  }
  const capOf = (line: string) => {
    const name = enough[line]
    return name && report?.foci[name] ? report.foci[name].eff : Infinity
  }
  const valueOf = useMemo(() => (names: string[]) => (worth ? focusValue(worth, names) : 0), [worth])

  return {
    points,
    setPoints,
    days,
    setDays,
    report,
    lines,
    idleLines,
    wanted,
    setWanted,
    resetWanted: () => setFocusOff(null),
    enough,
    setEnough,
    capOf,
    available,
    ownedFoci,
    worth,
    valueOf
  }
}
