import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ago } from '../api'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { act, showError } from '../toast'
import { Info, Pending } from '../components/ui'
import { wikiUrl } from '../format'
import { fmtCoin } from '../../../core/loot'
import { itemKey } from '../../../core/inventory'
import { parseWikiCoin, recipeKey, shopping, unitPrice, type PriceSource, type Purchase, type Recipe } from '../../../core/tradeskills'
import type { ItemInfo } from '../../../shared/types'
import { useExportCharacter, useInventory } from '../gear/model'
import { ItemIcon } from './gearBits'

// Recipes the player keeps making: what goes in, what they have (bags, bank, tradeskill depot), where
// to buy the rest and what a batch costs.

type BookRecipe = Recipe & { icon: number }

interface RecipeState {
  file: { fetchedAt: number; recipes: BookRecipe[] } | null
  stale: boolean
  progress: { busy: boolean; pages: number; total: number; error: string }
}

interface Favorite {
  key: string
  product: string
  combines: number
}

interface Saved {
  favorites: Favorite[]
  prices: Record<string, number>
}

/** Prices under a copper (one of a stack bought for a copper or two) still read as something. */
const coin = (copper: number) => (copper <= 0 ? '—' : copper < 1 ? '<1c' : fmtCoin(Math.round(copper)))

const SEARCH_SHOWN = 30

/**
 * EQ Traders Corner (eqtraders.com) is EverQuest Live's tradeskill site: recipes and vendors, mostly
 * the same for Legends' classic items. Its search is a form its robots.txt keeps tools off, so the
 * app only links there, through a site search the player's browser runs. DuckDuckGo's "\" prefix
 * goes straight to the first result, the item's own page, rather than a page of results.
 */
const eqtraders = (name: string) => `https://duckduckgo.com/?q=${encodeURIComponent(`\\site:eqtraders.com "${name}"`)}`

function useRecipes() {
  const q = useInvoke<RecipeState>('trade:recipes')
  const { setData, reload } = q
  useEffect(
    () =>
      api.on('state:recipes', (progress: RecipeState['progress']) => {
        setData((s) => (s ? { ...s, progress } : s))
        if (!progress.busy) reload()
      }),
    [setData, reload]
  )
  const refresh = useCallback(async () => {
    try {
      await api.invoke('trade:refresh')
    } catch (e) {
      showError('Could not download the recipes', e)
    }
    reload()
  }, [reload])
  return { ...q, refresh }
}

