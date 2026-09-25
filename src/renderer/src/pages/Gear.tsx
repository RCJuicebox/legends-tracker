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
import { className } from '../../../core/acModel'
import { GearFinder, type GearMode } from './GearFinder'

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


// A character sheet: the body's slots down either side of a card for the character, weapons and
// charms under the card. Slots that appear twice (ears, wrists, fingers, charms) take the export's
// items in order.
const LEFT = ['Head', 'Face', 'Ear', 'Ear', 'Neck', 'Shoulders', 'Back', 'Arms']
const RIGHT = ['Chest', 'Wrist', 'Wrist', 'Hands', 'Fingers', 'Fingers', 'Waist', 'Legs', 'Feet']
const HANDS = ['Primary', 'Secondary', 'Range', 'Ammo']
const CHARMS = ['Any Slot', 'Any Slot']
const SLOT_NAMES: Record<string, string> = { 'Any Slot': 'Any slot' }

/** Worn items by slot, each slot's items in the export's order. */
function bySlot(worn: InvItem[]): Map<string, InvItem[]> {
  const m = new Map<string, InvItem[]>()
  for (const it of worn) m.set(it.location, [...(m.get(it.location) ?? []), it])
  return m
}

const itemIconUrl = (icon?: number) => (icon && icon >= 500 ? `eqicon://item/${icon}` : '')

function ItemIcon({ icon, size = 36 }: { icon?: number; size?: number }) {
  const [ok, setOk] = useState(true)
  const src = itemIconUrl(icon)
  if (!src || !ok) return <span className="lt-icon blank" style={{ width: size, height: size }} />
  return <img className="lt-icon" src={src} width={size} height={size} alt="" onError={() => setOk(false)} />
}

const augName = (name: string) => name.replace(/\s*\(Exaltation\)$/i, '')
const plainName = (name: string) => name.replace(/\s*\+\d+$/, '')

/** Ten pips for the ten merge levels, filled up to this item's. */
function MergePips({ level }: { level: number }) {
  return (
    <span className="lt-pips" title={level ? `Merged to +${level} of 10` : 'Not merged yet'}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < level ? 'on' : ''} />
      ))}
    </span>
  )
}

type Filter = 'all' | 'worn' | 'bags' | 'bank' | 'keyring'

