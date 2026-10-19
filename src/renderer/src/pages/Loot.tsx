import { useMemo, useState } from 'react'
import { num, timeOfDay, when } from '../../../core/format'
import { useInvoke, useItemInfo, useLootView, useVisibleInterval } from '../hooks'
import { useRemembered } from '../remember'
import { actDone } from '../toast'
import { wikiUrl } from '../../../core/format'
import { Ago, Disclosure, FilterBox, Icon, Info, Pending, ToggleChip } from '../components/ui'
import { describeItem, fmtCoin, itemWorth, lastSales, sessionWorth, type LootEntry, type LootOutcome, type WorthFrom } from '../../../core/loot'
import { itemKey } from '../../../core/inventory'
import type { ItemInfo } from '../../../shared/types'
import { NotWatching } from '../components/NotWatching'

// What has dropped, session by session, with a line on what each item is for and a link to its
// page. The looking-up is the Gear page's: eqlwiki, cached a week.

const OUTCOMES: { key: LootOutcome; label: string; hint: string }[] = [
  { key: 'kept', label: 'Kept', hint: 'Put in your bags' },
  { key: 'merged', label: 'Merged', hint: 'Merged into an item you own, raising its +N' },
  { key: 'sold', label: 'Sold', hint: 'Auto-loot sold it on the spot' },
  { key: 'depot', label: 'Depot', hint: 'Stored in your tradeskill depot' },
  { key: 'hoard', label: 'Hoard', hint: 'Stored in your Dragon Hoard' },
  { key: 'currency', label: 'Currency', hint: 'Motes and runes, stored as currency; the Motes page counts them' }
]

const ALLA = (name: string) => `https://everquest.allakhazam.com/search.html?q=${encodeURIComponent(name)}`

/** Items shown at most; older loot stays in the ledger. */
const SHOWN = 400
/** Opened sessions remembered at most; older ones fold again. */
const OPEN_KEPT = 50

const useLoot = useLootView

/** Where a row's price came from, as its chip says it (LT-744). */
const WORTH_FROM: Record<WorthFrom, string> = {
  sold: 'what auto-loot last sold one for',
  offer: 'what a merchant last offered you for one, your charisma and faction in',
  wiki: "the wiki's merchant value, before charisma and faction"
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
  // What kept loot is worth: the last sale of its name, else a merchant's offer to you, else the wiki (LT-725, LT-744).
  const offersQ = useInvoke('loot:offers')
  useVisibleInterval(offersQ.reload, 60_000)
  const sales = useMemo(() => lastSales(view?.entries ?? []), [view])
  const worthOf = (e: LootEntry) => itemWorth(e.base, { sales, offers: offersQ.data ?? {}, wikiValue: info[itemKey(e.base)]?.use?.value })

  const toggle = (k: LootOutcome) => setHidden(hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k])
  // One status for the list, not one a row still on its way from eqlwiki (LT-684).
  const lookingUp = shownNames.filter((n) => !info[itemKey(n)]).length
  // Everything hidden by the outcome chips, nothing typed: said so, with a way back (LT-693).
  const allHidden = OUTCOMES.every((o) => hidden.includes(o.key))

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

      <NotWatching what="new loot and sales" />

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
        <span className="faint small" role="status">
          {lookingUp ? `Looking up ${num(lookingUp)} item${lookingUp === 1 ? '' : 's'} on eqlwiki…` : ''}
        </span>
        <span className="faint small">{view ? `${view.entries.length} item${view.entries.length === 1 ? '' : 's'} on record` : ''}</span>
        <button
          className="btn small"
          onClick={() => void actDone('New session started.', 'combat:newSession')}
          title="Close the current session and start a new one from now: loot from here on goes under it. Sessions are the damage meter's, so it starts one there too."
        >
          <Icon name="flag" /> New session
        </button>
      </div>

      {!view ? (
        <Pending error={q.error} retry={q.reload} what="the loot" />
      ) : !groups.length ? (
        <div className="card empty">
          {!view.entries.length ? (
            'Nothing looted yet.'
          ) : allHidden && !filtering ? (
            <>
              Every outcome is hidden: turn one on above, or{' '}
              <button className="link-button inline" onClick={() => setHidden([])}>
                show all
              </button>
              .
            </>
          ) : (
            'Nothing matches the filter.'
          )}
        </div>
      ) : (
        groups.map((g) => {
          const s = sessions.get(g.id)
          const coin = view.coin[g.id]
          const first = g.entries[g.entries.length - 1]
          const last = g.entries[0]
          const open = isOpen(g.id)
          const name = s?.name || first.zone || 'Session'
          return (
            <div className={`card loot-session${open ? '' : ' folded'}`} key={`${g.id}-${first.id}`}>
              <div className="loot-session-head">
                <h2>
                  <Disclosure open={open} onToggle={() => toggleOpen(g.id)} title={filtering ? 'Open while filtering' : undefined} disabled={filtering}>
                    {name}
                  </Disclosure>
                </h2>
                <span className="faint small">
                  {when(first.at)}
                  {last.at - first.at > 60_000 ? ` – ${timeOfDay(last.at)}` : ''}
                </span>
                <span className="chip">
                  {g.entries.length} item{g.entries.length === 1 ? '' : 's'}
                </span>
                {coin && coin.corpse > 0 && (
                  <span className="chip as-is" title="Coin picked up from corpses">
                    {fmtCoin(coin.corpse)} looted
                  </span>
                )}
                {coin && coin.sales > 0 && (
                  <span className="chip as-is" title="Coin from items sold, by auto-loot or at a merchant">
                    {fmtCoin(coin.sales)} sold
                  </span>
                )}
                <WorthChip w={sessionWorth(g.entries, worthOf)} />
              </div>
              {open && g.entries.map((e) => <Row key={e.id} e={e} info={info[itemKey(e.base)]} worth={worthOf(e)} refresh={refresh} />)}
            </div>
          )
        })
      )}
    </>
  )
}

/** What a session's kept loot would sell for, of the items a price is known for (LT-744). */
function WorthChip({ w }: { w: { copper: number; priced: number; items: number } }) {
  if (!w.copper) return null
  return (
    <span
      className="chip as-is"
      title={`What the items kept would sell for: ${w.priced} of ${w.items} priced, by the last sale of their name, a merchant's offer to you, or the wiki's merchant value for those looked up (open the session to look up the rest)`}
    >
      ≈ {fmtCoin(w.copper)} worth
    </span>
  )
}

function Row({
  e,
  info,
  worth,
  refresh
}: {
  e: LootEntry
  info: ItemInfo | undefined
  worth: { copper: number; from: WorthFrom } | null
  refresh: (name: string) => Promise<void>
}) {
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
        {e.plus > 0 && <span className="chip pill gold">+{e.plus}</span>}
        <span className={`chip ${e.outcome}`} title={o.hint}>
          {o.label}
          {e.outcome === 'sold' && e.copper > 0 ? ` · ${fmtCoin(e.copper)}` : ''}
          {e.outcome === 'merged' && e.into ? ` → ${e.into}` : ''}
        </span>
        {e.looter !== 'You' && <span className="chip">{e.looter}</span>}
        {worth && e.outcome !== 'sold' && e.outcome !== 'currency' && (
          <span className="chip as-is" title={`Sells for this: ${WORTH_FROM[worth.from]}`}>
            sells {fmtCoin(worth.copper)}
            {worth.from === 'wiki' ? ' (wiki)' : ''}
          </span>
        )}
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
          <span className="faint">Looking it up on eqlwiki…</span>
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
