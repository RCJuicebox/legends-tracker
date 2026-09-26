import { useState } from 'react'
import { ago } from '../api'
import { slotLabel } from '../../../core/inventory'
import { DEFAULT_HIDDEN_ERAS, OTHER_ERA, OTHER_OUT_ERA } from '../../../core/upgrades'
import { ROLE_LABELS, ROLE_PRESETS, type RoleKey } from '../../../core/statValue'
import type { CharacterSheet, InventoryView } from '../../../shared/types'
import { className } from '../../../core/acModel'
import { Info, Pending } from '../components/ui'
import { num, wikiUrl } from '../format'
import { AC_OVER_CAP, useGearModel, type CatalogState, type GearMode } from '../gear/useGearModel'
import { ItemIcon, source } from './gearBits'
import { FocusTab, OptimizeTab } from './GearFocus'
import { PetTab } from './GearPet'
import { MergeTab } from './GearMerge'

export type { GearMode }

/** What each era button stands for, as its tooltip and in the "i" beside the row. */
function eraTip(era: string): string {
  return era === OTHER_ERA
    ? 'No era on the wiki page and no drop zone to tell by: quested, crafted and vendor items mostly'
    : era === OTHER_OUT_ERA
      ? 'Out of era on the wiki, in no expansion named here: FearHateRevamp, HoleVP, WarrensFearHateRevamp and Unknown Era pages'
      : era === 'Classic'
        ? "Everything the wiki counts as in era for EverQuest Legends: Classic, and Legends' live zones (Fear, Hate, Hole, Sky, Temple, Warrens, Paineel, Stonebrunt)"
        : `${era}: out of era on EverQuest Legends`
}

