import { useEffect, useMemo, useState } from 'react'
import { api, ago } from '../api'
import { useRemembered } from '../remember'
import { itemKey, slotLabel } from '../../../core/inventory'
import { DEFAULT_HIDDEN_ERAS, ERA_ORDER, eraOf, findUpgrades, OTHER_ERA, OTHER_OUT_ERA, zoneEras } from '../../../core/upgrades'
import { conversions, rawWeights, ROLE_LABELS, ROLE_PRESETS, type ClassFactors, type RoleKey, type RoleWeights } from '../../../core/statValue'
import { aaTotal } from '../../../core/aa'
import type { CatalogItem } from '../../../core/wikiItem'
import type { CharacterSheet, InventoryView } from '../../../shared/types'
import { className } from '../../../core/acModel'
import { statsFor, wornSummary } from './Gear'
import { characterAc } from './Stats'
import { readSheet } from '../statsSheet'

/** AC past the soft cap is worth a quarter of AC under it, in every weighting. */
const AC_OVER_CAP = 0.25

interface CatalogState {
  file: { fetchedAt: number; items: CatalogItem[]; eraStatus?: Record<string, 'in' | 'out'>; format?: number } | null
  stale: boolean
  progress: { busy: boolean; pages: number; total: number; error: string }
}

const num = (n: number) => Math.round(n).toLocaleString()
const itemIconUrl = (icon?: number) => (icon && icon >= 500 ? `eqicon://item/${icon}` : '')
const wikiUrl = (title: string) => `https://eqlwiki.com/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}`

function Icon({ icon, size = 34 }: { icon?: number; size?: number }) {
  const [ok, setOk] = useState(true)
  const src = itemIconUrl(icon)
  if (!src || !ok) return <span className="lt-icon blank" style={{ width: size, height: size }} />
  return <img className="lt-icon" src={src} width={size} height={size} alt="" onError={() => setOk(false)} />
}

function useCatalog() {
  const [state, setState] = useState<CatalogState | null>(null)
  useEffect(() => {
    void api.invoke<CatalogState>('gear:catalog').then(setState)
    return api.on('state:catalog', (progress: CatalogState['progress']) => setState((s) => (s ? { ...s, progress } : s)))
  }, [])
  const refresh = async () => {
    await api.invoke<CatalogState>('gear:catalogRefresh')
    // Read what is stored now, rather than trust a reply that another refresh may have overtaken.
    setState(await api.invoke<CatalogState>('gear:catalog'))
  }
  // A catalog stored by an older build lacks what this one reads; fetch it again once, on its own.
  const [autoRefreshed, setAutoRefreshed] = useState(false)
  useEffect(() => {
    if (state?.file && (state.file.format ?? 1) < 2 && !state.progress.busy && !autoRefreshed) {
      setAutoRefreshed(true)
      void refresh()
    }
  }, [state?.file, autoRefreshed])
  return { state, refresh }
}

/** Where an item comes from, in a few words: the zone and who drops it, or quest / crafted. */
function source(item: CatalogItem): string {
  const parts: string[] = []
  if (item.zones.length) parts.push(item.zones.slice(0, 2).join(', ') + (item.mobs.length ? ` · ${item.mobs.slice(0, 2).join(', ')}` : ''))
  else if (item.mobs.length) parts.push(item.mobs.slice(0, 2).join(', '))
  if (item.quest) parts.push('quest')
  if (item.crafted) parts.push('crafted')
  return parts.join(' · ') || 'source not listed'
}

