import { useEffect, useMemo, useState } from 'react'
import { api, ago } from '../api'
import { useRemembered } from '../remember'
import {
  itemKey,
  mergeLevel,
  parseStatsBlock,
  scaledStats,
  slotLabel,
  wornTotals,
  POOL_KEYS,
  SAVE_KEYS,
  SHIELD_NAME,
  STAT_KEYS,
  type InvItem,
  type ItemStats
} from '../../../core/inventory'
import type { CharacterSheet, InventoryView, ItemInfo } from '../../../shared/types'

const who = (key: string) => key.replace('_', ' · ')
const num = (n: number) => n.toLocaleString()

interface Exports {
  current: string
  achievements: string[]
  inventory: string[]
}

/** The character whose exports a page shows: the one being played, unless another was picked. */
export function useExportCharacter(kind: 'inventory' | 'achievements', rememberKey: string) {
  const [exports, setExports] = useState<Exports | null>(null)
  const [picked, setPicked] = useRemembered<string>(rememberKey, '')
  useEffect(() => void api.invoke<Exports>('character:exports').then(setExports), [])
  const available = exports?.[kind] ?? []
  const character = picked && available.includes(picked) ? picked : exports?.current || available[0] || ''
  return { exports, available, character, setCharacter: setPicked }
}

export function useInventory(character: string, ready: boolean) {
  const [view, setView] = useState<InventoryView | null>(null)
  const [sheet, setSheet] = useState<CharacterSheet | null>(null)
  useEffect(() => {
    if (!ready) return
    void api.invoke<InventoryView>('inventory:load', character).then(setView)
    void api.invoke<CharacterSheet>('character:sheet', character).then(setSheet)
    return api.on('state:inventory', (v: InventoryView) => v.character === character && setView(v))
  }, [character, ready])
  const saveSheet = (s: CharacterSheet) => {
    setSheet(s)
    void api.invoke('character:saveSheet', character, s)
  }
  return { view, setView, sheet, saveSheet }
}

/** An item's stats at its merge level, if the wiki has it. */
export function statsFor(items: Record<string, ItemInfo>, name: string): ItemStats | null {
  const info = items[itemKey(name)]
  return info?.found ? scaledStats(parseStatsBlock(info.statsblock), mergeLevel(name)) : null
}

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

type Tab = 'worn' | 'bags' | 'bank' | 'keyring'

export function Inventory() {
  const { exports, available, character, setCharacter } = useExportCharacter('inventory', 'inv.character')
  const { view, setView, sheet, saveSheet } = useInventory(character, !!exports)
  const [tab, setTab] = useRemembered<Tab>('inv.tab', 'worn')
  const [q, setQ] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  if (!exports || !view) return <div className="empty">Loading…</div>

  const header = (
    <div className="page-head">
      <div>
        <h1>Inventory</h1>
        <p>
          {view.modified
            ? `${who(view.character)} · from ${view.file}, written by the game ${ago(view.modified)}. Type /outputfile inventory in game to refresh it; this page updates on its own.`
            : 'Read from the inventory export the game writes into its folder.'}
        </p>
      </div>
      <div className="actions">
        {available.length > 1 && (
          <select value={character} onChange={(e) => setCharacter(e.target.value)}>
            {available.map((c) => (
              <option key={c} value={c}>
                {who(c)}
              </option>
            ))}
          </select>
        )}
        {view.inventory && (
          <button
            className="btn"
            disabled={refreshing}
            title="Fetch every worn item from eqlwiki.com again"
            onClick={async () => {
              setRefreshing(true)
              setView(await api.invoke<InventoryView>('inventory:load', character, true))
              setRefreshing(false)
            }}
          >
            {refreshing ? 'Fetching…' : 'Refresh item stats'}
          </button>
        )}
      </div>
    </div>
  )

  if (!view.inventory) {
    return (
      <>
        {header}
        <div className="card empty">
          {view.error === 'missing' || !character ? (
            <>
              No inventory export for {character ? <b>{who(character)}</b> : 'this character'} yet.
              <br />
              In game, type <span className="mono">/outputfile inventory</span>. The game writes the file into its folder and this page picks it up within a few seconds.
            </>
          ) : (
            <>Could not read {view.file}: {view.error}</>
          )}
        </div>
      </>
    )
  }

  const inv = view.inventory
  const query = q.trim().toLowerCase()

  return (
    <>
      {header}
      <WornSummaryCard view={view} sheet={sheet} saveSheet={saveSheet} />
      <div className="row" style={{ margin: '4px 0 12px', gap: 6 }}>
        {(
          [
            ['worn', `Worn (${inv.worn.length})`],
            ['bags', `Bags (${inv.bags.length})`],
            ['bank', `Bank (${inv.bank.length + inv.sharedBank.length})`],
            ['keyring', `Key ring (${inv.keyRing.length})`]
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={`btn${tab === id && !query ? ' on' : ' ghost'}`} onClick={() => (setTab(id), setQ(''))}>
            {label}
          </button>
        ))}
        <span className="grow" />
        <input type="search" placeholder="Find an item anywhere" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} className="inv-search" />
      </div>
      {query ? (
        <SearchResults view={view} query={query} />
      ) : tab === 'worn' ? (
        <WornTable view={view} sheet={sheet} saveSheet={saveSheet} />
      ) : tab === 'bags' ? (
        <ContainerList items={inv.bags} empty="Nothing in your bags." />
      ) : tab === 'bank' ? (
        <ContainerList items={[...inv.bank, ...inv.sharedBank]} empty="Nothing in the bank." />
      ) : (
        <KeyRing view={view} />
      )}
      <p className="faint small" style={{ marginTop: 16 }}>
        Item stats come from <a href="https://eqlwiki.com" target="_blank" rel="noreferrer">eqlwiki.com</a>, the community wiki, and are
        scaled for each item's +N merge level the same way the wiki's item level slider scales them. Exaltation augments add nothing on
        top: their effects are already part of the item's figures. Type an AC over any item's to correct it.
      </p>
    </>
  )
}

