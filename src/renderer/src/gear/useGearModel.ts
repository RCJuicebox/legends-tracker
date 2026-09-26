import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { showError } from '../toast'
import { readSheet } from '../statsSheet'
import { characterAc } from '../stats/model'
import { statsFor, wornSummary } from './model'
import { itemKey, mergeLevel, parseStatsBlock, scaledStats, type InvItem } from '../../../core/inventory'
import {
  ANY_SLOT,
  canWear,
  DEFAULT_HIDDEN_ERAS,
  ERA_ORDER,
  eraOf,
  findUpgrades,
  isLore,
  restrictions,
  zoneEras,
  type Wearer,
  type Weights
} from '../../../core/upgrades'
import { conversions, rawWeights, ROLE_PRESETS, type ClassFactors, type RoleWeights } from '../../../core/statValue'
import { focusValue, type FocusLine, type FocusReport, type FocusWorth } from '../../../core/itemFocus'
import { optimizeGear, ownedPieces, type Piece, type PieceSource } from '../../../core/gearOptimizer'
import { candidatePiece, inTheRound } from '../../../core/finderRound'
import { aaTotal } from '../../../core/aa'
import { CATALOG_FORMAT, type CatalogItem } from '../../../core/wikiItem'
import type { CharacterSheet, InventoryView } from '../../../shared/types'

// Everything the upgrade finder, the focus effects tab and the optimizer work out, apart from how
// they show it.

/** AC past the soft cap is worth a quarter of AC under it, in every weighting. */
export const AC_OVER_CAP = 0.25
/** Points, to start with, for a focus that made every spell cast 10% better. */
const DEFAULT_FOCUS_POINTS = 300

/** The focus report, with the window of casts it was judged on. */
export type FocusData = FocusReport & { window: { total: number; from: string; to: string } | null }

export interface CatalogState {
  file: { fetchedAt: number; items: CatalogItem[]; eraStatus?: Record<string, 'in' | 'out'>; format?: number } | null
  stale: boolean
  progress: { busy: boolean; pages: number; total: number; error: string }
}

export type GearMode = 'finder' | 'focus' | 'optimize' | 'merge' | 'pet'

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

/** Everything the finder, the focus tab and the optimizer share. */
export interface GearModel {
  view: InventoryView
  classes: string[]
  level: number
  wearer: Wearer
  weights: Weights
  twoHanders: boolean
  catalog: CatalogItem[]
  /** Focus names an item carries: its own and its exaltations'. */
  fociOf: (item: InvItem) => { name: string; via: string }[]
  report: FocusData | null
  /** Days of casting the foci are judged on; 0 for all of it. */
  days: number
  setDays: (n: number) => void
  /** Lines that improve at least one of the character's spells. */
  lines: FocusLine[]
  /** Lines that improve none of them. */
  idleLines: FocusLine[]
  wanted: Set<string>
  setWanted: (keys: string[], on: boolean) => void
  resetWanted: () => void
  /** Per line, the focus the player calls enough (a stronger rank counts for no more); absent = the best. */
  enough: Record<string, string>
  setEnough: (line: string, focus: string | null) => void
  /** The strength that counts as the most wanted on a line: the enough focus's, or Infinity. */
  capOf: (line: string) => number
  points: number
  setPoints: (n: number) => void
  /** Per line, the catalog items with a focus of it that the character could wear, best first. */
  available: Map<string, FocusCandidate[]>
  /** Per line, what the character owns with a focus of it, best first. */
  ownedFoci: Map<string, OwnedFocus[]>
  pieces: Piece[]
  worth: FocusWorth | null
  focusValue: (names: string[]) => number
}

