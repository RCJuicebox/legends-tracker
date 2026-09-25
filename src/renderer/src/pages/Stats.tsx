import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ago, errorMessage } from '../api'
import { useRemembered } from '../remember'
import { useInvoke } from '../hooks'
import { showUndo } from '../toast'
import { Pending } from '../components/ui'
import { fractionPct as pct, num, who } from '../format'
import { readSheet, type StatsSheet } from '../statsSheet'
import { useExportCharacter, useInventory, wornSummary } from '../gear/model'
import { acInputs, acReport, autoValues, classTrio, combatReport, primaryClass, valOf, type Auto, type Caps, type Note, type Row, type Val } from '../stats/model'
import { CLASSES, className, computeAc } from '../../../core/acModel'
import { avoidanceFromHitRate, baseAccuracy, hitChance, OFFENSE, skillName, stanceAccuracy, WEAPON_SKILLS, windowOffense } from '../../../core/combatModel'
import { AA_USES, type AaEffect, type AaSummary } from '../../../core/aa'
import type { CharacterSheet } from '../../../shared/types'
import type { WornTotals } from '../../../core/inventory'

type Tab = 'character' | 'ac' | 'combat'
const TABS: [Tab, string][] = [
  ['character', 'Character'],
  ['ac', 'AC'],
  ['combat', 'Combat']
]

/** A change to the sheet: fields, or a function of the latest sheet giving them. */
type SetSheet = (patch: Partial<StatsSheet> | ((s: StatsSheet) => Partial<StatsSheet>)) => void

