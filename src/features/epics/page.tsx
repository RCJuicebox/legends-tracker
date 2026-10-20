import { useMemo, useState } from 'react'
import { CharacterPicker } from '../../renderer/src/components/CharacterPicker'
import { api } from '../../renderer/src/api'
import { useInvoke, useVisibleInterval } from '../../renderer/src/hooks'
import { Ago, FilterBox, GameCommand, Info, NumberInput, Pending, SettingsLink, Tabs, Tip } from '../../renderer/src/components/ui'
import { useRemembered } from '../../renderer/src/remember'
import { showToast } from '../../renderer/src/toast'
import { num, who, wikiUrl } from '../../core/format'
import { itemKey } from '../../core/inventory'
import { heldOf } from '../../core/itemTally'
import { useCharacterChoice } from '../../renderer/src/character'
import { EPIC_CLASSES, EPIC_SOURCE, EPIC_URL, SPELL_QUESTS, tickKey, type EpicState } from './core'
import { ANYWHERE, classViews, filterViews, itemRows, NO_FILTER, pickClasses, targets, type ClassView, type CountFrom, type EpicFilter, type StepView } from './views'

// Goals › Epics (an optional module, Settings › Modules): what to keep for each class's epic quest, as
// the eqlwiki's checklist lists it, with what the character holds of each; the five class spell
// quests, the same way; Targets, where to hunt for what either is missing; and Items, where a count is
// put right.

type View = 'checklist' | 'spells' | 'targets' | 'items'

/** The classes a spell quest is for, as a sentence ends: "an Enchanter, a Wizard, … and a Ranger". */
const SPELL_CLASSES = SPELL_QUESTS.map((q) => `${/^[AEIOU]/.test(q.cls) ? 'an' : 'a'} ${q.cls}`)
  .join(', ')
  .replace(/, ([^,]*)$/, ' and $1')

const HOW = (
  <>
    <div>
      <b>The checklist</b> is the eqlwiki’s “Epic Items To Keep” by Manlaan ({EPIC_SOURCE}): what each class’s epic quest takes that can be gathered now, pre-Kunark. A step with
      steps under it is a quest or a craft: its reward in hand covers what makes it, as does the finished epic. ⚠ marks what the wiki has not verified. SEQO reads the same page.
    </div>
    <div>
      <b>What you hold</b> is counted from your log (every copy you looted, kept or stored, less what you handed over or merged away), from your inventory export (
      <code>/outputfile inventory</code>: bags, bank, depot, worn and Storage), or the higher of the two for each item. Copies you had before your log began are put right on the
      Items tab. An item two of your classes take is wanted by both, so one of it reads 1/2.
    </div>
    <div>
      <b>Spell quests</b> are the five class spells a quest gives (Tashania, Ice Comet, Divine Might, Life Leech and Call of Flame), each from its eqlwiki quest page; SEQO chose
      the five. The scroll in hand covers the quest. Most pieces are ground spawns, which may leave no line in your log: the inventory export counts them, or tick them off. The ten
      Old Silver Coins share one name, and the ten Rods too, so they are counted together: tick each spot off as you pick it up. A piece an epic and a spell quest both take is
      wanted by both, on Targets too; tick the spell off to leave a quest out.
    </div>
    <div>
      <b>Tick a step off</b> yourself for what no file can see: a piece handed in, a reward quested on another PC, a step you will not do.
    </div>
  </>
)

type Act = {
  tick: (key: string, on: boolean) => void
  have: (item: string, n: number) => void
}

