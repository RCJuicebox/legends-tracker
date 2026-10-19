import { useMemo, useState } from 'react'
import { Info, NumberInput, Segmented, Tip } from '../../renderer/src/components/ui'
import { num } from '../../core/format'
import { itemKey } from '../../core/inventory'
import { firstIsland, heldOf, questNeeds, SKY_QUESTS, wishDone, wishLeft, type SkyItem, type SkyState } from './core'
import { ANY_MOB, classRows, cleanupRows, shoppingList, targets, type CountFrom, type QuestView } from './views'
import { Bar, whereOf } from './parts'

// Plan › Plane of Sky's tabs beside the Tests: the wish list, where to hunt, every item (where a count
// is put right), what could go, each class's Tests, and the Tests ignored.

/** The wish list: each reward wanted and how far along it is, then what they all still take. */
export function Wishes({
  s,
  from,
  onWant,
  onHave
}: {
  s: SkyState
  from: CountFrom
  onWant: (quest: string, want: number, extra?: number) => void
  onHave: (item: string, have: number) => void
}) {
  const shopping = useMemo(() => shoppingList(s, from), [s, from])
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
                Done <Info text="Hand-ins your log saw since you added the wish, and those you added here by hand (another PC, logging off)" />
              </th>
              <th>Left</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.wishes.map((w) => {
              const quest = SKY_QUESTS.find((x) => x.name === w.quest)
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
                    <span className="mono">{num(wishDone(w, s.runs))}</span>{' '}
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
export function Items({ s, filter, onHave }: { s: SkyState; filter: string; onHave: (item: string, have: number) => void }) {
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
      .sort((a, b) => firstIsland(a.item) - firstIsland(b.item) || a.item.name.localeCompare(b.item.name))
  }, [filter])
  return (
    <div className="card mb-16">
      <p className="hint">
        Your log counts what you looted, handed over and merged since it began; the inventory export, what it saw in your bags, bank, depot and worn (not the currency tab or the
        Dragon Hoard). Type what you hold where the log’s count is wrong: the log goes on counting from your number.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Where</th>
            <th>Your log</th>
            <th>Export</th>
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
                <td className="mono">{s.exported ? num(s.exported.counts[k] ?? 0) : '—'}</td>
                <td className="small">{r.tests.length > 3 ? `${r.tests.slice(0, 3).join(', ')} and ${r.tests.length - 3} more` : r.tests.join(', ')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type TargetScope = 'shown' | 'open' | 'wishes'

/** Where to hunt: each mob, and what it drops that the Tests in scope are missing. */
export function Targets({ views, shown, respawns }: { views: readonly QuestView[]; shown: readonly QuestView[]; respawns: Readonly<Record<string, string>> }) {
  const [scope, setScope] = useState<TargetScope>('shown')
  const list = useMemo(() => {
    const pick = scope === 'shown' ? shown : scope === 'wishes' ? views.filter((v) => v.want > 0 && v.times > 0 && !v.ignored) : views.filter((v) => !v.ignored && !v.turnIn.any)
    return targets(pick.filter((v) => scope === 'wishes' || !v.ready))
  }, [scope, views, shown])
  return (
    <>
      <div className="card row mb-16">
        <span className="small">For</span>
        <Segmented
          label="Hunt for"
          value={scope}
          onChange={setScope}
          options={[
            ['shown', 'The Tests shown', 'The Tests the Tests tab shows now, with its filters, less those you hold everything for'],
            ['open', 'Never handed in', 'Every Test not ignored that has not been handed in'],
            ['wishes', 'Your wish list', 'What your wish list still takes']
          ]}
        />
      </div>
      {!list.length ? (
        <div className="card empty">Nothing to hunt: you hold what they take.</div>
      ) : (
        <div className="stack mb-16">
          {list.map((t) => (
            <div key={`${t.mob}|${t.island ?? ''}`} className="card">
              <h2>
                {t.mob}
                {t.island ? <span className="faint small"> Island {t.island}</span> : null}
                {respawns[t.mob] && (
                  <span className="faint small" title="What your Respawns records say of it">
                    {' '}
                    · {respawns[t.mob]}
                  </span>
                )}
                <span className="spacer" />
                <span className="faint small">
                  {t.items.length} item{t.items.length === 1 ? '' : 's'}
                </span>
              </h2>
              {t.mob === ANY_MOB && <div className="faint small mb-8">Wind Runes drop from every mob in the Plane of Sky: the trash of an early island is the quickest.</div>}
              <table className="table sky-target-table">
                <tbody>
                  {t.items.map((r) => (
                    <tr key={r.item.name}>
                      <td>
                        <b>{r.item.name}</b>
                        {r.item.noDrop && <span className="faint small"> · No Drop</span>}
                        {r.also.length > 0 && <span className="faint small"> · also {r.also.join(', ')}</span>}
                      </td>
                      <td className="mono">
                        {num(r.have)}/{num(r.need)}
                      </td>
                      <td className="small">{r.tests.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** What could go: items held that every Test taking them has been handed in for, and no wish still wants. */
export function Cleanup({ s, from }: { s: SkyState; from: CountFrom }) {
  const rows = useMemo(() => cleanupRows(s, from), [s, from])
  if (!rows.length) return <div className="card empty">Nothing to clear: everything you hold, a Test you have not handed in or a wish still takes.</div>
  return (
    <div className="card mb-16">
      <p className="hint">
        Items you hold that every Test taking them has been handed in for, and no wish wants. A Test can be done again, and a second reward merges with the first into a +1: those
        you hold a whole set for say so.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Have</th>
            <th>Taken by</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item.name}>
              <td>
                <b>{r.item.name}</b>
              </td>
              <td className="mono">{num(r.have)}</td>
              <td className="small">
                {r.tests.map((t) => (
                  <div key={t.name}>
                    {t.name} → {t.rewards.join(' and ')} <span className="faint">(handed in ×{num(t.done)})</span>
                  </div>
                ))}
              </td>
              <td className="small">
                {r.keep ? (
                  <Tip
                    className="chip pill ok"
                    text={r.tests
                      .filter((t) => t.sets > 0)
                      .map((t) => `${t.name}: ${num(t.sets)} more`)
                      .join('; ')}
                  >
                    Keep: a whole set for another
                  </Tip>
                ) : (
                  <span className="chip pill">Spare</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Each class: its Tests handed in, and whether it is unlocked as a Primary Class. */
export function Classes({ s, onClass }: { s: SkyState; onClass: (cls: string) => void }) {
  const rows = useMemo(() => classRows(s), [s])
  return (
    <div className="card mb-16">
      <p className="hint">
        Handing in every Test of a class unlocks it as a Primary Class in Loadouts. Whether a class is unlocked is the achievements export’s word (
        <code>/outputfile achievements</code>) where it has one; a class unlocked by a token or by confirming it says nothing of its Tests.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Class</th>
            <th>Tests handed in</th>
            <th>Primary Class</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cls}>
              <td>
                <button className="link-button" onClick={() => onClass(r.cls)} title={`The ${r.cls} Tests`}>
                  {r.cls}
                </button>
              </td>
              <td>
                <Bar done={r.turnedIn} total={r.tests} label={`${r.cls}: ${r.turnedIn} of ${r.tests} Tests handed in`} />
              </td>
              <td className="small">
                {r.unlocked === true ? (
                  <Tip
                    className="chip pill ok"
                    text={
                      r.from === 'export'
                        ? r.granted
                          ? 'The achievements export says so: granted (confirmed, or a token), not by its Tests'
                          : 'The achievements export says so'
                        : 'Every Test is handed in'
                    }
                  >
                    Unlocked{r.granted ? ' (granted)' : ''}
                  </Tip>
                ) : r.unlocked === false ? (
                  <span className="chip pill">Locked</span>
                ) : (
                  <Tip className="faint" text="No achievements export says, and not every Test is handed in">
                    —
                  </Tip>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The Tests ignored: there to be shown again. */
export function Ignored({ views, onShow }: { views: readonly QuestView[]; onShow: (quest: string) => void }) {
  if (!views.length) return <div className="card empty">No Test is ignored. Ignore one on the Tests tab and it waits here, out of every other list.</div>
  return (
    <div className="card mb-16">
      <table className="table">
        <tbody>
          {views.map((v) => (
            <tr key={v.quest.name}>
              <td>
                <b>{v.quest.name}</b> <span className="small muted">→ {v.quest.rewards.join(' and ')}</span>
              </td>
              <td className="small">{v.quest.cls}</td>
              <td>
                <button className="btn small ghost" onClick={() => onShow(v.quest.name)}>
                  Show it again
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