export function Gear({ go }: { go?: (page: 'motes') => void }) {
  const { exports, available, character, setCharacter } = useExportCharacter('inventory', 'inv.character')
  const { view, setView, sheet, saveSheet } = useInventory(character, !!exports)
  const [selected, setSelected] = useState<string | null>(null)
  const [scaled, setScaled] = useRemembered<boolean>('gear.scaled', true)
  const [refreshing, setRefreshing] = useState(false)
  const [mode, setMode] = useRemembered<'sheet' | GearMode>('gear.view', 'sheet')

  if (!exports || !view) return <div className="empty">Loading…</div>

  const stats = (sheet?.stats ?? {}) as { classes?: string[]; level?: number }
  const classes = (stats.classes ?? []).filter(Boolean)
  const [name, server] = (view.character || character).split('_')

  const head = (
    <div className="page-head">
      <div>
        <h1>Gear</h1>
        <p>
          What {name || 'your character'} is wearing, from the game's inventory export: every item at its merge level, with the stats the wiki gives it. Type{' '}
          <span className="mono">/outputfile inventory</span> in game after a change; this page follows the file
          {view.modified > 0 ? ` (last written ${ago(view.modified)})` : ''}.
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
  const tile = (slot: string, key: string, wide = false) => {
    const i = taken.get(slot) ?? 0
    taken.set(slot, i + 1)
    const it = slots.get(slot)?.[i]
    const id = it ? it.location + '#' + i : ''
    return (
      <SlotTile
        key={key}
        slot={SLOT_NAMES[slot] ?? slot}
        item={it}
        view={view}
        wide={wide}
        selected={!!it && selected === id}
        onSelect={() => it && setSelected(selected === id ? null : id)}
      />
    )
  }
  const left = LEFT.map((s, i) => tile(s, `l${i}`))
  const right = RIGHT.map((s, i) => tile(s, `r${i}`))
  const hands = HANDS.map((s, i) => tile(s, `h${i}`))
  // Held shows only when something is held; it is empty nearly always.
  const charms = [...CHARMS, ...(slots.has('Held') ? ['Held'] : [])].map((s, i) => tile(s, `c${i}`))
  // The same order the tiles took their items in, so a selection finds its item again.
  const order = new Map<string, number>()
  const picked = view.inventory.worn.find((it) => {
    const i = order.get(it.location) ?? 0
    order.set(it.location, i + 1)
    return it.location + '#' + i === selected
  })

  const switcher = (
    <div className="row" style={{ marginBottom: 12 }}>
      <span className="lt-seg">
        <button className={mode === 'sheet' ? 'on' : ''} onClick={() => setMode('sheet')}>
          Character sheet
        </button>
        <button className={mode === 'finder' ? 'on' : ''} onClick={() => setMode('finder')}>
          Upgrade finder
        </button>
        <button className={mode === 'focus' ? 'on' : ''} onClick={() => setMode('focus')}>
          Focus effects
        </button>
        <button className={mode === 'optimize' ? 'on' : ''} onClick={() => setMode('optimize')}>
          Optimize what you own
        </button>
      </span>
    </div>
  )

  if (mode !== 'sheet')
    return (
      <>
        {head}
        {switcher}
        <GearFinder view={view} sheet={sheet} mode={mode} />
      </>
    )

  return (
    <>
      {head}
      {switcher}
      <div className="lt-sheet">
        <div className="lt-side">{left}</div>
        <div className="lt-center">
          <CharacterCard name={name} server={server} level={stats.level} classes={classes} view={view} sheet={sheet} />
          <div className="lt-subhead">Weapons</div>
          <div className="lt-grid2">{hands}</div>
          <div className="lt-subhead">Any slots</div>
          <div className="lt-grid2">{charms}</div>
        </div>
        <div className="lt-side">{right}</div>
      </div>
      {picked && (
        <ItemPanel
          item={picked}
          view={view}
          sheet={sheet}
          saveSheet={saveSheet}
          onClose={() => setSelected(null)}
          onPlan={async () => {
            const lvl = mergeLevel(picked.name)
            await api.invoke('stock:item', { name: picked.name, lvl, xp: 0, to: Math.min(11, lvl + 1) })
            try {
              localStorage.setItem('lt:motes.tab', JSON.stringify('planner'))
            } catch {
              // The planner still opens; it just may land on the other tab.
            }
            go?.('motes')
          }}
        />
      )}
      <GearTotals view={view} sheet={sheet} saveSheet={saveSheet} scaled={scaled} setScaled={setScaled} />
      <Carried view={view} />
      <p className="faint small" style={{ marginTop: 14 }}>
        Item stats and icon numbers come from <a href="https://eqlwiki.com" target="_blank" rel="noreferrer">eqlwiki.com</a>, the community wiki, scaled for each item's +N
        merge level the way the wiki's item level slider scales them; the icons themselves are the game's own. Exaltation augments add nothing on top: their effects are
        already part of the item's figures.
      </p>
    </>
  )
}

function SlotTile({ slot, item, view, wide, selected, onSelect }: { slot: string; item?: InvItem; view: InventoryView; wide: boolean; selected: boolean; onSelect: () => void }) {
  const info = item ? view.items[itemKey(item.name)] : undefined
  const lvl = item ? mergeLevel(item.name) : 0
  if (!item)
    return (
      <div className="lt-tile vacant">
        <span className="lt-icon blank" style={{ width: 36, height: 36 }} />
        <div className="lt-tile-body">
          <span className="lt-slot">{slot}</span>
          <span className="faint small">empty</span>
        </div>
      </div>
    )
  return (
    <button className={`lt-tile${wide ? ' wide' : ''}${selected ? ' selected' : ''}${info && !info.found ? ' unknown' : ''}`} onClick={onSelect} title={info && !info.found ? 'Not on the wiki' : 'Show this item'}>
      <ItemIcon icon={info?.icon} />
      <div className="lt-tile-body">
        <span className="lt-slot">
          {slot}
          {lvl > 0 && <b className="lt-plus">+{lvl}</b>}
          {item.augs.length > 0 && (
            <span className="lt-augs" title={item.augs.map((a) => augName(a.name)).join('\n')}>
              {item.augs.map((a) => (
                <AugDot key={a.location} name={a.name} view={view} />
              ))}
            </span>
          )}
        </span>
        <span className="lt-name" title={item.name}>
          {plainName(item.name)}
        </span>
        <MergePips level={lvl} />
      </div>
    </button>
  )
}

function AugDot({ name, view }: { name: string; view: InventoryView }) {
  const info = view.items[itemKey(name)]
  return info?.icon ? <ItemIcon icon={info.icon} size={16} /> : <span className="lt-augdot" />
}

/** The middle of the sheet: who it is, and what the gear adds up to. */
function CharacterCard({ name, server, level, classes, view, sheet }: { name: string; server?: string; level?: number; classes: string[]; view: InventoryView; sheet: CharacterSheet | null }) {
  const { totals } = wornSummary(view, sheet)
  const worn = view.inventory?.worn ?? []
  const levels = worn.map((it) => mergeLevel(it.name))
  const merged = levels.filter((l) => l > 0)
  const avg = merged.length ? merged.reduce((a, b) => a + b, 0) / merged.length : 0
  const maxed = levels.filter((l) => l >= 10).length
  return (
    <div className="lt-card">
      <div className="lt-who">
        <span className="lt-name-big">{name}</span>
        {server && <span className="muted">{server}</span>}
      </div>
      <div className="row tight" style={{ gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {level ? <span className="lt-chip gold">Level {level}</span> : null}
        {classes.map((c) => (
          <span key={c} className="lt-chip">
            {className(c)}
          </span>
        ))}
      </div>
      <div className="lt-big">
        <div>
          <b>{num(totals.ac)}</b>
          <span>AC</span>
        </div>
        <div>
          <b>{num(totals.pools.HP ?? 0)}</b>
          <span>HP</span>
        </div>
        <div>
          <b>{num(totals.pools.MANA ?? 0)}</b>
          <span>Mana</span>
        </div>
        <div>
          <b>{totals.haste}%</b>
          <span>Haste</span>
        </div>
      </div>
      <div className="lt-merge">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">Merged</span>
          <span className="small">
            <b>{merged.length}</b> of {worn.length} items · average <b>+{avg.toFixed(1)}</b>
            {maxed ? ` · ${maxed} at +10` : ''}
          </span>
        </div>
        <div className="lt-mergebar">
          <i style={{ width: `${(levels.reduce((a, b) => a + b, 0) / Math.max(1, worn.length * 10)) * 100}%` }} />
        </div>
      </div>
    </div>
  )
}

function GearTotals({
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
  const statName: Record<string, string> = { STR: 'Strength', STA: 'Stamina', AGI: 'Agility', DEX: 'Dexterity', WIS: 'Wisdom', INT: 'Intelligence', CHA: 'Charisma' }
  const bar = (label: string, v: number, most: number) => (
    <div key={label} className="lt-bar">
      <span>{label}</span>
      <span className="lt-bar-track">
        <i style={{ width: `${Math.min(100, (v / most) * 100)}%` }} />
      </span>
      <b>{num(v)}</b>
    </div>
  )
  const maxStat = Math.max(1, ...STAT_KEYS.map((k) => t.stats[k] ?? 0))
  const maxSave = Math.max(1, ...SAVE_KEYS.map((k) => t.saves[k] ?? 0))
  return (
    <div className="lt-totals">
      <div className="card">
        <div className="lt-card-head">
          <b>Attributes from gear</b>
          <span className="lt-seg">
            <button className={scaled ? 'on' : ''} onClick={() => setScaled(true)}>
              With merges
            </button>
            <button className={scaled ? '' : 'on'} onClick={() => setScaled(false)}>
              Base
            </button>
          </span>
        </div>
        {STAT_KEYS.map((k) => bar(statName[k], t.stats[k] ?? 0, maxStat))}
      </div>
      <div className="card">
        <div className="lt-card-head">
          <b>Resists from gear</b>
        </div>
        {SAVE_KEYS.filter((k) => t.saves[k]).map((k) => bar(k === 'CORRUPTION' ? 'Corruption' : k[0] + k.slice(1).toLowerCase(), t.saves[k] ?? 0, maxSave))}
      </div>
      <div className="card">
        <div className="lt-card-head">
          <b>Pools and pace</b>
        </div>
        <div className="lt-kv">
          <span>HP</span>
          <b>{num(t.pools.HP ?? 0)}</b>
          <span>Mana</span>
          <b>{num(t.pools.MANA ?? 0)}</b>
          <span>Endurance</span>
          <b>{num(t.pools.END ?? 0)}</b>
          <span>HP regen</span>
          <b>{num(t.hpRegen)}</b>
          <span>Mana regen</span>
          <b>{num(t.manaRegen)}</b>
          <span>End regen</span>
          <b>{num(t.endRegen)}</b>
          <span>Haste</span>
          <b>{t.haste}%</b>
          <span>Weight</span>
          <b>{t.weight.toFixed(1)}</b>
          {t.attack > 0 && (
            <>
              <span>Attack</span>
              <b>{num(t.attack)}</b>
            </>
          )}
          {t.reqLevel > 0 && (
            <>
              <span>Req level</span>
              <b>{t.reqLevel}</b>
            </>
          )}
        </div>
        <div className="faint small" style={{ marginTop: 10 }}>
          {found} of {worn.length} worn items on the wiki · ammo left out of AC
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

function ItemPanel({
  item,
  view,
  sheet,
  saveSheet,
  onClose,
  onPlan
}: {
  item: InvItem
  view: InventoryView
  sheet: CharacterSheet | null
  saveSheet: (s: CharacterSheet) => void
  onClose: () => void
  onPlan: () => void
}) {
  const key = itemKey(item.name)
  const info = view.items[key]
  const s = statsFor(view.items, item.name)
  const own = sheet?.acOverrides[key]
  const lvl = mergeLevel(item.name)
  return (
    <div className="card lt-panel">
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <ItemIcon icon={info?.icon} size={44} />
        <div className="grow">
          <div className="lt-panel-title">
            {plainName(item.name)} {lvl > 0 && <b className="lt-plus">+{lvl}</b>}
          </div>
          <div className="row small muted" style={{ gap: 10 }}>
            <span>{slotLabel(item.location)}</span>
            <MergePips level={lvl} />
            {info?.found && (
              <a href={wikiUrl(info.title)} target="_blank" rel="noreferrer">
                eqlwiki
              </a>
            )}
          </div>
        </div>
        {lvl < 10 && (
          <button className="btn primary small" onClick={onPlan} title="Open the Motes upgrade planner with this item">
            Plan this upgrade
          </button>
        )}
        <button className="btn ghost small" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="lt-panel-body">
        <div>
          {info?.found ? (
            <>
              <div className="small faint" style={{ marginBottom: 4 }}>
                The wiki's stats, base values{lvl ? `; at +${lvl}: AC ${s?.ac ?? 0}` : ''}
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
        </div>
        {item.augs.length > 0 && (
          <div className="stack" style={{ gap: 10 }}>
            {item.augs.map((a) => {
              const ai = view.items[itemKey(a.name)]
              return (
                <div key={a.location}>
                  <div className="row small" style={{ gap: 8 }}>
                    <ItemIcon icon={ai?.icon} size={22} />
                    <b>{augName(a.name)}</b>
                    <span className="lt-chip">exaltation</span>
                  </div>
                  {ai?.found && (
                    <pre className="inv-block" style={{ marginTop: 4 }}>
                      {statsText(ai)}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
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
  const label: Record<Filter, string> = { all: 'Everything', worn: 'Worn', bags: 'Bags', bank: 'Bank', keyring: 'Key ring' }
  return (
    <div className="card lt-carried">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Where everything is</h2>
        <span className="grow" />
        <span className="lt-seg">
          {(Object.keys(label) as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {label[f]} <small>{counts[f]}</small>
            </button>
          ))}
        </span>
        <input type="search" className="inv-search" placeholder="Find an item" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
      </div>
      <div className="lt-list">
        {shown.map((r, i) => (
          <div key={i} className="lt-row">
            <span className="lt-row-name">{r.name}</span>
            <span className="muted small">{r.where}</span>
            <span className="mono small">{r.count > 1 ? `×${num(r.count)}` : ''}</span>
          </div>
        ))}
        {!shown.length && <div className="empty">Nothing here{query ? ` called "${q}"` : ''}.</div>}
      </div>
    </div>
  )
}
