import { useMemo, useState } from 'react'
import { useRemembered } from '../remember'
import { baseName, slotLabel } from '../../../core/inventory'
import { canWear, score, weightsForSlot } from '../../../core/gearFinder'
import { pieceName, SLOT_LAYOUT, type GearLock, type Piece, type PieceSource, type Plan } from '../../../core/gearOptimizer'
import type { GearInput } from '../../../core/gearWork'
import { useGearPlan } from '../gear/useGearPlan'
import type { CatalogItem } from '../../../core/wikiItem'
import type { GearModel } from '../gear/useGearModel'
import { CATALOG_PER_SLOT } from '../../../core/gearCatalog'
import { Disclosure, Info, Segmented } from '../components/ui'
import { num, wikiUrl } from '../../../core/format'
import { source, whereText } from './gearBits'
import { pct } from './GearFocus'

// Gear › Gear optimiser: the whole set worn as well as it can be by your weights, with pieces locked in where you want them.

/** Where a piece to get comes from: its era and where it drops. */
const catalogWhere = (c: CatalogItem | undefined) => (c ? [c.era, source(c)].filter(Boolean).join(' · ') : '')

/** A piece locked into a slot, kept by what finds it again in the next inventory export. */
interface LockRef {
  slot: number
  name: string
  from: PieceSource
  location: string
}

/** Where pieces come from, in the lock picker's order. */
const PICK_GROUPS: [PieceSource, string][] = [
  ['worn', 'Worn'],
  ['bags', 'Bags'],
  ['bank', 'Bank'],
  ['sharedBank', 'Shared bank'],
  ['storage', 'Storage › Equipment'],
  ['pet', 'On your pet'],
  ['catalog', 'To get']
]

/** A piece in the lock picker: copies of one item in one place (three in the bags, say) are one choice. */
const pieceId = (p: Piece) => `${p.from}|${p.from === 'worn' ? p.item.location : ''}|${p.item.name}`