export function Tradeskills() {
  const exp = useExportCharacter('inventory', 'inv.character')
  const character = exp.character
  const inv = useInventory(character, !!exp.exports, exp.available.join(','))
  const recipes = useRecipes()
  const savedQ = useInvoke<Saved>('trade:favorites')
  const purchasesQ = useInvoke<Record<string, Purchase>>(character ? 'trade:purchases' : null, [character])
  const [query, setQuery] = useState('')
  // Recipe cards folded shut, by recipe key; kept across restarts.
  const [collapsed, setCollapsed] = useRemembered<string[]>('trade.collapsed', [])
  const [info, setInfo] = useState<Record<string, ItemInfo>>({})

  // New purchases show up as they happen: the log is read on from where it stopped.
  const reloadPurchases = purchasesQ.reload
  useEffect(() => {
    const t = setInterval(reloadPurchases, 30_000)
    return () => clearInterval(t)
  }, [reloadPurchases])

  const saved = savedQ.data
  const save = async (next: Saved) => {
    savedQ.setData(next)
    const r = await act<Saved>('trade:saveFavorites', next)
    if (r) savedQ.setData(r)
  }

  const book = useMemo(() => recipes.data?.file?.recipes ?? [], [recipes.data])
  const byKey = useMemo(() => new Map(book.map((r) => [recipeKey(r), r])), [book])
  const favorites = useMemo(() => (saved?.favorites ?? []).map((f) => ({ f, r: byKey.get(f.key) })), [saved, byKey])
  const favKeys = new Set(saved?.favorites.map((f) => f.key) ?? [])
  // What the recipes make, so an ingredient no vendor sells can say it is crafted, and how.
  const madeBy = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of book) if (!m.has(r.product.toLowerCase())) m.set(r.product.toLowerCase(), r.skill)
    return m
  }, [book])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return book.filter((r) => r.product.toLowerCase().includes(q)).slice(0, SEARCH_SHOWN)
  }, [book, query])

  // What the character holds: bags (and what the bags hold), bank, shared bank, tradeskill depot.
  const have = useMemo(() => {
    const m = new Map<string, number>()
    const i = inv.view?.inventory
    for (const it of [...(i?.bags ?? []), ...(i?.bank ?? []), ...(i?.sharedBank ?? []), ...(i?.depot ?? [])]) {
      const k = itemKey(it.name)
      m.set(k, (m.get(k) ?? 0) + it.count)
    }
    return m
  }, [inv.view])

  // Ingredient pages, for who sells them and the wiki's value; asked once per name.
  // An answer is kept whenever it comes: it is keyed by name, so one that outlives a later ask is
  // still right, and dropping it would leave its names asked and never answered.
  const [asked] = useState(() => new Set<string>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const names = useMemo(() => [...new Set(favorites.flatMap(({ r }) => r?.ingredients.map((i) => i.name) ?? []))], [favorites])
  useEffect(() => {
    const want = names.filter((n) => !asked.has(itemKey(n)))
    if (!want.length) return
    for (const n of want) asked.add(itemKey(n))
    api.invoke<Record<string, ItemInfo>>('inventory:lookup', want).then(
      (r) => mounted.current && setInfo((prev) => ({ ...prev, ...r })),
      () => {
        for (const n of want) asked.delete(itemKey(n))
      }
    )
  }, [names, asked])

  const bought = purchasesQ.data ?? {}
  const price = (name: string): { unit: number; from: PriceSource } => {
    // A price typed in is the player saying they know better; then what they last paid.
    const typed = saved?.prices[name.toLowerCase()]
    if (typed) return { unit: typed, from: 'typed' }
    const p = bought[name.toLowerCase()]
    if (p) return { unit: unitPrice(p), from: 'paid' }
    const use = info[itemKey(name)]?.use
    // A price the page's notes give ("35p from vendor"), else the merchant value, but only for what a
    // vendor sells: for a drop, the merchant value is what a vendor pays, not a way to get one.
    const notes = /vendor|merchant|charisma/i.test(use?.notes ?? '') ? parseWikiCoin(use?.notes ?? '') : 0
    const wiki = notes || (use?.vendors?.length ? parseWikiCoin(use.value) : 0)
    if (wiki) return { unit: wiki, from: 'wiki' }
    return { unit: 0, from: 'none' }
  }

  const toggle = (r: BookRecipe) => {
    if (!saved) return
    const key = recipeKey(r)
    const favs = favKeys.has(key) ? saved.favorites.filter((f) => f.key !== key) : [...saved.favorites, { key, product: r.product, combines: 1 }]
    void save({ ...saved, favorites: favs })
  }

  const exportAge = inv.view?.modified ? ago(inv.view.modified) : ''
  const rs = recipes.data
  const p = rs?.progress

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tradeskills</h1>
          <p>
            Recipes you make, what goes in, what you have, where to buy the rest and what a batch costs. Counts are from your last{' '}
            <span className="mono">/outputfile inventory</span>
            {exportAge ? ` (${exportAge})` : ''}: bags, bank and tradeskill depot.{' '}
            <Info
              label="Where the numbers come from"
              text={
                <>
                  <div>
                    Recipes are eqlwiki's: each crafted item's page gives its recipe and how many a combine makes; the Alchemy table adds potions whose pages do
                    not.
                  </div>
                  <div>
                    Prices are what your log shows you paying last ("You purchased 100 Small Vial from Kizzie Mintopp for 1 platinum"), from the log and its
                    archives. An item you have never bought takes a price you type in, else the wiki's merchant value, which is what a vendor asks at best:
                    faction and charisma change it.
                  </div>
                </>
              }
            />
          </p>
        </div>
      </div>

      <div className="card stack gap-10 mb-16">
        {!rs ? (
          <Pending what="the recipes" error={recipes.error} retry={recipes.reload} />
        ) : !rs.file ? (
          <div className="row">
            <span className="muted">The recipes come from eqlwiki.com: about a minute to download, once a week, kept on this PC.</span>
            {p?.busy ? (
              <span className="small">
                Reading pages {p.pages} of {p.total || '…'}
              </span>
            ) : (
              <button className="btn primary" onClick={() => void recipes.refresh()}>
                Download the recipes
              </button>
            )}
            {p?.error && (
              <span className="small" style={{ color: 'var(--red)' }}>
                Could not download them: {p.error}
              </span>
            )}
          </div>
        ) : (
          <>
            <div className="row">
              <input
                placeholder="Find a recipe: distillate of clarity, elixir…"
                aria-label="Find a recipe"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ width: 360 }}
              />
              <span className="spacer" />
              <span className="faint small">
                {book.length.toLocaleString()} recipes, {ago(rs.file.fetchedAt)}
              </span>
              {p?.busy ? (
                <span className="small">
                  Reading {p.pages}/{p.total}
                </span>
              ) : (
                <button className="btn ghost small" onClick={() => void recipes.refresh()}>
                  Refresh
                </button>
              )}
            </div>
            {results.length > 0 && (
              <div className="lt-opt">
                {results.map((r) => {
                  const on = favKeys.has(recipeKey(r))
                  return (
                    <div key={recipeKey(r)} className="lt-opt-row">
                      <button
                        className={`btn small${on ? ' primary' : ''}`}
                        aria-pressed={on}
                        title={on ? 'Remove from favourites' : 'Add to favourites'}
                        onClick={() => toggle(r)}
                      >
                        {on ? '★' : '☆'}
                      </button>
                      <div className="lt-cand-body">
                        <div className="row gap-8">
                          <ItemIcon icon={r.icon} size={24} />
                          <b>{r.product}</b>
                          <span className="small muted">
                            {r.skill} {r.trivial ? `(trivial ${r.trivial})` : ''}
                            {r.yields > 1 ? ` · makes ${r.yields}` : ''}
                          </span>
                        </div>
                        <div className="small muted">{r.ingredients.map((i) => `${i.count > 1 ? `${i.count} × ` : ''}${i.name}`).join(' + ')}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {query.trim().length >= 2 && !results.length && <span className="muted small">No recipe makes anything by that name.</span>}
          </>
        )}
      </div>

      {!saved ? (
        <Pending what="your favourites" error={savedQ.error} retry={savedQ.reload} />
      ) : !favorites.length ? (
        <div className="card empty">No favourites yet. Find a recipe above and star it.</div>
      ) : (
        favorites.map(({ f, r }) =>
          !r ? (
            <div key={f.key} className="card row mb-16">
              <span>
                <b>{f.product}</b> <span className="muted">is no longer in the wiki's recipes under this recipe.</span>
              </span>
              <span className="spacer" />
              <button
                className="btn small"
                onClick={() =>
                  void save({
                    ...saved,
                    favorites: saved.favorites.filter((x) => x.key !== f.key)
                  })
                }
              >
                Remove
              </button>
            </div>
          ) : (
            <RecipeCard
              key={f.key}
              r={r}
              combines={f.combines}
              setCombines={(n) =>
                void save({
                  ...saved,
                  favorites: saved.favorites.map((x) => (x.key === f.key ? { ...x, combines: n } : x))
                })
              }
              unfavorite={() => toggle(r)}
              have={(n) => have.get(itemKey(n)) ?? 0}
              price={price}
              setPrice={(name, copper) =>
                void save({
                  ...saved,
                  prices: { ...saved.prices, [name.toLowerCase()]: copper }
                })
              }
              info={info}
              bought={bought}
              madeBy={madeBy}
              open={!collapsed.includes(f.key)}
              toggleOpen={() => setCollapsed(collapsed.includes(f.key) ? collapsed.filter((k) => k !== f.key) : [...collapsed, f.key])}
            />
          )
        )
      )}
    </>
  )
}

function RecipeCard({
  r,
  combines,
  setCombines,
  unfavorite,
  have,
  price,
  setPrice,
  info,
  bought,
  madeBy,
  open,
  toggleOpen
}: {
  r: BookRecipe
  combines: number
  setCombines: (n: number) => void
  unfavorite: () => void
  have: (name: string) => number
  price: (name: string) => { unit: number; from: PriceSource }
  setPrice: (name: string, copper: number) => void
  info: Record<string, ItemInfo>
  bought: Record<string, Purchase>
  madeBy: Map<string, string>
  open: boolean
  toggleOpen: () => void
}) {
  const [draft, setDraft] = useState(String(combines))
  useEffect(() => setDraft(String(combines)), [combines])
  const s = shopping(r, combines, have, price)
  const made = combines * Math.max(1, r.yields)
  return (
    <div className="card stack gap-10 mb-16">
      <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
        <button
          className="btn small ghost"
          aria-expanded={open}
          aria-label={open ? `Collapse ${r.product}` : `Expand ${r.product}`}
          title={open ? 'Collapse' : 'Expand'}
          onClick={toggleOpen}
          style={{ width: 28 }}
        >
          {open ? '▾' : '▸'}
        </button>
        <button className="btn small primary" aria-pressed title="Remove from favourites" onClick={unfavorite}>
          ★
        </button>
        <ItemIcon icon={r.icon} size={30} />
        <a href={wikiUrl(r.product)} target="_blank" rel="noreferrer" style={{ fontWeight: 650, fontSize: 15 }}>
          {r.product}
        </a>
        <span className="small muted">
          {r.skill}
          {r.trivial ? `, trivial ${r.trivial}` : ''}
          {r.yields > 1 ? ` · ${r.yields} a combine` : ''}
        </span>
        <a
          className="small"
          href={eqtraders(r.product)}
          target="_blank"
          rel="noreferrer"
          title="Look it up on EQ Traders Corner (EverQuest Live's tradeskill site)"
        >
          EQTraders
        </a>
        <span className="spacer" />
        <label className="row tight small">
          Combines
          <input
            type="number"
            min={1}
            value={draft}
            style={{ width: 80 }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const n = Math.max(1, Math.round(Number(draft) || 1))
              if (n !== combines) setCombines(n)
              else setDraft(String(combines))
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <span className="small">
          makes <b>{made.toLocaleString()}</b>
        </span>
        <span className={`lt-chip ${s.canMake >= combines ? 'good' : s.canMake > 0 ? 'warn' : ''}`} title="Combines the ingredients you have would make">
          {s.canMake.toLocaleString()} from what you have
        </span>
        {!open && (
          <span className="small">
            to buy <b>{coin(s.toBuy)}</b>
          </span>
        )}
      </div>

      {open && <RecipeDetail s={s} combines={combines} info={info} bought={bought} madeBy={madeBy} setPrice={setPrice} />}
    </div>
  )
}

/** A recipe's ingredients and totals, shown while its card is open. */
function RecipeDetail({
  s,
  combines,
  info,
  bought,
  madeBy,
  setPrice
}: {
  s: ReturnType<typeof shopping>
  combines: number
  info: Record<string, ItemInfo>
  bought: Record<string, Purchase>
  madeBy: Map<string, string>
  setPrice: (name: string, copper: number) => void
}) {
  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>Ingredient</th>
            <th title="In one combine">Each</th>
            <th title={`For ${combines} combine${combines === 1 ? '' : 's'}`}>Need</th>
            <th title="Bags, bank, shared bank and tradeskill depot, at your last inventory export">Have</th>
            <th>To buy</th>
            <th>Price</th>
            <th>Cost</th>
            <th>Where to get it</th>
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l) => {
            const it = info[itemKey(l.name)]
            const vendors = it?.use?.vendors ?? []
            const last = bought[l.name.toLowerCase()]
            return (
              <tr key={l.name}>
                <td>
                  <span className="row gap-8">
                    <ItemIcon icon={it?.icon} size={22} />
                    <a href={wikiUrl(l.name)} target="_blank" rel="noreferrer">
                      {l.name}
                    </a>
                    <a className="faint small" href={eqtraders(l.name)} target="_blank" rel="noreferrer" title="Look it up on EQ Traders Corner">
                      EQTC
                    </a>
                  </span>
                </td>
                <td className="mono">{l.perCombine}</td>
                <td className="mono">{l.need.toLocaleString()}</td>
                <td className="mono">{l.have.toLocaleString()}</td>
                <td className="mono">{l.toBuy ? <b>{l.toBuy.toLocaleString()}</b> : <span className="faint">0</span>}</td>
                <td className="nowrap">
                  <PriceCell unit={l.unit} from={l.priceFrom} last={last} onSet={(c) => setPrice(l.name, c)} />
                </td>
                <td className="mono nowrap">{l.toBuy ? coin(l.cost) : <span className="faint">—</span>}</td>
                <td className="small">
                  {last ? (
                    <span title={`You last bought ${last.count} from ${last.merchant}, ${ago(last.at)}`}>
                      <b>{last.merchant}</b>
                      {vendorZone(vendors, last.merchant) ? `, ${vendorZone(vendors, last.merchant)}` : ''}
                    </span>
                  ) : vendors.length ? (
                    <span title={vendors.map((v) => `${v.npc}, ${v.zone}${v.note ? ` (${v.note})` : ''}`).join('\n')}>
                      {vendors[0].npc}, {vendors[0].zone}
                      {vendors.length > 1 && <span className="faint"> +{vendors.length - 1} more</span>}
                    </span>
                  ) : it ? (
                    <Sources info={it} craftedBy={madeBy.get(l.name.toLowerCase())} />
                  ) : (
                    <span className="faint">looking it up…</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
        <span>
          To buy: <b>{coin(s.toBuy)}</b>
        </span>
        <span className="muted">
          Whole batch {coin(s.batch)} · {coin(s.each)} each
        </span>
        {s.unpriced && <span className="lt-chip warn">Some prices unknown: totals leave them out</span>}
      </div>
    </>
  )
}

/** Where an item no vendor sells comes from: crafted, dropped, foraged, a quest, or what its page's notes say. */
function Sources({ info, craftedBy }: { info: ItemInfo; craftedBy?: string }) {
  if (!info.found) return <span className="faint">not on eqlwiki</span>
  const use = info.use
  const src = use?.sources
  const lines: { text: string; title?: string }[] = []
  if (craftedBy || src?.crafted) lines.push({ text: `Crafted${craftedBy ? ` (${craftedBy})` : ''}` })
  const drops = (src?.drops ?? []).filter((d) => d.zone || d.mobs.length)
  if (drops.length) {
    const d = drops[0]
    const mobs = d.mobs.slice(0, 2).join(', ') + (d.mobs.length > 2 ? ` +${d.mobs.length - 2}` : '')
    const more = drops.length > 1 ? ` · +${drops.length - 1} more zone${drops.length > 2 ? 's' : ''}` : ''
    lines.push({
      text: `Dropped${d.zone ? ` in ${d.zone}` : ''}${mobs ? `: ${mobs}` : ''}${more}`,
      title: drops.map((x) => `${x.zone || 'Dropped by'}${x.mobs.length ? `: ${x.mobs.join(', ')}` : ''}`).join('\n')
    })
  }
  if (src?.foraged.length) {
    lines.push({ text: `Foraged in ${src.foraged.slice(0, 2).join(', ')}${src.foraged.length > 2 ? ` +${src.foraged.length - 2}` : ''}`, title: src.foraged.join('\n') })
  }
  if (use?.quests.length) lines.push({ text: `Quest: ${use.quests.slice(0, 2).join(', ')}${use.quests.length > 2 ? ` +${use.quests.length - 2}` : ''}`, title: use.quests.join('\n') })
  // Nothing else to go on: what the page says in words.
  if (!lines.length && use?.notes) lines.push({ text: use.notes, title: 'From the item page' })
  if (!lines.length) return <span className="faint">no source on the wiki</span>
  return (
    <span className="stack" style={{ gap: 2 }}>
      {lines.map((l, i) => (
        <span key={i} className={i ? 'muted' : ''} title={l.title}>
          {l.text}
        </span>
      ))}
    </span>
  )
}

function vendorZone(vendors: { npc: string; zone: string }[], npc: string): string {
  return vendors.find((v) => v.npc.toLowerCase() === npc.toLowerCase())?.zone ?? ''
}

/** The price of one, with where it came from; a price can be typed where none is known. */
function PriceCell({ unit, from, last, onSet }: { unit: number; from: PriceSource; last?: Purchase; onSet: (copper: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  if (editing || from === 'none') {
    return (
      <input
        placeholder="e.g. 2g 5s"
        aria-label="Price of one"
        value={text}
        style={{ width: 90 }}
        autoFocus={editing}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const c = parseWikiCoin(text) || (Number(text) > 0 ? Math.round(Number(text)) : 0)
          if (c) onSet(c)
          setEditing(false)
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    )
  }
  const label = from === 'paid' ? `what you paid${last ? `, ${ago(last.at)}` : ''}` : from === 'typed' ? 'typed in' : "the wiki's merchant value"
  return (
    <button className="link-button mono" title={`${label}. Click to type a price.`} onClick={() => setEditing(true)}>
      {from === 'wiki' ? '≈ ' : ''}
      {coin(unit)}
    </button>
  )
}
