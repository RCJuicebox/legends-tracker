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


// The equipment window's layout: two columns of the big slots, then the weapons and rings across,
// then the two charm slots. Slots that appear twice (ears, wrists, fingers, charms) take the export's
// items in order.
const LEFT = ['Ear', 'Head', 'Face', 'Ear', 'Neck', 'Shoulders', 'Arms', 'Back']
const RIGHT = ['Wrist', 'Wrist', 'Range', 'Hands', 'Chest', 'Legs', 'Feet', 'Waist']
const ROW = ['Primary', 'Secondary', 'Fingers', 'Fingers', 'Ammo', 'Held']
const CHARMS = ['Any Slot', 'Any Slot']

/** Worn items by slot, each slot's items in the export's order. */
function bySlot(worn: InvItem[]): Map<string, InvItem[]> {
  const m = new Map<string, InvItem[]>()
  for (const it of worn) m.set(it.location, [...(m.get(it.location) ?? []), it])
  return m
}

const itemIconUrl = (icon?: number) => (icon && icon >= 500 ? `eqicon://item/${icon}` : '')

function ItemIcon({ icon, size = 30 }: { icon?: number; size?: number }) {
  const [ok, setOk] = useState(true)
  const src = itemIconUrl(icon)
  if (!src || !ok) return <span className="gear-icon empty" style={{ width: size, height: size }} />
  return <img className="gear-icon" src={src} width={size} height={size} alt="" onError={() => setOk(false)} />
}

const augName = (name: string) => name.replace(/\s*\(Exaltation\)$/i, '')

type Filter = 'all' | 'worn' | 'bags' | 'bank' | 'keyring'

