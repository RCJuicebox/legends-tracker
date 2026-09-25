import { useEffect, useMemo } from 'react'
import { api, ago } from '../api'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { Info, Pending, Switch } from '../components/ui'
import { num, wikiUrl } from '../format'
import { className } from '../../../core/acModel'
import { itemKey, mergeLevel, parseStatsBlock, scaledStats, slotLabel, type InvItem } from '../../../core/inventory'
import { restrictions, isLore, score } from '../../../core/upgrades'
import { rawWeights, type ClassFactors } from '../../../core/statValue'
import {
  optimizePetGear, PET_ROLE_PRESETS, petConversions, petMelee, petSlots, type PetChoice, type PetGearReading, type PetPiece, type PetProfile
} from '../../../core/pets'
import type { GearModel } from '../gear/useGearModel'
import { ItemIcon } from './gearBits'

// The pet's gear: the best items the character owns for the pet to wear, within the pet
// inventory's slots, against what the pet wears now (the log's `/pet inventory check` list).

interface PetState {
  character: string
  gear: PetGearReading | null
  summon: { spell: string; at: number } | null
  spells: { spell: string; level: number; classes: string[] }[]
  spellsLoaded: boolean
}

const code = (c: string) => c.toUpperCase()

function usePet(character: string, classes: string[], level: number) {
  const q = useInvoke<PetState>('pet:state', [character, classes, level])
  const setData = q.setData
  useEffect(
    () =>
      api.on('state:pet', (s: Omit<PetState, 'spells' | 'spellsLoaded'>) =>
        setData((prev) => (prev && s.character === prev.character ? { ...prev, gear: s.gear, summon: s.summon } : prev))
      ),
    [setData]
  )
  return q
}

/** Where an item is now, in a few words. */
function where(p: PetPiece): string {
  const loc = p.item.location
  if (p.from === 'pet') return 'on your pet'
  if (p.from === 'worn') return `you wear it (${slotLabel(loc)})`
  if (p.from === 'bags') return `in your bags (${loc.replace(/-Slot(\d+)$/, ', slot $1')})`
  if (p.from === 'bank') return `in your bank (${loc.replace(/^Bank(\d+)(?:-Slot(\d+))?$/, (_, b, s) => `bank ${b}${s ? `, slot ${s}` : ''}`)})`
  return 'in the shared bank'
}

