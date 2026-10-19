import { useMemo, useState } from 'react'
import { CharacterPicker } from '../../renderer/src/components/CharacterPicker'
import { api } from '../../renderer/src/api'
import { useInvoke, useVisibleInterval } from '../../renderer/src/hooks'
import { Ago, FilterBox, GameCommand, Info, Pending, SettingsLink, Tabs, Tip } from '../../renderer/src/components/ui'
import { useRemembered } from '../../renderer/src/remember'
import { showToast } from '../../renderer/src/toast'
import { num, who } from '../../core/format'
import { describeItem } from '../../core/loot'
import { itemKey } from '../../core/inventory'
import { useCharacterChoice } from '../../renderer/src/character'
import { SKY_QUESTS, SKY_SOURCE, wishLeft, type SkyState } from './core'
import { NO_FILTER, passes, questView, skyFacets, sortViews, type CountFrom, type QuestView, type SkyFilter, type SkySort } from './views'
import { Bar, NeedChip, WantControl, whereOf } from './parts'
import { Classes, Cleanup, Ignored, Items, Targets, Wishes } from './tabs'

// Plan › Plane of Sky (an optional module, Settings › Modules): every class's Test quests with what each
// takes and how many of each the character holds; Ready, the Tests that can be handed in now; the wish
// list; Targets, where to hunt for what is missing; Items, where a count is put right; Cleanup, what
// could go; Classes, each class's Tests and its unlock; and the Tests ignored.

type View = 'tests' | 'ready' | 'wishes' | 'targets' | 'items' | 'cleanup' | 'classes' | 'ignored'

const HOW = (
  <>
    <div>
      <b>The Tests</b> are the eqlwiki’s Plane of Sky class quests ({SKY_SOURCE}). Each takes a Wind Rune, which any Plane of Sky mob can drop, and an item or two from the islands.
    </div>
    <div>
      <b>What you hold</b> is counted from your log (every copy you looted, kept or stored, less what you handed over or merged away), from your inventory export (
      <code>/outputfile inventory</code>: bags, bank, depot and worn, not the currency tab or the Dragon Hoard), or the higher of the two for each item. Copies you had before your
      log began are put right on the Items tab.
    </div>
    <div>
      <b>Handed in</b> is a trade with the Test’s giver that completed with its items in it, the hand-ins you added, its reward in your inventory export, or the achievements export
      saying you obtained it.
    </div>
  </>
)

const SORTS: [SkySort, string][] = [
  ['near', 'Nearest to done'],
  ['recent', 'Most recently looted'],
  ['class', 'By class'],
  ['island', 'By island']
]

type Act = {
  want: (quest: string, n: number, extra?: number) => void
  have: (item: string, n: number) => void
  mark: (quest: string, mark: 'favorite' | 'ignored', on: boolean) => void
  turnIns: (quest: string, hand: number) => void
}

