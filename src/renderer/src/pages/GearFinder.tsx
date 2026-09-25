import { useEffect, useMemo, useState } from 'react'
import { api, ago } from '../api'
import { useRemembered } from '../remember'
import { itemKey, mergeLevel, parseStatsBlock, scaledStats, slotLabel, type InvItem } from '../../../core/inventory'
import {
  ANY_SLOT,
  canWear,
  DEFAULT_HIDDEN_ERAS,
  ERA_ORDER,
  eraOf,
  findUpgrades,
  isLore,
  OTHER_ERA,
  OTHER_OUT_ERA,
  restrictions,
  zoneEras,
  type Wearer,
  type Weights
} from '../../../core/upgrades'
import { conversions, rawWeights, ROLE_LABELS, ROLE_PRESETS, type ClassFactors, type RoleKey, type RoleWeights } from '../../../core/statValue'
import { focusValue, type FocusLine, type FocusReport, type FocusWorth } from '../../../core/itemFocus'
import { ownedPieces, type Piece, type PieceSource } from '../../../core/gearOptimizer'
import { aaTotal } from '../../../core/aa'
import { CATALOG_FORMAT, type CatalogItem } from '../../../core/wikiItem'
import type { CharacterSheet, InventoryView } from '../../../shared/types'
import { className } from '../../../core/acModel'
import { statsFor, wornSummary } from './Gear'
import { characterAc } from './Stats'
import { readSheet } from '../statsSheet'
import { Icon, num, source, wikiUrl } from './gearBits'
import { FocusTab, OptimizeTab } from './GearFocus'

/** AC past the soft cap is worth a quarter of AC under it, in every weighting. */
const AC_OVER_CAP = 0.25
/** What a wanted focus effect is worth at the best rank there is, in score points, to start with. */
const DEFAULT_FOCUS_POINTS = 300

interface CatalogState {
  file: { fetchedAt: number; items: CatalogItem[]; eraStatus?: Record<string, 'in' | 'out'>; format?: number } | null
  stale: boolean
  progress: { busy: boolean; pages: number; total: number; error: string }
}

export type GearMode = 'finder' | 'focus' | 'optimize'

function useCatalog() {
  const [state, setState] = useState<CatalogState | null>(null)
  useEffect(() => {
    void api.invoke<CatalogState>('gear:catalog').then(setState)
    return api.on('state:catalog', (progress: CatalogState['progress']) => {
      setState((s) => (s ? { ...s, progress } : s))
      // A download finished, whoever started it: show what it stored.
      if (!progress.busy) void api.invoke<CatalogState>('gear:catalog').then(setState)
    })
  }, [])
  const refresh = async () => {
    await api.invoke<CatalogState>('gear:catalogRefresh')
    // Read what is stored now, rather than trust a reply that another refresh may have overtaken.
    setState(await api.invoke<CatalogState>('gear:catalog'))
  }
  // A catalog stored by an older build lacks what this one reads; fetch it again once, on its own.
  const [autoRefreshed, setAutoRefreshed] = useState(false)
  useEffect(() => {
    if (state?.file && (state.file.format ?? 1) < CATALOG_FORMAT && !state.progress.busy && !autoRefreshed) {
      setAutoRefreshed(true)
      void refresh()
    }
  }, [state?.file, autoRefreshed])
  return { state, refresh }
}

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
  report: FocusReport | null
  /** Lines that improve at least one of the character's spells. */
  lines: FocusLine[]
  /** Lines that improve none of them. */
  idleLines: FocusLine[]
  wanted: Set<string>
  setWanted: (keys: string[], on: boolean) => void
  resetWanted: () => void
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

