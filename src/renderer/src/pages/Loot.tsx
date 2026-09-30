import { useEffect, useMemo, useState } from 'react'
import { day, timeOfDay } from '../../../core/format'
import { api } from '../api'
import { useInvoke, useItemInfo } from '../hooks'
import { useRemembered } from '../remember'
import { wikiUrl } from '../../../core/format'
import { Ago, FilterBox, Icon, Info, Pending, ToggleChip } from '../components/ui'
import { describeItem, fmtCoin, type LootEntry, type LootOutcome } from '../../../core/loot'
import { itemKey } from '../../../core/inventory'
import type { ItemInfo } from '../../../shared/types'
import type { LootView } from '../../../shared/ipc'

// What has dropped, session by session, with a line on what each item is for and a link to its
// page. The looking-up is the Gear page's: eqlwiki, cached a week.

type View = LootView

const OUTCOMES: { key: LootOutcome; label: string; hint: string }[] = [
  { key: 'kept', label: 'Kept', hint: 'Put in your bags' },
  { key: 'merged', label: 'Merged', hint: 'Merged into an item you own, raising its +N' },
  { key: 'sold', label: 'Sold', hint: 'Auto-loot sold it on the spot' },
  { key: 'depot', label: 'Depot', hint: 'Stored in your tradeskill depot' },
  { key: 'currency', label: 'Currency', hint: 'Motes and runes, stored as currency; the Motes page counts them' }
]

const ALLA = (name: string) => `https://everquest.allakhazam.com/search.html?q=${encodeURIComponent(name)}`

/** Items shown at most; older loot stays in the ledger. */
const SHOWN = 400
/** Opened sessions remembered at most; older ones fold again. */
const OPEN_KEPT = 50

function useLoot() {
  const q = useInvoke('loot:get')
  const setData = q.setData
  useEffect(() => api.on('state:loot', (v: View) => setData(v)), [setData])
  return q
}

export function Loot() {
  const q = useLoot()
  const view = q.data
  const [filter, setFilter] = useState('')
  const [hidden, setHidden] = useRemembered<LootOutcome[]>('loot.hidden', ['currency'])
  // Sessions start folded; these are the ones opened. A filter opens every session it matches.
  const [opened, setOpened] = useRemembered<string[]>('loot.open', [])
  const filtering = filter.trim().length > 0
  const isOpen = (id: string) => filtering || opened.includes(id)
  const toggleOpen = (id: string) => setOpened(opened.includes(id) ? opened.filter((x) => x !== id) : [id, ...opened].slice(0, OPEN_KEPT))

  const entries = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (view?.entries ?? [])
      .filter((e) => !hidden.includes(e.outcome))
      .filter((e) => !f || e.item.toLowerCase().includes(f) || e.source.toLowerCase().includes(f) || e.looter.toLowerCase().includes(f))
      .slice(0, SHOWN)
  }, [view, hidden, filter])

  const groups = useMemo(() => {
    const out: { id: string; entries: LootEntry[] }[] = []
    for (const e of entries) {
      const last = out[out.length - 1]
      if (last && last.id === e.sessionId) last.entries.push(e)
      else out.push({ id: e.sessionId, entries: [e] })
    }
    return out
  }, [entries])

  // The wiki, for what the open sessions show.
  const shownNames = useMemo(() => [...new Set(groups.filter((g) => filtering || opened.includes(g.id)).flatMap((g) => g.entries.map((e) => e.base)))], [groups, filtering, opened])
  const { info, refresh } = useItemInfo(shownNames)
  const sessions = useMemo(() => new Map((view?.sessions ?? []).map((s) => [s.id, s])), [view])

  const toggle = (k: LootOutcome) => setHidden(hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Loot</h1>
          <p>
            Everything looted, newest first, by session: what each item is, from its page on eqlwiki, and a link there or to Allakhazam for the rest. The last hour of the log is
            read in when watching starts.
          </p>
        </div>
      </div>

      <div className="card row mb-16">
        <FilterBox placeholder="Filter by item, mob or looter…" label="Filter loot" value={filter} onChange={setFilter} width={260} />
        <span className="row tight" role="group" aria-label="Outcomes shown">
          {OUTCOMES.map((o) => (
            <ToggleChip key={o.key} className={o.key} on={!hidden.includes(o.key)} title={o.hint} onChange={() => toggle(o.key)}>
              {o.label}
            </ToggleChip>
          ))}
        </span>
        <span className="spacer" />
        {view?.reading && <span className="chip warn">{view.reading}</span>}
        <span className="faint small">{view ? `${view.entries.length} item${view.entries.length === 1 ? '' : 's'} on record` : ''}</span>
      </div>

      {!view ? (
        <Pending error={q.error} retry={q.reload} what="the loot" />
      ) : !groups.length ? (
        <div className="card empty">{view.entries.length ? 'Nothing matches the filter.' : 'Nothing looted yet. Loot something while watching and it appears here.'}</div>
      ) : (
        groups.map((g) => {
          const s = sessions.get(g.id)
          const coin = view.coin[g.id]
          const first = g.entries[g.entries.length - 1]
          const last = g.entries[0]
          const open = isOpen(g.id)
          const name = s?.name || first.zone || 'Session'
          return (
            <div className={`card loot-session${open ? '' : ' folded'}`} key={`${g.id}-${last.id}`}>
              <div className="loot-session-head">
                <button
                  className="btn small ghost"
                  aria-expanded={open}
                  aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
                  title={filtering ? 'Open while filtering' : open ? 'Collapse' : 'Expand'}
                  disabled={filtering}
                  onClick={() => toggleOpen(g.id)}
                  style={{ width: 28 }}
                >
                  {open ? '▾' : '▸'}
                </button>
                <h2>{name}</h2>
                <span className="faint small">
                  {day(first.at)} · {timeOfDay(first.at)}
                  {last.at - first.at > 60_000 ? ` – ${timeOfDay(last.at)}` : ''}
                </span>
                <span className="chip">
                  {g.entries.length} item{g.entries.length === 1 ? '' : 's'}
                </span>
                {coin && coin.corpse > 0 && (
                  <span className="chip" title="Coin picked up from corpses">
                    {fmtCoin(coin.corpse)} looted
                  </span>
                )}
                {coin && coin.sales > 0 && (
                  <span className="chip" title="Coin from items sold, by auto-loot or at a merchant">
                    {fmtCoin(coin.sales)} sold
                  </span>
                )}
              </div>
              {open && g.entries.map((e) => <Row key={e.id} e={e} info={info[itemKey(e.base)]} refresh={refresh} />)}
            </div>
          )
        })
      )}
    </>
  )
}