export function Sky() {
  const chars = useCharacterChoice('inventory', { withLogs: true })
  const character = chars.character
  const q = useInvoke(character ? 'sky:state' : null, [character])
  useVisibleInterval(q.reload, 60_000)
  const [view, setView] = useRemembered<View>('sky.view', 'tests')
  const [kept, setFilter] = useRemembered<Omit<SkyFilter, 'text'>>('sky.filter', { ...NO_FILTER, cls: 'mine' })
  const [text, setText] = useState('')
  const [sort, setSort] = useRemembered<SkySort>('sky.sort', 'near')
  const [from, setFrom] = useRemembered<CountFrom>('sky.from', 'both')
  const [firstTime, setFirstTime] = useState(false)
  const s = q.data
  const f = useMemo<SkyFilter>(() => ({ ...NO_FILTER, ...kept, text }), [kept, text])
  const patch = (p: Partial<SkyFilter>) => setFilter({ ...kept, ...p })

  /** Calls one of the module's channels and shows the state it answers with. */
  const save = async (call: () => Promise<SkyState>) => {
    try {
      q.setData(await call())
    } catch (e) {
      showToast(`Could not save that: ${e instanceof Error ? e.message : String(e)}`, { tone: 'bad' })
    }
  }
  const act: Act = {
    want: (quest, n, extra) => void save(() => api.invoke('sky:wish', character, quest, Math.max(0, n), extra)),
    have: (item, n) => void save(() => api.invoke('sky:have', character, item, n)),
    mark: (quest, mark, on) => void save(() => api.invoke('sky:mark', character, quest, mark, on)),
    turnIns: (quest, hand) => void save(() => api.invoke('sky:turnIns', character, quest, hand))
  }

  const mine = useMemo(() => s?.classes ?? [], [s])
  // Without an inventory export there is the log alone.
  const counted: CountFrom = s?.exported ? from : 'log'
  const views = useMemo(() => (s ? SKY_QUESTS.map((x) => questView(x, s, counted)) : []), [s, counted])
  const shown = useMemo(() => views.filter((v) => passes(v, f, mine)).sort(sortViews(sort)), [views, f, mine, sort])
  const ready = useMemo(() => views.filter((v) => v.ready && !v.ignored && (!firstTime || !v.turnIn.any)).sort(sortViews('near')), [views, firstTime])
  const ignored = useMemo(() => views.filter((v) => v.ignored), [views])
  const open = s ? s.wishes.filter((w) => wishLeft(w, s.runs) > 0).length : 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Plane of Sky</h1>
          <div className="lead">
            The class Tests, what each takes and how many of each you hold; where to hunt; and your wish list. <Info label="How it is worked out" text={HOW} />
          </div>
        </div>
        <div className="actions">
          <CharacterPicker character={character} available={chars.available} onPick={chars.setCharacter} />
        </div>
      </div>

      {!chars.ready ? (
        <Pending error={chars.error} retry={chars.reload} what="your characters" />
      ) : !character ? (
        <div className="card empty">
          No character yet. Choose the game folder on <SettingsLink tab="general">Settings › General</SettingsLink>, then play with logging on (/log on).
        </div>
      ) : !s ? (
        <Pending error={q.error} retry={q.reload} doing={`Reading ${who(character)}’s log`} />
      ) : (
        <>
          <Tabs
            className="mb-16"
            label="Plane of Sky view"
            value={view}
            onChange={setView}
            tabs={[
              ['tests', 'Tests'],
              ['ready', ready.length ? `Ready (${ready.length})` : 'Ready'],
              ['wishes', open ? `Wish list (${open})` : 'Wish list'],
              ['targets', 'Targets'],
              ['items', 'Items'],
              ['cleanup', 'Cleanup'],
              ['classes', 'Classes'],
              ['ignored', ignored.length ? `Ignored (${ignored.length})` : 'Ignored']
            ]}
          />
          <Sources s={s} from={from} onFrom={setFrom} />
          {view === 'tests' ? (
            <>
              <FilterBar f={f} mine={mine} sort={sort} onSort={setSort} onFilter={patch} onText={setText} />
              <div className="faint small mb-8">
                {num(shown.length)} of {num(views.length - ignored.length)} Tests
              </div>
              <TestList views={shown} act={act} />
            </>
          ) : view === 'ready' ? (
            <>
              <div className="card row mb-16">
                <label className="row tight small">
                  <input type="checkbox" checked={firstTime} onChange={(e) => setFirstTime(e.target.checked)} />
                  Only Tests I have never handed in
                </label>
                <span className="faint small">The Tests you hold everything for: a walk to the giver away.</span>
              </div>
              {ready.length ? <TestList views={ready} act={act} /> : <div className="card empty">No Test is ready: you hold everything for none of them.</div>}
            </>
          ) : view === 'wishes' ? (
            <Wishes s={s} from={counted} onWant={act.want} onHave={act.have} />
          ) : view === 'targets' ? (
            <Targets views={views} shown={shown} />
          ) : view === 'items' ? (
            <>
              <div className="card row mb-16">
                <FilterBox placeholder="Find an item, mob or Test…" label="Find an item, mob or Test" value={text} onChange={setText} width={260} />
              </div>
              <Items s={s} filter={text} onHave={act.have} />
            </>
          ) : view === 'cleanup' ? (
            <Cleanup s={s} from={counted} />
          ) : view === 'classes' ? (
            <Classes
              s={s}
              onClass={(cls) => {
                setFilter({ ...NO_FILTER, cls })
                setView('tests')
              }}
            />
          ) : (
            <Ignored views={ignored} onShow={(quest) => act.mark(quest, 'ignored', false)} />
          )}
        </>
      )}
    </>
  )
}

