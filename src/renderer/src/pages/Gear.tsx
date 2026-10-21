import { useMemo, useState } from 'react'
import { CharacterPicker } from '../components/CharacterPicker'
import { api } from '../api'
import { useRemembered } from '../remember'
import { useInvoke } from '../hooks'
import { useCatalog } from '../gear/useCatalog'
import { OPTIMIZED_KEY, type OptimizedPick } from '../gear/optimized'
import { judgeOwned } from '../../../core/gearJudge'
import type { Wearer } from '../../../core/gearFinder'
import { showError } from '../toast'
import { Ago, FilterBox, GameCommand, Pending, Segmented, Tabs } from '../components/ui'
import { numExact as num, who } from '../../../core/format'
import { itemKey, mergeLevel, placeLabel, storageTab, type InvItem } from '../../../core/inventory'
import type { InventoryView } from '../../../shared/types'
import { className } from '../../../shared/game/classes'
import { useInventory } from '../gear/model'
import { useCharacterChoice } from '../character'
import { wornSummary, type WornSummary } from '../../../core/wornGear'
import { ItemIcon } from './gearBits'
import { GearFinder, type GearMode } from './GearFinder'
import { useCharacterRecord, withRecord } from '../character'
import { readStatsInputs } from '../../../core/statsInputs'
import type { Go } from '../nav'
import { GearTotals, ItemPanel } from './GearPanels'
import { CHARMS, HANDS, LEFT, MAX_MERGE, MergePips, MergePlus, RIGHT, SLOT_NAMES, augName, bySlot, plainName } from './GearParts'

type Filter = 'all' | 'worn' | 'bags' | 'bank' | 'keyring'

type GearTab = 'sheet' | 'effects' | 'finder' | 'optimize' | 'pet'

const TABS: [GearTab, string][] = [
  ['sheet', 'Character sheet'],
  ['effects', 'Effects'],
  ['finder', 'Upgrade finder'],
  ['optimize', 'Gear optimiser'],
  ['pet', 'Pet']
]

/** What gear does beyond its stats: the three kinds the Effects tab shows, one at a time. */
type EffectsKind = 'focus' | 'effects' | 'procs'

const EFFECTS: [EffectsKind, string][] = [
  ['focus', 'Focus items'],
  ['effects', 'Worn effects'],
  ['procs', 'Procs']
]

/**
 * The Gear page, or with `only` one of its views on its own (the Motes page shows Best merge this
 * way). `onPlan` is where a merge's Plan button goes.
 */