function WornSummaryCard({ view, sheet, saveSheet }: { view: InventoryView; sheet: CharacterSheet | null; saveSheet: (s: CharacterSheet) => void }) {
  const { totals, secondary, shield, shieldByName, shieldAC } = wornSummary(view, sheet)
  const cell = (label: string, value: number | string, sub?: string) => (
    <div className="stat" key={label}>
      <span className="label">{label}</span>
      <span className="value">{typeof value === 'number' ? num(value) : value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  )
  return (
    <div className="card stack" style={{ gap: 14, marginBottom: 14 }}>
      <div className="inv-totals">
        {cell('Worn AC', totals.ac, 'ammo not counted')}
        {POOL_KEYS.map((k) => cell(k === 'MANA' ? 'Mana' : k === 'END' ? 'Endurance' : k, totals.pools[k] ?? 0))}
        {cell('Haste', `${totals.haste}%`, 'best worn, not added')}
        {cell('Weight', totals.weight.toFixed(1), 'worn gear')}
      </div>
      <div className="inv-statline">
        {STAT_KEYS.map((k) => (
          <span key={k}>
            <b>{k}</b> {totals.stats[k] ?? 0}
          </span>
        ))}
        <span className="inv-sep" />
        {SAVE_KEYS.filter((k) => totals.saves[k]).map((k) => (
          <span key={k}>
            <b>SV {k === 'CORRUPTION' ? 'CORR' : k}</b> {totals.saves[k]}
          </span>
        ))}
      </div>
      {totals.unknown > 0 && (
        <div className="notice small">
          {totals.unknown} worn item{totals.unknown === 1 ? ' is' : 's are'} not on the wiki, so {totals.unknown === 1 ? 'it adds' : 'they add'} nothing here. Type the AC the game shows into{' '}
          {totals.unknown === 1 ? 'its row' : 'their rows'} below.
        </div>
      )}
      <div className="small muted row" style={{ gap: 10 }}>
        {secondary ? (
          <>
            <span>
              <b>Secondary:</b> {secondary.name}, {shield ? `a shield: its ${shieldAC} AC also lifts your AC soft cap.` : 'not a shield, so none of your AC lifts the soft cap.'}
            </span>
            <label className="row tight" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={shield}
                onChange={(e) => sheet && saveSheet({ ...sheet, shield: e.target.checked === shieldByName ? null : e.target.checked })}
              />
              Treat as a shield
            </label>
          </>
        ) : (
          <span>Nothing in your secondary slot, so nothing lifts your AC soft cap.</span>
        )}
      </div>
    </div>
  )
}

function statSummary(s: ItemStats | null): string {
  if (!s) return ''
  const parts: string[] = []
  for (const k of STAT_KEYS) if (s.stats[k]) parts.push(`${k} ${s.stats[k]! > 0 ? '+' : ''}${s.stats[k]}`)
  for (const k of POOL_KEYS) if (s.pools[k]) parts.push(`${k} ${s.pools[k]! > 0 ? '+' : ''}${s.pools[k]}`)
  if (s.haste) parts.push(`Haste ${s.haste}%`)
  if (s.damage) parts.push(`${s.damage}/${s.delay}`)
  return parts.join(' · ')
}

function WornTable({ view, sheet, saveSheet }: { view: InventoryView; sheet: CharacterSheet | null; saveSheet: (s: CharacterSheet) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const worn = view.inventory?.worn ?? []
  return (
    <div className="card" style={{ padding: 0 }}>
      <table className="table inv-table">
        <thead>
          <tr>
            <th>Slot</th>
            <th>Item</th>
            <th style={{ width: 110 }}>AC</th>
            <th>Stats at its level</th>
            <th style={{ width: 60 }}>WT</th>
          </tr>
        </thead>
        <tbody>
          {worn.map((it, i) => {
            const key = itemKey(it.name)
            const info = view.items[key]
            const s = statsFor(view.items, it.name)
            const own = sheet?.acOverrides[key]
            const rowKey = `${it.location}-${i}`
            return [
              <tr key={rowKey} className="clickable" onClick={() => setOpen(open === rowKey ? null : rowKey)}>
                <td className="nowrap muted">{slotLabel(it.location)}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{it.name}</div>
                  {it.augs.length > 0 && <div className="small faint">{it.augs.map((a) => a.name.replace(/\s*\(Exaltation\)$/, '')).join(' · ')}</div>}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    className="inv-ac"
                    type="number"
                    min={0}
                    value={own ?? ''}
                    placeholder={s ? String(s.ac) : '?'}
                    title={own !== undefined ? 'Your figure. Clear it to use the wiki again.' : s ? 'From the wiki, at its merge level. Type to override.' : 'Not on the wiki: type the AC the game shows.'}
                    onChange={(e) => {
                      if (!sheet) return
                      const next = { ...sheet.acOverrides }
                      if (e.target.value === '') delete next[key]
                      else next[key] = Math.max(0, Math.floor(Number(e.target.value) || 0))
                      saveSheet({ ...sheet, acOverrides: next })
                    }}
                  />
                  {own !== undefined ? <span className="chip warn">yours</span> : !info?.found ? <span className="chip bad">not on wiki</span> : null}
                </td>
                <td className="small">{statSummary(s)}</td>
                <td className="mono small">{s ? s.weight.toFixed(1) : ''}</td>
              </tr>,
              open === rowKey && (
                <tr key={rowKey + '-d'}>
                  <td />
                  <td colSpan={4}>
                    <ItemDetail name={it.name} info={info} augs={it.augs} items={view.items} />
                  </td>
                </tr>
              )
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

function wikiUrl(title: string) {
  return `https://eqlwiki.com/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}`
}

function StatsBlock({ info }: { info: ItemInfo }) {
  const text = info.statsblock
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return <pre className="inv-block">{text}</pre>
}

function ItemDetail({ name, info, augs, items }: { name: string; info?: ItemInfo; augs: InvItem[]; items: Record<string, ItemInfo> }) {
  const lvl = mergeLevel(name)
  return (
    <div className="inv-detail">
      <div>
        {info?.found ? (
          <>
            <div className="small muted" style={{ marginBottom: 4 }}>
              <a href={wikiUrl(info.title)} target="_blank" rel="noreferrer">
                {info.title}
              </a>{' '}
              on eqlwiki, base values{lvl ? `; this one is +${lvl}` : ''}
            </div>
            <StatsBlock info={info} />
          </>
        ) : (
          <div className="small muted">eqlwiki has no page for {name.replace(/\s*\+\d+$/, '')}.</div>
        )}
      </div>
      {augs.map((a) => {
        const ai = items[itemKey(a.name)]
        return (
          <div key={a.location}>
            <div className="small muted" style={{ marginBottom: 4 }}>
              ↳ {a.name}
              {ai?.found && (
                <>
                  {' · '}
                  <a href={wikiUrl(ai.title)} target="_blank" rel="noreferrer">
                    wiki
                  </a>
                </>
              )}
            </div>
            {ai?.found && <StatsBlock info={ai} />}
          </div>
        )
      })}
    </div>
  )
}

/** A readable place: "General 1-Slot3" → "Bag 1, slot 3". */
function placeLabel(location: string, bagName?: string): string {
  const parts = location.split('-')
  const top = parts[0]
  const slot = /^Slot(\d+)$/.exec(parts[1] ?? '')?.[1]
  const where = /^General (\d+)$/.test(top) ? `Bag ${top.slice(8)}` : /^Bank(\d+)$/.test(top) ? `Bank ${top.slice(4)}` : /^SharedBank(\d+)$/.test(top) ? `Shared bank ${top.slice(10)}` : slotLabel(top)
  return slot ? `${where}${bagName ? ` (${bagName})` : ''}, slot ${slot}` : where
}

function ContainerList({ items, empty }: { items: InvItem[]; empty: string }) {
  if (!items.length) return <div className="card empty">{empty}</div>
  const groups = new Map<string, InvItem[]>()
  for (const it of items) {
    const top = it.location.split('-')[0]
    groups.set(top, [...(groups.get(top) ?? []), it])
  }
  return (
    <div className="inv-groups">
      {[...groups].map(([top, list]) => {
        const holder = list.find((x) => x.location === top)
        const contents = list.filter((x) => x.location !== top)
        return (
          <div key={top} className="card inv-group">
            <div className="inv-group-head">
              <b>{placeLabel(top)}</b>
              <span className="muted">{holder ? holder.name : ''}</span>
            </div>
            {contents.length > 0 ? (
              <table className="table small">
                <tbody>
                  {contents.map((it) => (
                    <tr key={it.location}>
                      <td className="faint mono" style={{ width: 34 }}>
                        {/Slot(\d+)$/.exec(it.location)?.[1]}
                      </td>
                      <td>
                        {it.name}
                        {it.augs.length > 0 && <span className="faint"> · {it.augs.map((a) => a.name.replace(/\s*\(Exaltation\)$/, '')).join(', ')}</span>}
                      </td>
                      <td className="mono muted" style={{ textAlign: 'right' }}>
                        {it.count > 1 ? `×${num(it.count)}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : holder && holder.augs.length ? (
              <div className="small faint">{holder.augs.map((a) => a.name).join(', ')}</div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function KeyRing({ view }: { view: InventoryView }) {
  const groups = useMemo(() => {
    const g = new Map<string, string[]>()
    for (const k of view.inventory?.keyRing ?? []) g.set(k.kind, [...(g.get(k.kind) ?? []), k.name])
    return [...g]
  }, [view])
  if (!groups.length) return <div className="card empty">The key ring is empty.</div>
  return (
    <div className="inv-groups">
      {groups.map(([kind, names]) => (
        <div key={kind} className="card inv-group">
          <div className="inv-group-head">
            <b>{kind}</b>
            <span className="muted">{names.length}</span>
          </div>
          <div className="small inv-names">
            {[...names].sort((a, b) => a.localeCompare(b)).map((n) => (
              <div key={n}>{n}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SearchResults({ view, query }: { view: InventoryView; query: string }) {
  const inv = view.inventory!
  const bagNames = new Map<string, string>()
  for (const it of [...inv.bags, ...inv.bank, ...inv.sharedBank]) if (!it.location.includes('-')) bagNames.set(it.location, it.name)
  const hits: { where: string; name: string; count: number }[] = []
  const scan = (list: InvItem[]) => {
    for (const it of list) {
      if (it.name.toLowerCase().includes(query)) hits.push({ where: placeLabel(it.location, it.location.includes('-') ? bagNames.get(it.location.split('-')[0]) : undefined), name: it.name, count: it.count })
      for (const a of it.augs) if (a.name.toLowerCase().includes(query)) hits.push({ where: `In ${it.name} (${placeLabel(it.location)})`, name: a.name, count: 1 })
    }
  }
  scan(inv.worn)
  scan(inv.bags)
  scan(inv.bank)
  scan(inv.sharedBank)
  for (const k of inv.keyRing) if (k.name.toLowerCase().includes(query)) hits.push({ where: `Key ring: ${k.kind}`, name: k.name, count: 1 })
  if (!hits.length) return <div className="card empty">Nothing called "{query}" anywhere.</div>
  return (
    <div className="card" style={{ padding: 0 }}>
      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Where</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {hits.map((h, i) => (
            <tr key={i}>
              <td>{h.name}</td>
              <td className="muted">{h.where}</td>
              <td className="mono muted" style={{ textAlign: 'right' }}>
                {h.count > 1 ? `×${num(h.count)}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