export function PetTab({ m }: { m: GearModel }) {
  const character = m.view.character
  const pet = usePet(character, m.classes, m.level)
  const [picked, setPicked] = useRemembered<string>(`pet.spell.${character}`, '')
  const [preset, setPreset] = useRemembered<string>('pet.preset', 'Damage')
  const [includeWorn, setIncludeWorn] = useRemembered<boolean>('pet.includeWorn', false)
  const state = pet.data
  const spells = state?.spells ?? []
  // The pet chosen here, else the last one summoned, else the best the classes have.
  const spell = picked || state?.summon?.spell || spells[spells.length - 1]?.spell || ''
  const profileQ = useInvoke<{ spell: string; profile: PetProfile | null }>(spell ? 'pet:profile' : null, [spell])
  // The answer for the pet shown, not one asked for before it.
  const loading = !!spell && profileQ.data?.spell !== spell
  const profile = loading ? null : (profileQ.data?.profile ?? null)
  const petClasses = useMemo(() => profile?.classes ?? [], [profile])
  const capsQ = useInvoke<{ factors: Record<string, ClassFactors> }>(profile ? 'stats:caps' : null, [petClasses, profile?.level ?? 1])

  const capacity = petSlots(m.classes)
  const byKey = useMemo(() => new Map(m.catalog.map((it) => [itemKey(it.title), it])), [m.catalog])
  const weights = useMemo(
    () => (profile ? rawWeights(PET_ROLE_PRESETS[preset] ?? PET_ROLE_PRESETS.Damage, petConversions(profile, capsQ.data?.factors ?? {})) : null),
    [profile, preset, capsQ.data]
  )
  const wearer = useMemo(
    () => ({ classes: [...new Set([...m.classes, ...petClasses])], race: '', level: profile?.level || m.level }),
    [m.classes, petClasses, profile?.level, m.level]
  )

  // What the character owns, as the pet could use it; and what the pet wears now.
  const owned = useMemo<PetPiece[]>(
    () =>
      m.pieces.flatMap((p): PetPiece[] => {
        if (!p.r || !p.stats || (p.from === 'worn' && !includeWorn)) return []
        const c = byKey.get(itemKey(p.item.name))
        return [{ item: p.item, from: p.from, key: p.key, r: p.r, stats: p.stats, lore: p.lore, noPet: !!c && /\bNO PET\b/i.test(c.statsblock) }]
      }),
    [m.pieces, byKey, includeWorn]
  )
  const onPet = useMemo<PetChoice[]>(
    () =>
      (state?.gear?.items ?? []).flatMap((g): PetChoice[] => {
        const c = byKey.get(itemKey(g.name))
        if (!c) return []
        const item: InvItem = { location: g.slot, name: g.name, id: 0, count: 1, augs: [] }
        const piece: PetPiece = {
          item, from: 'pet', key: itemKey(g.name), r: restrictions(c.statsblock), stats: scaledStats(parseStatsBlock(c.statsblock), mergeLevel(g.name)),
          lore: isLore(c.statsblock), noPet: false
        }
        return [{ piece, slot: g.slot }]
      }),
    [state?.gear, byKey]
  )
  const unknownOnPet = (state?.gear?.items ?? []).filter((g) => !byKey.has(itemKey(g.name)))

  const plan = useMemo(
    () =>
      profile && weights
        ? optimizePetGear({ pieces: [...owned, ...onPet.map((c) => c.piece)], current: onPet, capacity, wearer, weights, melee: profile.melee, level: profile.level })
        : null,
    [profile, weights, owned, onPet, capacity, wearer]
  )

  if (!state) return <Pending what="your pet" error={pet.error} retry={pet.reload} />

  const bonuses = m.classes.filter((c) => petSlots([c]) > 4).map((c) => `${className(c)} +${petSlots([c]) - 4}`)
  const keep = new Set(plan?.chosen.map((c) => c.piece) ?? [])
  const takeBack = onPet.filter((c) => !keep.has(c.piece))
  const gain = plan ? plan.total - plan.current : 0
  const bare = profile?.melee ? petMelee(profile.melee, profile.level, null, null) : 0

  return (
    <div className="stack gap-12">
      <div className="card stack gap-10">
        <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
          <b>Pet</b>
          <select aria-label="Pet" value={spell} onChange={(e) => setPicked(e.target.value === state.summon?.spell ? '' : e.target.value)}>
            {!spells.some((s) => s.spell === spell) && spell && <option value={spell}>{spell}</option>}
            {spells.map((s) => (
              <option key={s.spell} value={s.spell}>
                {s.spell} (level {s.level} {s.classes.map(code).join('/')})
              </option>
            ))}
          </select>
          {state.summon && (
            <span className="small muted">
              {state.summon.spell === spell ? `your last summon, ${ago(state.summon.at)}` : `you last summoned ${state.summon.spell}`}
            </span>
          )}
          {picked && (
            <button className="btn ghost small" onClick={() => setPicked('')}>
              Follow the last summon
            </button>
          )}
          <span className="spacer" />
          <b>Weigh stats for</b>
          <span className="lt-seg" role="group" aria-label="Weigh the pet's stats for">
            {Object.keys(PET_ROLE_PRESETS).map((name) => (
              <button key={name} className={preset === name ? 'on' : ''} aria-pressed={preset === name} onClick={() => setPreset(name)}>
                {name}
              </button>
            ))}
          </span>
        </div>

        {!spell ? (
          <p className="muted" style={{ margin: 0 }}>
            {state.spellsLoaded ? 'None of your classes summons a pet by this level.' : 'The spell file is not loaded yet; set the game folder in Settings.'}
          </p>
        ) : profileQ.error && loading ? (
          <p className="small" style={{ margin: 0, color: 'var(--red)' }}>
            Could not read {spell} from eqlwiki: {profileQ.error}
          </p>
        ) : loading ? (
          <p className="muted small" style={{ margin: 0 }}>
            Reading {spell} from eqlwiki…
          </p>
        ) : !profile ? (
          <p className="muted small" style={{ margin: 0 }}>
            eqlwiki has no page for the pet {spell} summons, so its classes are not known. Pick another pet.
          </p>
        ) : (
          <div className="row small" style={{ flexWrap: 'wrap', gap: 18 }}>
            <span>
              <a href={wikiUrl(`${spell} Summon`)} target="_blank" rel="noreferrer">
                {petClasses.map(code).join(' / ')}
              </a>
              , level {profile.level}
            </span>
            <span>
              <b>{capacity}</b> slots <span className="faint">(4{bonuses.length ? ` + ${bonuses.join(' + ')}` : ''})</span>
            </span>
            <span>
              Wears gear for <b>{wearer.classes.map(code).join(' ')}</b>
            </span>
            <span>
              {profile.melee ? (
                <>
                  Base melee {profile.melee.damage}/{profile.melee.delay} +{profile.melee.bonus}, dual wield {Math.round(profile.melee.dualWield * 100)}%
                </>
              ) : (
                <span className="faint">No base melee on the Pet Guide yet: weapons are scored on their stats only</span>
              )}
            </span>
            {profile.unsure.length > 0 && <span className="lt-chip warn" title="The wiki marks these with a question mark">unconfirmed: {profile.unsure.join(', ')}</span>}
            <Info
              label="How the pet is scored"
              text={
                <>
                  <div>
                    A pet wears what your classes or its own could, one item per slot, the higher AC when two share a slot (eqlwiki Pet Guide). Its classes, level, stats and base
                    melee come from its wiki pages. Item level requirements are checked against the pet's level.
                  </div>
                  <div>
                    Stats are weighed the way the upgrade finder weighs yours, with the pet's classes and stats: {profile.stats.STR} STR, {profile.stats.STA} STA, {profile.stats.AGI} AGI.
                    Haste counts once, the best worn. Weapons count by the melee damage they give the pet under the Pet Guide's rules (a better ratio is used outright; more damage
                    at a worse ratio keeps the pet's delay), with a hit averaging bonus + 1.5 × damage. A two-hander gives up the off hand.
                  </div>
                  <div>Focus effects and procs are not counted: nothing yet says whether a pet's gear focuses anything.</div>
                </>
              }
            />
          </div>
        )}
        <label className="row small" style={{ gap: 8 }}>
          <Switch on={includeWorn} onChange={setIncludeWorn} label="Include what you wear" />
          Include what you wear yourself
        </label>
      </div>

      <div className="card stack gap-6">
        <h2 style={{ margin: 0 }}>On your pet now</h2>
        {state.gear ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              From <span className="mono">/pet inventory check</span>, {ago(state.gear.at)}. Type it again in game after a change; this follows the log.
            </p>
            {state.gear.items.length ? (
              <div className="lt-opt">
                {state.gear.items.map((g) => {
                  const c = onPet.find((x) => x.piece.item.name === g.name)
                  return (
                    <div key={`${g.slot}|${g.name}`} className="lt-opt-row">
                      <span className="lt-slot">{slotLabel(g.slot)}</span>
                      <div className="lt-cand-body">
                        <div className="row gap-8">
                          <ItemIcon icon={byKey.get(itemKey(g.name))?.icon} size={24} />
                          <a href={wikiUrl(g.name.replace(/\s*\+\d+$/, ''))} target="_blank" rel="noreferrer">
                            {g.name}
                          </a>
                        </div>
                      </div>
                      <span className="small muted">{c ? '' : 'not in the catalog'}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p style={{ margin: 0 }}>Nothing: the pet wears no items.</p>
            )}
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Not known yet. Type <span className="mono">/pet inventory check</span> in game with your pet up, and what it wears appears here.
          </p>
        )}
      </div>

      {plan && (
        <div className="card stack gap-6">
          <h2 style={{ margin: 0 }}>Best use of what you own</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {owned.length + onPet.length} pieces you {includeWorn ? 'wear, ' : ''}carry, bank or have on the pet, tried in every slot they fit, at most {capacity}. Give them in this order:
            the main-hand weapon before the off hand, or the pet will not dual wield.
          </p>
          <div className="row" style={{ gap: 18, flexWrap: 'wrap', marginTop: 4 }}>
            {gain > 0.5 ? (
              <>
                <span className="lt-gain">+{num(gain)}</span>
                <span className={plan.parts.stats - plan.currentParts.stats >= 0 ? 'lt-up' : 'lt-down'}>Stats {signed(plan.parts.stats - plan.currentParts.stats)}</span>
                <span className={plan.parts.haste - plan.currentParts.haste >= 0 ? 'lt-up' : 'lt-down'}>Haste {signed(plan.parts.haste - plan.currentParts.haste)}</span>
                {profile?.melee && (
                  <span className={plan.parts.melee - plan.currentParts.melee >= 0 ? 'lt-up' : 'lt-down'}>Weapons {signed(plan.parts.melee - plan.currentParts.melee)}</span>
                )}
              </>
            ) : (
              <span>{state.gear ? 'What the pet wears is already the best of what you own, by these weights.' : 'The best set, by these weights:'}</span>
            )}
            {bare > 0 && profile?.melee && weights && (
              <span className="small muted" title="Melee damage against the pet with no weapons, by the Pet Guide's rules">
                melee {signed(Math.round((plan.parts.melee / (weights.ratio * 100)) * 100))}% vs bare hands
              </span>
            )}
          </div>
          <div className="lt-opt">
            {plan.chosen.map((c) => (
              <div key={`${c.slot}|${c.piece.from}|${c.piece.item.location}|${c.piece.key}`} className="lt-opt-row">
                <span className="lt-slot">{slotLabel(c.slot)}</span>
                <div className="lt-cand-body">
                  <div className="row gap-8">
                    <ItemIcon icon={byKey.get(itemKey(c.piece.item.name))?.icon} size={24} />
                    <b>{c.piece.item.name}</b>
                    <span className="small muted">{where(c.piece)}</span>
                    {c.piece.from === 'pet' && <span className="lt-chip good">keep</span>}
                  </div>
                </div>
                <span className="lt-gain" title="This item's stats by the pet's weights (haste and weapon damage are counted over the whole set, above)">
                  {num(scoreOf(c, weights))}
                </span>
              </div>
            ))}
          </div>
          {takeBack.length > 0 && (
            <p className="small" style={{ margin: '4px 0 0' }}>
              Take back: {takeBack.map((c) => c.piece.item.name).join(', ')}.
            </p>
          )}
          {unknownOnPet.length > 0 && (
            <p className="small muted" style={{ margin: 0 }}>
              Not scored, not in the item catalog: {unknownOnPet.map((g) => g.name).join(', ')}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${num(n)}`

/** One item's stats by the pet's weights, haste and weapon aside. */
const scoreOf = (c: PetChoice, weights: ReturnType<typeof rawWeights> | null) => (weights ? score(c.piece.stats, { ...weights, haste: 0, ratio: 0 }) : 0)
