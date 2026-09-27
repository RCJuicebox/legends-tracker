import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { showError } from '../toast'
import { readSheet } from '../statsSheet'
import { characterAc } from '../stats/model'
import { statsFor, wornSummary } from './model'
import { itemFoci, itemKey, mergeLevel, parseStatsBlock, scaledStats, storedEquipment, type InvItem } from '../../../core/inventory'
import {
  ANY_SLOT,
  canWear,
  DEFAULT_HIDDEN_ERAS,
  ERA_ORDER,
  eraOf,
  findUpgrades,
  isLore,
  isTwoHanded,
  restrictions,
  score,
  handWeights,
  weightsForSlot,
  type HandWeights,
  zoneEras,
  type Wearer,
  type Weights
} from '../../../core/upgrades'
import { conversions, rawWeights, ROLE_PRESETS, type RoleWeights } from '../../../core/statValue'
import { focusValue, type FocusLine, type FocusWorth } from '../../../core/itemFocus'
import { optimizeGear, ownedPieces, pieceName, SLOT_LAYOUT, type EffectValue, type Exaltation, type Piece, type PieceSource } from '../../../core/gearOptimizer'
import { usePet } from './usePet'
import { effectScore, itemEffects, procOf, procWorth, wornEffectOf, wornStats, wornWorth, type EffectSpell, type EffectWorth } from '../../../core/itemEffects'
import { meleeProfile, type MeleeProfile } from '../../../core/meleeTally'
import { candidatePiece, inTheRound, ownedInTheRound } from '../../../core/finderRound'
import { aaTotal } from '../../../core/aa'
import { DOUBLE_ATTACK, DUAL_WIELD, TRIPLE_ATTACK, TRIPLE_CLASSES, doubleAttackChance, dualWieldChance, handSwings, tripleAttackChance } from '../../../core/combatModel'
import { CATALOG_FORMAT, withRaceFix, type CatalogItem } from '../../../core/wikiItem'
import type { CharacterSheet, InventoryView } from '../../../shared/types'
import type { CatalogState, FocusData } from '../../../shared/ipc'

// Everything the upgrade finder, the focus effects tab and the optimizer work out, apart from how
// they show it.

/** AC past the soft cap is worth a quarter of AC under it, in every weighting. */
export const AC_OVER_CAP = 0.25
/** Points, to start with, for a focus that made every spell cast 10% better. */
const DEFAULT_FOCUS_POINTS = 300

export type { CatalogState, FocusData }

export type GearMode = 'finder' | 'focus' | 'effects' | 'procs' | 'optimize' | 'merge' | 'pet'

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
  /** How much each hand's weapon counts, from how often it swings; null when the log gives no Dual Wield skill. */
  hands: HandInfo | null
  /** What the finder and the optimizer weigh the hands' weapon ratio by: `hands`, raised when weapons go by ratio first. */
  weaponHands: HandWeights | null
  /** For the optimizer's all-gear mode: the best of what is not owned, slot by slot (empty on other tabs). */
  catalogPieces: Piece[]
  /** The finder's comparison: pieces to get as they drop, or at the merge level of what they replace. */
  compare: 'drop' | 'level'
  /** Worn effects and procs: the character's melee they are weighed against, their spells, their worth. */
  effects: GearEffects
  /** An item's own worn effect and proc, by name; undefined when the wiki does not know it. */
  effectsOfItem: (name: string) => { worn: string; proc: string } | undefined
  /** Every exaltation kept in Storage with a focus, worn effect or proc, whoever may use it. */
  storedExaltations: Exaltation[]
  /** Whether the era buttons hide a catalog item. */
  eraHidden: (c: CatalogItem) => boolean
  /** Exaltations kept in Storage, free to put in a piece's focus slot. */
  exaltations: Exaltation[]
  /** The pet as the log shows it: what it wears, which one it is. */
  pet: ReturnType<typeof usePet>
  worth: FocusWorth | null
  focusValue: (names: string[]) => number
}

/** Each hand's weight, and what it came from. */
export interface HandInfo extends HandWeights {
  swings: { main: number; off: number }
  dualWield: number
  doubleAttack: number
  ambidexterity: number
  /** The chance the offhand swings in a round. */
  dual: number
}

