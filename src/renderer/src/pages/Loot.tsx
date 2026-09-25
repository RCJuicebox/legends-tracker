import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { wikiUrl } from '../format'
import { Icon, Info, Pending } from '../components/ui'
import { fmtCoin, type LootEntry, type LootOutcome, type LootSnapshot } from '../../../core/loot'
import { itemKey } from '../../../core/inventory'
import type { ItemInfo, SegmentSummary } from '../../../shared/types'

// What has dropped, session by session, with a line on what each item is for and a link to its
// page. The looking-up is the Gear page's: eqlwiki, cached a week.

type View = LootSnapshot & { sessions: SegmentSummary[] }

const OUTCOMES: { key: LootOutcome; label: string; hint: string }[] = [
  { key: 'kept', label: 'Kept', hint: 'Put in your bags' },
  { key: 'merged', label: 'Merged', hint: 'Merged into an item you own, raising its +N' },
  { key: 'sold', label: 'Sold', hint: 'Auto-loot sold it on the spot' },
  { key: 'depot', label: 'Depot', hint: 'Stored in your tradeskill depot' },
  { key: 'currency', label: 'Currency', hint: 'Motes and runes, stored as currency; the Motes page counts them' }
]

const ALLA = (name: string) => `https://everquest.allakhazam.com/search.html?q=${encodeURIComponent(name)}`

const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const day = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

/** Items shown at most; older loot stays in the ledger. */
const SHOWN = 400

function useLoot() {
  const q = useInvoke<View>('loot:get')
  const setData = q.setData
  useEffect(() => api.on('state:loot', (v: View) => setData(v)), [setData])
  return q
}