export function Gear() {
  const { exports, available, character, setCharacter } = useExportCharacter('inventory', 'inv.character')
  const { view, setView, sheet, saveSheet } = useInventory(character, !!exports)
  const [selected, setSelected] = useState<string | null>(null)
  const [scaled, setScaled] = useRemembered<boolean>('gear.scaled', true)
  const [refreshing, setRefreshing] = useState(false)

  if (!exports || !view) return <div className="empty">Loading…</div>

  const stats = (sheet?.stats ?? {}) as { classes?: string[]; level?: number }
  const classes = (stats.classes ?? []).filter(Boolean)
  const [name, server] = (view.character || character).split('_')

  const head = (
    <>
      <div className="page-head gear-head">
        <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <h1>{name || 'Gear'}</h1>
          {server && <span className="muted">{server}</span>}
          {stats.level ? <b>Level {stats.level}</b> : null}
          {classes.map((c) => (
            <span key={c} className="gear-class">
              {c.toUpperCase()}
            </span>
          ))}
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
        </div>
      </div>
      <div className="gear-banner">
        <span className="mono">/outputfile inventory</span>
        <span className="muted">Type it in game whenever your gear changes; this page follows the file.</span>
        <span className="grow" />
        {view.modified > 0 && <span className="faint">updated {ago(view.modified)}</span>}
        {view.inventory && (
          <button
            className="btn ghost small"
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
    </>
  )

  if (!view.inventory) {
    return (
      <>
        {head}
        <div className="card empty">
          {view.error === 'missing' || !character ? (
            <>
              No inventory export for {character ? <b>{who(character)}</b> : 'this character'} yet. Type <span className="mono">/outputfile inventory</span> in game and this
              page fills in within a few seconds.
            </>
          ) : (
            <>Could not read {view.file}: {view.error}</>
          )}
        </div>
      </>
    )
  }

  const slots = bySlot(view.inventory.worn)
  const taken = new Map<string, number>()
  const next = (slot: string) => {
    const i = taken.get(slot) ?? 0
    taken.set(slot, i + 1)
    return slots.get(slot)?.[i]
  }
  const card = (slot: string, key: string, compact = false) => {
    const it = next(slot)
    return <SlotCard key={key} slot={slot} item={it} view={view} compact={compact} selected={!!it && selected === it.location + it.name} onSelect={() => it && setSelected(selected === it.location + it.name ? null : it.location + it.name)} />
  }
  const left = LEFT.map((s, i) => card(s, `l${i}`))
  const right = RIGHT.map((s, i) => card(s, `r${i}`))
  const row = ROW.map((s, i) => card(s, `w${i}`, true))
  const charms = CHARMS.map((s, i) => card(s, `c${i}`))
  const picked = view.inventory.worn.find((it) => it.location + it.name === selected)

  return (
    <>
      {head}
      <div className="gear-layout">
        <div className="gear-doll">
          <div className="gear-cols">
            <div className="gear-col">{left}</div>
            <div className="gear-col">{right}</div>
          </div>
          <div className="gear-row">{row}</div>
          <div className="gear-cols">{charms}</div>
        </div>
        <div className="stack" style={{ gap: 12 }}>
          <GearStats view={view} sheet={sheet} saveSheet={saveSheet} scaled={scaled} setScaled={setScaled} />
          {picked && <ItemPanel item={picked} view={view} sheet={sheet} saveSheet={saveSheet} onClose={() => setSelected(null)} />}
        </div>
      </div>
      <Carried view={view} />
      <p className="faint small" style={{ marginTop: 14 }}>
        Item stats and icons numbers come from <a href="https://eqlwiki.com" target="_blank" rel="noreferrer">eqlwiki.com</a>, the community wiki, scaled for each item's +N
        merge level the way the wiki's item level slider scales them; the icons themselves are the game's own. Exaltation augments add nothing on top: their effects are
        already part of the item's figures.
      </p>
    </>
  )
}

function SlotCard({ slot, item, view, compact, selected, onSelect }: { slot: string; item?: InvItem; view: InventoryView; compact: boolean; selected: boolean; onSelect: () => void }) {
  const info = item ? view.items[itemKey(item.name)] : undefined
  return (
    <div className={`gear-slot${compact ? ' compact' : ''}${selected ? ' selected' : ''}${item ? '' : ' empty'}`}>
      <ItemIcon icon={info?.icon} />
      <div className="gear-slot-body">
        <div className="gear-slot-label">{slot}</div>
        {item ? (
          <button className={`gear-item${info && !info.found ? ' unknown' : ''}`} onClick={onSelect} title={info && !info.found ? 'Not on the wiki' : 'Show this item'}>
            {item.name}
          </button>
        ) : (
          <div className="faint small">empty</div>
        )}
        {item && item.augs.length > 0 && (
          <div className="gear-augs">
            {item.augs.map((a) => (
              <span key={a.location} className="gear-aug">
                {augName(a.name)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function GearStats({
  view,
  sheet,
  saveSheet,
  scaled,
  setScaled
}: {
  view: InventoryView
  sheet: CharacterSheet | null
  saveSheet: (s: CharacterSheet) => void
  scaled: boolean
  setScaled: (v: boolean) => void
}) {
  const worn = view.inventory?.worn ?? []
  const base = (it: InvItem) => {
    const info = view.items[itemKey(it.name)]
    return info?.found ? parseStatsBlock(info.statsblock) : null
  }
  const t = scaled ? wornSummary(view, sheet).totals : wornTotals(worn, base, (it) => sheet?.acOverrides[itemKey(it.name)])
  const { secondary, shield, shieldByName, shieldAC } = wornSummary(view, sheet)
  const found = worn.filter((it) => view.items[itemKey(it.name)]?.found).length
  const sign = (n: number) => (n > 0 ? `+${num(n)}` : num(n))
  const line = (label: string, v: number | string, show = true) =>
    show ? (
      <div key={label} className="gear-stat">
        <span>{label}</span>
        <b>{typeof v === 'number' ? sign(v) : v}</b>
      </div>
    ) : null
  const statName: Record<string, string> = { STR: 'Strength', STA: 'Stamina', AGI: 'Agility', DEX: 'Dexterity', WIS: 'Wisdom', INT: 'Intelligence', CHA: 'Charisma' }
  const saveName = (k: string) => `SV ${k === 'CORRUPTION' ? 'Corruption' : k[0] + k.slice(1).toLowerCase()}`
  return (
    <div className="card gear-stats">
      <div className="row" style={{ marginBottom: 10 }}>
        <b>Stats from gear</b>
        <button className={`gear-toggle${scaled ? ' on' : ''}`} onClick={() => setScaled(!scaled)} title="With each item's +N merge level, or at base values">
          {scaled ? 'with +N' : 'base'}
        </button>
      </div>
      <div className="gear-stat-cols">
        <div>
          {line('AC', t.ac)}
          <div className="gear-gap" />
          {SAVE_KEYS.map((k) => line(saveName(k), t.saves[k] ?? 0, !!t.saves[k]))}
        </div>
        <div>
          {STAT_KEYS.map((k) => line(statName[k], t.stats[k] ?? 0))}
          {line('HP', t.pools.HP ?? 0)}
          {line('Mana', t.pools.MANA ?? 0)}
          {line('Endurance', t.pools.END ?? 0)}
          {line('Regen', t.hpRegen, !!t.hpRegen)}
          {line('Mana Regen', t.manaRegen, !!t.manaRegen)}
          {line('End Regen', t.endRegen, !!t.endRegen)}
          {line('Attack', t.attack, !!t.attack)}
          {line('Haste', `+${t.haste}%`, !!t.haste)}
          {line('Weight', t.weight.toFixed(1))}
          {line('Req Level', String(t.reqLevel), !!t.reqLevel)}
        </div>
      </div>
      <div className="faint small" style={{ marginTop: 10 }}>
        {found} of {worn.length} worn items{worn.length - found ? ` · ${worn.length - found} not on the wiki` : ''} · ammo left out of AC
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>
        {secondary ? (
          <label className="row tight" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={shield}
              onChange={(e) => sheet && saveSheet({ ...sheet, shield: e.target.checked === shieldByName ? null : e.target.checked })}
            />
            Secondary is a shield{shield ? `: its ${shieldAC} AC lifts your soft cap` : ''}
          </label>
        ) : (
          'Nothing in your secondary slot.'
        )}
      </div>
    </div>
  )
}

function wikiUrl(title: string) {
  return `https://eqlwiki.com/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}`
}

function statsText(info: ItemInfo): string {
  return info.statsblock
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function ItemPanel({ item, view, sheet, saveSheet, onClose }: { item: InvItem; view: InventoryView; sheet: CharacterSheet | null; saveSheet: (s: CharacterSheet) => void; onClose: () => void }) {
  const key = itemKey(item.name)
  const info = view.items[key]
  const s = statsFor(view.items, item.name)
  const own = sheet?.acOverrides[key]
  const lvl = mergeLevel(item.name)
  return (
    <div className="card gear-panel">
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <ItemIcon icon={info?.icon} size={40} />
        <div className="grow">
          <div style={{ fontWeight: 650 }}>{item.name}</div>
          <div className="small muted">
            {slotLabel(item.location)}
            {info?.found && (
              <>
                {' · '}
                <a href={wikiUrl(info.title)} target="_blank" rel="noreferrer">
                  eqlwiki
                </a>
              </>
            )}
          </div>
        </div>
        <button className="btn ghost small" onClick={onClose}>
          ×
        </button>
      </div>
      {info?.found ? (
        <>
          <div className="small faint" style={{ margin: '10px 0 4px' }}>
            Base values{lvl ? `; at +${lvl}: AC ${s?.ac ?? 0}` : ''}
          </div>
          <pre className="inv-block">{statsText(info)}</pre>
        </>
      ) : (
        <p className="small muted">eqlwiki has no page for this item, so it adds nothing to the totals unless you type its AC below.</p>
      )}
      <label className="row small" style={{ marginTop: 10, gap: 8 }}>
        AC
        <input
          className="inv-ac"
          type="number"
          min={0}
          value={own ?? ''}
          placeholder={s ? String(s.ac) : '?'}
          onChange={(e) => {
            if (!sheet) return
            const next = { ...sheet.acOverrides }
            if (e.target.value === '') delete next[key]
            else next[key] = Math.max(0, Math.floor(Number(e.target.value) || 0))
            saveSheet({ ...sheet, acOverrides: next })
          }}
        />
        <span className="faint">{own !== undefined ? 'your figure; clear it to use the wiki' : 'type to correct the wiki'}</span>
      </label>
      {item.augs.map((a) => {
        const ai = view.items[itemKey(a.name)]
        return (
          <div key={a.location} style={{ marginTop: 10 }}>
            <div className="row small" style={{ gap: 8 }}>
              <ItemIcon icon={ai?.icon} size={22} />
              <b>{augName(a.name)}</b>
              <span className="faint">exaltation</span>
            </div>
            {ai?.found && <pre className="inv-block" style={{ marginTop: 4 }}>{statsText(ai)}</pre>}
          </div>
        )
      })}
    </div>
  )
}

/** A readable place: "General 1-Slot3" → "Bag 1, slot 3". */
function placeLabel(location: string): string {
  const parts = location.split('-')
  const top = parts[0]
  const slot = /^Slot(\d+)$/.exec(parts[1] ?? '')?.[1]
  const where = /^General (\d+)$/.test(top) ? `Bag ${top.slice(8)}` : /^Bank(\d+)$/.test(top) ? `Bank ${top.slice(4)}` : /^SharedBank(\d+)$/.test(top) ? `Shared bank ${top.slice(10)}` : slotLabel(top)
  return slot ? `${where}, slot ${slot}${parts[2] ? ' (augment)' : ''}` : where
}

function Carried({ view }: { view: InventoryView }) {
  const [filter, setFilter] = useRemembered<Filter>('gear.filter', 'all')
  const [q, setQ] = useState('')
  const inv = view.inventory!
  const rows = useMemo(() => {
    const out: { kind: Filter; name: string; where: string; count: number }[] = []
    const add = (kind: Filter, list: InvItem[]) => {
      for (const it of list) {
        out.push({ kind, name: it.name, where: placeLabel(it.location), count: it.count })
        for (const a of it.augs) out.push({ kind, name: a.name, where: `In ${it.name}`, count: 1 })
      }
    }
    add('worn', inv.worn)
    add('bags', inv.bags)
    add('bank', [...inv.bank, ...inv.sharedBank])
    for (const k of inv.keyRing) out.push({ kind: 'keyring', name: k.name, where: `Key ring: ${k.kind}`, count: 1 })
    return out
  }, [inv])
  const counts = { all: rows.length, worn: 0, bags: 0, bank: 0, keyring: 0 }
  for (const r of rows) counts[r.kind]++
  const query = q.trim().toLowerCase()
  const shown = rows.filter((r) => (filter === 'all' || r.kind === filter) && (!query || r.name.toLowerCase().includes(query)))
  const label: Record<Filter, string> = { all: 'All', worn: 'Worn', bags: 'Bags', bank: 'Bank', keyring: 'Key rings' }
  return (
    <div className="card gear-carried">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <b>Everything you carry</b>
        <input type="search" className="inv-search" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
        {(Object.keys(label) as Filter[]).map((f) => (
          <button key={f} className={`gear-filter${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
            {label[f]} {counts[f]}
          </button>
        ))}
        <span className="faint small">
          {shown.length} of {rows.length}
        </span>
      </div>
      <div className="gear-table">
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Location</th>
              <th style={{ textAlign: 'right' }}>Count</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                <td className="gear-name">{r.name}</td>
                <td className="muted">{r.where}</td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {num(r.count)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