export interface GearEffects {
  /** The character's melee over the days looked at; null while it is read or when there is no log. */
  profile: MeleeProfile | null
  spells: Record<string, EffectSpell>
  /** Worth in the weights' terms, for the finder and the optimizer; null until the spell file is read. */
  value: EffectValue | null
  /** What each does and the damage a minute it adds (0 with no melee to weigh against), by spell name. */
  wornWorth: (name: string) => EffectWorth | null
  procWorth: (name: string) => EffectWorth | null
  /** Worth in the weights' terms, all told and (for a worn effect) the part that is stats. */
  wornScore: (name: string) => number
  wornStatScore: (name: string) => number
  procScore: (name: string) => number
  /** Weapons in hand now that carry a proc, by name. */
  carriers: Map<string, number>
  dex: number
  loading: boolean
}

const HANDS = ['Primary', 'Secondary']
/** How far weapon ratio outweighs the rest in the hands when weapons go by ratio first: 1% of weapon damage then counts 100 times over. */
const RATIO_FIRST = 100
/** Each kind of slot once; the Any slots take what the others do. */
const SLOT_NAMES = [...new Set(SLOT_LAYOUT)].filter((s) => s !== 'Any Slot')
export const CATALOG_PER_SLOT = 12
const NO_MELEE = meleeProfile({}, { from: '', to: '' })