export function Stats() {
  const exp = useExportCharacter('inventory', 'stats.character')
  const { exports, available, character, setCharacter } = exp
  const inv = useInventory(character, !!exports, available.join(','))
  const { view, sheet: charSheet, updateSheet } = inv
  const [tab, setTab] = useRemembered<Tab>('stats.tab', 'character')
  const [aaStatus, setAaStatus] = useState('')

  const s = useMemo(() => readSheet(charSheet?.stats), [charSheet])
  const trio = useMemo(() => classTrio(s), [s.classes])
  const capsQ = useInvoke<Caps>('stats:caps', [trio, s.level])
  const caps = capsQ.data

  // Builds on the latest sheet, so a change that lands after an await (the AAs, a screen read) never
  // undoes what was typed meanwhile.
  const set = useCallback<SetSheet>(
    (patch) =>
      updateSheet((cs) => {
        const cur = readSheet(cs.stats)
        const p = typeof patch === 'function' ? patch(cur) : patch
        return { ...cs, stats: { ...cur, ...p } as unknown as CharacterSheet['stats'] }
      }),
    [updateSheet]
  )
  const setOverride = (key: keyof StatsSheet['overrides'], v: number | undefined) =>
    set((cur) => {
      const o = { ...cur.overrides }
      if (v === undefined) delete o[key]
      else o[key] = v
      return { overrides: o }
    })

  const readAas = async (quiet: boolean) => {
    setAaStatus('Reading your log…')
    try {
      const aa = await api.invoke<AaSummary | null>('stats:readAAs')
      if (aa) {
        set({ aa })
        setAaStatus('')
      } else setAaStatus(quiet ? '' : 'No /alternateadv list in your current log yet.')
    } catch (e) {
      setAaStatus(quiet ? '' : `Could not read your log: ${errorMessage(e)}`)
    }
  }
  // First visit for a character: look for AAs without being asked.
  useEffect(() => {
    if (charSheet && !s.aa) void readAas(true)
  }, [character, !!charSheet])

  if (!exports || !view || !charSheet || !caps)
    return (
      <Pending
        what="the Stats page"
        error={exp.error || inv.error || capsQ.error}
        retry={() => {
          exp.reload()
          inv.reload()
          capsQ.reload()
        }}
      />
    )

  const primary = primaryClass(trio, caps.ac)
  const tableCap = caps.ac[primary]
  const gear = view.inventory ? wornSummary(view, charSheet) : null
  const skill = (id: number) => s.skills[id] ?? 0
  const auto = autoValues(s, caps.ac, primary, gear)
  const val = valOf(s, auto)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Stats</h1>
          <p>
            AC and melee for {who(character) || 'your character'}, worked out the way the server does. Worn gear comes from the Inventory page, skill caps and soft
            caps from the game's own tables, and AAs from your log.
          </p>
        </div>
        {available.length > 1 && (
          <div className="actions">
            <select aria-label="Character" value={character} onChange={(e) => setCharacter(e.target.value)}>
              {available.map((c) => (
                <option key={c} value={c}>
                  {who(c)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="card stack gap-12 mb-14">
        <div className="stats-fields">
          {[0, 1, 2].map((i) => (
            <label key={i} className="field">
              <span>Class {['one', 'two', 'three'][i]}</span>
              <select
                value={s.classes[i]}
                onChange={(e) => {
                  const c = [...s.classes] as StatsSheet['classes']
                  c[i] = e.target.value
                  set({ classes: c })
                }}
              >
                {i > 0 && <option value="">none</option>}
                {CLASSES.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <NumField label="Level" value={s.level} min={1} max={130} onChange={(v) => set({ level: Math.max(1, Math.min(130, v || 1)) })} />
          <label className="field">
            <span>Race</span>
            <select value={s.race} onChange={(e) => set({ race: e.target.value as StatsSheet['race'] })}>
              <option value="other">Any other race</option>
              <option value="iksar">Iksar</option>
            </select>
          </label>
        </div>
        <AaLine aa={s.aa} status={aaStatus} onRead={() => void readAas(false)} />
      </div>

      <div className="row gap-6 mb-12" role="group" aria-label="Stats view">
        {TABS.map(([id, label]) => (
          <button key={id} className={`btn${tab === id ? ' on' : ' ghost'}`} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'character' ? (
        <CharacterTab s={s} set={set} val={val} trio={trio} primary={primary} skill={skill} gear={gear?.totals ?? null} />
      ) : tab === 'ac' ? (
        <AcTab s={s} set={set} setOverride={setOverride} auto={auto} val={val} trio={trio} primary={primary} tableCap={tableCap} skill={skill} hasInventory={!!gear} />
      ) : (
        <CombatTab s={s} set={set} setOverride={setOverride} auto={auto} val={val} trio={trio} primary={primary} caps={caps} skill={skill} />
      )}
    </>
  )
}

function AaLine({ aa, status, onRead }: { aa: AaSummary | null; status: string; onRead: () => void }) {
  const [open, setOpen] = useState(false)
  const applied = (Object.keys(AA_USES) as AaEffect[]).filter((k) => aa?.totals[k])
  return (
    <div className="stack gap-8">
      <div className="row small gap-10">
        <b>Alternate Advancement</b>
        <span className="muted">
          {aa ? `${aa.count} abilities from your /alternateadv list of ${aa.when}.` : 'Type /alternateadv list in game; the tracker reads the result from your log.'}
        </span>
        {status && <span className="faint">{status}</span>}
        <span className="grow" />
        {aa && (
          <button className="btn ghost small" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'} details
          </button>
        )}
        <button className="btn small" onClick={onRead}>
          Read from my log
        </button>
      </div>
      {aa && (
        <div className="row tight" style={{ flexWrap: 'wrap', gap: 6 }}>
          {applied.map((k) => (
            <span key={k} className={`chip${AA_USES[k].applied ? ' ok' : ''}`} title={`${AA_USES[k].feeds}. From ${aa.totals[k]!.from.map(([n, v]) => `${n} ${v}`).join(', ')}`}>
              {AA_USES[k].label} +{aa.totals[k]!.sum}
              {AA_USES[k].unit}
            </span>
          ))}
        </div>
      )}
      {open && aa && (
        <div className="small stats-aalist">
          {aa.abilities.map((a) => (
            <div key={`${a.id}-${a.name}`}>
              <b>{a.name}</b>
              {a.cost !== null && <span className="faint"> · cost {a.cost}</span>}
              {Object.keys(a.effects).length > 0 && (
                <span className="muted">
                  {' '}
                  ·{' '}
                  {(Object.entries(a.effects) as [AaEffect, number][]).map(([k, v]) => `${AA_USES[k].label} ${v}${AA_USES[k].unit}`).join(', ')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** A number input. With `auto`, the value comes from a file unless typed over; clearing it goes back. */
function NumField({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  auto,
  autoFrom
}: {
  label: string
  hint?: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  min?: number
  max?: number
  step?: number
  auto?: number
  autoFrom?: string
}) {
  const overridden = auto !== undefined && value !== undefined
  return (
    <label className="field">
      <span>
        {label}
        {hint && <em className="faint"> {hint}</em>}
      </span>
      <div className="row tight">
        <input
          type="number"
          className="grow"
          min={min}
          max={max}
          step={step}
          value={value ?? ''}
          placeholder={auto !== undefined ? String(auto) : '0'}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') return onChange(auto !== undefined ? undefined : 0)
            const v = step < 1 ? parseFloat(raw) : Math.floor(parseFloat(raw))
            onChange(Number.isFinite(v) ? Math.max(min, max !== undefined ? Math.min(max, v) : v) : 0)
          }}
        />
        {auto !== undefined &&
          (overridden ? (
            <button className="chip warn" title={`Your figure. Click to go back to ${auto} from ${autoFrom}.`} onClick={(e) => (e.preventDefault(), onChange(undefined))}>
              yours ×
            </button>
          ) : (
            <span className="chip ok" title={`From ${autoFrom}. Type to override.`}>
              {autoFrom}
            </span>
          ))}
      </div>
    </label>
  )
}

interface TabProps {
  s: StatsSheet
  set: SetSheet
  setOverride: (k: keyof StatsSheet['overrides'], v: number | undefined) => void
  auto: Auto
  val: Val
  trio: string[]
  primary: string
  skill: (id: number) => number
}

function Notes({ notes }: { notes: Note[] }) {
  return (
    <ul className="stats-notes">
      {notes.map(([kind, title, text], i) => (
        <li key={i} className={kind}>
          <b>{title}</b> {text}
        </li>
      ))}
    </ul>
  )
}

function Trace({ rows }: { rows: Row[] }) {
  return (
    <details className="stats-trace">
      <summary>Show every step</summary>
      <table className="table small">
        <tbody>
          {rows.map(([label, value, note], i) =>
            label.startsWith('#') ? (
              <tr key={i}>
                <td colSpan={3} className="stats-trace-head">
                  {label.slice(1)}
                </td>
              </tr>
            ) : (
              <tr key={i}>
                <td>{label}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>
                  {typeof value === "number" ? num(value) : value}
                </td>
                <td className="faint">{note}</td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </details>
  )
}

function AcTab({ s, set, setOverride, auto, val, trio, primary, tableCap, skill, hasInventory }: TabProps & { tableCap?: { cap: number; mult: number }; hasInventory: boolean }) {
  const i = acInputs(s, trio, primary, val, skill)
  const { r, full, sum, notes, rows } = acReport(i, primary)

  return (
    <div className="stats-grid">
      <div className="stack gap-14">
        <div className="card">
          <div className="grid three">
            <div className="stat">
              <span className="label">Mitigation AC</span>
              <span className="value stats-big">{num(r.mitigation)}</span>
            </div>
            <div className="stat">
              <span className="label">Soft cap</span>
              <span className="value stats-big">{num(r.effCap)}</span>
            </div>
            <div className="stat">
              <span className="label">Avoidance</span>
              <span className="value stats-big">{num(r.avoidance)}</span>
            </div>
          </div>
          <p className="faint small" style={{ margin: '10px 0 0' }}>
            The Inventory window's three AC figures, in its order. With your unbuffed numbers these match the game exactly.
          </p>
        </div>
        <div className="card stack gap-8">
          <b>
            {num(r.srv.total)} AC Sum against a {num(r.effCap)} soft cap
          </b>
          <div className="stats-bar">
            <i className="full" style={{ width: `${(full / sum) * 100}%` }} />
            <i className="over" style={{ width: `${(r.kept / sum) * 100}%` }} />
            <i className="lost" style={{ width: `${(r.lost / sum) * 100}%` }} />
          </div>
          <div className="row small muted" style={{ gap: 16 }}>
            <span>
              <i className="stats-key full" /> Counts in full <b>{num(full)}</b>
            </span>
            {r.over && (
              <>
                <span>
                  <i className="stats-key over" /> Counts at {(i.multiplier * 100).toFixed(1)}% <b>{num(r.kept)}</b>
                </span>
                <span>
                  <i className="stats-key lost" /> Eaten by the cap <b>{num(r.lost)}</b>
                </span>
              </>
            )}
          </div>
          <Notes notes={notes} />
          <Trace rows={rows} />
        </div>
      </div>

      <div className="stack gap-14">
        <div className="card stack gap-10">
          <h2>Worn gear</h2>
          <div className="stats-fields two">
            <NumField label="AC on equipped items" hint="every slot but ammo" value={s.overrides.itemAC} auto={auto.itemAC} autoFrom="inventory" onChange={(v) => setOverride('itemAC', v)} />
            <NumField label="AC on your shield" hint="secondary slot" value={s.overrides.shieldAC} auto={auto.shieldAC} autoFrom="inventory" onChange={(v) => setOverride('shieldAC', v)} />
            <NumField label="Avoidance from items" hint="up to 100" value={s.itemAvoidance} onChange={(v) => set({ itemAvoidance: v ?? 0 })} />
            <NumField label="AC from food and drink" value={s.foodDrinkAC} onChange={(v) => set({ foodDrinkAC: v ?? 0 })} />
            <NumField label="AC from tribute and trophies" value={s.tributeAC} onChange={(v) => set({ tributeAC: v ?? 0 })} />
          </div>
          {!hasInventory && <p className="faint small">No inventory export yet, so type your worn AC. Type /outputfile inventory in game to fill it in.</p>}
        </div>
        <div className="card stack gap-10">
          <h2>Character</h2>
          <div className="stats-fields two">
            <NumField label="Agility" hint="Inventory window" value={s.agility} onChange={(v) => set({ agility: v ?? 0 })} />
            <NumField label="Heroic agility" value={s.heroicAgility} onChange={(v) => set({ heroicAgility: v ?? 0 })} />
            <NumField label="Heroic strength" value={s.heroicStrength} onChange={(v) => set({ heroicStrength: v ?? 0 })} />
            {trio.includes('mnk') && <NumField label="Total weight" hint="Inventory window" step={0.1} value={s.weight} onChange={(v) => set({ weight: v ?? 0 })} />}
            <NumField label="Drunkenness" hint="0 to 200" max={200} value={s.drunk} onChange={(v) => set({ drunk: v ?? 0 })} />
          </div>
          <p className="faint small">Defence skill ({num(skill(15))}) comes from your skills on the Combat tab.</p>
        </div>
        <div className="card stack gap-10">
          <h2>Buffs and AAs</h2>
          <div className="stats-fields two">
            <NumField label="AC from buffs" hint="SPA 1 + 416" value={s.acBuffs} onChange={(v) => set({ acBuffs: v ?? 0 })} />
            <NumField label="Armor of Wisdom AC" value={s.armorOfWisdom} onChange={(v) => set({ armorOfWisdom: v ?? 0 })} />
            <NumField label="Hero's Fortitude AC" value={s.herosFortitude} onChange={(v) => set({ herosFortitude: v ?? 0 })} />
            <NumField label="Combat Stability" hint="SPA 259, %" value={s.overrides.combatStability} auto={auto.combatStability} autoFrom="AAs" onChange={(v) => setOverride('combatStability', v)} />
            <NumField label="Melee avoidance AAs" hint="SPA 172, %" value={s.overrides.evasion} auto={auto.evasion} autoFrom="AAs" onChange={(v) => setOverride('evasion', v)} />
          </div>
        </div>
        <div className="card stack gap-10">
          <h2>Soft cap</h2>
          <div className="stats-fields two">
            <NumField label="Soft cap" value={s.overrides.softCap} auto={auto.softCap} autoFrom="game table" onChange={(v) => setOverride('softCap', v)} />
            <NumField label="Post-cap multiplier" step={0.005} max={1} value={s.overrides.multiplier} auto={auto.multiplier} autoFrom="game table" onChange={(v) => setOverride('multiplier', v)} />
          </div>
          <p className="faint small">
            {tableCap
              ? `From the game's Resources/ACMitigation.txt: ${className(primary)}${trio.length > 1 ? `, the sturdiest of ${trio.map(className).join(', ')},` : ''} at level ${s.level} caps at ${tableCap.cap} and keeps ${(tableCap.mult * 100).toFixed(1)}% beyond it.`
              : 'The game folder has no ACMitigation.txt; type the cap in.'}
          </p>
        </div>
        <p className="faint small">
          Transcribed from "What is your 'Real AC'?" by Dzarn, an EverQuest developer, as reposted to r/EQLegends by neodraykl. Avoidance follows EQEmu's
          GetTotalDefense.
        </p>
      </div>
    </div>
  )
}

function CombatTab({ s, set, setOverride, auto, val, trio, primary, caps, skill }: TabProps & { caps: Caps }) {
  const { weaponName, offense, acc, dp, crit, swings, notes, rows } = combatReport(s, val, trio, caps, skill)

  return (
    <div className="stack gap-14">
      <div className="stats-grid">
        <div className="stack gap-14">
          <div className="card">
            <div className="grid four">
              <div className="stat">
                <span className="label">Attack</span>
                <span className="value stats-big">
                  {num(offense)} / {num(acc)}
                </span>
                <span className="sub">before any stance bonus</span>
              </div>
              <div className="stat">
                <span className="label">Double attack</span>
                <span className="value stats-big">{pct(dp)}</span>
              </div>
              <div className="stat">
                <span className="label">Melee crit</span>
                <span className="value stats-big">{pct(crit)}</span>
                <span className="sub">{s.measuredCrit > 0 ? 'measured' : 'classic model'}</span>
              </div>
              <div className="stat">
                <span className="label">Swings a round</span>
                <span className="value stats-big">{swings.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div className="card stack gap-8">
            <Notes notes={notes} />
            <Trace rows={rows} />
          </div>
          <StanceCard s={s} set={set} baseAcc={acc} weaponName={weaponName} />
        </div>

        <div className="stack gap-14">
          <div className="card stack gap-10">
            <h2>Attack</h2>
            <div className="stats-fields two">
              <label className="field">
                <span>Weapon you swing</span>
                <select value={s.weapon} onChange={(e) => set({ weapon: Number(e.target.value) })}>
                  {WEAPON_SKILLS.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <NumField label="Strength" hint="Inventory window" value={s.strength} onChange={(v) => set({ strength: v ?? 0 })} />
              <NumField label="Dexterity" value={s.dexterity} onChange={(v) => set({ dexterity: v ?? 0 })} />
              <NumField label="ATK from items" hint="not in the window" value={s.itemATK} onChange={(v) => set({ itemATK: v ?? 0 })} />
              <NumField label="Attack power AAs" value={s.overrides.attackAA} auto={auto.attackAA} autoFrom="AAs" onChange={(v) => setOverride('attackAA', v)} />
              <NumField label="Ambidexterity" hint="dual wield bonus" value={s.overrides.ambidexterity} auto={auto.ambidexterity} autoFrom="AAs" onChange={(v) => setOverride('ambidexterity', v)} />
              <NumField label="Double attack bonus" hint="%" value={s.doubleAttackBonus} onChange={(v) => set({ doubleAttackBonus: v ?? 0 })} />
            </div>
          </div>
          <div className="card stack gap-10">
            <h2>Crit</h2>
            <div className="stats-fields two">
              <NumField label="Measured crit rate" hint="%, from a parse" step={0.1} max={100} value={s.measuredCrit} onChange={(v) => set({ measuredCrit: v ?? 0 })} />
              <NumField label="Crit chance AAs" hint="SPA 169, %" value={s.overrides.spa169} auto={auto.spa169} autoFrom="AAs" onChange={(v) => setOverride('spa169', v)} />
              <NumField label="Crit difficulty" hint="classic 8900" value={s.critDifficulty} min={1} onChange={(v) => set({ critDifficulty: v || 1 })} />
              <NumField label="Heroic dexterity" hint="0 on Legends" value={s.heroicDex} onChange={(v) => set({ heroicDex: v ?? 0 })} />
            </div>
          </div>
          <SkillsCard s={s} set={set} caps={caps} trio={trio} />
        </div>
      </div>
      <p className="faint small">
        Skill caps from the game's own Resources/skillcaps.txt, best of your {trio.length > 1 ? 'three classes' : 'class'} per skill (classic EverQuest numbering). Attack,
        hit and swing formulas are EQEmu's zone/attack.cpp, confirmed against the stats window and parses; the crit model is not. Primary class for class rules:{' '}
        {className(primary)}.
      </p>
    </div>
  )
}

function SkillsCard({ s, set, caps, trio }: { s: StatsSheet; set: SetSheet; caps: Caps; trio: string[] }) {
  return (
    <div className="card stack gap-10">
      <h2>
        Your skills <span className="spacer" />
        <span className="row tight" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
          <button className="btn ghost small" onClick={() => set({ skills: Object.fromEntries(caps.skills.map((x) => [x.id, x.cap])) })}>
            All capped
          </button>
          <button
            className="btn ghost small"
            onClick={() => {
              const before = s.skills
              set({ skills: {} })
              showUndo('Skills cleared.', () => set({ skills: before }))
            }}
          >
            Clear
          </button>
        </span>
      </h2>
      <p className="faint small" style={{ margin: 0 }}>
        Type them from your in-game Skills window. Caps are the best of your classes at level {s.level}.
      </p>
      <div className="stats-skills">
        {[...caps.skills]
          .sort((a, b) => Number(!(s.skills[a.id] > 0)) - Number(!(s.skills[b.id] > 0)) || skillName(a.id).localeCompare(skillName(b.id)))
          .map((x) => {
          const have = s.skills[x.id] ?? 0
          return (
            <div key={x.id} className="stats-skill">
              <span className="small">{skillName(x.id)}</span>
              <span className="stats-skillbar">
                <i style={{ width: `${x.cap ? Math.min(100, (have / x.cap) * 100) : 0}%` }} />
              </span>
              <span className={`small ${have >= x.cap && have > 0 ? 'ok-text' : 'faint'}`} title={`${className(x.from)} has the best cap`}>
                {have >= x.cap && have > 0 ? 'capped' : x.cap}
                {trio.length > 1 && <span className="faint"> {x.from}</span>}
              </span>
              <input
                type="number"
                min={0}
                max={x.cap}
                value={s.skills[x.id] ?? ''}
                placeholder="0"
                aria-label={`${skillName(x.id)} skill`}
                onChange={(e) => {
                  const next = { ...s.skills }
                  if (e.target.value === '') delete next[x.id]
                  else next[x.id] = Math.max(0, Math.floor(Number(e.target.value) || 0))
                  set({ skills: next })
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StanceCard({ s, set, baseAcc, weaponName }: { s: StatsSheet; set: SetSheet; baseAcc: number; weaponName: string }) {
  const D = Math.max(1, Math.floor(s.targetAvoidance || 1))
  const [solveNote, setSolveNote] = useState('')
  const stances = s.stances.map((st) => ({ ...st, acc: stanceAccuracy(baseAcc, st.pct) }))
  const setStance = (i: number, patch: Partial<{ name: string; pct: number }>) => set({ stances: s.stances.map((st, j) => (j === i ? { ...st, ...patch } : st)) })
  const ladder = [0.75, 0.9, 0.95, 0.99].map((p) => `${p * 100}% needs ${num(Math.ceil(D / (2 * (1 - p))))}`).join(', ')
  return (
    <div className="card stack gap-12">
      <h2>Stances and chance to hit</h2>
      <p className="faint small" style={{ margin: 0 }}>
        Your Accuracy ({num(baseAcc)} with {weaponName}) is multiplied by the stance's hit bonus, then rolled against the target's avoidance. Each stance is a point
        on one curve.
      </p>
      <HitChart stances={stances} avoidance={D} />
      <table className="table small">
        <thead>
          <tr>
            <th>Stance</th>
            <th>Hit bonus %</th>
            <th>Accuracy</th>
            <th>To hit</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {stances.map((st, i) => (
            <tr key={i}>
              <td>
                <input value={st.name} maxLength={40} aria-label={`Stance ${i + 1} name`} onChange={(e) => setStance(i, { name: e.target.value })} />
              </td>
              <td>
                <input type="number" min={0} max={200} style={{ width: 70 }} aria-label={`${st.name} hit bonus %`} value={st.pct} onChange={(e) => setStance(i, { pct: Math.max(0, Math.min(200, Math.floor(Number(e.target.value) || 0))) })} />
              </td>
              <td className="mono">{num(st.acc)}</td>
              <td className="mono">{pct(hitChance(st.acc, D))}</td>
              <td>
                <button className="btn ghost small x-btn" aria-label={`Remove ${st.name}`} disabled={s.stances.length < 2} onClick={() => set({ stances: s.stances.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button className="btn ghost small" disabled={s.stances.length >= 10} onClick={() => set({ stances: [...s.stances, { name: `Stance ${s.stances.length + 1}`, pct: 0 }] })}>
          Add a stance
        </button>
      </div>
      <div className="stats-fields three">
        <NumField label="Target avoidance" min={1} value={s.targetAvoidance} onChange={(v) => set({ targetAvoidance: Math.max(1, v ?? 1) })} />
        <NumField label="Measured hit rate" hint="%" step={0.01} max={99.99} value={s.parseHit} onChange={(v) => set({ parseHit: v ?? 0 })} />
        <NumField label="Your Accuracy then" value={s.parseAccuracy} onChange={(v) => set({ parseAccuracy: v ?? 0 })} />
      </div>
      <div className="row small">
        <button
          className="btn small"
          onClick={() => {
            const d = avoidanceFromHitRate(s.parseHit / 100, s.parseAccuracy)
            if (!(d > 0)) return setSolveNote('Enter a hit rate between 0 and 100% and the Accuracy you had.')
            set({ targetAvoidance: Math.max(1, Math.round(d)) })
            setSolveNote(`A ${s.parseHit.toFixed(2)}% hit rate at Accuracy ${num(s.parseAccuracy)} means avoidance of about ${num(Math.round(d))}.`)
          }}
        >
          Work out the target's avoidance from a parse
        </button>
        <span className="muted">{solveNote}</span>
      </div>
      <p className="faint small" style={{ margin: 0 }}>
        Against avoidance {num(D)}: {ladder} Accuracy. It never reaches 100%; each doubling of Accuracy halves your misses. Striker's +25% applies to skill attacks
        only and Ranged's to archery, so both are 0% on this melee curve.
      </p>
    </div>
  )
}

function HitChart({ stances, avoidance }: { stances: { name: string; acc: number }[]; avoidance: number }) {
  const W = 640
  const H = 240
  const m = { l: 44, r: 16, t: 16, b: 34 }
  const maxAcc = Math.max(avoidance * 2.2, ...stances.map((s) => s.acc * 1.15), 100)
  const x = (a: number) => m.l + (a / maxAcc) * (W - m.l - m.r)
  const y = (p: number) => m.t + (1 - p) * (H - m.t - m.b)
  const pts: string[] = []
  for (let k = 0; k <= 120; k++) {
    const a = (maxAcc * k) / 120
    pts.push(`${x(a).toFixed(1)},${y(hitChance(a, avoidance)).toFixed(1)}`)
  }
  const step = niceStep(maxAcc)
  const ticks: number[] = []
  for (let t = 0; t <= maxAcc; t += step) ticks.push(t)
  // Stances sharing an Accuracy share one label.
  const groups = new Map<number, string[]>()
  for (const s of stances) groups.set(s.acc, [...(groups.get(s.acc) ?? []), s.name])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="stats-chart" role="img" aria-label="Chance to hit against Accuracy">
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <g key={p}>
          <line x1={m.l} x2={W - m.r} y1={y(p)} y2={y(p)} className="grid" />
          <text x={m.l - 6} y={y(p) + 4} textAnchor="end">
            {p * 100}%
          </text>
        </g>
      ))}
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - m.b + 16} textAnchor="middle">
          {num(t)}
        </text>
      ))}
      <text x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle" className="axis">
        Accuracy
      </text>
      <line x1={x(avoidance)} x2={x(avoidance)} y1={m.t} y2={H - m.b} className="avoid" />
      <text x={x(avoidance) + 4} y={m.t + 10} className="axis">
        avoidance {num(avoidance)}
      </text>
      <polyline points={pts.join(' ')} className="curve" />
      {[...groups]
        .sort((a, b) => b[0] - a[0])
        .map(([acc, names], i) => {
          // Labels stack down the lower right, clear of the curve, each with a leader to its point.
          const p = hitChance(acc, avoidance)
          const lx = W - m.r - 4
          const ly = y(0.42) + i * 15
          return (
            <g key={acc}>
              <line x1={x(acc)} y1={y(p)} x2={lx - 4} y2={ly - 4} className="leader" />
              <circle cx={x(acc)} cy={y(p)} r={4.5} className="dot" />
              <text x={lx} y={ly} textAnchor="end" className="label" dx={-8}>
                {names.join(', ')} · {(p * 100).toFixed(1)}%
              </text>
            </g>
          )
        })}
    </svg>
  )
}

function niceStep(span: number): number {
  const raw = span / 5
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag
}

const HEROIC = ['Accuracy', 'Avoidance', 'Combat Effects', 'Damage Shielding', 'Damage Shield Mitigation', 'DoT Shielding', 'Melee Shielding', 'Spell Shielding', 'Strike Through', 'Stun Resist']
const SPELL_MODS = ['Heal Amount', 'Spell Damage', 'Clairvoyance', 'Luck']
const SKILL_MODS = ['Bash', 'Backstab', 'Dragon Punch', 'Eagle Strike', 'Flying Kick', 'Frenzy', 'Kick', 'Round Kick', 'Tiger Claw']
const STATS: [string, string][] = [['Strength', 'STR'], ['Stamina', 'STA'], ['Intelligence', 'INT'], ['Wisdom', 'WIS'], ['Agility', 'AGI'], ['Dexterity', 'DEX'], ['Charisma', 'CHA']]
const RESISTS: [string, string][] = [['Magic', 'MAGIC'], ['Fire', 'FIRE'], ['Cold', 'COLD'], ['Disease', 'DISEASE'], ['Poison', 'POISON'], ['Void', 'VOID']]

/**
 * The in-game Inventory window's Stats tab, read off the screen, with what the tracker predicts
 * beside it: the AC and attack calculators, and what worn gear contributes.
 */
function CharacterTab({
  s,
  set,
  val,
  trio,
  primary,
  skill,
  gear
}: {
  s: StatsSheet
  set: SetSheet
  val: Val
  trio: string[]
  primary: string
  skill: (id: number) => number
  gear: WornTotals | null
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const w = s.window?.values ?? {}
  const has = !!s.window
  const ac = computeAc(acInputs(s, trio, primary, val, skill))
  const offense = windowOffense(skill(s.weapon), s.strength)
  const accuracy = baseAccuracy(skill(OFFENSE), skill(s.weapon))

  const read = async () => {
    setBusy(true)
    setMessage('')
    try {
      const r = await api.invoke<{ values: Record<string, number[]>; rows: string[]; screens: number }>('stats:readScreen')
      const found = Object.keys(r.values).length
      if (found < 5) {
        setMessage(`Could not find the Stats window on ${r.screens} screen${r.screens === 1 ? '' : 's'}. Open your Inventory window on its Stats tab, uncovered, and try again.`)
        return
      }
      const v = r.values
      // The window's own stats feed the calculators, so they describe the character as it is now.
      set({
        window: { at: Date.now(), values: v },
        ...(v.Agility ? { agility: v.Agility[0] } : {}),
        ...(v.Strength ? { strength: v.Strength[0] } : {}),
        ...(v.Dexterity ? { dexterity: v.Dexterity[0] } : {})
      })
      setMessage(`Read ${found} lines. Strength, Agility and Dexterity on the AC and Combat tabs now follow it.`)
    } catch (e) {
      setMessage(`Could not read the screen: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const n = (label: string, i = 0) => w[label]?.[i]
  const show = (v: number | undefined) => (v === undefined ? '—' : num(v))
  const pair = (label: string) => (w[label] ? `${num(w[label][0])} / ${num(w[label][1] ?? w[label][0])}` : '—')
  const check = (actual: number | undefined, predicted: number) =>
    actual === undefined ? (
      <span className="faint">calc {num(predicted)}</span>
    ) : actual === predicted ? (
      <span className="ok-text" title="The calculator gives the same">
        ✓
      </span>
    ) : (
      <span className="warn-text" title="What the calculator gives with your current inputs">
        calc {num(predicted)}
      </span>
    )
  const gearNote = (g: number | undefined) => (gear && g ? <span className="faint">gear +{num(g)}</span> : null)
  const row = (label: string, value: React.ReactNode, note?: React.ReactNode, color?: boolean) => (
    <div className="char-row" key={label}>
      <span>{label}</span>
      <b className={color ? 'char-green' : ''}>{value}</b>
      <span className="char-note">{note}</span>
    </div>
  )

  return (
    <div className="stack gap-14">
      <div className="card row gap-12">
        <button className="btn primary" disabled={busy} onClick={() => void read()}>
          {busy ? 'Reading the screen…' : 'Read from screen'}
        </button>
        <span className="small muted grow">
          {has
            ? `Read ${ago(s.window!.at)}. Open your Inventory window on its Stats tab and read again whenever your gear or buffs change.`
            : 'Open your Inventory window on its Stats tab in game, then read it. This window steps aside for a moment while it looks.'}
        </span>
        {message && <span className="small faint">{message}</span>}
      </div>

      {!has ? (
        <div className="card empty">
          Nothing read yet. The tracker reads the game&apos;s own Stats tab, so every figure here is exactly what the game shows, buffs included, with the calculators&apos;
          predictions beside it.
        </div>
      ) : (
        <div className="char-window">
          <div className="card char-col">
            {row('HP', pair('HP'), gearNote(gear?.pools.HP))}
            {row('Mana', pair('Mana'), gearNote(gear?.pools.MANA))}
            {row('Endurance', pair('Endurance'), gearNote(gear?.pools.END))}
            {row(
              'AC',
              w.AC ? w.AC.map(num).join(' / ') : '—',
              <>
                {check(n('AC', 0), ac.mitigation)} {check(n('AC', 1), ac.effCap)} {check(n('AC', 2), ac.avoidance)}
              </>
            )}
            {row(
              'Attack',
              pair('Attack'),
              <>
                {check(n('Attack', 0), offense)}
                <span className="faint" title="Accuracy before any stance or buff">
                  {' '}
                  base accuracy {num(accuracy)}
                </span>
              </>
            )}
            {row('Attack Speed', w['Attack Speed'] ? `${w['Attack Speed'][0]}%` : '—', gear?.haste ? <span className="faint">gear haste {gear.haste}%</span> : null, true)}
            {row('Velocity', show(n('Velocity')))}
            <div className="char-head">Regen</div>
            {row('Combat HP Regen', show(n('Combat HP Regen')), gearNote(gear?.hpRegen), true)}
            {row('Combat Mana Regen', show(n('Combat Mana Regen')), gearNote(gear?.manaRegen), true)}
            {row('Combat End Regen', show(n('Combat End Regen')), gearNote(gear?.endRegen), true)}
            <div className="char-head">Stats</div>
            {STATS.map(([label, key]) =>
              row(
                label,
                w[label] ? (
                  <>
                    <span className="char-green">{num(w[label][0])}</span> / {num(w[label][1] ?? 510)} <span className="char-heroic">+{w[label][2] ?? 0}</span>
                  </>
                ) : (
                  '—'
                ),
                gear && w[label] ? (
                  <span className="faint">
                    gear +{gear.stats[key] ?? 0} · rest {num(w[label][0] - (gear.stats[key] ?? 0))}
                  </span>
                ) : null
              )
            )}
            <div className="char-head">Resists</div>
            {RESISTS.map(([label, key]) =>
              row(
                label,
                w[label] ? (
                  <>
                    <span className="char-green">{num(w[label][0])}</span> / {num(w[label][1] ?? 1000)}
                  </>
                ) : (
                  '—'
                ),
                gearNote(gear?.saves[key])
              )
            )}
          </div>
          <div className="card char-col">
            <div className="char-head first">Heroic Mods</div>
            {HEROIC.map((label) => row(label, w[label] ? `${w[label][0]} / ${w[label][1]}` : '—'))}
            <div className="char-head">Spell Mods</div>
            {SPELL_MODS.map((label) => row(label, show(n(label))))}
            <div className="char-head">Skill Damage Mod</div>
            {SKILL_MODS.map((label) => row(label, w[label] ? `${w[label][0]} / ${w[label][1]}` : '—'))}
          </div>
        </div>
      )}
      <p className="faint small">
        Read with Windows&apos; own text recognition from a picture of your screen; nothing touches the game. A dash is a line it could not read. The notes beside each figure
        are what the AC and Combat tabs work out from your current inputs (a tick when they agree with the game) and what your worn gear adds.
      </p>
    </div>
  )
}