export function Gear({ go, only, onPlan }: { go?: Go; only?: GearMode; onPlan?: () => void }) {
  const exp = useCharacterChoice('inventory')
  const { exports, available, character, setCharacter } = exp
  const inv = useInventory(character, !!exports, available.join(','))
  const { view, setView, sheet, updateSheet } = inv
  const { record } = useCharacterRecord(character)
  const [selected, setSelected] = useState<string | null>(null)
  const [scaled, setScaled] = useRemembered<boolean>('gear.scaled', true)
  const [refreshing, setRefreshing] = useState(false)
  const [remembered, setTab] = useRemembered<'sheet' | GearMode>('gear.view', 'sheet')
  const [kind, setKind] = useRemembered<EffectsKind>('gear.effects', 'focus')
  // Focus items and Procs were tabs of their own, now under Effects; Best merge is on the Motes page, and a remembered 'merge' opens the sheet here.
  const tab: GearTab = remembered === 'merge' ? 'sheet' : remembered === 'focus' || remembered === 'procs' ? 'effects' : remembered
  const mode = only ?? (tab === 'effects' ? kind : tab)
  // Worked out once per inventory and sheet, for the card and the totals both.
  const summary = useMemo(() => (view?.inventory ? wornSummary(view, sheet) : null), [view, sheet])

  if (!exports || !view)
    return (
      <Pending
        what="your inventory"
        error={exp.error || inv.error}
        retry={() => {
          exp.reload()
          inv.reload()
        }}
      />
    )

  const stats = withRecord(readStatsInputs(sheet?.stats), record)
  const classes = stats.classes.filter(Boolean)
  const [name, server] = (view.character || character).split('_')

  const picker = <CharacterPicker character={character} available={available} onPick={setCharacter} />
  const refresh = view.inventory && (
    <button
      className="btn"
      disabled={refreshing}
      title="Fetch every worn item from eqlwiki.com again"
      onClick={async () => {
        setRefreshing(true)
        try {
          setView(await api.invoke('inventory:load', character, true))
        } catch (e) {
          showError('Could not fetch the item stats', e)
        } finally {
          setRefreshing(false)
        }
      }}
    >
      {refreshing ? 'Refreshing…' : 'Refresh item stats'}
    </button>
  )
  const head = (
    <div className="page-head">
      <div>
        <h1>Gear</h1>
        <p>
          What {name || 'your character'} is wearing, from the game's inventory export: every item at its merge level, with the stats the wiki gives it. Type{' '}
          <GameCommand cmd="/outputfile inventory" /> in game after a change; this page follows the file
          {view.modified > 0 && (
            <>
              {' '}
              (last written <Ago t={view.modified} />)
            </>
          )}
          .
        </p>
      </div>
      <div className="actions">
        {picker}
        {refresh}
      </div>
    </div>
  )
  // On another page (Motes), no second title: whose gear it is, with the same picker and refresh.
  const top = only ? (
    <div className="row mb-12" style={{ flexWrap: 'wrap' }}>
      <span className="small muted grow">The gear of the character picked here, from its inventory export.</span>
      {picker}
      {refresh}
    </div>
  ) : (
    head
  )

  if (!view.inventory || !summary) {
    return (
      <>
        {top}
        <div className="card empty">
          {view.error === 'missing' || !character ? (
            <>
              No inventory export for {character ? <b>{who(character)}</b> : 'this character'} yet. Type <GameCommand cmd="/outputfile inventory" /> in game and this page fills in
              within a few seconds.
            </>
          ) : (
            <>
              Could not read {view.file}: {view.error}
            </>
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
    <>
      <div className="row mb-12">
        <Tabs label="Gear view" value={tab} onChange={setTab} tabs={TABS} />
      </div>
      {tab === 'effects' && (
        <div className="row mb-12">
          <b>Show</b>
          <Segmented label="Which effects" value={kind} onChange={setKind} options={EFFECTS} />
        </div>
      )}
    </>
  )

  if (only)
    return (
      <>
        {top}
        <GearFinder view={view} sheet={sheet} mode={only} onPlan={onPlan} />
      </>
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
          <CharacterCard name={name} server={server} level={stats.level} classes={classes} view={view} summary={summary} />
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
          updateSheet={updateSheet}
          onClose={() => setSelected(null)}
          onPlan={async () => {
            const lvl = mergeLevel(picked.name)
            try {
              await api.invoke('stock:item', { name: picked.name, lvl, xp: 0, to: Math.min(MAX_MERGE + 1, lvl + 1) })
            } catch (e) {
              showError('Could not set up the planner', e)
              return
            }
            go?.('motes', 'planner')
          }}
        />
      )}
      <GearTotals view={view} sheet={sheet} updateSheet={updateSheet} summary={summary} scaled={scaled} setScaled={setScaled} />
      <Carried view={view} classes={classes} />
      <p className="faint small mt-16">
        Item stats and icon numbers come from{' '}
        <a href="https://eqlwiki.com" target="_blank" rel="noreferrer">
          eqlwiki.com
        </a>
        , the community wiki, scaled for each item's +N merge level the way the wiki's item level slider scales them; the icons themselves are the game's own. Exaltation augments
        add nothing on top: their effects are already part of the item's figures.
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
    <button
      className={`lt-tile${wide ? ' wide' : ''}${selected ? ' selected' : ''}${info && !info.found ? ' unknown' : ''}`}
      onClick={onSelect}
      title={info && !info.found ? 'Not on the wiki' : 'Show this item'}
    >
      <ItemIcon icon={info?.icon} size={36} />
      <div className="lt-tile-body">
        <span className="lt-slot">
          {slot}
          {lvl > 0 && <MergePlus level={lvl} />}
          {item.augs.length > 0 && (
            <span className="lt-augs" title={item.augs.map((a) => augName(a.name)).join('\n')}>
              {item.augs.map((a) => (
                <AugDot key={a.location} name={a.name} view={view} />
              ))}
              <span className="sr-only">, augmented with {item.augs.map((a) => augName(a.name)).join(', ')}</span>
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
function CharacterCard({
  name,
  server,
  level,
  classes,
  view,
  summary
}: {
  name: string
  server?: string
  level?: number
  classes: string[]
  view: InventoryView
  summary: WornSummary
}) {
  const { totals } = summary
  const worn = view.inventory?.worn ?? []
  const levels = worn.map((it) => mergeLevel(it.name))
  const merged = levels.filter((l) => l > 0)
  const avg = merged.length ? merged.reduce((a, b) => a + b, 0) / merged.length : 0
  const maxed = levels.filter((l) => l >= MAX_MERGE).length
  const progress = (levels.reduce((a, b) => a + b, 0) / Math.max(1, worn.length * MAX_MERGE)) * 100
  return (
    <div className="lt-card">
      <div className="lt-who">
        <span className="lt-name-big">{name}</span>
        {server && <span className="muted">{server}</span>}
      </div>
      <div className="row tight" style={{ gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {level ? <span className="chip pill gold">Level {level}</span> : null}
        {classes.map((c) => (
          <span key={c} className="chip pill">
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
      <div className="lt-big three">
        <div>
          <b>
            {merged.length}
            <small> / {worn.length}</small>
          </b>
          <span>Merged</span>
        </div>
        <div>
          <b>+{avg.toFixed(1)}</b>
          <span>Average</span>
        </div>
        <div>
          <b className={maxed ? 'lt-maxed' : ''}>{maxed}</b>
          <span>At +{MAX_MERGE}</span>
        </div>
      </div>
      <div className="lt-merge">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">Total merge progress</span>
          <b className="small">{Math.floor(progress)}%</b>
        </div>
        <div className="bar thick merge" role="img" aria-label={`Total merge progress ${Math.floor(progress)}%`}>
          <i style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  )
}

function Carried({ view, classes }: { view: InventoryView; classes: string[] }) {
  const [filter, setFilter] = useRemembered<Filter>('gear.filter', 'all')
  const [q, setQ] = useState('')
  const inv = view.inventory!
  // Keep, sell or merge fodder (FEAT-034): from the wiki's catalog, the optimiser's best set and the starred recipes.
  const catalog = useCatalog().state?.file?.items
  const byKey = useMemo(() => new Map((catalog ?? []).map((c) => [itemKey(c.title), c])), [catalog])
  const [picks] = useRemembered<OptimizedPick[]>(`${OPTIMIZED_KEY}.${view.character}`, [])
  const pickNames = useMemo(() => new Set(picks.map((p) => p.name)), [picks])
  const wantedQ = useInvoke('trade:wanted')
  const wanted = useMemo(() => new Set(Object.keys(wantedQ.data ?? {})), [wantedQ.data])
  const wornNames = useMemo(() => inv.worn.map((it) => it.name), [inv])
  const wearer = useMemo<Wearer | null>(() => (classes.length ? { classes, race: '', level: 100 } : null), [classes])
  const judge = (name: string, kind: Filter) =>
    kind === 'all' ? null : judgeOwned({ name, kind, worn: wornNames, picks: pickNames, catalog: byKey, wearer, wanted, value: view.items[itemKey(name)]?.use?.value })
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
    for (const k of inv.keyRing) out.push({ kind: 'keyring', name: k.name, where: `Storage › ${storageTab(k.kind)}`, count: 1 })
    return out
  }, [inv])
  const counts = { all: rows.length, worn: 0, bags: 0, bank: 0, keyring: 0 }
  for (const r of rows) counts[r.kind]++
  const query = q.trim().toLowerCase()
  // Each row keyed by where it is and what, so a filter keeps rows rather than remounting them (LT-405).
  const shown = useMemo(() => {
    const seen = new Map<string, number>()
    return rows
      .filter((r) => (filter === 'all' || r.kind === filter) && (!query || r.name.toLowerCase().includes(query)))
      .map((r) => {
        const k = `${r.where}|${r.name}`
        const n = seen.get(k) ?? 0
        seen.set(k, n + 1)
        return { ...r, key: n ? `${k}|${n}` : k }
      })
  }, [rows, filter, query])
  const label: Record<Filter, string> = { all: 'Everything', worn: 'Worn', bags: 'Bags', bank: 'Bank', keyring: 'Storage' }
  return (
    <div className="card lt-carried">
      <div className="row mb-12">
        <h2 style={{ margin: 0 }}>Where everything is</h2>
        <span className="grow" />
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={(Object.keys(label) as Filter[]).map((f) => [
            f,
            <>
              {label[f]} <small>{counts[f]}</small>
            </>
          ])}
        />
        <FilterBox className="inv-search" placeholder="Filter items…" label="Filter items" value={q} onChange={setQ} width={200} />
      </div>
      <div className="lt-list">
        {shown.map((r) => (
          <div key={r.key} className="lt-row">
            <span className="lt-row-name" title={r.name}>
              {r.name}
            </span>
            <span className="muted small">
              {r.where}
              {(() => {
                const v = judge(r.name, r.kind)
                return v ? (
                  <span className={`chip small ${v.verdict === 'keep' ? 'ok' : v.verdict === 'sell' ? 'warn' : ''}`} title={v.why}>
                    {' '}
                    {v.verdict === 'fodder' ? 'merge fodder' : v.verdict}
                  </span>
                ) : null
              })()}
            </span>
            <span className="mono small">{r.count > 1 ? `×${num(r.count)}` : ''}</span>
          </div>
        ))}
        {!shown.length && <div className="empty">Nothing here{query ? ` called "${q}"` : ''}.</div>}
      </div>
    </div>
  )
}
