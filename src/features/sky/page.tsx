import { useMemo, useState } from 'react'
import { CharacterPicker } from '../../renderer/src/components/CharacterPicker'
import { api } from '../../renderer/src/api'
import { useInvoke, useVisibleInterval } from '../../renderer/src/hooks'
import { FilterBox, Info, NumberInput, Pending, SettingsLink, Tabs, Tip, ToggleChip } from '../../renderer/src/components/ui'
import { useRemembered } from '../../renderer/src/remember'
import { showToast } from '../../renderer/src/toast'
import { num, who } from '../../core/format'
import { itemKey } from '../../core/inventory'
import { useCharacterChoice } from '../../renderer/src/character'
import { byNearest, heldOf, questMatch, questNeeds, questView, shoppingList, SKY_QUESTS, SKY_SOURCE, wishDone, wishLeft, type QuestView, type SkyItem, type SkyState } from './core'

// Plan › Plane of Sky (an optional module, Settings › Modules): every class's Test quests with what each
// takes and how many of each the character holds, nearest to done first; the wish list, the rewards
// wanted and how many times, with what they still take added up; and every item the Tests take, where
// a count the log cannot know (copies held before it began) is put right.

type View = 'tests' | 'wishes' | 'items'

const HOW = (
  <>
    <div>
      <b>The Tests</b> are the eqlwiki’s Plane of Sky class quests ({SKY_SOURCE}). Each takes a Wind Rune, which any Plane of Sky mob can drop, and an item or two from the islands.
    </div>
    <div>
      <b>What you hold</b> is counted from your log: every copy you looted (kept, or stored in the depot, the currency tab or the Dragon Hoard), less what you handed over or merged
      away. Copies you had before your log began are not in it: put the count right on the Items tab, and the log goes on counting from there.
    </div>
    <div>
      <b>A Test is done</b> when a trade with its class’s giver completes with its items in it. The <b>wish list</b> counts the hand-ins from when you added a wish; add any the log
      did not see (another PC, logging off) by hand.
    </div>
  </>
)

/** Where an item comes from, short: "Island 7 · Sister of the Spire · No Drop". */
function whereOf(i: SkyItem): string {
  if (/^Wind Rune /.test(i.name)) return 'Any Plane of Sky mob'
  const at = [i.island ? `Island ${i.island}` : 'Not from the Plane of Sky', i.from, i.noDrop ? 'No Drop' : ''].filter(Boolean)
  return at.join(' · ')
}

/** An item a Test takes, as a chip: held of needed, ticked when there are enough. */
function NeedChip({ item, have, need }: { item: SkyItem; have: number; need: number }) {
  const enough = have >= need
  return (
    <Tip className={`chip pill${enough ? ' ok' : have > 0 ? ' warn' : ''}`} text={`${item.name}: ${whereOf(item)}. You hold ${num(have)}, and need ${num(need)}.`}>
      {item.name} {num(have)}/{num(need)}
    </Tip>
  )
}

/** How many times a reward is wanted: a button to want it, then − and + . */
function WantControl({ v, onWant }: { v: QuestView; onWant: (want: number) => void }) {
  const want = v.want
  if (!want)
    return (
      <button className="btn small ghost" onClick={() => onWant(1)} title="Put it on your wish list: its items are added up there">
        ☆ Want it
      </button>
    )
  return (
    <span className="row tight" role="group" aria-label={`Wanted ${want} more times`}>
      <button className="btn small ghost" onClick={() => onWant(want - 1)} aria-label="Want it one time fewer">
        −
      </button>
      <Tip className="chip pill gold" text={v.times < want ? `On your wish list ${want} times; ${v.times} to go` : `On your wish list ${want} times`}>
        ★ ×{want}
      </Tip>
      <button className="btn small ghost" onClick={() => onWant(want + 1)} aria-label="Want it one time more">
        +
      </button>
    </span>
  )
}