/** The wiki's item catalog as stored on this PC, and a way to fetch it again. */
function useCatalog() {
  const q = useInvoke<CatalogState>('gear:catalog')
  const { setData, reload } = q
  useEffect(
    () =>
      api.on('state:catalog', (progress: CatalogState['progress']) => {
        setData((s) => (s ? { ...s, progress } : s))
        // A download finished, whoever started it: show what it stored.
        if (!progress.busy) reload()
      }),
    [setData, reload]
  )
  const refresh = useCallback(async () => {
    try {
      await api.invoke<CatalogState>('gear:catalogRefresh')
    } catch (e) {
      showError('Could not download the item catalog', e)
    }
    // Read what is stored now, rather than trust a reply that another refresh may have overtaken.
    reload()
  }, [reload])
  // A catalog stored by an older build lacks what this one reads; fetch it again once, on its own.
  const state = q.data
  const [autoRefreshed, setAutoRefreshed] = useState(false)
  useEffect(() => {
    if (state?.file && (state.file.format ?? 1) < CATALOG_FORMAT && !state.progress.busy && !autoRefreshed) {
      setAutoRefreshed(true)
      void refresh()
    }
  }, [state?.file, state?.progress.busy, autoRefreshed, refresh])
  return { state, refresh, error: q.error, reload }
}