export function GearFinder({ view, sheet, mode }: { view: InventoryView; sheet: CharacterSheet | null; mode: GearMode }) {
  const { state, refresh } = useCatalog()
  const [preset, setPreset] = useRemembered<string>('finder.preset', 'Balanced')
  const [custom, setCustom] = useRemembered<RoleWeights>('finder.roleWeights', ROLE_PRESETS.Balanced)
  const [twoHandMode, setTwoHandMode] = useRemembered<'auto' | 'one' | 'any'>('finder.twoHand', 'auto')
  const [compare, setCompare] = useRemembered<'drop' | 'level'>('finder.compare', 'drop')
  const [hiddenEras, setHiddenEras] = useRemembered<string[]>('finder.hiddenEras.v3', DEFAULT_HIDDEN_ERAS)
  const [slot, setSlot] = useRemembered<string>('finder.slot', 'all')
  const [showWeights, setShowWeights] = useState(false)
  const [capMode, setCapMode] = useRemembered<'auto' | 'over' | 'under'>('finder.acCap', 'auto')
  const [points, setPoints] = useRemembered<number>('finder.focusPoints', DEFAULT_FOCUS_POINTS)
  const [focusOff, setFocusOff] = useRemembered<string[] | null>(`focus.off.${view.character}`, null)
  const sheetStats = useMemo(() => readSheet(sheet?.stats), [sheet])
  const [acCaps, setAcCaps] = useState<Record<string, { cap: number; mult: number }> | null>(null)
  const [factors, setFactors] = useState<Record<string, ClassFactors>>({})
  useEffect(() => {
    const trio = sheetStats.classes.filter(Boolean)
    if (!trio.length) return
    void api
      .invoke<{ ac: Record<string, { cap: number; mult: number }>; factors: Record<string, ClassFactors> }>('stats:caps', trio, sheetStats.level)
      .then((r) => {
        setAcCaps(r.ac)
        setFactors(r.factors ?? {})
      })
  }, [sheetStats.classes.join(','), sheetStats.level])

  const stats = (sheet?.stats ?? {}) as { classes?: string[]; level?: number; race?: string }
  const classes = (stats.classes ?? []).filter(Boolean)
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
  const wearer = useMemo<Wearer>(() => ({ classes, race: stats.race === 'iksar' ? 'IKS' : '', level }), [classes.join(','), stats.race, level])

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
  const [report, setReport] = useState<FocusReport | null>(null)
  useEffect(() => {
    if (!items || !classes.length) return
    const names = [...new Set(items.map((it) => it.focus).filter(Boolean))]
    void api.invoke<FocusReport | null>('gear:foci', names, classes, level).then(setReport)
  }, [items, classes.join(','), level])
  const lines = useMemo(() => (report?.lines ?? []).filter((l) => l.spells > 0), [report])
  const idleLines = useMemo(() => (report?.lines ?? []).filter((l) => l.spells === 0), [report])
  // Wanted unless turned off. Out of the box that is every line but reagents: Legends' spell file
  // lists no reagents, so there is no telling which spells use one.
  const off = useMemo(() => focusOff ?? lines.filter((l) => l.kind === 'reagent').map((l) => l.key), [focusOff, lines])
  const wanted = useMemo(() => new Set(lines.map((l) => l.key).filter((k) => !off.includes(k))), [lines, off])
  const setWanted = (keys: string[], on: boolean) => setFocusOff(on ? off.filter((k) => !keys.includes(k)) : [...new Set([...off, ...keys])])

  const available = useMemo(() => {
    const out = new Map<string, FocusCandidate[]>()
    if (!report || !items) return out
    const hidden = new Set(hiddenEras)
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
  }, [report, items, hiddenEras, zones, eraStatus, wearer, owned])

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
  const worth = useMemo<FocusWorth | null>(() => {
    if (!report) return null
    const best = new Map<string, number>()
    for (const l of lines) best.set(l.key, Math.max(available.get(l.key)?.[0]?.eff ?? 0, ownedFoci.get(l.key)?.[0]?.eff ?? 0))
    return { points, wanted, best, foci: report.foci }
  }, [report, lines, available, ownedFoci, points, wanted])
  const valueOf = useMemo(() => (names: string[]) => (worth ? focusValue(worth, names) : 0), [worth])

  const results = useMemo(() => {
    if (!items || !classes.length || mode !== 'finder') return null
    return findUpgrades({
      worn: inv.worn,
      statsOf: (it) => statsFor(view.items, it.name),
      catalog: items,
      wearer,
      weights,
      compare,
      hiddenEras,
      eraStatus,
      twoHanders,
      owned,
      focus: worth ? { worn: (it) => fociOf(it).map((f) => f.name), value: valueOf } : undefined
    })
  }, [items, wearer, weights, compare, hiddenEras, inv, view.items, owned, twoHanders, worth, fociOf, valueOf, mode])

  if (!state) return <div className="empty">Loading…</div>
  const p = state.progress

  if (!state.file) {
    return (
      <div className="card stack lt-finder-intro" style={{ gap: 12 }}>
        <h2 style={{ margin: 0 }}>Item catalog</h2>
        <p className="muted" style={{ margin: 0 }}>
          The upgrade finder, the focus effects and the optimizer read every piece of equipment on eqlwiki.com: what your classes, race and level can use, and what focus
          effects it carries. That needs the wiki's item catalog first: about a minute to download, once a week, kept on this PC.
        </p>
        {p.busy ? (
          <Progress p={p} />
        ) : (
          <div className="row">
            <button className="btn primary" onClick={() => void refresh()}>
              Download the item catalog
            </button>
            {p.error && <span className="small" style={{ color: 'var(--red)' }}>Could not download it: {p.error}</span>}
          </div>
        )}
      </div>
    )
  }

  const model: GearModel = {
    view,
    classes,
    level,
    wearer,
    weights,
    twoHanders,
    catalog: state.file.items,
    fociOf,
    report,
    lines,
    idleLines,
    wanted,
    setWanted,
    resetWanted: () => setFocusOff(null),
    points,
    setPoints,
    available,
    ownedFoci,
    pieces,
    worth,
    focusValue: valueOf
  }

  const shown = (results ?? []).filter((r) => slot === 'all' || r.slot === slot)
  const withUpgrades = shown.filter((r) => r.candidates.length)
  const none = shown.filter((r) => !r.candidates.length && r.current)
  const scoring = mode !== 'focus'

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card stack" style={{ gap: 12 }}>
        {scoring && (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <b>Weigh stats for</b>
            <span className="lt-seg">
              {[...Object.keys(ROLE_PRESETS), 'Custom'].map((name) => (
                <button key={name} className={preset === name ? 'on' : ''} onClick={() => setPreset(name)}>
                  {name}
                </button>
              ))}
            </span>
            <button className="btn ghost small" onClick={() => setShowWeights(!showWeights)}>
              {showWeights ? 'Hide weights' : 'Show weights'}
            </button>
            <span className="grow" />
            {mode === 'finder' && (
              <>
                <b>Compare</b>
                <span className="lt-seg">
                  <button className={compare === 'drop' ? 'on' : ''} onClick={() => setCompare('drop')} title="Candidates as they drop, at +0, against your gear at its merge level">
                    As they drop
                  </button>
                  <button className={compare === 'level' ? 'on' : ''} onClick={() => setCompare('level')} title="Candidates merged to the same level as the item they would replace">
                    At your merge level
                  </button>
                </span>
              </>
            )}
          </div>
        )}
        {mode !== 'optimize' && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <b>Eras</b>
            {eraCounts.map(([era, n]) => {
              const on = !hiddenEras.includes(era)
              return (
                <button
                  key={era}
                  className={`lt-era${on ? ' on' : ''}`}
                  title={
                    era === OTHER_ERA
                      ? 'No era on the wiki page and no drop zone to tell by: quested, crafted and vendor items mostly'
                      : era === OTHER_OUT_ERA
                        ? 'Out of era on the wiki, in no expansion named here: FearHateRevamp, HoleVP, WarrensFearHateRevamp and Unknown Era pages'
                        : era === 'Classic'
                          ? "Everything the wiki counts as in era for EverQuest Legends: Classic, and Legends' live zones (Fear, Hate, Hole, Sky, Temple, Warrens, Paineel, Stonebrunt)"
                          : `${era}: out of era on EverQuest Legends`
                  }
                  onClick={() => setHiddenEras(on ? [...hiddenEras, era] : hiddenEras.filter((e) => e !== era))}
                >
                  {era} <small>{num(n)}</small>
                </button>
              )
            })}
            <button className="btn ghost small" onClick={() => setHiddenEras(DEFAULT_HIDDEN_ERAS)}>
              Live eras only
            </button>
          </div>
        )}
        {scoring && (
          <>
            <div className="row small" style={{ gap: 10, flexWrap: 'wrap' }}>
              <b>AC soft cap</b>
              <span className="lt-seg">
                {(
                  [
                    ['auto', acState ? `Auto: ${acState.over ? 'over' : 'under'}` : 'Auto'],
                    ['over', 'Over'],
                    ['under', 'Under']
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} className={capMode === m ? 'on' : ''} onClick={() => setCapMode(m)}>
                    {label}
                  </button>
                ))}
              </span>
              <span className="muted">
                {overCap
                  ? `AC counts at ${AC_OVER_CAP * 100}% of its weight: past the soft cap most of it is lost.`
                  : 'AC counts in full: you are under the soft cap.'}
                {acState && capMode === 'auto' && ` Mitigation ${num(acState.mitigation)} against a soft cap of ${num(acState.cap)}, from ${acState.from}.`}
              </span>
            </div>
            <div className="row small" style={{ gap: 10, flexWrap: 'wrap' }}>
              <b>Primary</b>
              <span className="lt-seg">
                {(
                  [
                    ['auto', `Auto: ${secondaryInUse ? 'one-handed' : 'any'}`],
                    ['one', 'One-handed'],
                    ['any', 'Include two-handed']
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} className={twoHandMode === m ? 'on' : ''} onClick={() => setTwoHandMode(m)}>
                    {label}
                  </button>
                ))}
              </span>
              <span className="muted">
                {twoHanders ? 'Two-handed weapons are suggested for Primary.' : 'Two-handed weapons are left out: your secondary hand is in use.'}
              </span>
            </div>
            <FocusPoints points={points} setPoints={setPoints} wanted={wanted.size} lines={lines.length} />
            <div className="small muted lt-worth">
              <b>What a point is worth to you:</b> {conv.notes.join(' · ')}
              {conv.offensePerStr ? ' · STR adds ⅔ Offense' : ''} · AGI adds {conv.avoidancePerAgi.toFixed(2)} avoidance · DEX only helps procs (it does not move crit on Legends)
            </div>
            {showWeights && (
              <div className="lt-weights">
                {(Object.keys(ROLE_LABELS) as RoleKey[]).map((k) => (
                  <label key={k} className="lt-weight">
                    <span>{ROLE_LABELS[k]}</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={role[k]}
                      title={k === 'ac' && overCap ? `Counts as ${Math.round(role.ac * AC_OVER_CAP * 100) / 100} while over the soft cap` : undefined}
                      onChange={(e) => {
                        setCustom({ ...role, [k]: Math.max(0, Number(e.target.value) || 0) })
                        setPreset('Custom')
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        <div className="row small muted" style={{ gap: 14, flexWrap: 'wrap' }}>
          <span>
            For{' '}
            <b>
              {classes.length ? classes.map(className).join(' / ') : 'no classes set'}, level {level}
              {stats.race === 'iksar' ? ', Iksar' : ''}
            </b>{' '}
            (from the Stats page)
          </span>
          {mode === 'finder' && (
            <select value={slot} onChange={(e) => setSlot(e.target.value)}>
              <option value="all">Every slot</option>
              {(results ?? []).map((r) => (
                <option key={r.slot} value={r.slot}>
                  {slotLabel(r.slot)}
                </option>
              ))}
            </select>
          )}
          <span className="grow" />
          <span className="faint">
            {num(state.file.items.length)} pieces from eqlwiki, fetched {ago(state.file.fetchedAt)}
          </span>
          {p.busy ? (
            <Progress p={p} small />
          ) : (
            <button className="btn ghost small" onClick={() => void refresh()}>
              Refresh
            </button>
          )}
        </div>
      </div>

      {!classes.length ? (
        <div className="card empty">Set your classes and level on the Stats page, and these tools will know what you can wear.</div>
      ) : mode === 'focus' ? (
        <FocusTab m={model} />
      ) : mode === 'optimize' ? (
        <OptimizeTab m={model} />
      ) : (
        <>
          <div className="lt-finder">
            {withUpgrades.map((r) => (
              <div key={r.slot} className="card lt-finder-slot">
                <div className="lt-finder-head">
                  <span className="lt-slot">{slotLabel(r.slot)}</span>
                  {r.current ? (
                    <span className="small muted">
                      replaces <b>{r.current.item.name}</b> · score {num(r.current.score)}
                      {r.current.focusLoss > 0 && (
                        <span title="What its focus effects add, by your focus weighting: a candidate without them has to make up for it">
                          {' '}
                          + {num(r.current.focusLoss)} focus ({fociOf(r.current.item).map((f) => f.name).join(', ')})
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="small muted">empty slot</span>
                  )}
                </div>
                {r.candidates.map((c) => (
                  <div key={c.item.title} className="lt-cand">
                    <Icon icon={c.item.icon} />
                    <div className="lt-cand-body">
                      <div className="row tight" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <a className="lt-cand-name" href={wikiUrl(c.item.title)} target="_blank" rel="noreferrer">
                          {c.item.title}
                        </a>
                        {c.owned && <span className="lt-chip gold">you have one</span>}
                        <span className="lt-chip" title={c.eraInferred ? 'Worked out from the zones it drops in; the wiki page has no era' : undefined}>
                          {c.era}
                          {c.eraInferred ? ' · by zone' : ''}
                        </span>
                        {c.focus && (
                          <span
                            className={`lt-chip ${c.focus.gain > 0 ? 'focus' : ''}`}
                            title={c.focus.gain > 0 ? `Adds ${num(c.focus.gain)} to your focus effects` : 'A focus you already have as good, or one you do not want'}
                          >
                            {c.focus.name}
                          </span>
                        )}
                      </div>
                      <div className="lt-diffs">
                        {c.diffs.slice(0, 7).map((d) => (
                          <span key={d.key} className={d.delta > 0 ? 'up' : 'down'}>
                            {d.delta > 0 ? '+' : ''}
                            {Number.isInteger(d.delta) ? d.delta : d.delta.toFixed(2)} {d.label}
                          </span>
                        ))}
                      </div>
                      <div className="faint small">{source(c.item)}</div>
                    </div>
                    <span className="lt-gain" title="How much higher it scores than what you wear, by your weights, focus effects included">
                      +{num(c.delta)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {!withUpgrades.length && <div className="card empty">Nothing on the wiki beats what you wear{slot !== 'all' ? ' there' : ''}, by these weights.</div>}
          {none.length > 0 && (
            <p className="small muted">
              Nothing beats what you wear in: <b>{none.map((r) => slotLabel(r.slot)).join(', ')}</b>.
            </p>
          )}
          <p className="faint small">
            Weights are on outcomes (HP, mana, AC, avoidance, Offense, haste…); a raw stat counts for what it buys you, worked out from your classes, level, current stats
            and AAs, the same formulas the Stats page checks against the game. Focus effects you want (Focus effects tab) count too: a candidate that brings a better one
            gains, and replacing an item loses what its focus and exaltations gave. Your two Any slots take any piece of gear. Scores only rank items against each other. The
            wiki holds base stats, so a candidate "as it drops" is at +0 while your gear counts at its merge level; switch to "At your merge level" to compare like with like.
            In era and out of era follow eqlwiki's own list; an item with no era on its page takes the era of the zones it drops in. Item data from eqlwiki.com.
          </p>
        </>
      )}
    </div>
  )
}

function FocusPoints({ points, setPoints, wanted, lines }: { points: number; setPoints: (n: number) => void; wanted: number; lines: number }) {
  return (
    <div className="row small" style={{ gap: 10, flexWrap: 'wrap' }}>
      <b>Focus effects</b>
      <label className="row tight" style={{ gap: 6 }}>
        each worth
        <input type="number" min={0} step={25} value={points} style={{ width: 72 }} onChange={(e) => setPoints(Math.max(0, Number(e.target.value) || 0))} />
        points
      </label>
      <span className="muted">
        at the best rank there is; less for a lower rank. {wanted} of the {lines} that help your spells are wanted (Focus effects tab).
      </span>
    </div>
  )
}

function Progress({ p, small }: { p: CatalogState['progress']; small?: boolean }) {
  const pctDone = p.total ? Math.min(100, Math.round((p.pages / p.total) * 100)) : 0
  return (
    <div className={`row ${small ? 'small' : ''}`} style={{ gap: 10, minWidth: small ? 220 : 360 }}>
      <span className="lt-mergebar grow">
        <i style={{ width: `${pctDone}%` }} />
      </span>
      <span className="muted nowrap">
        {num(p.pages)} of {num(p.total || 11000)} pages
      </span>
    </div>
  )
}