export function Epics() {
  const chars = useCharacterChoice('inventory', { withLogs: true })
  const character = chars.character
  const q = useInvoke(character ? 'epics:state' : null, [character])
  useVisibleInterval(q.reload, 60_000)
  const [view, setView] = useRemembered<View>('epics.view', 'checklist')
  const [kept, setFilter] = useRemembered<Omit<EpicFilter, 'text'>>('epics.filter', { cls: 'mine', hideDone: false })
  const [text, setText] = useState('')
  const [from, setFrom] = useRemembered<CountFrom>('epics.from', 'both')
  const s = q.data
  const f = useMemo<EpicFilter>(() => ({ ...NO_FILTER, ...kept, text }), [kept, text])

  /** Calls one of the module's channels and shows the state it answers with. */
  const save = async (call: () => Promise<EpicState>) => {
    try {
      q.setData(await call())
    } catch (e) {
      showToast(`Could not save that: ${e instanceof Error ? e.message : String(e)}`, { tone: 'bad' })
    }
  }
  const act: Act = {
    tick: (key, on) => void save(() => api.invoke('epics:tick', character, key, on)),
    have: (item, n) => void save(() => api.invoke('epics:have', character, item, n))
  }

  const mine = useMemo(() => s?.classes ?? [], [s])
  // Without an inventory export there is the log alone.
  const counted: CountFrom = s?.exported ? from : 'log'
  // The epics and the spell quests are counted together, so what both take is wanted by both.
  const picked = useMemo(() => [...pickClasses(f, mine, 'epic'), ...pickClasses(f, mine, 'spell')], [f, mine])
  const views = useMemo(() => (s ? classViews(picked, s, counted) : []), [s, picked, counted])
  const shown = useMemo(() => views.filter((c) => c.kind === (view === 'spells' ? 'spell' : 'epic')), [views, view])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Epics</h1>
          <div className="lead">
            What to keep for each class’s epic quest and spell quest, and how much of it you hold; where to hunt for the rest. <Info label="How it is worked out" text={HOW} />
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
            label="Epics view"
            value={view}
            onChange={setView}
            tabs={[
              ['checklist', 'Checklist'],
              ['spells', 'Spell quests'],
              ['targets', 'Targets'],
              ['items', 'Items']
            ]}
          />
          <Sources s={s} from={from} onFrom={setFrom} />
          {view !== 'items' && (
            <div className="card row mb-16">
              <select value={f.cls === 'mine' && !mine.length ? 'all' : f.cls} onChange={(e) => setFilter({ ...kept, cls: e.target.value })} aria-label="Class">
                {mine.length > 0 && <option value="mine">Your classes ({mine.join(', ')})</option>}
                <option value="all">Every class</option>
                {EPIC_CLASSES.map((c) => (
                  <option key={c.cls} value={c.cls}>
                    {c.cls}
                  </option>
                ))}
              </select>
              {(view === 'checklist' || view === 'spells') && (
                <>
                  <FilterBox placeholder="Find an item, mob, zone or quest…" label="Find an item, mob, zone or quest" value={text} onChange={setText} width={260} />
                  <label className="row tight small" title="What is left to gather: a step in hand, ticked off or covered is hidden">
                    <input type="checkbox" checked={f.hideDone} onChange={(e) => setFilter({ ...kept, hideDone: e.target.checked })} />
                    Hide what is done
                  </label>
                </>
              )}
            </div>
          )}
          {view === 'checklist' || view === 'spells' ? (
            <Checklist
              views={shown}
              f={f}
              act={act}
              empty={
                view === 'spells' ? `No spell quest for ${f.cls === 'mine' && mine.length ? mine.join(' or ') : f.cls}: the five are for ${SPELL_CLASSES}.` : 'No class picked.'
              }
            />
          ) : view === 'targets' ? (
            <Targets views={views} />
          ) : (
            <Items s={s} filter={text} onText={setText} onHave={act.have} />
          )}
          <div className="faint small mb-16">
            Checklist from <a href={EPIC_URL}>Epic Items To Keep</a> by Manlaan on eqlwiki.com, which also has each class’s Epic Quest walkthrough; SEQO (RealMaeel) reads the same
            page. Spell quests from their eqlwiki quest pages, with SEQO’s notes from the EQ Legends Tools quest guides.
          </div>
        </>
      )}
    </>
  )
}