export function useGearModel(view: InventoryView, sheet: CharacterSheet | null, mode: GearMode) {
  const catalog = useCatalog()
  const state = catalog.state
  const [preset, setPreset] = useRemembered<string>('finder.preset', 'Balanced')
  const [custom, setCustom] = useRemembered<RoleWeights>('finder.roleWeights', ROLE_PRESETS.Balanced)
  const [twoHandMode, setTwoHandMode] = useRemembered<'auto' | 'one' | 'any'>('finder.twoHand', 'auto')
  const [compare, setCompare] = useRemembered<'drop' | 'level'>('finder.compare', 'drop')
  const [hiddenEras, setHiddenEras] = useRemembered<string[]>('finder.hiddenEras.v3', DEFAULT_HIDDEN_ERAS)
  const [slot, setSlot] = useRemembered<string>('finder.slot', 'all')
  const [capMode, setCapMode] = useRemembered<'auto' | 'over' | 'under'>('finder.acCap', 'auto')
  // 'round': every candidate judged with everything owned rearranged around it; 'slot': one slot, one item out.
  const [judge, setJudge] = useRemembered<'slot' | 'round'>('finder.judge', 'round')
  const [points, setPoints] = useRemembered<number>('finder.focusPoints.v2', DEFAULT_FOCUS_POINTS)
  const [days, setDays] = useRemembered<number>('focus.days', 14)
  const [focusOff, setFocusOff] = useRemembered<string[] | null>(`focus.off.${view.character}`, null)
  const [enough, setEnoughAll] = useRemembered<Record<string, string>>(`focus.enough.${view.character}`, {})
  const sheetStats = useMemo(() => readSheet(sheet?.stats), [sheet])
  const trio = sheetStats.classes.filter(Boolean)
  const capsQ = useInvoke<{ ac: Record<string, { cap: number; mult: number }>; factors: Record<string, ClassFactors> }>(
    trio.length ? 'stats:caps' : null,
    [trio, sheetStats.level]
  )
  const acCaps = capsQ.data?.ac ?? null
  const factors = useMemo(() => capsQ.data?.factors ?? {}, [capsQ.data])

  const stats = (sheet?.stats ?? {}) as { classes?: string[]; level?: number; race?: string }
  // The same array for as long as the classes are the same, so memos and effects can depend on it.
  const classKey = (stats.classes ?? []).filter(Boolean).join(',')
  const classes = useMemo(() => (classKey ? classKey.split(',') : []), [classKey])
  const level = stats.level ?? 50
  const role = preset === 'Custom' ? custom : (ROLE_PRESETS[preset] ?? ROLE_PRESETS.Balanced)
  // What a point of each stat buys this character: its classes, its current stats (the Stats
  // window's when read, else the sheet's), and its AAs.
  const conv = useMemo(() => {
    const w = sheetStats.window?.values ?? {}
    const cur = (label: string, fallback: number) => w[label]?.[0] ?? fallback
    return conversions({
      classes: sheetStats.classes.filter(Boolean),
      factors,
      stats: {
        STR: cur('Strength', sheetStats.strength || 150),
        STA: cur('Stamina', 150),
        AGI: cur('Agility', sheetStats.agility || 150),
        DEX: cur('Dexterity', sheetStats.dexterity || 150),
        WIS: cur('Wisdom', 150),
        INT: cur('Intelligence', 150)
      },
      hpBonusPct: aaTotal(sheetStats.aa, 'base_hp_pct'),
      evasionPct: sheetStats.overrides.evasion ?? aaTotal(sheetStats.aa, 'avoidance_pct')
    })
  }, [sheetStats, factors])
  // Over the soft cap or not: the game's own Stats window when it has been read (mitigation above
  // the soft cap means over), else the AC calculator.
  const acState = useMemo(() => {
    const w = sheetStats.window?.values.AC
    if (w && w.length >= 2) return { over: w[0] > w[1], mitigation: w[0], cap: w[1], from: 'your last Stats window read' }
    if (!acCaps) return null
    const r = characterAc(sheetStats, acCaps, view.inventory ? wornSummary(view, sheet) : null)
    return { over: r.over, mitigation: r.mitigation, cap: r.effCap, from: 'the AC calculator' }
  }, [sheetStats, acCaps, view, sheet])
  const overCap = capMode === 'auto' ? !!acState?.over : capMode === 'over'
  const weights = useMemo(() => {
    const w = rawWeights(role, conv)
    return overCap ? { ...w, ac: w.ac * AC_OVER_CAP } : w
  }, [role, conv, overCap])
  // Two-handers only when the secondary hand is free, unless the player says otherwise.
  const secondaryInUse = !!view.inventory?.worn.some((it) => it.location === 'Secondary')
  const twoHanders = twoHandMode === 'any' || (twoHandMode === 'auto' && !secondaryInUse)
  const inv = view.inventory!
  const owned = useMemo(() => new Set([...inv.worn, ...inv.bags, ...inv.bank, ...inv.sharedBank].flatMap((i) => [itemKey(i.name), ...i.augs.map((a) => itemKey(a.name))])), [inv])
  const wearer = useMemo<Wearer>(() => ({ classes, race: stats.race === 'iksar' ? 'IKS' : '', level }), [classes, stats.race, level])

  const items = state?.file?.items
  const eraStatus = state?.file?.eraStatus
  const zones = useMemo(() => zoneEras(items ?? [], eraStatus), [items, eraStatus])
  // Every era in the catalog with how many pieces it holds, tagged or worked out from drop zones.
  const eraCounts = useMemo(() => {
    const counts = new Map<string, number>(ERA_ORDER.map((e) => [e, 0]))
    for (const it of items ?? []) {
      const { era } = eraOf(it, zones, eraStatus)
      counts.set(era, (counts.get(era) ?? 0) + 1)
    }
    return [...counts]
  }, [items, zones, eraStatus])

  // ---- focus effects ----
  const byKey = useMemo(() => new Map((items ?? []).map((it) => [itemKey(it.title), it])), [items])
  const fociOf = useMemo(
    () => (item: InvItem) => {
      const out: { name: string; via: string }[] = []
      const own = byKey.get(itemKey(item.name))?.focus
      if (own) out.push({ name: own, via: '' })
      for (const a of item.augs) {
        const f = byKey.get(itemKey(a.name))?.focus
        if (f && !out.some((o) => o.name === f)) out.push({ name: f, via: a.name })
      }
      return out
    },
    [byKey]
  )
  const [report, setReport] = useState<FocusData | null>(null)
  useEffect(() => {
    if (!items || !classes.length) return
    let live = true
    const names = [...new Set(items.map((it) => it.focus).filter(Boolean))]
    api.invoke<FocusData | null>('gear:foci', names, classes, level, view.character, days).then(
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

  // Hiding an era re-sorts the whole catalog; the buttons answer first, the lists follow.
  const shownEras = useDeferredValue(hiddenEras)
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

  const pieces = useMemo(
    () =>
      ownedPieces(inv, (item) => {
        const c = byKey.get(itemKey(item.name))
        const stats = statsFor(view.items, item.name) ?? (c ? scaledStats(parseStatsBlock(c.statsblock), mergeLevel(item.name)) : null)
        if (!c && !stats) return null
        return { r: c ? restrictions(c.statsblock) : null, stats, foci: fociOf(item).map((f) => f.name), lore: c ? isLore(c.statsblock) : true }
      }),
    [inv, byKey, view.items, fociOf]
  )
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

  // The finder scores the whole catalog (about 11,000 pieces) against every slot. Its inputs go
  // through a deferred value, so a weight being typed or a button being pressed answers at once and
  // the results catch up in the background.
  const input = useMemo(
    () => ({ items, wearer, weights, compare, hiddenEras, inv, viewItems: view.items, owned, twoHanders, worth, fociOf, valueOf, eraStatus, pieces, judge }),
    [items, wearer, weights, compare, hiddenEras, inv, view.items, owned, twoHanders, worth, fociOf, valueOf, eraStatus, pieces, judge]
  )
  const deferred = useDeferredValue(input)
  const results = useMemo(() => {
    const d = deferred
    if (!d.items || !classes.length || mode !== 'finder') return null
    const round = d.judge === 'round'
    const slots = findUpgrades({
      worn: d.inv.worn,
      statsOf: (it) => statsFor(d.viewItems, it.name),
      catalog: d.items,
      wearer: d.wearer,
      weights: d.weights,
      compare: d.compare,
      hiddenEras: d.hiddenEras,
      eraStatus: d.eraStatus,
      twoHanders: d.twoHanders,
      owned: d.owned,
      focus: d.worth ? { worn: (it) => d.fociOf(it).map((f) => f.name), value: d.valueOf } : undefined,
      // In the round, the stat winners a focus loss would hide get their chance: the optimizer may keep the focus elsewhere.
      perSlot: round ? 8 : 6,
      keepStatWinners: round
    })
    if (!round) return slots
    // Each candidate among everything owned, worn as well as it can be; its worth is what the set gains.
    const opts = { pieces: d.pieces, wearer: d.wearer, weights: d.weights, twoHanders: d.twoHanders, focusValue: d.valueOf }
    const baseline = optimizeGear(opts)
    return slots.map((s) => {
      const judged = s.candidates.map((c) => {
        const r = inTheRound({ ...opts, candidate: candidatePiece(c.item, c.stats), baseline })
        return { ...c, round: { delta: r.delta, placed: r.placed, moves: r.moves.map((m) => ({ slot: m.slot, out: m.out?.item.name ?? null, in: m.in?.item.name ?? null })) } }
      })
      return { ...s, candidates: judged.filter((c) => c.round.delta > 0).sort((a, b) => b.round.delta - a.round.delta).slice(0, 6) }
    })
  }, [deferred, classes.length, mode])

  const model: GearModel | null = state?.file
    ? {
        view,
        classes,
        level,
        wearer,
        weights,
        twoHanders,
        catalog: state.file.items,
        fociOf,
        report,
        days,
        setDays,
        lines,
        idleLines,
        wanted,
        setWanted,
        resetWanted: () => setFocusOff(null),
        enough,
        setEnough,
        capOf,
        points,
        setPoints,
        available,
        ownedFoci,
        pieces,
        worth,
        focusValue: valueOf
      }
    : null

  return {
    catalog,
    model,
    results,
    /** The results shown are from before the latest change and are being worked out again. */
    resultsStale: deferred !== input,
    stats,
    classes,
    level,
    role,
    conv,
    /** What a point of each item stat is worth to this character, AC quartered over the soft cap. */
    weights,
    acState,
    overCap,
    secondaryInUse,
    twoHanders,
    eraCounts,
    fociOf,
    lines,
    wanted,
    points,
    setPoints,
    controls: { preset, setPreset, custom, setCustom, twoHandMode, setTwoHandMode, compare, setCompare, hiddenEras, setHiddenEras, slot, setSlot, capMode, setCapMode, judge, setJudge }
  }
}