function Row({ e, info, refresh }: { e: LootEntry; info: ItemInfo | undefined; refresh: (name: string) => Promise<void> }) {
  const [refreshing, setRefreshing] = useState(false)
  const [iconOk, setIconOk] = useState(true)
  const d = describeItem(info)
  const title = info?.found ? info.title : e.base
  const o = OUTCOMES.find((x) => x.key === e.outcome)!
  return (
    <div className={`loot-row${e.outcome === 'sold' && !e.copper ? ' dim' : ''}`}>
      {info?.icon && iconOk ? <img className="loot-icon" src={`eqicon://item/${info.icon}`} alt="" onError={() => setIconOk(false)} /> : <span className="loot-icon blank" />}
      <div className="loot-name">
        <a href={wikiUrl(title)} target="_blank" rel="noreferrer" title="Open on eqlwiki">
          {e.count > 1 ? `${e.count} × ` : ''}
          {e.base}
        </a>
        {e.plus > 0 && <span className="lt-chip gold">+{e.plus}</span>}
        <span className={`chip ${e.outcome}`} title={o.hint}>
          {o.label}
          {e.outcome === 'sold' && e.copper > 0 ? ` · ${fmtCoin(e.copper)}` : ''}
          {e.outcome === 'merged' && e.into ? ` → ${e.into}` : ''}
        </span>
        {e.looter !== 'You' && <span className="chip">{e.looter}</span>}
      </div>
      <div className="loot-side">
        <span>
          {e.source} · {timeOfDay(e.at)}
        </span>
        <span className="loot-links">
          <a href={wikiUrl(title)} target="_blank" rel="noreferrer" title="This item on eqlwiki, the EverQuest Legends wiki">
            <Icon name="link" /> eqlwiki
          </a>
          <a href={ALLA(e.base)} target="_blank" rel="noreferrer" title="Search Allakhazam's EverQuest database for this item">
            <Icon name="link" /> Allakhazam
          </a>
        </span>
      </div>
      <div className="loot-what">
        {!info ? (
          <Pending inline doing="Looking it up on eqlwiki" />
        ) : (
          <>
            {d.head && <b>{d.head}</b>}
            {d.body.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {!d.head && !d.body.length && info.found && <span className="faint">The page says nothing about what it is for.</span>}
            {!info.found && (
              <span className="faint">
                Not on eqlwiki under this name; try Allakhazam.{' '}
                <Info label="About the lookup" text="Item names are matched to eqlwiki page titles, then searched for. A page with a different spelling can be missed." />
              </span>
            )}
            {info.fetchedAt ? (
              <div className="faint small">
                From eqlwiki, looked up <Ago t={info.fetchedAt} />.{' '}
                <button
                  className="link-button"
                  disabled={refreshing}
                  onClick={() => {
                    setRefreshing(true)
                    void refresh(e.base).finally(() => setRefreshing(false))
                  }}
                >
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