export function OptimizeTab({ m }: { m: GearModel }) {
  // What it chooses from: what the character owns, or that and the best of every piece they could get.
  const [scope, setScope] = useRemembered<'owned' | 'all'>('optimize.scope', 'owned')
  const all = scope === 'all'
  const pieces = useMemo(() => (all ? [...m.pieces, ...m.catalogPieces] : m.pieces), [all, m.pieces, m.catalogPieces])
  const byTitle = useMemo(() => new Map(m.catalog.map((c) => [c.title, c])), [m.catalog])
  // Pieces locked into a slot, per character: found again where they were, or by name wherever they
  // went since (a piece to get only with All gear).
  const [lockRefs, setLockRefs] = useRemembered<LockRef[]>(`optimize.locks.${m.view.character}`, [])
  const lockPieces = useMemo(
    () =>
      lockRefs.map(
        (r) =>
          pieces.find((p) => !p.exalt && p.item.name === r.name && p.from === r.from && p.item.location === r.location) ??
          pieces.find((p) => !p.exalt && p.item.name === r.name && p.from === r.from) ??
          pieces.find((p) => !p.exalt && p.item.name === r.name && (p.from === 'catalog') === (r.from === 'catalog'))
      ),
    [lockRefs, pieces]
  )
  const locks = useMemo(() => lockRefs.flatMap((r, i): GearLock[] => (lockPieces[i] ? [{ slot: r.slot, piece: lockPieces[i] }] : [])), [lockRefs, lockPieces])
  // Worked out in the gear worker: with All gear or exaltations a search takes a few hundred
  // milliseconds, which held the window on every lock or weight changed (LT-390).
  const input = useMemo<GearInput>(
    () => ({
      pieces,
      wearer: m.wearer,
      weights: m.weights,
      twoHanders: m.twoHanders,
      worth: m.worth,
      exaltations: m.exaltations,
      effects: m.effects.inputs,
      hands: m.weaponHands,
      locks: locks.map((l) => ({ slot: l.slot, piece: pieces.indexOf(l.piece) }))
    }),
    [pieces, m.wearer, m.weights, m.twoHanders, m.worth, m.exaltations, m.effects.inputs, m.weaponHands, locks]
  )
  const { plan, stale, error } = useGearPlan(input)
  if (!plan)
    return (
      <div className="card" aria-busy={!error}>
        {error ? <p className="notice warn">The best set could not be worked out: {error}</p> : <p className="muted">Working out the best set…</p>}
      </div>
    )
  const hostOf = (p: Piece) => p.host ?? p
  /** Locks `p` into slot `i`, in place of any lock on that slot or that piece. */
  const lock = (i: number, p: Piece) => {
    const h = hostOf(p)
    const kept = lockRefs.filter((r, k) => r.slot !== i && lockPieces[k] !== h)
    setLockRefs([...kept, { slot: i, name: h.item.name, from: h.from, location: h.item.location }])
  }
  const unlock = (i: number) => setLockRefs(lockRefs.filter((r) => r.slot !== i))
  const lockedSlots = new Set(plan.locked)
  const toGet = plan.after.filter((p) => p?.from === 'catalog').length
  // Stats as shown: at the weights' own worth. With weapons by ratio first the plan weighs the hands'
  // weapon ratio far above the rest to choose them; the numbers shown keep it at its own weight.
  const shownScore = (p: Piece | null, i: number) => (p?.stats ? score(p.stats, { ...weightsForSlot(m.weights, plan.slots[i], m.hands), haste: 0 }) : 0)
  const shownBefore = plan.before.map(shownScore)
  const shownAfter = plan.after.map(shownScore)
  const changes = plan.slots.map((slot, i) => ({ slot, i, before: plan.before[i], after: plan.after[i] })).filter((c) => c.before !== c.after)
  // Changes that are one move: a piece leaving one slot for another ties the two slots together, and
  // a slot's own stats may fall for the set to gain (a new weapon in Primary, the old one to Secondary).
  const root = plan.slots.map((_, i) => i)
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])))
  for (const c of changes) {
    const k = c.before ? plan.after.findIndex((p) => p && hostOf(p) === hostOf(c.before!)) : -1
    if (k >= 0 && k !== c.i) root[find(k)] = find(c.i)
  }
  const moveOf = (i: number) => changes.filter((c) => find(c.i) === find(i))
  const moveGain = (move: { i: number }[]) => sum(move.map((o) => shownAfter[o.i] - shownBefore[o.i]))
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const statGain = sum(shownAfter) - sum(shownBefore) + plan.hasteAfter - plan.hasteBefore
  const focusGain = plan.focusAfter - plan.focusBefore
  const effectsGain = plan.effectsAfter - plan.effectsBefore
  const namesOf = (p: Piece | null) => p?.foci ?? []
  // Worn effects and procs, for the chips: a proc only counts in the hands, but it goes where its weapon goes.
  const effectNamesOf = (p: Piece | null) => [...(p?.worn ?? []), ...(p?.procs ?? [])]
  const lineOf = (name: string) => m.report?.foci[name]
  const bestIn = (set: (Piece | null)[], line: string) => Math.max(0, ...set.flatMap((p) => namesOf(p).map((n) => (lineOf(n)?.line === line ? lineOf(n)!.eff : 0))))
  const wantedLines = m.lines.filter((l) => m.wanted.has(l.key))

  return (
    <div className={`stack gap-12${stale ? ' lt-stale' : ''}`} aria-busy={stale}>
      {error && <p className="notice warn">The latest change could not be worked out, so this is the set from before it: {error}</p>}
      <div className="card stack gap-6">
        <div className="row">
          <h2 style={{ margin: 0 }}>{all ? 'Best set from all gear' : 'Best use of what you own'}</h2>
          <span className="grow" />
          <Segmented
            label="Choose from"
            value={scope}
            onChange={setScope}
            options={[
              ['owned', 'Gear you own'],
              ['all', 'All gear']
            ]}
          />
        </div>
        {all && (
          <p className="small" style={{ margin: 0 }}>
            With the best of everything your classes can wear from the eras shown ({m.catalogPieces.length} pieces, the top {CATALOG_PER_SLOT} a slot by these weights, focus and
            effects), {m.compare === 'level' ? 'at the merge level of what you wear in the slot' : 'as they drop (+0)'}, as the upgrade finder compares them (its “Compare”
            setting). Pieces to get are marked; the rest is what you own.
          </p>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Every piece you wear, carry, bank, keep in Storage › Equipment or have on your pet ({m.pieces.length} of them), tried in every slot it fits, both Any slots included,
          scored with these weights plus the focus effects you want and what worn effects and procs add to your melee (Worn effects and Procs tabs). Exaltations stay in the item
          that holds them; the {m.exaltations.length} you may use in Storage › Exaltations are tried in the focus, worn and proc slots of each piece of their own kind (a ring's in
          a ring), in place of what it has there. Your pet's pieces count without any exaltations they hold, which the game does not list. Haste does not stack, so one haste item
          is all it wears for it: each you own is tried as that one, wherever it leaves the rest of the set best.
        </p>
        {changes.length ? (
          <div className="row" style={{ gap: 18, flexWrap: 'wrap', marginTop: 4 }}>
            <span>
              <b>{changes.length}</b> change{changes.length === 1 ? '' : 's'}
              {toGet > 0 && `, ${toGet} to get`}
            </span>
            <span className={statGain >= 0 ? 'lt-up' : 'lt-down'}>
              Stats {statGain >= 0 ? '+' : ''}
              {num(statGain)}
            </span>
            <span className={focusGain >= 0 ? 'lt-up' : 'lt-down'}>
              Focus effects {focusGain >= 0 ? '+' : ''}
              {num(focusGain)}
            </span>
            {(m.effects.value || effectsGain !== 0) && (
              <span className={effectsGain >= 0 ? 'lt-up' : 'lt-down'}>
                Effects {effectsGain >= 0 ? '+' : ''}
                {num(effectsGain)}
              </span>
            )}
            <span className="lt-gain">+{num(statGain + focusGain + effectsGain)}</span>
          </div>
        ) : (
          <p style={{ margin: '4px 0 0' }}>
            {plan.locked.length
              ? 'With the pieces locked in, what you wear is already the best way to wear the rest, by these weights, the focus effects you want and worn effects and procs.'
              : all
                ? 'Nothing you could get beats what you wear, by these weights, the focus effects you want and worn effects and procs.'
                : 'What you wear is already the best way to wear what you own, by these weights, the focus effects you want and worn effects and procs.'}
          </p>
        )}
      </div>

      <LockCard plan={plan} pieces={pieces} m={m} refs={lockRefs} found={lockPieces} all={all} lock={lock} unlock={unlock} clear={() => setLockRefs([])} />

      {changes.length > 0 && (
        <div className="card lt-opt">
          {changes.map((c) => {
            const together = moveOf(c.i)
            const moveTo = c.before ? plan.after.findIndex((p) => p && hostOf(p) === hostOf(c.before!)) : -1
            // The same piece, exalted where it is.
            const exaltedHere = !!c.after?.exalt && !!c.before && hostOf(c.after) === hostOf(c.before)
            const gained = [
              ...namesOf(c.after).filter((n) => !plan.before.some((p) => namesOf(p).includes(n))),
              ...effectNamesOf(c.after).filter((n) => !plan.before.some((p) => effectNamesOf(p).includes(n)))
            ]
            const lost = [
              ...namesOf(c.before).filter((n) => !plan.after.some((p) => namesOf(p).includes(n))),
              ...effectNamesOf(c.before).filter((n) => !plan.after.some((p) => effectNamesOf(p).includes(n)))
            ]
            const delta = shownAfter[c.i] - shownBefore[c.i]
            return (
              <div key={c.i} className="lt-opt-row">
                <span className="lt-slot">{slotLabel(c.slot)}</span>
                <div className="lt-cand-body">
                  <div className="row gap-8">
                    {lockedSlots.has(c.i) && (
                      <span className="lt-chip gold" title="Locked in: the rest of the set is worn around it">
                        locked
                      </span>
                    )}
                    {c.after ? (
                      <>
                        {c.after.from === 'catalog' ? (
                          <>
                            <a href={wikiUrl(baseName(c.after.item.name))} target="_blank" rel="noreferrer">
                              <b>{c.after.item.name}</b>
                            </a>
                            <span className="lt-chip warn">to get</span>
                            <span className="small muted">{catalogWhere(byTitle.get(baseName(c.after.item.name)))}</span>
                          </>
                        ) : (
                          <>
                            <b>{c.after.item.name}</b>
                            {!exaltedHere && (
                              <span className="small muted">
                                {c.after.from === 'worn' ? `from your ${slotLabel(c.after.item.location)}` : whereText(c.after.from, c.after.item).replace(/^(in|on) /, 'from ')}
                              </span>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <span className="muted">leave empty</span>
                    )}
                  </div>
                  {c.after?.exalt && (
                    <div className="small">
                      put <b>{c.after.exalt.item.name}</b> in its {c.after.exaltSlot ?? 'focus'} slot, from Storage › Exaltations
                    </div>
                  )}
                  {!exaltedHere && (
                    <div className="small muted">
                      instead of {c.before ? <b>{pieceName(c.before)}</b> : 'nothing'}
                      {c.before && (moveTo >= 0 ? `, which moves to ${slotLabel(plan.slots[moveTo])}` : ', which comes off')}
                    </div>
                  )}
                  {together.length > 1 && (
                    <div className="small muted" title="The stats of every slot this move changes, by your weights">
                      one move with{' '}
                      {together
                        .filter((o) => o.i !== c.i)
                        .map((o) => slotLabel(o.slot))
                        .join(' and ')}
                      : together{' '}
                      <b className={moveGain(together) >= 0 ? 'lt-up' : 'lt-down'}>
                        {moveGain(together) >= 0 ? '+' : ''}
                        {num(moveGain(together))}
                      </b>{' '}
                      in stats
                    </div>
                  )}
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
                <span className="lt-gain" title="Stats in this slot alone, by your weights: haste, focus effects, worn effects and procs are counted over all slots, above">
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
              const cap = m.capOf(l.key)
              const best = (m.available.get(l.key) ?? []).find((c) => c.eff <= cap + 1e-9)
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
        A search from what you wear now: it moves one piece at a time into the slot where it adds most (swapping, or refilling the slot it left) until no move adds anything. Stats
        are scored exactly as in the upgrade finder, at each piece's merge level; lore items go on once. Items with no wiki page stay where they are.
      </p>
    </div>
  )
}

/** The pieces locked in, and a picker to lock another: any piece in any slot it fits. */
function LockCard({
  plan,
  pieces,
  m,
  refs,
  found,
  all,
  lock,
  unlock,
  clear
}: {
  plan: Plan
  pieces: Piece[]
  m: GearModel
  refs: LockRef[]
  found: (Piece | undefined)[]
  all: boolean
  lock: (i: number, p: Piece) => void
  unlock: (i: number) => void
  clear: () => void
}) {
  const [pick, setPick] = useState('')
  const [pickSlot, setPickSlot] = useState('')
  const [open, setOpen] = useRemembered('optimize.keepOpen', true)
  // What you wear, slot by slot, and whether each is locked where it is.
  const worn = plan.before.flatMap((p, i) => (p?.from === 'worn' ? [{ i, p }] : []))
  const wornLocked = (i: number, p: Piece) => refs.some((r, k) => r.slot === i && found[k] === p)
  // Every piece with a wiki page (one without stays where it is), once each.
  const choices = useMemo(() => {
    const seen = new Set<string>()
    return pieces.filter((p) => p.r && !p.exalt && !seen.has(pieceId(p)) && !!seen.add(pieceId(p))).sort((a, b) => a.item.name.localeCompare(b.item.name))
  }, [pieces])
  const chosen = choices.find((p) => pieceId(p) === pick)
  const slotNames = chosen?.r ? [...new Set(SLOT_LAYOUT)].filter((s) => canWear(chosen.r!, m.wearer, s)) : []
  // At first, where it is worn, or where the plan puts it.
  const planned = chosen ? plan.slots[plan.after.findIndex((p) => p && (p.host ?? p) === chosen)] : undefined
  const slotName = slotNames.includes(pickSlot) ? pickSlot : (slotNames.find((s) => s === chosen?.item.location || s === planned) ?? slotNames[0] ?? '')
  // Of a pair of slots, the one the piece is in, then the one the plan puts it in, then one not locked.
  const indexFor = (p: Piece, name: string): number => {
    const at = SLOT_LAYOUT.flatMap((s, i) => (s === name ? [i] : []))
    const taken = new Set(refs.map((r) => r.slot))
    return at.find((i) => plan.before[i] === p) ?? at.find((i) => plan.after[i] && (plan.after[i]!.host ?? plan.after[i]) === p) ?? at.find((i) => !taken.has(i)) ?? at[0]
  }
  const locked = new Set(plan.locked)
  const why = (r: LockRef, p: Piece | undefined): string => {
    if (!p) return r.from === 'catalog' && !all ? 'a piece to get: it counts with All gear' : 'not in your latest inventory export'
    return locked.has(r.slot) ? '' : 'not used: it cannot go there with the other locks'
  }
  return (
    <div className="card stack gap-8">
      <div className="row gap-8">
        <Disclosure open={open} onToggle={() => setOpen(!open)}>
          Keep what you wear
        </Disclosure>
        <Info
          label="About locking"
          text="A piece locked into a slot stays there whatever the weights say, and the optimiser wears everything else around it; it may still put an exaltation from Storage in it. Lock what you wear below, or put any other piece you own in a slot. Locks are kept for this character until you unlock them, and a piece that moves between exports is found again by name. A lock goes unused when its piece cannot go there with the others: the same lore item twice, or a two-hander in Primary with Secondary locked."
        />
        <span className="small muted">
          {refs.length ? `${refs.length} locked${open ? '' : `: ${refs.map((r) => r.name).join(', ')}`}` : 'Lock a piece and the optimiser leaves it on and works around it.'}
        </span>
        <span className="grow" />
        {refs.length > 1 && (
          <button className="btn ghost small" onClick={clear}>
            Unlock all
          </button>
        )}
      </div>
      {open && (
        <div className="lt-keep" role="group" aria-label="What you wear">
          {worn.map(({ i, p }) => {
            const on = wornLocked(i, p)
            return (
              <button
                key={i}
                className="lt-keep-slot"
                aria-pressed={on}
                title={on ? `Locked: ${pieceName(p)} stays in your ${slotLabel(plan.slots[i])}. Click to unlock.` : `Lock ${pieceName(p)} in your ${slotLabel(plan.slots[i])}`}
                onClick={() => (on ? unlock(i) : lock(i, p))}
              >
                <span className="lt-slot">{slotLabel(plan.slots[i])}</span>
                <span className="name">{p.item.name}</span>
                <span className="state">{on ? 'Locked' : 'Lock'}</span>
              </button>
            )
          })}
        </div>
      )}
      {open &&
        refs.map((r, k) => {
          // Pieces locked where you wear them show in the grid.
          if (found[k] && plan.before[r.slot] === found[k] && locked.has(r.slot)) return null
          const note = why(r, found[k])
          return (
            <div key={`${r.slot}|${r.name}`} className="row gap-8 small">
              <span className="lt-slot">{slotLabel(SLOT_LAYOUT[r.slot] ?? '')}</span>
              <b>{r.name}</b>
              {found[k] && <span className="muted">{whereText(found[k]!.from, found[k]!.item)}</span>}
              {note && <span className="lt-chip warn">{note}</span>}
              <span className="grow" />
              <button className="btn ghost small" aria-label={`Unlock ${r.name}`} onClick={() => unlock(r.slot)}>
                Unlock
              </button>
            </div>
          )
        })}
      {open && (
        <div className="row gap-8 small">
          <span className="muted">Or put another piece in a slot:</span>
          <select aria-label="Piece to lock" value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: 360 }}>
            <option value="">Choose a piece…</option>
            {PICK_GROUPS.map(([from, label]) => {
              const group = choices.filter((p) => p.from === from)
              return group.length ? (
                <optgroup key={from} label={label}>
                  {group.map((p) => (
                    <option key={pieceId(p)} value={pieceId(p)}>
                      {p.item.name}
                      {from === 'worn' ? ` (${slotLabel(p.item.location)})` : ''}
                    </option>
                  ))}
                </optgroup>
              ) : null
            })}
          </select>
          {chosen &&
            (slotNames.length ? (
              <>
                <span className="muted">in</span>
                <select aria-label="Slot to lock it in" value={slotName} onChange={(e) => setPickSlot(e.target.value)}>
                  {slotNames.map((s) => (
                    <option key={s} value={s}>
                      {slotLabel(s)}
                    </option>
                  ))}
                </select>
                <button
                  className="btn small"
                  onClick={() => {
                    lock(indexFor(chosen, slotName), chosen)
                    setPick('')
                    setPickSlot('')
                  }}
                >
                  Lock
                </button>
              </>
            ) : (
              <span className="muted">your classes, race or level cannot wear it</span>
            ))}
        </div>
      )}
    </div>
  )
}
