import { useEffect, useMemo, useState } from 'react'
import { api, ago } from '../api'
import { useRemembered } from '../remember'
import { itemKey, slotLabel } from '../../../core/inventory'
import { DEFAULT_HIDDEN_ERAS, eraOf, findUpgrades, PRESETS, UNKNOWN_ERA, WEIGHT_LABELS, zoneEras, type Weights, type WeightKey } from '../../../core/upgrades'
import type { CatalogItem } from '../../../core/wikiItem'
import type { CharacterSheet, InventoryView } from '../../../shared/types'
import { className } from '../../../core/acModel'
import { statsFor, wornSummary } from './Gear'
import { characterAc } from './Stats'
import { readSheet } from '../statsSheet'

/** AC past the soft cap is worth a quarter of AC under it, in every weighting. */
const AC_OVER_CAP = 0.25

interface CatalogState {
  file: { fetchedAt: number; items: CatalogItem[] } | null
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
  const refresh = async () => setState(await api.invoke<CatalogState>('gear:catalogRefresh'))
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
  const [custom, setCustom] = useRemembered<Weights>('finder.weights', PRESETS.Balanced)
  const [compare, setCompare] = useRemembered<'drop' | 'level'>('finder.compare', 'drop')
  const [hiddenEras, setHiddenEras] = useRemembered<string[]>('finder.hiddenEras.v2', DEFAULT_HIDDEN_ERAS)
  const [slot, setSlot] = useRemembered<string>('finder.slot', 'all')
  const [showWeights, setShowWeights] = useState(false)
  const [capMode, setCapMode] = useRemembered<'auto' | 'over' | 'under'>('finder.acCap', 'auto')
  const sheetStats = useMemo(() => readSheet(sheet?.stats), [sheet])
  const [acCaps, setAcCaps] = useState<Record<string, { cap: number; mult: number }> | null>(null)
  useEffect(() => {
    const trio = sheetStats.classes.filter(Boolean)
    if (!trio.length) return
    void api.invoke<{ ac: Record<string, { cap: number; mult: number }> }>('stats:caps', trio, sheetStats.level).then((r) => setAcCaps(r.ac))
  }, [sheetStats.classes.join(','), sheetStats.level])

  const stats = (sheet?.stats ?? {}) as { classes?: string[]; level?: number; race?: string }
  const classes = (stats.classes ?? []).filter(Boolean)
  const baseWeights = preset === 'Custom' ? custom : (PRESETS[preset] ?? PRESETS.Balanced)
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
  const weights = useMemo(() => (overCap ? { ...baseWeights, ac: baseWeights.ac * AC_OVER_CAP } : baseWeights), [baseWeights, overCap])
  const inv = view.inventory!
  const owned = useMemo(() => new Set([...inv.worn, ...inv.bags, ...inv.bank, ...inv.sharedBank].flatMap((i) => [itemKey(i.name), ...i.augs.map((a) => itemKey(a.name))])), [inv])

  // Every era in the catalog with how many pieces it holds, tagged or worked out from drop zones.
  const eraCounts = useMemo(() => {
    const items = state?.file?.items ?? []
    const zones = zoneEras(items)
    const counts = new Map<string, number>()
    for (const it of items) {
      const { era } = eraOf(it, zones)
      counts.set(era, (counts.get(era) ?? 0) + 1)
    }
    const order = (e: string) => (e === 'Classic' ? 0 : e === 'Kunark' ? 2 : e === 'Velious' ? 3 : e === 'Luclin' ? 4 : e === UNKNOWN_ERA ? 5 : 1)
    return [...counts].sort((a, b) => order(a[0]) - order(b[0]) || b[1] - a[1])
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
      owned
    })
  }, [state?.file, classes.join(','), stats.level, stats.race, weights, compare, hiddenEras, inv, view.items, owned])

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
            {[...Object.keys(PRESETS), 'Custom'].map((name) => (
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
                  era === UNKNOWN_ERA
                    ? 'No era on the wiki page and no drop zone to tell by: quested, crafted and vendor items mostly'
                    : DEFAULT_HIDDEN_ERAS.includes(era)
                      ? `${era}: zones not in EverQuest Legends yet`
                      : undefined
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
        {showWeights && (
          <div className="lt-weights">
            {(Object.keys(WEIGHT_LABELS) as WeightKey[]).map((k) => (
              <label key={k} className="lt-weight">
                <span>{WEIGHT_LABELS[k]}</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={baseWeights[k]}
                  title={k === 'ac' && overCap ? `Counts as ${Math.round(baseWeights.ac * AC_OVER_CAP * 100) / 100} while over the soft cap` : undefined}
                  onChange={(e) => {
                    setCustom({ ...baseWeights, [k]: Math.max(0, Number(e.target.value) || 0) })
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
            Scores are your weights times each stat, so they only rank items against each other. The wiki holds base stats, so a candidate "as it drops" is at +0 while
            your gear counts at its merge level; switch to "At your merge level" to compare like with like. Weapon ratio (damage ÷ delay) only counts when you give it a
            weight. An item with no era on its wiki page takes the era of the zones it drops in, learned from the tagged items there. Item data from eqlwiki.com.
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
