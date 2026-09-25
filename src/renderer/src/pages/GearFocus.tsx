import { useMemo } from 'react'
import { baseName, slotLabel } from '../../../core/inventory'
import { restrictions } from '../../../core/upgrades'
import { KIND_LABELS, KIND_ORDER, type FocusLine } from '../../../core/itemFocus'
import { optimizeGear, type Piece } from '../../../core/gearOptimizer'
import type { FocusCandidate, GearModel, OwnedFocus } from './GearFinder'
import { Icon, num, pct, source, whereText, wikiUrl } from './gearBits'

// The Gear page's focus effects tab and its optimizer for what the character already owns.

/** "FINGER" → "finger"; an item that fits several slots lists them. */
const slotWords = (statsblock: string) =>
  restrictions(statsblock)
    .slots.map((s) => s.toLowerCase())
    .join(' ')

function strengthNote(info: { pct: number; maxLevel: number; decayPct: number; eff: number }, topLevel: number): string {
  if (!info.maxLevel) return `${pct(info.pct)}, with no level cap`
  if (info.eff >= info.pct) return `${pct(info.pct)} on spells up to level ${info.maxLevel}: full strength on your level-${topLevel} spells`
  if (!info.eff) return `${pct(info.pct)} on spells up to level ${info.maxLevel}, and nothing past it: no use on your level-${topLevel} spells`
  return `${pct(info.pct)} on spells up to level ${info.maxLevel}, ${info.decayPct}% less for each level past it: ${pct(info.eff)} on your level-${topLevel} spells`
}

type Status = { label: string; tone: 'good' | 'warn' | 'bad' | '' }

function status(have: OwnedFocus[], best: FocusCandidate | undefined): Status {
  const worn = have.find((h) => h.from === 'worn')?.eff ?? 0
  const owned = have[0]?.eff ?? 0
  const top = Math.max(best?.eff ?? 0, owned)
  if (worn && worn >= top) return { label: 'Wearing the best', tone: 'good' }
  if (worn && owned > worn) return { label: 'You own a better one', tone: 'warn' }
  if (worn) return { label: 'Wearing a lower rank', tone: 'warn' }
  if (owned) return { label: 'Owned, not worn', tone: 'warn' }
  return { label: 'Missing', tone: 'bad' }
}

function ownedText(h: OwnedFocus): string {
  const where = whereText(h.from, h.item)
  return h.via ? `the ${baseName(h.via)} exaltation in ${h.item.name}, ${where}` : `${h.item.name}, ${where}`
}

export function FocusTab({ m }: { m: GearModel }) {
  if (!m.report) {
    return (
      <div className="card empty">
        Reading focus effects from the game's spell file… If this stays, check the game folder in Settings: the focus effects come from its spells_us.txt.
      </div>
    )
  }
  const byKind = KIND_ORDER.map((k) => ({ kind: k, lines: m.lines.filter((l) => l.kind === k) })).filter((g) => g.lines.length)
  const wantedCount = m.lines.filter((l) => m.wanted.has(l.key)).length
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Focus effects for your spells</h2>
          <span className="grow" />
          <button className="btn ghost small" onClick={() => m.setWanted(m.lines.map((l) => l.key), true)}>
            Want all
          </button>
          <button className="btn ghost small" onClick={() => m.setWanted(m.lines.map((l) => l.key), false)}>
            Want none
          </button>
          <button className="btn ghost small" onClick={m.resetWanted} title="Every focus but reagent use">
            Defaults
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Every focus effect on gear that improves at least one spell your classes cast, with the best there is in the eras shown and the best you own, worn or not
          (exaltations included). Tick the ones you want: {wantedCount} of {m.lines.length} are. Each wanted focus counts for{' '}
          <label className="row tight" style={{ display: 'inline-flex', gap: 4 }}>
            <input type="number" min={0} step={25} value={m.points} style={{ width: 64 }} onChange={(e) => m.setPoints(Math.max(0, Number(e.target.value) || 0))} />
          </label>{' '}
          points at the best rank there is in the upgrade finder and the optimizer, a lower rank for less. Only the best focus of a kind works on a spell, so what counts is
          the best rank you wear in each line.
        </p>
      </div>

      {byKind.map((g) => (
        <div key={g.kind} className="card lt-focus">
          <div className="lt-subhead">{KIND_LABELS[g.kind]}</div>
          {g.lines.map((l) => (
            <FocusRow key={l.key} m={m} l={l} />
          ))}
        </div>
      ))}

      {m.idleLines.length > 0 && (
        <p className="small muted">
          No help to your spells: {m.idleLines.map((l) => `${l.label} (${l.families.join(', ')})`).join(' · ')}.
        </p>
      )}
      <p className="faint small">
        What each focus does comes from the game's own spell file: its strength, its level cap and how fast it fades past it, and which spells it touches (beneficial or
        detrimental, instant or over time, pets, lifetaps, instruments). Foci that differ only in strength and level cap are ranks of one line; Extended Enhancement III and
        Tavee's Greater Diuturnity are the same focus. A rank is judged on your highest-level spell in its line. Which item carries which focus comes from eqlwiki.com.
      </p>
    </div>
  )
}