/** Where the counts come from, and how old the export is. */
function Sources({ s, from, onFrom }: { s: EpicState; from: CountFrom; onFrom: (v: CountFrom) => void }) {
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
    </div>
  )
}

/** Each list picked (a class's epic, or a spell quest): what finishes it, how far along its pieces are, and its steps as a tree. */
function Checklist({ views, f, act, empty }: { views: readonly ClassView[]; f: EpicFilter; act: Act; empty: string }) {
  if (!views.length) return <div className="card empty">{empty}</div>
  return (
    <div className="stack mb-16">
      {views.map((c) => {
        const shown = filterViews(c.steps, f)
        const pct = Math.round(c.near * 100)
        return (
          <div key={c.key} className="card epic-class">
            <h2>
              {c.spell ? (
                <>
                  <span>{c.spell.name}</span>
                  <span className="muted small">
                    {c.cls} level {c.spell.level} · <a href={wikiUrl(c.spell.page)}>{c.spell.page}</a>
                  </span>
                </>
              ) : (
                <>
                  <span>{c.cls}</span>
                  <span className="muted small">{c.epic.length ? c.epic.join(' and ') : 'epic not on the wiki yet'}</span>
                </>
              )}
              {c.finished && (
                <Tip className="chip ok" text={`${c.finished} is in your bags or bank: nothing more is needed`}>
                  Finished
                </Tip>
              )}
              <span className="spacer" />
              {c.pieces > 0 && (
                <span className="epic-bar-wrap" title={`${c.done} of ${c.pieces} pieces in hand, ticked off or covered`}>
                  <span className="small mono">
                    {num(c.done)}/{num(c.pieces)}
                  </span>
                  <span
                    className="epic-bar"
                    role="progressbar"
                    aria-label={`${c.spell?.name ?? c.cls}: ${c.done} of ${c.pieces} pieces`}
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${pct}%` }} />
                  </span>
                </span>
              )}
            </h2>
            {!c.steps.length ? (
              <div className="faint small">The wiki has nothing confirmed to gather for this class yet.</div>
            ) : !shown.length ? (
              <div className="faint small">Nothing matches{f.hideDone ? ': every step is done' : ''}.</div>
            ) : (
              <ul className="epic-steps">
                {shown.map((v) => (
                  <StepRow key={v.name} v={v} act={act} />
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** A step: its tick, its name and count, how it comes, and its parts under it. */
function StepRow({ v, act }: { v: StepView; act: Act }) {
  const st = v.step
  const key = tickKey(v.list, st)
  const where = [st.how, st.zone].filter(Boolean).join(' · ')
  const count = st.item ? (v.need > 0 ? `${num(Math.min(v.have, v.need))}/${num(v.need)}` : v.done && !v.ticked ? `${num(v.have)}/${num(st.qty)}` : '') : ''
  return (
    <li className={`epic-step${v.done ? ' done' : ''}`}>
      <div className="epic-step-row" style={{ paddingLeft: v.depth * 22 }}>
        <input
          type="checkbox"
          checked={v.ticked}
          aria-label={`Tick off ${v.name}`}
          title={v.ticked ? 'Ticked off by you: untick it' : 'Tick it off yourself: a turn-in, a craft or a reward no file can see'}
          onChange={(e) => act.tick(key, e.target.checked)}
        />
        <span className="epic-step-name">
          {st.item ? (
            <>
              <a href={wikiUrl(st.item)} title="Its eqlwiki page">
                {st.item}
              </a>
              {st.label && <span className="muted"> ({st.label})</span>}
            </>
          ) : (
            <b>{st.quest}</b>
          )}
          {st.qty > 1 && <span className="muted"> ×{st.qty}</span>}
        </span>
        {count && (
          <Tip
            className={`chip pill${v.enough ? ' ok' : v.have > 0 ? ' warn' : ''}`}
            text={v.shared ? `${num(v.have)} held; ${num(v.need)} wanted between the classes shown` : `${num(v.have)} held of ${num(v.need || st.qty)} needed`}
          >
            {count}
            {v.shared ? ' shared' : ''}
          </Tip>
        )}
        {v.ticked ? (
          <span className="chip pill ok">Ticked off</span>
        ) : v.covered ? (
          <Tip className="chip pill ok" text={`${v.covered}: this only exists to make it`}>
            ✔ {v.covered}
          </Tip>
        ) : null}
        <span className="small muted epic-step-how">
          {st.unverified && (
            <Tip className="warn-text" text="The wiki marks this entry unverified">
              ⚠{' '}
            </Tip>
          )}
          {where}
          {st.note && <span className="faint"> · {st.note}</span>}
        </span>
      </div>
      {v.parts.length > 0 && (
        <ul className="epic-steps">
          {v.parts.map((p) => (
            <StepRow key={p.name} v={p} act={act} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Where to hunt: each zone, and what it gives that the classes shown are missing. */
function Targets({ views }: { views: readonly ClassView[] }) {
  const list = useMemo(() => targets(views), [views])
  if (!list.length) return <div className="card empty">Nothing to hunt: every piece the classes shown take is in hand, ticked off or covered.</div>
  return (
    <div className="stack mb-16">
      {list.map((t) => (
        <div key={t.zone} className="card">
          <h2>
            {t.zone}
            <span className="spacer" />
            <span className="faint small">
              {t.rows.length} piece{t.rows.length === 1 ? '' : 's'}
            </span>
          </h2>
          {t.zone === ANYWHERE && <div className="faint small mb-8">The wiki names no zone: bought, crafted, or from mobs found in many zones.</div>}
          <table className="table epic-target-table">
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.name}>
                  <td>
                    <b>{r.name}</b>
                    {r.unverified && <span className="warn-text"> ⚠</span>}
                    {r.note && <span className="faint small"> · {r.note}</span>}
                  </td>
                  <td className="mono">
                    {num(r.have)}/{num(r.need)}
                  </td>
                  <td className="small">{r.how}</td>
                  <td className="small faint">{r.classes.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

/** Every item the steps take, who takes it and how many are held: the place to put a count right. */
function Items({ s, filter, onText, onHave }: { s: EpicState; filter: string; onText: (v: string) => void; onHave: (item: string, have: number) => void }) {
  const rows = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
    return itemRows().filter((r) => words.every((w) => [r.name, r.how, r.zone ?? '', ...r.classes].join(' ').toLowerCase().includes(w)))
  }, [filter])
  return (
    <>
      <div className="card row mb-16">
        <FilterBox placeholder="Find an item, mob, zone or class…" label="Find an item, mob, zone or class" value={filter} onChange={onText} width={260} />
      </div>
      <div className="card mb-16">
        <p className="hint">
          Your log counts what you looted, handed over and merged since it began; the inventory export, what it saw in your bags, bank, depot, worn and Storage. Type what you hold
          where the log’s count is wrong: the log goes on counting from your number.
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
              const k = itemKey(r.name)
              const fixed = s.adjust[k] !== undefined
              return (
                <tr key={k}>
                  <td>
                    <b>{r.name}</b>
                    {r.kind !== 'piece' && <span className="faint small"> · the {r.kind}</span>}
                  </td>
                  <td className="small">{[r.how, r.zone].filter(Boolean).join(' · ')}</td>
                  <td>
                    <span className="row tight">
                      <NumberInput value={heldOf(s, r.name)} min={0} max={9999} width={64} label={`${r.name} held`} onChange={(n) => n !== undefined && onHave(r.name, n)} />
                      {fixed && (
                        <Tip className="faint small" text={`Your log counts ${num(s.logged[k] ?? 0)}; you said otherwise. Type that number to go back to the log’s count.`}>
                          set by you
                        </Tip>
                      )}
                    </span>
                  </td>
                  <td className="mono">{s.exported ? num(s.exported.counts[k] ?? 0) : '—'}</td>
                  <td className="small">{r.classes.join(', ')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