export function GearFinder({ view, sheet, mode, go }: { view: InventoryView; sheet: CharacterSheet | null; mode: GearMode; go?: (page: 'motes') => void }) {
  const g = useGearModel(view, sheet, mode)
  const { catalog, model, results, stats, classes, level, role, conv, acState, overCap, secondaryInUse, twoHanders, eraCounts, fociOf, lines, wanted, points, setPoints } = g
  const { preset, setPreset, setCustom, twoHandMode, setTwoHandMode, compare, setCompare, hiddenEras, setHiddenEras, slot, setSlot, capMode, setCapMode, judge, setJudge } = g.controls
  const [showWeights, setShowWeights] = useState(false)
  const state = catalog.state
  const refresh = catalog.refresh

  // The best merge reads only what is worn and the wiki's stats for it: no catalog needed.
  if (mode === 'merge') return <MergeTab view={view} weights={g.weights} preset={preset} setPreset={setPreset} go={go} />

  if (!state) return <Pending what="the item catalog" error={catalog.error} retry={catalog.reload} />
  const p = state.progress

  if (!state.file || !model) {
    return (
      <div className="card stack gap-12 lt-finder-intro">
        <h2 style={{ margin: 0 }}>Item catalog</h2>
        <p className="muted" style={{ margin: 0 }}>
          The upgrade finder, the focus effects and the optimizer read every piece of equipment on eqlwiki.com: what your classes, race and level can use, and what focus
          effects it carries. That needs the wiki's item catalog first: about a minute to download, once a week, kept on this PC.
        </p>
        {p.busy ? (
          <Progress p={p} />
        ) : (
          <div className="row">
            <button className="btn primary" onClick={() => void refresh()}>
              Download the item catalog
            </button>
            {p.error && (
              <span className="small" role="status" style={{ color: 'var(--red)' }}>
                Could not download it: {p.error}
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  if (mode === 'pet')
    return classes.length ? <PetTab m={model} /> : <div className="card empty">Set your classes and level on the Stats page, and the pet tools will know what your pet can wear.</div>

  const shown = (results ?? []).filter((r) => slot === 'all' || r.slot === slot)
  const withUpgrades = shown.filter((r) => r.candidates.length)
  const none = shown.filter((r) => !r.candidates.length && r.current)
  const scoring = mode !== 'focus'

  return (
    <div className="stack gap-12">
      <div className="card stack gap-12">
        {scoring && (
          <div className="row">
            <b>Weigh stats for</b>
            <span className="lt-seg" role="group" aria-label="Weigh stats for">
              {[...Object.keys(ROLE_PRESETS), 'Custom'].map((name) => (
                <button key={name} className={preset === name ? 'on' : ''} aria-pressed={preset === name} onClick={() => setPreset(name)}>
                  {name}
                </button>
              ))}
            </span>
            <button className="btn ghost small" aria-expanded={showWeights} onClick={() => setShowWeights(!showWeights)}>
              {showWeights ? 'Hide weights' : 'Show weights'}
            </button>
            <span className="grow" />
            {mode === 'finder' && (
              <>
                <b>Compare</b>
                <span className="lt-seg" role="group" aria-label="Compare">
                  <button className={compare === 'drop' ? 'on' : ''} aria-pressed={compare === 'drop'} onClick={() => setCompare('drop')} title="Candidates as they drop, at +0, against your gear at its merge level">
                    As they drop
                  </button>
                  <button className={compare === 'level' ? 'on' : ''} aria-pressed={compare === 'level'} onClick={() => setCompare('level')} title="Candidates merged to the same level as the item they would replace">
                    At your merge level
                  </button>
                </span>
                <Info
                  label="About Compare"
                  text="As they drop: candidates at +0, against your gear at its merge level. At your merge level: candidates merged to the same level as the item they would replace."
                />
                <b>Judge</b>
                <span className="lt-seg" role="group" aria-label="Judge">
                  <button className={judge === 'round' ? 'on' : ''} aria-pressed={judge === 'round'} onClick={() => setJudge('round')} title="Everything you own rearranged around the candidate: the item it pushes out may go to an Any slot and keep its focus">
                    In the round
                  </button>
                  <button className={judge === 'slot' ? 'on' : ''} aria-pressed={judge === 'slot'} onClick={() => setJudge('slot')} title="One slot, one item out: quicker, and blind to where the displaced item could go">
                    This slot only
                  </button>
                </span>
                <Info
                  label="About Judge"
                  text="In the round: each candidate is added to everything you own and the optimizer wears the lot as well as it can; the gain is what the whole set gains, so an item that pushes a focus belt into a free Any slot loses no focus, and a lore twin or a two-hander is caught. This slot only: the candidate against the one item it replaces, focus lost and all."
                />
              </>
            )}
          </div>
        )}
        {mode !== 'optimize' && (
          <div className="row gap-8">
            <b>Eras</b>
            <Info
              label="About the eras"
              text={
                <>
                  <div>Each button shows or hides that era's items. Classic: {eraTip('Classic').replace(/^Everything/, 'everything')}.</div>
                  <div>
                    {OTHER_ERA}: {eraTip(OTHER_ERA)}.
                  </div>
                  <div>
                    {OTHER_OUT_ERA}: {eraTip(OTHER_OUT_ERA)}.
                  </div>
                  <div>Every other era is out of era on EverQuest Legends.</div>
                </>
              }
            />
            {eraCounts.map(([era, n]) => {
              const on = !hiddenEras.includes(era)
              return (
                <button
                  key={era}
                  className={`lt-era${on ? ' on' : ''}`}
                  aria-pressed={on}
                  title={eraTip(era)}
                  onClick={() => setHiddenEras(on ? [...hiddenEras, era] : hiddenEras.filter((e) => e !== era))}
                >
                  {era} <small>{num(n)}</small>
                </button>
              )
            })}
            <button className="btn ghost small" onClick={() => setHiddenEras(DEFAULT_HIDDEN_ERAS)}>
              Live eras only
            </button>
          </div>
        )}
        {scoring && (
          <>
            <div className="row small">
              <b>AC soft cap</b>
              <span className="lt-seg" role="group" aria-label="AC soft cap">
                {(
                  [
                    ['auto', acState ? `Auto: ${acState.over ? 'over' : 'under'}` : 'Auto'],
                    ['over', 'Over'],
                    ['under', 'Under']
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} className={capMode === m ? 'on' : ''} aria-pressed={capMode === m} onClick={() => setCapMode(m)}>
                    {label}
                  </button>
                ))}
              </span>
              <span className="muted">
                {overCap
                  ? `AC counts at ${AC_OVER_CAP * 100}% of its weight: past the soft cap most of it is lost.`
                  : 'AC counts in full: you are under the soft cap.'}
                {acState && capMode === 'auto' && ` Mitigation ${num(acState.mitigation)} against a soft cap of ${num(acState.cap)}, from ${acState.from}.`}
              </span>
            </div>
            <div className="row small">
              <b>Primary</b>
              <span className="lt-seg" role="group" aria-label="Primary">
                {(
                  [
                    ['auto', `Auto: ${secondaryInUse ? 'one-handed' : 'any'}`],
                    ['one', 'One-handed'],
                    ['any', 'Include two-handed']
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} className={twoHandMode === m ? 'on' : ''} aria-pressed={twoHandMode === m} onClick={() => setTwoHandMode(m)}>
                    {label}
                  </button>
                ))}
              </span>
              <span className="muted">
                {twoHanders ? 'Two-handed weapons are suggested for Primary.' : 'Two-handed weapons are left out: your secondary hand is in use.'}
              </span>
            </div>
            <FocusPoints points={points} setPoints={setPoints} wanted={wanted.size} lines={lines.length} />
            <div className="small muted lt-worth">
              <b>What a point is worth to you:</b> {conv.notes.join(' · ')}
              {conv.offensePerStr ? ' · STR adds ⅔ Offense' : ''} · AGI adds {conv.avoidancePerAgi.toFixed(2)} avoidance · DEX only helps procs (it does not move crit on Legends)
            </div>
            {showWeights && (
              <div className="lt-weights">
                {(Object.keys(ROLE_LABELS) as RoleKey[]).map((k) => (
                  <label key={k} className="lt-weight">
                    <span>{ROLE_LABELS[k]}</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={role[k]}
                      title={k === 'ac' && overCap ? `Counts as ${Math.round(role.ac * AC_OVER_CAP * 100) / 100} while over the soft cap` : undefined}
                      onChange={(e) => {
                        setCustom({ ...role, [k]: Math.max(0, Number(e.target.value) || 0) })
                        setPreset('Custom')
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        <div className="row small muted gap-14">
          <span>
            For{' '}
            <b>
              {classes.length ? classes.map(className).join(' / ') : 'no classes set'}, level {level}
              {stats.race === 'iksar' ? ', Iksar' : ''}
            </b>{' '}
            (from the Stats page)
          </span>
          {mode === 'finder' && (
            <select aria-label="Slot" value={slot} onChange={(e) => setSlot(e.target.value)}>
              <option value="all">Every slot</option>
              {(results ?? []).map((r) => (
                <option key={r.slot} value={r.slot}>
                  {slotLabel(r.slot)}
                </option>
              ))}
            </select>
          )}
          <span className="grow" />
          <span className="faint">
            {num(state.file.items.length)} pieces from eqlwiki, fetched {ago(state.file.fetchedAt)}
          </span>
          {p.busy ? (
            <Progress p={p} small />
          ) : (
            <button className="btn ghost small" onClick={() => void refresh()}>
              Refresh
            </button>
          )}
        </div>
      </div>

      {!classes.length ? (
        <div className="card empty">Set your classes and level on the Stats page, and these tools will know what you can wear.</div>
      ) : mode === 'focus' ? (
        <FocusTab m={model} />
      ) : mode === 'optimize' ? (
        <OptimizeTab m={model} />
      ) : (
        <>
          <div className={`lt-finder${g.resultsStale ? ' stale' : ''}`} aria-busy={g.resultsStale}>
            {withUpgrades.map((r) => (
              <div key={r.slot} className="card lt-finder-slot">
                <div className="lt-finder-head">
                  <span className="lt-slot">{slotLabel(r.slot)}</span>
                  {r.current ? (
                    <span className="small muted">
                      replaces <b>{r.current.item.name}</b> · score {num(r.current.score)}
                      {r.current.focusLoss > 0 && (
                        <span title="What its focus effects add, by your focus weighting: a candidate without them has to make up for it">
                          {' '}
                          + {num(r.current.focusLoss)} focus ({fociOf(r.current.item).map((f) => f.name).join(', ')})
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="small muted">empty slot</span>
                  )}
                </div>
                {r.candidates.map((c) => (
                  <div key={c.item.title} className="lt-cand">
                    <ItemIcon icon={c.item.icon} />
                    <div className="lt-cand-body">
                      <div className="row gap-8">
                        <a className="lt-cand-name" href={wikiUrl(c.item.title)} target="_blank" rel="noreferrer">
                          {c.item.title}
                        </a>
                        {c.owned && <span className="lt-chip gold">you have one</span>}
                        <span className="lt-chip" title={c.eraInferred ? 'Worked out from the zones it drops in; the wiki page has no era' : undefined}>
                          {c.era}
                          {c.eraInferred ? ' · by zone' : ''}
                        </span>
                        {c.focus && (
                          <span
                            className={`lt-chip ${c.focus.gain > 0 ? 'focus' : ''}`}
                            title={c.focus.gain > 0 ? `Adds ${num(c.focus.gain)} to your focus effects` : 'A focus you already have as good, or one you do not want'}
                          >
                            {c.focus.name}
                          </span>
                        )}
                      </div>
                      <div className="lt-diffs">
                        {c.diffs.slice(0, 7).map((d) => (
                          <span key={d.key} className={d.delta > 0 ? 'up' : 'down'}>
                            {d.delta > 0 ? '+' : ''}
                            {Number.isInteger(d.delta) ? d.delta : d.delta.toFixed(2)} {d.label}
                          </span>
                        ))}
                      </div>
                      <div className="faint small">{source(c.item)}</div>
                      {c.round && (c.round.placed !== r.slot || c.round.moves.length > 1) && (
                        <div className="small muted">
                          {c.round.placed && c.round.placed !== r.slot ? `Goes in ${slotLabel(c.round.placed)}. ` : ''}
                          {c.round.moves
                            .filter((m) => m.in !== c.item.title)
                            .map((m) => (m.in ? `${m.in} → ${slotLabel(m.slot)}` : `${m.out} → carried`))
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                    <span
                      className="lt-gain"
                      title={
                        c.round
                          ? `What the whole set gains with it, everything rearranged (this slot alone: ${c.delta > 0 ? '+' : ''}${num(c.delta)})`
                          : 'How much higher it scores than what you wear, by your weights, focus effects included'
                      }
                    >
                      +{num(c.round ? c.round.delta : c.delta)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {!withUpgrades.length && <div className="card empty">Nothing on the wiki beats what you wear{slot !== 'all' ? ' there' : ''}, by these weights.</div>}
          {none.length > 0 && (
            <p className="small muted">
              Nothing beats what you wear in: <b>{none.map((r) => slotLabel(r.slot)).join(', ')}</b>.
            </p>
          )}
          <p className="faint small">
            Weights are on outcomes (HP, mana, AC, avoidance, Offense, haste…); a raw stat counts for what it buys you, worked out from your classes, level, current stats
            and AAs, the same formulas the Stats page checks against the game. Focus effects you want (Focus effects tab) count too: a candidate that brings a better one
            gains, and replacing an item loses what its focus and exaltations gave. Your two Any slots take any piece of gear. Scores only rank items against each other. The
            wiki holds base stats, so a candidate "as it drops" is at +0 while your gear counts at its merge level; switch to "At your merge level" to compare like with like.
            In era and out of era follow eqlwiki's own list; an item with no era on its page takes the era of the zones it drops in. Item data from eqlwiki.com.
          </p>
        </>
      )}
    </div>
  )
}

function FocusPoints({ points, setPoints, wanted, lines }: { points: number; setPoints: (n: number) => void; wanted: number; lines: number }) {
  return (
    <div className="row small">
      <b>Focus effects</b>
      <span className="muted">making every spell you cast 10% better is worth</span>
      <input type="number" min={0} step={25} value={points} style={{ width: 72 }} aria-label="Points for making every spell 10% better" onChange={(e) => setPoints(Math.max(0, Number(e.target.value) || 0))} />
      <span className="muted">
        points; a focus counts for the spells it touches, by how often you cast them. {wanted} of the {lines} that touch your spells are wanted (Focus effects tab).
      </span>
    </div>
  )
}

function Progress({ p, small }: { p: CatalogState['progress']; small?: boolean }) {
  const pctDone = p.total ? Math.min(100, Math.round((p.pages / p.total) * 100)) : 0
  return (
    <div className={`row ${small ? 'small' : ''}`} style={{ minWidth: small ? 220 : 360 }}>
      <span className="sr-only" role="status">
        Downloading the item catalog
      </span>
      <span className="lt-mergebar grow" role="progressbar" aria-label="Item catalog download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctDone}>
        <i style={{ width: `${pctDone}%` }} />
      </span>
      <span className="muted nowrap">
        {num(p.pages)} of {num(p.total || 11000)} pages
      </span>
    </div>
  )
}