export function Sky() {
  const chars = useCharacterChoice('inventory', { withLogs: true })
  const character = chars.character
  const q = useInvoke(character ? 'sky:state' : null, [character])
  useVisibleInterval(q.reload, 60_000)
  const [view, setView] = useRemembered<View>('sky.view', 'tests')
  const [cls, setCls] = useRemembered<string>('sky.class', 'mine')
  const [filter, setFilter] = useState('')
  const [readyOnly, setReadyOnly] = useState(false)
  const s = q.data

  /** Calls one of the module's channels and shows the state it answers with. */
  const save = async (call: () => Promise<SkyState>) => {
    try {
      q.setData(await call())
    } catch (e) {
      showToast(`Could not save that: ${e instanceof Error ? e.message : String(e)}`, { tone: 'bad' })
    }
  }
  const want = (quest: string, n: number, extra?: number) => void save(() => api.invoke('sky:wish', character, quest, Math.max(0, n), extra))
  const setHave = (item: string, n: number) => void save(() => api.invoke('sky:have', character, item, n))

  const mine = useMemo(() => s?.classes ?? [], [s])
  const classes = useMemo(() => [...new Set(SKY_QUESTS.map((x) => x.cls))], [])
  const pick = cls === 'mine' && !mine.length ? 'all' : cls
  const views = useMemo(
    () =>
      s
        ? SKY_QUESTS.filter((x) => (pick === 'all' ? true : pick === 'mine' ? mine.includes(x.cls) : x.cls === pick))
            .filter((x) => questMatch(x, filter))
            .map((x) => questView(x, s))
            .filter((v) => !readyOnly || v.ready)
            .sort(byNearest)
        : [],
    [s, pick, mine, filter, readyOnly]
  )
  const shopping = useMemo(() => (s ? shoppingList(s) : []), [s])
  const wishes = s?.wishes ?? []
  const open = s ? wishes.filter((w) => wishLeft(w, s.runs) > 0).length : 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Plane of Sky</h1>
          <div className="lead">
            The class Tests, what each takes and how many of each you hold, nearest to done first; and your wish list. <Info label="How it is worked out" text={HOW} />
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
              ['wishes', open ? `Wish list (${open})` : 'Wish list'],
              ['items', 'Items']
            ]}
          />
          {view !== 'wishes' && (
            <div className="card row mb-16">
              {view === 'tests' && (
                <select value={pick} onChange={(e) => setCls(e.target.value)} aria-label="Class">
                  {mine.length > 0 && <option value="mine">Your classes ({mine.join(', ')})</option>}
                  <option value="all">Every class</option>
                  {classes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              <FilterBox placeholder="Find a Test, reward or item…" label="Find a Test, reward or item" value={filter} onChange={setFilter} width={260} />
              {view === 'tests' && (
                <ToggleChip on={readyOnly} onChange={setReadyOnly} title="Only the Tests you hold everything for">
                  Ready to hand in
                </ToggleChip>
              )}
            </div>
          )}
          {view === 'tests' ? (
            <Tests views={views} onWant={want} />
          ) : view === 'wishes' ? (
            <Wishes s={s} shopping={shopping} onWant={want} onHave={setHave} />
          ) : (
            <Items s={s} filter={filter} onHave={setHave} />
          )}
        </>
      )}
    </>
  )
}