/** Where the counts come from, and how old each export is. */
function Sources({ s, from, onFrom }: { s: SkyState; from: CountFrom; onFrom: (v: CountFrom) => void }) {
  return (
    <div className="row small mb-16">
      <label className="row tight">
        Count items from
        <select value={s.exported ? from : 'log'} disabled={!s.exported} onChange={(e) => onFrom(e.target.value as CountFrom)}>
          <option value="both">Both (the higher of the two)</option>
          <option value="log">Your log</option>
          <option value="export">The inventory export</option>
        </select>
      </label>
      <span className="faint">
        {s.exported ? (
          <>
            {s.exported.file}, written <Ago t={s.exported.modified} />: <GameCommand cmd="/outputfile inventory" /> writes it again.
          </>
        ) : (
          <>
            No inventory export: <GameCommand cmd="/outputfile inventory" /> in game counts your bags and bank too.
          </>
        )}
      </span>
      <span className="faint">
        {s.achieved ? (
          <>
            Achievements export written <Ago t={s.achieved.modified} />.
          </>
        ) : (
          <>
            No achievements export: <GameCommand cmd="/outputfile achievements" /> says which rewards you obtained.
          </>
        )}
      </span>
    </div>
  )
}

/** The Tests tab's filters and order. */
function FilterBar({
  f,
  mine,
  sort,
  onSort,
  onFilter,
  onText
}: {
  f: SkyFilter
  mine: readonly string[]
  sort: SkySort
  onSort: (v: SkySort) => void
  onFilter: (p: Partial<SkyFilter>) => void
  onText: (v: string) => void
}) {
  const facets = useMemo(skyFacets, [])
  const classes = useMemo(() => [...new Set(SKY_QUESTS.map((x) => x.cls))], [])
  const box = (key: 'hideReady' | 'hideTurnedIn' | 'onlyTurnedIn' | 'favoritesOnly', label: string, title: string) => (
    <label className="row tight small" title={title}>
      <input type="checkbox" checked={f[key]} onChange={(e) => onFilter({ [key]: e.target.checked })} />
      {label}
    </label>
  )
  return (
    <div className="card stack gap-8 mb-16">
      <div className="row">
        <select value={f.cls === 'mine' && !mine.length ? 'all' : f.cls} onChange={(e) => onFilter({ cls: e.target.value })} aria-label="Class">
          {mine.length > 0 && <option value="mine">Your classes ({mine.join(', ')})</option>}
          <option value="all">Every class</option>
          {classes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={f.island} onChange={(e) => onFilter({ island: Number(e.target.value) })} aria-label="Island">
          <option value={0}>Every island</option>
          {facets.islands.map((i) => (
            <option key={i} value={i}>
              Island {i}
            </option>
          ))}
        </select>
        <select value={f.mob} onChange={(e) => onFilter({ mob: e.target.value })} aria-label="Mob">
          <option value="">Every mob</option>
          {facets.mobs.map((m) => (
            <option key={m.mob} value={m.mob}>
              {m.mob} (island {m.island})
            </option>
          ))}
        </select>
        <FilterBox placeholder="Find a Test, item, reward or mob…" label="Find a Test, item, reward or mob" value={f.text} onChange={onText} width={260} />
        <label className="row tight small">
          Sort
          <select value={sort} onChange={(e) => onSort(e.target.value as SkySort)}>
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        {box('hideReady', 'Hide Tests I hold everything for', 'What is left to gather: a Test you hold every item for has nothing left to farm')}
        {box('hideTurnedIn', 'Hide Tests I have handed in', 'What you have not run yet')}
        {box('onlyTurnedIn', 'Only Tests I have handed in', 'The Tests you have run at least once')}
        {box('favoritesOnly', '★ Starred only', 'The Tests you starred')}
      </div>
    </div>
  )
}

/** The Tests, each a row that opens on its details. */
function TestList({ views, act }: { views: readonly QuestView[]; act: Act }) {
  const [opened, setOpened] = useState<Set<string>>(new Set())
  if (!views.length) return <div className="card empty">No Test matches.</div>
  const toggle = (name: string) => setOpened((o) => (o.has(name) ? new Set([...o].filter((x) => x !== name)) : new Set([...o, name])))
  return (
    <div className="card mb-16">
      <ol className="sky-tests">
        {views.map((v) => (
          <TestRow key={v.quest.name} v={v} act={act} open={opened.has(v.quest.name)} onOpen={() => toggle(v.quest.name)} />
        ))}
      </ol>
    </div>
  )
}

/** What a Test's hand-ins are known from, said. */
function turnInText(v: QuestView): string {
  const t = v.turnIn
  const parts = [
    t.log ? `your log saw ${t.log}` : '',
    t.hand > 0 ? `you added ${t.hand}` : t.hand < 0 ? `you took away ${-t.hand}` : '',
    t.reward ? 'its reward is in your inventory export' : '',
    t.achievement ? 'the achievements export says you obtained its reward' : ''
  ].filter(Boolean)
  return `Handed in: ${parts.join('; ')}.`
}

function TestRow({ v, act, open, onOpen }: { v: QuestView; act: Act; open: boolean; onOpen: () => void }) {
  const q = v.quest
  const mobs = [...new Set(q.items.filter((i) => i.from).map((i) => `${i.from} · Island ${i.island}`))]
  const total = v.needs.length
  const got = total - v.missing
  return (
    <li className={`sky-test${v.ready ? ' ready' : ''}`}>
      <div className="sky-test-head">
        <span className="sky-test-title">
          <button
            className={`btn small ghost sky-star${v.favorite ? ' on' : ''}`}
            aria-pressed={v.favorite}
            aria-label={v.favorite ? `Unstar ${q.name}` : `Star ${q.name}`}
            title={v.favorite ? 'Starred: take the star off' : 'Star it: ★ Starred only shows the starred'}
            onClick={() => act.mark(q.name, 'favorite', !v.favorite)}
          >
            {v.favorite ? '★' : '☆'}
          </button>
          <span className="chip pill">{q.cls}</span>
          <span className="sky-reward">{q.name}</span>
          <span className="muted small">→ {q.rewards.join(' and ')}</span>
          {v.ready && (
            <Tip className="chip ok" text="You hold everything it takes, once">
              Ready
            </Tip>
          )}
        </span>
        <span className="sky-test-side">
          {v.shared.length > 0 && (
            <Tip className="chip pill" text={v.shared.map((x) => `${x.item} is taken by ${x.tests.join(', ')} too`).join('. ')}>
              🔗 {v.shared.reduce((n, x) => n + x.tests.length, 0)}
            </Tip>
          )}
          {v.turnIn.any && (
            <Tip className="chip pill ok" text={turnInText(v)}>
              Handed in{v.turnIn.count > 1 ? ` ×${v.turnIn.count}` : ''}
            </Tip>
          )}
          {v.missing > 0 && (
            <span className="chip pill warn">
              {v.missing} of {total} missing
            </span>
          )}
          <Bar done={got} total={total} label={`${got} of ${total} items held`} />
          <WantControl v={v} onWant={(n) => act.want(q.name, n)} />
          <button className="btn small ghost" aria-expanded={open} aria-label={open ? `Close ${q.name}` : `Open ${q.name}`} onClick={onOpen}>
            {open ? '▴' : '▾'}
          </button>
        </span>
      </div>
      <div className="small muted">
        Turn in to {q.giver}, say “{q.say}”{mobs.length ? <> · Kill: {mobs.join(', ')}</> : null}
      </div>
      <div className="sky-needs">
        {v.needs.map((n) => (
          <NeedChip key={n.item.name} item={n.item} have={n.have} need={n.need} />
        ))}
      </div>
      {open && <TestDetails v={v} act={act} />}
    </li>
  )
}

/** A Test opened: each item with both counts and what the wiki says of it, the reward, the hand-ins and what else takes its items. */
function TestDetails({ v, act }: { v: QuestView; act: Act }) {
  const q = v.quest
  const names = useMemo(() => [...q.rewards, ...q.items.map((i) => i.name)], [q])
  const info = useInvoke('inventory:lookup', [names], [names.join('|')])
  const stats = (name: string) => describeItem(info.data?.[itemKey(name)])
  const t = v.turnIn
  const by = t.hand ? `${t.hand > 0 ? '+' : ''}${t.hand} by you` : ''
  return (
    <div className="sky-details">
      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Where</th>
            <th>Your log</th>
            <th>Export</th>
            <th>Need</th>
            <th>What it is</th>
          </tr>
        </thead>
        <tbody>
          {v.needs.map((n) => (
            <tr key={n.item.name}>
              <td>
                <b>{n.item.name}</b>
              </td>
              <td className="small">{whereOf(n.item)}</td>
              <td className="mono">{num(n.log)}</td>
              <td className="mono">{n.exported === null ? '—' : num(n.exported)}</td>
              <td className="mono">{num(n.need)}</td>
              <td className="small faint">{/^Wind Rune /.test(n.item.name) ? 'A Wind Rune, kept in the currency tab' : stats(n.item.name).head || (info.data ? '' : '…')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.rewards.map((r) => {
        const d = stats(r)
        return (
          <div key={r} className="small">
            <b>{r}</b> {d.head ? <span className="muted">{d.head}</span> : !info.data ? <span className="faint">Looking it up…</span> : null}
            {d.body.length > 0 && <div className="faint">{d.body.join(' · ')}</div>}
          </div>
        )
      })}
      <div className="row small">
        <span>
          Handed in: <b>{num(t.count)}</b>
          {t.log ? ` (your log saw ${num(t.log)}${by ? `, ${by}` : ''})` : by ? ` (${by})` : ''}
          {t.reward && !t.count ? '; its reward is in your inventory export' : ''}
          {t.achievement && !t.count ? '; the achievements export says you obtained it' : ''}
        </span>
        <button className="btn small ghost" onClick={() => act.turnIns(q.name, t.hand + 1)} title="Count a hand-in your log did not see (another PC, logging off)">
          +1 hand-in
        </button>
        {t.count > 0 && (
          <button className="btn small ghost" onClick={() => act.turnIns(q.name, t.hand - 1)} title="Take one away: the log counted one that was not this Test">
            −1
          </button>
        )}
        <span className="spacer" />
        <button className="btn small ghost" onClick={() => act.mark(q.name, 'ignored', true)} title="Never show it: it waits on the Ignored tab, out of every other list">
          Ignore this Test
        </button>
      </div>
      {v.shared.length > 0 && (
        <div className="small faint">
          {v.shared.map((x) => (
            <div key={x.item}>
              {x.item} is taken by {x.tests.join(', ')} too.
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