/** The wiki's item catalog as stored on this PC, and a way to fetch it again. */
function useCatalog() {
  const q = useInvoke('gear:catalog')
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
      await api.invoke('gear:catalogRefresh')
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

/** The copy of an item the character owns at the highest merge level, among the pieces the optimizer weighs. */
function bestOwned(pieces: Piece[], key: string): Piece | null {
  let best: Piece | null = null
  for (const p of pieces) if (p.key === key && p.stats && (!best || mergeLevel(p.item.name) > mergeLevel(best.item.name))) best = p
  return best
}

export function useGearModel(view: InventoryView, sheet: CharacterSheet | null, mode: GearMode) {
  const catalog = useCatalog()
  const state = catalog.state
  const [preset, setPreset] = useRemembered<string>('finder.preset', 'Balanced')
  // v2: weapon ratio per 1% of damage. Custom weights saved before keep their place against the
  // Melee role, whose weight went from 80 to 12.
  const [savedCustom, saveCustom] = useRemembered<RoleWeights & { v?: number }>('finder.roleWeights', { ...ROLE_PRESETS.Balanced, v: 2 })
  const custom = useMemo<RoleWeights>(() => {
    const { v, ...w } = savedCustom
    return v === 2 ? w : { ...w, ratio: Math.round((w.ratio ?? 0) * (12 / 80) * 10) / 10 }
  }, [savedCustom])
  const setCustom = useCallback((w: RoleWeights) => saveCustom({ ...w, v: 2 }), [saveCustom])
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
  const capsQ = useInvoke(
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
  const pet = usePet(view.character, classes, level)
  // Custom weights saved before a weight existed read it as the Balanced role has it.
  const role = useMemo(
    () => (preset === 'Custom' ? { ...ROLE_PRESETS.Balanced, ...custom } : (ROLE_PRESETS[preset] ?? ROLE_PRESETS.Balanced)),
    [preset, custom]
  )
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
  // How much each hand's weapon counts, from how often it swings: EQEmu's attack rounds (the Stats
  // page's, checked against hour-long parses) on the skills the log's skill-up lines give. Unknown
  // (no Dual Wield skill in the log) counts both hands alike.
  const hands = useMemo<HandInfo | null>(() => {
    const k = sheetStats.skills
    const dw = k[DUAL_WIELD] ?? 0
    if (!dw) return null
    const da = k[DOUBLE_ATTACK] ?? 0
    const amb = sheetStats.overrides.ambidexterity ?? aaTotal(sheetStats.aa, 'dual_wield_pct')
    const double = doubleAttackChance(da, level, sheetStats.doubleAttackBonus)
    const triple = classes.some((c) => TRIPLE_CLASSES.includes(c)) ? tripleAttackChance(k[TRIPLE_ATTACK] ?? 0) : 0
    const dual = dualWieldChance(dw, level, amb)
    const swings = handSwings({ double, triple, dual, doubleSkill: da })
    return { ...handWeights(swings), swings, dualWield: dw, doubleAttack: da, ambidexterity: amb, dual }
  }, [sheetStats, level, classes])
  // "Weapons: best ratio first": in the hands, weapon ratio outweighs everything else, whatever the
  // other weights, so the weights pick among weapons of about the same ratio. Only the hands' weapon
  // ratio is raised: worn effects, procs and merges are weighed as before.
  const [ratioFirst, setRatioFirst] = useRemembered<boolean>('finder.ratioFirst', true)
  const weaponHands = useMemo<HandWeights | null>(
    () => (ratioFirst ? { main: (hands?.main ?? 1) * RATIO_FIRST, off: (hands?.off ?? 1) * RATIO_FIRST } : hands),
    [ratioFirst, hands]
  )
  // Two-handers only when the secondary hand is free, unless the player says otherwise.
  const secondaryInUse = !!view.inventory?.worn.some((it) => it.location === 'Secondary')
  const twoHanders = twoHandMode === 'any' || (twoHandMode === 'auto' && !secondaryInUse)
  const inv = view.inventory!
  // What the pet wears is the character's too: the log's list names each piece (not its exaltations).
  const petGear = pet.data?.gear
  const petItems = useMemo<InvItem[]>(() => (petGear?.items ?? []).map((g) => ({ location: 'Pet', name: g.name, id: 0, count: 1, augs: [] })), [petGear])
  const owned = useMemo(
    () =>
      new Set(
        [...inv.worn, ...inv.bags, ...inv.bank, ...inv.sharedBank, ...storedEquipment(inv), ...petItems].flatMap((i) => [itemKey(i.name), ...i.augs.map((a) => itemKey(a.name))])
      ),
    [inv, petItems]
  )
  const wearer = useMemo<Wearer>(() => ({ classes, race: stats.race === 'iksar' ? 'IKS' : '', level }), [classes, stats.race, level])

  // Crafted items without an era of their own take their ingredients' eras (from the recipe book, which
  // the main process fetches again in the background when it is old; asked again once it has been).
  const craftQ = useInvoke('trade:craftEras')
  const reloadCraft = craftQ.reload
  useEffect(() => api.on('state:recipes', (p: { busy: boolean }) => !p.busy && reloadCraft()), [reloadCraft])
  const rawItems = state?.file?.items
  // And race lines the wiki has wrong are put right (RACE_FIXES).
  const items = useMemo(() => {
    const made = craftQ.data ?? {}
    return rawItems?.map((it) => {
      const fixed = withRaceFix(it)
      return !fixed.era && made[fixed.title] ? { ...fixed, craftEras: made[fixed.title] } : fixed
    })
  }, [rawItems, craftQ.data])
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
  // Every catalog item's own worn effect and proc, read from its stats block once.
  const effectsOfItem = useMemo(() => {
    const byItem = new Map([...byKey].map(([key, c]) => [key, { worn: wornEffectOf(c.statsblock), proc: procOf(c.statsblock) }]))
    return (name: string) => byItem.get(itemKey(name))
  }, [byKey])
  const fociOf = useMemo(
    () => (item: InvItem) => itemFoci(item, (name) => byKey.get(itemKey(name))?.focus),
    [byKey]
  )
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
        const fx = itemEffects(item, effectsOfItem)
        return {
          r: c ? restrictions(c.statsblock) : null, stats, foci: fociOf(item).map((f) => f.name), worn: fx.worn.map((f) => f.name), procs: fx.procs.map((f) => f.name),
          lore: c ? isLore(c.statsblock) : true
        }
      }, petItems),
    [inv, byKey, view.items, fociOf, petItems, effectsOfItem]
  )
  // Exaltations kept in Storage › Exaltations that bring a focus and the character may use, with what
  // the item each was made from allows: the slot kind it goes in, and its classes, race and level.
  const storedExaltations = useMemo<Exaltation[]>(
    () =>
      inv.keyRing.flatMap((k): Exaltation[] => {
        if (k.kind !== 'Augmentation') return []
        const c = byKey.get(itemKey(k.name))
        const fx = effectsOfItem(k.name)
        if (!c || !(c.focus || fx?.worn || fx?.proc)) return []
        const item = { location: 'Storage', name: k.name, id: k.id, count: 1, augs: [] }
        return [{ item, from: 'storage', focus: c.focus, worn: fx?.worn ?? '', proc: fx?.proc ?? '', r: restrictions(c.statsblock) }]
      }),
    [inv, byKey, effectsOfItem]
  )
  const exaltations = useMemo(() => storedExaltations.filter((e) => canWear(e.r, wearer, ANY_SLOT)), [storedExaltations, wearer])
  // An item's era group, as the era buttons name them, and whether those buttons hide it.
  const eraHidden = useMemo(() => {
    const hidden = new Set(shownEras)
    return (c: CatalogItem) => hidden.has(eraOf(c, zones, eraStatus).era)
  }, [shownEras, zones, eraStatus])
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

  // Worn effects and procs: every one the catalog names, what its spell does, and the character's own
  // melee over the same days as the focus effects, to weigh them against.
  const effectNames = useMemo(() => {
    const out = new Set<string>()
    for (const it of items ?? []) {
      const fx = effectsOfItem(it.title)
      if (fx?.worn) out.add(fx.worn)
      if (fx?.proc) out.add(fx.proc)
    }
    return [...out].sort()
  }, [items, effectsOfItem])
  const effectsQ = useInvoke(
    effectNames.length && view.character ? 'gear:effects' : null,
    [effectNames, view.character, days]
  )
  const dex = sheetStats.window?.values.Dexterity?.[0] ?? (sheetStats.dexterity || 150)
  const effects = useMemo<GearEffects>(() => {
    const data = effectsQ.data
    const profile = data?.profile ?? null
    const spells = data?.spells ?? {}
    const carriers = new Map<string, number>()
    for (const p of pieces) if (p.from === 'worn' && HANDS.includes(p.item.location)) for (const n of p.procs ?? []) carriers.set(n, (carriers.get(n) ?? 0) + 1)
    // With no melee in the log, what an effect does is still shown and its stats still count.
    const melee = profile ?? NO_MELEE
    const wornWorthOf = (name: string) => (spells[name] ? wornWorth(spells[name], melee, level) : null)
    const procWorthOf = (name: string) => (spells[name] ? procWorth(spells[name], melee, { level, dex, carriers: carriers.get(name) ?? 1 }) : null)
    // Stats a worn effect gives are priced as on an item: set-wide, so no weapon ratio or haste.
    const statWeights = { ...weights, ratio: 0, rangedRatio: 0, haste: 0 }
    const wornStatScore = (name: string) => (spells[name] ? score(wornStats(spells[name], level), statWeights) : 0)
    const wornScore = (name: string) => effectScore(wornWorthOf(name)?.dpm ?? 0, melee, weights.ratio) + wornStatScore(name)
    const procScore = (name: string) => effectScore(procWorthOf(name)?.dpm ?? 0, melee, weights.ratio)
    const value: EffectValue | null = data ? { worn: (names) => names.reduce((s, n) => s + wornScore(n), 0), proc: procScore } : null
    return { profile, spells, value, wornWorth: wornWorthOf, procWorth: procWorthOf, wornScore, wornStatScore, procScore, carriers, dex, loading: !data }
  }, [effectsQ.data, pieces, level, dex, weights])

  // The finder scores the whole catalog (about 11,000 pieces) against every slot. Its inputs go
  // through a deferred value, so a weight being typed or a button being pressed answers at once and
  // the results catch up in the background.
  // The optimizer's all-gear mode: pieces the character does not own that one of their classes may
  // wear, from the eras shown. As the finder has them: as they drop (+0), or at the merge level of
  // what is worn in the slot (the lower of a pair), one piece a level. Each slot keeps its best dozen
  // by stats, focus and effects; the search picks among those and what is owned.
  const catalogPieces = useMemo<Piece[]>(() => {
    if (mode !== 'optimize' || !items) return []
    const hidden = new Set(shownEras)
    const best = new Map<string, { p: Piece; v: number }[]>()
    const slotLevel = new Map<string, number>()
    if (compare === 'level')
      for (const s of SLOT_NAMES) {
        const levels = inv.worn.filter((w) => w.location === s).map((w) => mergeLevel(w.name))
        slotLevel.set(s, levels.length ? Math.min(...levels) : 0)
      }
    for (const c of items) {
      const key = itemKey(c.title)
      if (owned.has(key) || /^Summoned:/i.test(c.title)) continue
      if (hidden.has(eraOf(c, zones, eraStatus).era)) continue
      const r = restrictions(c.statsblock)
      const slots = SLOT_NAMES.filter((s) => canWear(r, wearer, s) && !(s === 'Primary' && isTwoHanded(r) && !twoHanders))
      if (!slots.length) continue
      const fx = effectsOfItem(c.title)
      const base = parseStatsBlock(c.statsblock)
      const atLevel = new Map<number, Piece>()
      const pieceAt = (level: number): Piece => {
        let p = atLevel.get(level)
        if (!p) {
          const name = level ? `${c.title} +${level}` : c.title
          atLevel.set(level, (p = {
            item: { location: 'Catalog', name, id: 0, count: 1, augs: [] }, from: 'catalog', key, r, stats: level ? scaledStats(base, level) : base,
            foci: c.focus ? [c.focus] : [], worn: fx?.worn ? [fx.worn] : [], procs: fx?.proc ? [fx.proc] : [], lore: isLore(c.statsblock)
          }))
        }
        return p
      }
      const extra = (c.focus ? valueOf([c.focus]) : 0) + (effects.value && fx?.worn ? effects.value.worn([fx.worn]) : 0)
      for (const s of slots) {
        const p = pieceAt(slotLevel.get(s) ?? 0)
        const proc = effects.value && fx?.proc && HANDS.includes(s) ? effects.value.proc(fx.proc) : 0
        const v = score(p.stats!, weightsForSlot(weights, s, weaponHands)) + extra + proc
        const list = best.get(s) ?? []
        list.push({ p, v })
        best.set(s, list)
      }
    }
    const keep = new Set<Piece>()
    for (const list of best.values()) for (const { p } of list.sort((a, b) => b.v - a.v).slice(0, CATALOG_PER_SLOT)) keep.add(p)
    return [...keep]
  }, [mode, items, shownEras, owned, zones, eraStatus, wearer, twoHanders, effectsOfItem, valueOf, effects.value, weights, compare, inv, weaponHands])

  const input = useMemo(
    () => ({ items, wearer, weights, compare, hiddenEras, inv, viewItems: view.items, owned, twoHanders, worth, fociOf, valueOf, eraStatus, pieces, exaltations, judge, effects, effectsOfItem, hands: weaponHands }),
    [items, wearer, weights, compare, hiddenEras, inv, view.items, owned, twoHanders, worth, fociOf, valueOf, eraStatus, pieces, exaltations, judge, effects, effectsOfItem, weaponHands]
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
      ownedStats: (key) => bestOwned(d.pieces, key)?.stats ?? null,
      hands: d.hands,
      focus: d.worth ? { worn: (it) => d.fociOf(it).map((f) => f.name), value: d.valueOf } : undefined,
      effects: d.effects.value
        ? {
            of: (it) => {
              const fx = itemEffects(it, d.effectsOfItem)
              return { worn: fx.worn.map((f) => f.name), procs: fx.procs.map((f) => f.name) }
            },
            value: d.effects.value
          }
        : undefined,
      // In the round, the stat winners a focus loss would hide get their chance: the optimizer may keep the focus elsewhere.
      perSlot: round ? 8 : 6,
      keepStatWinners: round
    })
    if (!round) return slots
    // Each candidate among everything owned, worn as well as it can be; its worth is what the set gains.
    const opts = { pieces: d.pieces, wearer: d.wearer, weights: d.weights, twoHanders: d.twoHanders, focusValue: d.valueOf, exaltations: d.exaltations, effects: d.effects.value ?? undefined, hands: d.hands }
    const baseline = optimizeGear(opts)
    return slots.map((s) => {
      const judged = s.candidates.map((c) => {
        // One the character owns is already among the pieces: judged as their own copy, as the optimizer does.
        const key = itemKey(c.item.title)
        const mine = !!bestOwned(d.pieces, key)
        const r = mine ? ownedInTheRound({ ...opts, key, baseline }) : inTheRound({ ...opts, candidate: candidatePiece(c.item, c.stats), baseline })
        // One the best set wears just where it is worn now is no upgrade, and one it wears in another
        // slot is that slot's.
        const stays =
          mine && (r.placed !== s.slot || baseline.after.some((p, i) => p?.key === key && p.from === 'worn' && !p.exalt && baseline.slots[i] === p.item.location))
        return {
          ...c,
          round: {
            delta: stays ? 0 : r.delta, placed: r.placed, owned: mine,
            moves: r.moves.map((m) => ({ slot: m.slot, out: m.out ? pieceName(m.out) : null, in: m.in ? pieceName(m.in) : null }))
          }
        }
      })
      // The best thing to have first, as the optimizer's all-gear mode would choose it: a piece to get
      // gains over the best set of what is owned, which already has the owned candidates in it, so
      // those rank after any piece to get that beats that set (their own gain still shows).
      const rank = (c: (typeof judged)[number]) => (c.round.owned ? 0 : c.round.delta)
      return { ...s, candidates: judged.filter((c) => c.round.delta > 0).sort((a, b) => rank(b) - rank(a) || b.round.delta - a.round.delta).slice(0, 6) }
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
        catalog: items ?? state.file.items,
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
        catalogPieces,
        compare,
        hands,
        weaponHands,
        effects,
        effectsOfItem,
        storedExaltations,
        eraHidden,
        exaltations,
        pet,
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
    hands,
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
    controls: { ratioFirst, setRatioFirst, preset, setPreset, custom, setCustom, twoHandMode, setTwoHandMode, compare, setCompare, hiddenEras, setHiddenEras, slot, setSlot, capMode, setCapMode, judge, setJudge }
  }
}