export function GearFinder({ view, sheet }: { view: InventoryView; sheet: CharacterSheet | null }) {
  const { state, refresh } = useCatalog()
  const [preset, setPreset] = useRemembered<string>('finder.preset', 'Balanced')
  const [custom, setCustom] = useRemembered<RoleWeights>('finder.roleWeights', ROLE_PRESETS.Balanced)
  const [twoHandMode, setTwoHandMode] = useRemembered<'auto' | 'one' | 'any'>('finder.twoHand', 'auto')
  const [compare, setCompare] = useRemembered<'drop' | 'level'>('finder.compare', 'drop')
  const [hiddenEras, setHiddenEras] = useRemembered<string[]>('finder.hiddenEras.v3', DEFAULT_HIDDEN_ERAS)
  const [slot, setSlot] = useRemembered<string>('finder.slot', 'all')
  const [showWeights, setShowWeights] = useState(false)
  const [capMode, setCapMode] = useRemembered<'auto' | 'over' | 'under'>('finder.acCap', 'auto')
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

  // Every era in the catalog with how many pieces it holds, tagged or worked out from drop zones.
  const eraCounts = useMemo(() => {
    const items = state?.file?.items ?? []
    const status = state?.file?.eraStatus
    const zones = zoneEras(items, status)
    const counts = new Map<string, number>(ERA_ORDER.map((e) => [e, 0]))
    for (const it of items) {
      const { era } = eraOf(it, zones, status)
      counts.set(era, (counts.get(era) ?? 0) + 1)
    }
    return [...counts]
  }, [state?.file])

  const results = useMemo(() => {
    if (!state?.file || !classes.length) return null
    return findUpgrades({
      worn: inv.worn,
      statsOf: (it) => statsFor(view.items, it.name),
      catalog: state.file.items,
      wearer: { classes, race: stats.race === 'iksar' ? 'IKS' : '', level: stats.level ?? 50 },
      weights,
      compare,
      hiddenEras,
      eraStatus: state.file.eraStatus,
      twoHanders,
      owned
    })
  }, [state?.file, classes.join(','), stats.level, stats.race, weights, compare, hiddenEras, inv, view.items, owned, twoHanders])

  if (!state) return <div className="empty">Loading…</div>
  const p = state.progress

  if (!state.file) {
    return (
      <div className="card stack lt-finder-intro" style={{ gap: 12 }}>
        <h2 style={{ margin: 0 }}>Find upgrades</h2>
        <p className="muted" style={{ margin: 0 }}>
          The finder compares what you wear against every piece of equipment on eqlwiki.com that your classes, race and level can use. It needs the wiki's item catalog
          first: about a minute to download, once a week, kept on this PC.
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

  const shown = (results ?? []).filter((r) => slot === 'all' || r.slot === slot)
  const withUpgrades = shown.filter((r) => r.candidates.length)
  const none = shown.filter((r) => !r.candidates.length && r.current)

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card stack" style={{ gap: 12 }}>
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
          <b>Compare</b>
          <span className="lt-seg">
            <button className={compare === 'drop' ? 'on' : ''} onClick={() => setCompare('drop')} title="Candidates as they drop, at +0, against your gear at its merge level">
              As they drop
            </button>
            <button className={compare === 'level' ? 'on' : ''} onClick={() => setCompare('level')} title="Candidates merged to the same level as the item they would replace">
              At your merge level
            </button>
          </span>
        </div>
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
        <div className="row small muted" style={{ gap: 14, flexWrap: 'wrap' }}>
          <span>
            For{' '}
            <b>
              {classes.length ? classes.map(className).join(' / ') : 'no classes set'}, level {stats.level ?? 50}
              {stats.race === 'iksar' ? ', Iksar' : ''}
            </b>{' '}
            (from the Stats page)
          </span>
          <select value={slot} onChange={(e) => setSlot(e.target.value)}>
            <option value="all">Every slot</option>
            {(results ?? []).map((r) => (
              <option key={r.slot} value={r.slot}>
                {slotLabel(r.slot)}
              </option>
            ))}
          </select>
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
        <div className="card empty">Set your classes and level on the Stats page, and the finder will know what you can wear.</div>
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
                    <span className="lt-gain" title="How much higher it scores than what you wear, by your weights">
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
            Weights are on outcomes (HP, mana, AC, avoidance, Offense, haste…); a raw stat counts for what it buys you, worked out from your classes, level,
            current stats and AAs, the same formulas the Stats page checks against the game. Scores only rank items against each other. The wiki holds base stats, so a candidate "as it drops" is at +0 while
            your gear counts at its merge level; switch to "At your merge level" to compare like with like. Weapon ratio (damage ÷ delay) only counts when you give it a
            weight. In era and out of era follow eqlwiki's own list; an item with no era on its page takes the era of the zones it drops in, learned from the tagged
            items there. Item data from eqlwiki.com.
          </p>
        </>
      )}
    </div>
  )
}

function Progress({ p, small }: { p: CatalogState['progress']; small?: boolean }) {
  const pct = p.total ? Math.min(100, Math.round((p.pages / p.total) * 100)) : 0
  return (
    <div className={`row ${small ? 'small' : ''}`} style={{ gap: 10, minWidth: small ? 220 : 360 }}>
      <span className="lt-mergebar grow">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="muted nowrap">
        {num(p.pages)} of {num(p.total || 11000)} pages
      </span>
    </div>
  )
}