function FocusRow({ m, l }: { m: GearModel; l: FocusLine }) {
  const on = m.wanted.has(l.key)
  const avail = m.available.get(l.key) ?? []
  const have = m.ownedFoci.get(l.key) ?? []
  const best = avail[0]
  const topItems = best ? avail.filter((c) => c.eff >= best.eff) : []
  const st = status(have, best)
  const info = (name: string) => m.report!.foci[name]
  return (
    <div className={`lt-focus-row${on ? '' : ' off'}`}>
      <label className="lt-focus-toggle" title={on ? 'Wanted: counts in the finder and the optimizer' : 'Not wanted'}>
        <input type="checkbox" checked={on} onChange={() => m.setWanted([l.key], !on)} />
      </label>
      <div className="lt-focus-line">
        <b>{l.label}</b>
        <div className="small muted">{l.families.join(' · ')}</div>
        <div className="faint small" title={l.examples.join('\n')}>
          Helps {l.spells} of your spells: {l.examples.slice(0, 3).join(', ')}
          {l.spells > 3 ? '…' : ''}
        </div>
      </div>
      <div className="lt-focus-col">
        <div className="lt-focus-cap">Best there is</div>
        {best ? (
          <>
            <div title={strengthNote(info(best.focus), l.topLevel)}>
              <b>{best.focus}</b> <span className="muted">{pct(best.eff)}</span>
            </div>
            {topItems.slice(0, 3).map((c) => (
              <div key={c.item.title} className="lt-focus-item" title={source(c.item)}>
                <Icon icon={c.item.icon} size={20} />
                <a href={wikiUrl(c.item.title)} target="_blank" rel="noreferrer">
                  {c.item.title}
                </a>
                <span className="faint">
                  {slotWords(c.item.statsblock)} · {c.era}
                </span>
                {c.owned && <span className="lt-chip gold">yours</span>}
              </div>
            ))}
            {topItems.length > 3 && <div className="faint small">and {topItems.length - 3} more</div>}
          </>
        ) : (
          <span className="faint small">None in the eras shown that works on your spells</span>
        )}
        {have[0] && have[0].eff > (best?.eff ?? 0) && best && (
          <div className="small muted">Your {baseName(have[0].via || have[0].item.name)} ({have[0].focus}) beats these: it is from an era not shown.</div>
        )}
      </div>
      <div className="lt-focus-col">
        <div className="lt-focus-cap">
          You have <span className={`lt-chip ${st.tone}`}>{st.label}</span>
        </div>
        {have.length ? (
          <>
            <div title={strengthNote(info(have[0].focus), l.topLevel)}>
              <b>{have[0].focus}</b> <span className="muted">{pct(have[0].eff)}</span>
            </div>
            <div className="small muted">{ownedText(have[0])}</div>
            {have[0].from !== 'worn' && have.some((h) => h.from === 'worn') && (
              <div className="faint small">
                Worn: {have.find((h) => h.from === 'worn')!.focus} ({pct(have.find((h) => h.from === 'worn')!.eff)})
              </div>
            )}
          </>
        ) : (
          <span className="faint small">Nothing you own carries it</span>
        )}
      </div>
    </div>
  )
}