/** The Tests, each with what it takes and the wish control. */
function Tests({ views, onWant }: { views: QuestView[]; onWant: (quest: string, want: number) => void }) {
  if (!views.length) return <div className="card empty">No Test matches.</div>
  return (
    <div className="card mb-16">
      <ol className="sky-tests">
        {views.map((v) => (
          <li key={v.quest.name} className={`sky-test${v.ready ? ' ready' : ''}`}>
            <div className="sky-test-head">
              <span className="sky-reward">{v.quest.rewards.join(' and ')}</span>
              <span className="muted small">
                {v.quest.name} · {v.quest.giver}, say “{v.quest.say}”
              </span>
              {v.ready && (
                <Tip className="chip ok" text="You hold everything it takes, once">
                  Ready
                </Tip>
              )}
              {v.done > 0 && (
                <Tip className="chip pill" text="Hand-ins your log saw">
                  Done ×{v.done}
                </Tip>
              )}
              <span className="spacer" />
              <span className="mono small">{Math.round(v.near * 100)}%</span>
              <WantControl v={v} onWant={(n) => onWant(v.quest.name, n)} />
            </div>
            <div className="sky-needs">
              {v.needs.map((n) => (
                <NeedChip key={n.item.name} item={n.item} have={n.have} need={n.need} />
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The wish list: each reward wanted and how far along it is, then what they all still take. */
function Wishes({
  s,
  shopping,
  onWant,
  onHave
}: {
  s: SkyState
  shopping: ReturnType<typeof shoppingList>
  onWant: (quest: string, want: number, extra?: number) => void
  onHave: (item: string, have: number) => void
}) {
  if (!s.wishes.length)
    return (
      <div className="card empty">
        Nothing wished for yet. On the Tests tab, <b>☆ Want it</b> puts a reward here; + wants it more than once (two Wu’s Fists to merge).
      </div>
    )
  return (
    <>
      <div className="card mb-16">
        <h2>Wanted</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Reward</th>
              <th>Test</th>
              <th>Want</th>
              <th>
                Done <Info text="Hand-ins your log saw since you added the wish, and those you added by hand (another PC, logging off)" />
              </th>
              <th>Left</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.wishes.map((w) => {
              const quest = SKY_QUESTS.find((x) => x.name === w.quest)
              const done = wishDone(w, s.runs)
              const left = wishLeft(w, s.runs)
              return (
                <tr key={w.quest}>
                  <td>
                    <b>{quest?.rewards.join(' and ') ?? w.quest}</b>
                  </td>
                  <td className="small">{w.quest}</td>
                  <td>
                    <NumberInput value={w.want} min={1} max={99} width={60} label={`Times ${w.quest} is wanted`} onChange={(n) => n !== undefined && onWant(w.quest, n)} />
                  </td>
                  <td>
                    <span className="mono">{num(done)}</span>{' '}
                    <button className="btn small ghost" onClick={() => onWant(w.quest, w.want, (w.extra ?? 0) + 1)} title="Count a hand-in your log did not see">
                      +1
                    </button>
                  </td>
                  <td>{left ? <span className="mono">{num(left)}</span> : <span className="chip ok">Done</span>}</td>
                  <td>
                    <button className="btn small ghost" onClick={() => onWant(w.quest, 0)} title="Take it off the wish list">
                      Remove
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="card mb-16">
        <h2>What they still take</h2>
        {!shopping.length ? (
          <div className="faint small">Every wish is done.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Where</th>
                <th>Have</th>
                <th>Need</th>
                <th>For</th>
              </tr>
            </thead>
            <tbody>
              {shopping.map((r) => (
                <tr key={r.item.name} className={r.have >= r.need ? 'faint' : undefined}>
                  <td>
                    <b>{r.item.name}</b>
                  </td>
                  <td className="small">{whereOf(r.item)}</td>
                  <td>
                    <NumberInput value={r.have} min={0} max={9999} width={64} label={`${r.item.name} held`} onChange={(n) => n !== undefined && onHave(r.item.name, n)} />
                  </td>
                  <td>{r.have >= r.need ? <span className="chip ok">{num(r.need)}</span> : <span className="mono">{num(r.need)}</span>}</td>
                  <td className="small">{r.for.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

/** Every item the Tests take, where it drops and how many are held: the place to put a count right. */
function Items({ s, filter, onHave }: { s: SkyState; filter: string; onHave: (item: string, have: number) => void }) {
  const rows = useMemo(() => {
    const by = new Map<string, { item: SkyItem; tests: string[] }>()
    for (const x of SKY_QUESTS)
      for (const item of questNeeds(x)) {
        const r = by.get(itemKey(item.name)) ?? { item, tests: [] }
        r.tests.push(x.name)
        by.set(itemKey(item.name), r)
      }
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
    return [...by.values()]
      .filter((r) => words.every((w) => [r.item.name, whereOf(r.item), ...r.tests].join(' ').toLowerCase().includes(w)))
      .sort((a, b) => (a.item.island ?? 0) - (b.item.island ?? 0) || a.item.name.localeCompare(b.item.name))
  }, [filter])
  return (
    <div className="card mb-16">
      <p className="hint">
        Your log counts what you looted, handed over and merged since it began. Type what you hold where it is wrong: the log goes on counting from your number.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Where</th>
            <th>Have</th>
            <th>Taken by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = itemKey(r.item.name)
            const fixed = s.adjust[k] !== undefined
            return (
              <tr key={k}>
                <td>
                  <b>{r.item.name}</b>
                </td>
                <td className="small">{whereOf(r.item)}</td>
                <td>
                  <span className="row tight">
                    <NumberInput
                      value={heldOf(s, r.item.name)}
                      min={0}
                      max={9999}
                      width={64}
                      label={`${r.item.name} held`}
                      onChange={(n) => n !== undefined && onHave(r.item.name, n)}
                    />
                    {fixed && (
                      <Tip className="faint small" text={`Your log counts ${num(s.logged[k] ?? 0)}; you said otherwise. Type that number to go back to the log’s count.`}>
                        set by you
                      </Tip>
                    )}
                  </span>
                </td>
                <td className="small">{r.tests.length > 3 ? `${r.tests.slice(0, 3).join(', ')} and ${r.tests.length - 3} more` : r.tests.join(', ')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