/** What the wiki says an item is, in a line or two. */
function describe(info: ItemInfo | undefined): { head: string; body: string[] } {
  if (!info) return { head: '', body: [] }
  if (!info.found) return { head: 'Not on eqlwiki', body: [] }
  const lines = info.statsblock
    .split(/<br\s*\/?>/i)
    .map((l) => l.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const slot = lines.find((l) => /^Slot:/i.test(l))
  const head: string[] = []
  if (slot) {
    head.push(slot.replace(/^Slot:\s*/i, ''))
    for (const l of lines) if (/^(AC|DMG|Skill|Effect|Focus):|^[A-Z]{2,4}: [+-]?\d/.test(l) && !/^(WT|Size):/i.test(l) && head.length < 4) head.push(l)
    const cls = lines.find((l) => /^Class:/i.test(l))
    if (cls) head.push(cls.replace(/^Class:\s*/i, ''))
  } else {
    const flags = lines[0] && !/^(WT|Size):/i.test(lines[0]) ? lines[0] : ''
    if (flags) head.push(flags)
  }
  const body: string[] = []
  const u = info.use
  if (u?.notes) body.push(u.notes)
  if (u?.quests.length) body.push(`Quests: ${u.quests.slice(0, 4).join(', ')}${u.quests.length > 4 ? ` +${u.quests.length - 4}` : ''}`)
  if (u?.recipes.length) body.push(`Recipes: ${u.recipes.slice(0, 4).join(', ')}${u.recipes.length > 4 ? ` +${u.recipes.length - 4}` : ''}`)
  if (u?.value) body.push(`Sells for ${u.value}`)
  return { head: head.join(' · '), body }
}

export function Loot() {
  const q = useLoot()
  const view = q.data
  const [filter, setFilter] = useState('')
  const [hidden, setHidden] = useRemembered<LootOutcome[]>('loot.hidden', ['currency'])
  const [info, setInfo] = useState<Record<string, ItemInfo>>({})
  const [asked] = useState(() => new Set<string>())

  const entries = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (view?.entries ?? [])
      .filter((e) => !hidden.includes(e.outcome))
      .filter((e) => !f || e.item.toLowerCase().includes(f) || e.source.toLowerCase().includes(f) || e.looter.toLowerCase().includes(f))
      .slice(0, SHOWN)
  }, [view, hidden, filter])

  // The wiki, for whatever is on screen and not yet known; asked once per name.
  useEffect(() => {
    const names = [...new Set(entries.map((e) => e.base))].filter((n) => !asked.has(itemKey(n)))
    if (!names.length) return
    for (const n of names) asked.add(itemKey(n))
    let on = true
    api.invoke<Record<string, ItemInfo>>('inventory:lookup', names).then(
      (r) => on && setInfo((prev) => ({ ...prev, ...r })),
      () => {
        // Offline: the names can be asked again later.
        for (const n of names) asked.delete(itemKey(n))
      }
    )
    return () => {
      on = false
    }
  }, [entries, asked])

  const groups = useMemo(() => {
    const out: { id: string; entries: LootEntry[] }[] = []
    for (const e of entries) {
      const last = out[out.length - 1]
      if (last && last.id === e.sessionId) last.entries.push(e)
      else out.push({ id: e.sessionId, entries: [e] })
    }
    return out
  }, [entries])
  const sessions = useMemo(() => new Map((view?.sessions ?? []).map((s) => [s.id, s])), [view])

  const toggle = (k: LootOutcome) => setHidden(hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Loot</h1>
          <p>
            Everything looted, newest first, by session: what each item is, from its page on eqlwiki, and a link there or to Allakhazam
            for the rest. The last hour of the log is read in when watching starts.
          </p>
        </div>
      </div>

      <div className="card row mb-16">
        <input placeholder="Filter by item, mob or looter…" aria-label="Filter loot" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 260 }} />
        <span className="row tight" role="group" aria-label="Outcomes shown">
          {OUTCOMES.map((o) => (
            <button key={o.key} className={`chip toggle ${o.key}${hidden.includes(o.key) ? ' off' : ''}`} aria-pressed={!hidden.includes(o.key)} title={o.hint} onClick={() => toggle(o.key)}>
              {o.label}
            </button>
          ))}
        </span>
        <span className="spacer" />
        {view?.reading && <span className="chip warn">{view.reading}</span>}
        <span className="faint small">
          {view ? `${view.entries.length} item${view.entries.length === 1 ? '' : 's'} on record` : ''}
        </span>
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
          return (
            <div className="card loot-session" key={`${g.id}-${last.id}`}>
              <div className="loot-session-head">
                <h2>{s?.name || first.zone || 'Session'}</h2>
                <span className="faint small">
                  {day(first.at)} · {when(first.at)}
                  {last.at - first.at > 60_000 ? ` – ${when(last.at)}` : ''}
                </span>
                <span className="chip">
                  {g.entries.length} item{g.entries.length === 1 ? '' : 's'}
                </span>
                {coin && coin.corpse > 0 && <span className="chip" title="Coin picked up from corpses">{fmtCoin(coin.corpse)} looted</span>}
                {coin && coin.sales > 0 && <span className="chip" title="Coin from items sold, by auto-loot or at a merchant">{fmtCoin(coin.sales)} sold</span>}
              </div>
              {g.entries.map((e) => (
                <Row key={e.id} e={e} info={info[itemKey(e.base)]} />
              ))}
            </div>
          )
        })
      )}
    </>
  )
}

function Row({ e, info }: { e: LootEntry; info: ItemInfo | undefined }) {
  const [iconOk, setIconOk] = useState(true)
  const d = describe(info)
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
          {e.source} · {when(e.at)}
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
          <span className="faint">Looking it up…</span>
        ) : (
          <>
            {d.head && <b>{d.head}</b>}
            {d.body.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {!d.head && !d.body.length && info.found && <span className="faint">The page says nothing about what it is for.</span>}
            {!info.found && (
              <span className="faint">
                Not on eqlwiki under this name; try Allakhazam. <Info label="About the lookup" text="Item names are matched to eqlwiki page titles, then searched for. A page with a different spelling can be missed." />
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