export function OptimizeTab({ m }: { m: GearModel }) {
  const plan = useMemo(
    () => optimizeGear({ pieces: m.pieces, wearer: m.wearer, weights: m.weights, twoHanders: m.twoHanders, focusValue: m.focusValue }),
    [m.pieces, m.wearer, m.weights, m.twoHanders, m.focusValue]
  )
  const changes = plan.slots
    .map((slot, i) => ({ slot, i, before: plan.before[i], after: plan.after[i] }))
    .filter((c) => c.before !== c.after)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const statGain = sum(plan.slotScoreAfter) - sum(plan.slotScoreBefore) + plan.hasteAfter - plan.hasteBefore
  const focusGain = plan.focusAfter - plan.focusBefore
  const namesOf = (p: Piece | null) => p?.foci ?? []
  const lineOf = (name: string) => m.report?.foci[name]
  const bestIn = (set: (Piece | null)[], line: string) =>
    Math.max(0, ...set.flatMap((p) => namesOf(p).map((n) => (lineOf(n)?.line === line ? lineOf(n)!.eff : 0))))
  const wantedLines = m.lines.filter((l) => m.wanted.has(l.key))

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card stack" style={{ gap: 6 }}>
        <h2 style={{ margin: 0 }}>Best use of what you own</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Every piece you wear, carry and bank ({m.pieces.length} of them), tried in every slot it fits, both Any slots included, scored with these weights plus the focus
          effects you want. Exaltations stay in the item that holds them.
        </p>
        {changes.length ? (
          <div className="row" style={{ gap: 18, flexWrap: 'wrap', marginTop: 4 }}>
            <span>
              <b>{changes.length}</b> change{changes.length === 1 ? '' : 's'}
            </span>
            <span className={statGain >= 0 ? 'lt-up' : 'lt-down'}>
              Stats {statGain >= 0 ? '+' : ''}
              {num(statGain)}
            </span>
            <span className={focusGain >= 0 ? 'lt-up' : 'lt-down'}>
              Focus effects {focusGain >= 0 ? '+' : ''}
              {num(focusGain)}
            </span>
            <span className="lt-gain">+{num(statGain + focusGain)}</span>
          </div>
        ) : (
          <p style={{ margin: '4px 0 0' }}>What you wear is already the best way to wear what you own, by these weights and the focus effects you want.</p>
        )}
      </div>

      {changes.length > 0 && (
        <div className="card lt-opt">
          {changes.map((c) => {
            const moveTo = c.before ? plan.after.indexOf(c.before) : -1
            const gained = namesOf(c.after).filter((n) => !plan.before.some((p) => namesOf(p).includes(n)))
            const lost = namesOf(c.before).filter((n) => !plan.after.some((p) => namesOf(p).includes(n)))
            const delta = plan.slotScoreAfter[c.i] - plan.slotScoreBefore[c.i]
            return (
              <div key={c.i} className="lt-opt-row">
                <span className="lt-slot">{slotLabel(c.slot)}</span>
                <div className="lt-cand-body">
                  <div className="row tight" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {c.after ? (
                      <>
                        <b>{c.after.item.name}</b>
                        <span className="small muted">
                          {c.after.from === 'worn' ? `from your ${slotLabel(c.after.item.location)}` : whereText(c.after.from, c.after.item).replace(/^in /, 'from ')}
                        </span>
                      </>
                    ) : (
                      <span className="muted">leave empty</span>
                    )}
                  </div>
                  <div className="small muted">
                    instead of {c.before ? <b>{c.before.item.name}</b> : 'nothing'}
                    {c.before && (moveTo >= 0 ? `, which moves to ${slotLabel(plan.slots[moveTo])}` : ', which comes off')}
                  </div>
                  {(gained.length > 0 || lost.length > 0) && (
                    <div className="lt-diffs">
                      {gained.map((n) => (
                        <span key={n} className="up">
                          + {n}
                        </span>
                      ))}
                      {lost.map((n) => (
                        <span key={n} className="down">
                          − {n}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="lt-gain" title="Stats in this slot, by your weights (focus effects are counted over all slots, above)">
                  {delta >= 0 ? '+' : ''}
                  {num(delta)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {wantedLines.length > 0 && (
        <div className="card lt-focus">
          <div className="lt-subhead">The focus effects you want</div>
          <div className="lt-opt-table">
            <span className="lt-focus-cap">Focus</span>
            <span className="lt-focus-cap">Worn now</span>
            <span className="lt-focus-cap">With these changes</span>
            <span className="lt-focus-cap">Best there is</span>
            {wantedLines.map((l) => {
              const now = bestIn(plan.before, l.key)
              const after = bestIn(plan.after, l.key)
              const owned = m.ownedFoci.get(l.key)?.[0]
              const best = m.available.get(l.key)?.[0]
              const tone = after && after >= (best?.eff ?? 0) ? 'good' : after ? 'warn' : 'bad'
              return (
                <div key={l.key} className="lt-opt-line">
                  <span>
                    {l.label}
                    <div className="faint small">{l.families.join(' · ')}</div>
                  </span>
                  <span>{now ? pct(now) : <span className="faint">none</span>}</span>
                  <span>
                    <span className={`lt-chip ${tone}`}>{after ? pct(after) : 'none'}</span>
                    {owned && owned.eff > after && (
                      <div className="faint small" title="You own it, but by these weights the slot is worth more with something else in it">
                        left off: {owned.focus} ({pct(owned.eff)})
                      </div>
                    )}
                  </span>
                  <span>
                    {best ? (
                      <>
                        {pct(best.eff)}{' '}
                        <a className="small" href={wikiUrl(best.item.title)} target="_blank" rel="noreferrer">
                          {best.item.title}
                        </a>
                        <div className="faint small">{source(best.item)}</div>
                      </>
                    ) : (
                      <span className="faint">none in era</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <p className="faint small">
        A search from what you wear now: it moves one piece at a time into the slot where it adds most (swapping, or refilling the slot it left) until no move adds
        anything. Stats are scored exactly as in the upgrade finder, at each piece's merge level; lore items go on once. Items with no wiki page stay where they are.
      </p>
    </div>
  )
}
