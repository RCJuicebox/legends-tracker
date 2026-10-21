import { useEffect, useRef } from 'react'
import { Ago, Segmented, Switch } from '../components/ui'
import { numExact as num, wikiUrl } from '../../../core/format'
import { itemKey, mergeLevel, parseStatsBlock, slotLabel, wornTotals, SAVE_KEYS, STAT_KEYS, type InvItem } from '../../../core/inventory'
import type { CharacterSheet, InventoryView, ItemInfo } from '../../../shared/types'
import { statsFor, type WornSummary } from '../../../core/wornGear'
import { ItemIcon } from './gearBits'
import { MAX_MERGE, MergePips, MergePlus, UpdateSheet, augName, plainName } from './GearParts'

// The Gear page's panels (LT-638): the totals of what is worn, and an item's own panel.

export function GearTotals({
  view,
  sheet,
  updateSheet,
  summary,
  scaled,
  setScaled
}: {
  view: InventoryView
  sheet: CharacterSheet | null
  updateSheet: UpdateSheet
  summary: WornSummary
  scaled: boolean
  setScaled: (v: boolean) => void
}) {
  const worn = view.inventory?.worn ?? []
  const base = (it: InvItem) => {
    const info = view.items[itemKey(it.name)]
    return info?.found ? parseStatsBlock(info.statsblock) : null
  }
  const t = scaled ? summary.totals : wornTotals(worn, base, (it) => sheet?.acOverrides[itemKey(it.name)])
  const { secondary, shield, shieldByName, shieldAC } = summary
  const found = worn.filter((it) => view.items[itemKey(it.name)]?.found).length
  const statName: Record<string, string> = { STR: 'Strength', STA: 'Stamina', AGI: 'Agility', DEX: 'Dexterity', WIS: 'Wisdom', INT: 'Intelligence', CHA: 'Charisma' }
  const bar = (label: string, v: number, most: number) => (
    <div key={label} className="lt-bar">
      <span>{label}</span>
      <span className="bar soft">
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
          <Segmented
            label="Attributes shown"
            value={scaled ? 'merged' : 'base'}
            onChange={(v) => setScaled(v === 'merged')}
            options={[
              ['merged', 'With merges'],
              ['base', 'Base']
            ]}
          />
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
        <div className="faint small mt-12">
          {found} of {worn.length} worn items on the wiki · ammo left out of AC
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          {secondary ? (
            <label className="row tight" style={{ cursor: 'pointer' }}>
              <Switch on={shield} onChange={(on) => updateSheet((sh) => ({ ...sh, shield: on === shieldByName ? null : on }))} />
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

export function statsText(info: ItemInfo): string {
  return info.statsblock
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export function ItemPanel({
  item,
  view,
  sheet,
  updateSheet,
  onClose,
  onPlan
}: {
  item: InvItem
  view: InventoryView
  sheet: CharacterSheet | null
  updateSheet: UpdateSheet
  onClose: () => void
  onPlan: () => void
}) {
  const key = itemKey(item.name)
  const info = view.items[key]
  const s = statsFor(view.items, item.name)
  const own = sheet?.acOverrides[key]
  const lvl = mergeLevel(item.name)
  // The panel sits below the sheet, often below the fold: it comes into view and takes focus when an
  // item is picked, so the click is seen to do something; Escape closes it (LT-681).
  const title = useRef<HTMLDivElement>(null)
  useEffect(() => {
    title.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    title.current?.focus({ preventScroll: true })
  }, [item.name])
  return (
    <div
      className="card lt-panel"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        onClose()
      }}
    >
      <div className="row gap-12" style={{ alignItems: 'flex-start' }}>
        <ItemIcon icon={info?.icon} size={44} />
        <div className="grow">
          <div className="lt-panel-title" ref={title} tabIndex={-1}>
            {plainName(item.name)} {lvl > 0 && <MergePlus level={lvl} />}
          </div>
          <div className="row small muted">
            <span>{slotLabel(item.location)}</span>
            <MergePips level={lvl} />
            {info?.found && (
              <a href={wikiUrl(info.title)} target="_blank" rel="noreferrer">
                eqlwiki
              </a>
            )}
          </div>
        </div>
        {lvl < MAX_MERGE && (
          <button className="btn primary small" onClick={onPlan} title="Open Motes › Merge planner with this item">
            Plan this upgrade
          </button>
        )}
        <button className="btn ghost small x-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="lt-panel-body">
        <div>
          {info?.found ? (
            <>
              <div className="small faint mb-4">The wiki's stats, base values{lvl ? `; at +${lvl}: AC ${s?.ac ?? 0}` : ''}</div>
              <pre className="inv-block">{statsText(info)}</pre>
              {info.fetchedAt ? (
                <p className="faint small">
                  From eqlwiki, looked up <Ago t={info.fetchedAt} />; Refresh item stats reads every worn item's page again.
                </p>
              ) : null}
            </>
          ) : (
            <p className="small muted">eqlwiki has no page for this item, so it adds nothing to the totals unless you type its AC below.</p>
          )}
          <label className="row small gap-8 mt-12">
            AC
            <input
              className="inv-ac"
              type="number"
              min={0}
              value={own ?? ''}
              placeholder={s ? String(s.ac) : '?'}
              onChange={(e) => {
                const raw = e.target.value
                updateSheet((sh) => {
                  const next = { ...sh.acOverrides }
                  if (raw === '') delete next[key]
                  else next[key] = Math.max(0, Math.floor(Number(raw) || 0))
                  return { ...sh, acOverrides: next }
                })
              }}
            />
            <span className="faint">{own !== undefined ? 'your figure; clear it to use the wiki' : 'type to correct the wiki'}</span>
          </label>
        </div>
        {item.augs.length > 0 && (
          <div className="stack gap-12">
            {item.augs.map((a) => {
              const ai = view.items[itemKey(a.name)]
              return (
                <div key={a.location}>
                  <div className="row small gap-8">
                    <ItemIcon icon={ai?.icon} size={22} />
                    <b>{augName(a.name)}</b>
                    <span className="chip pill">exaltation</span>
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
