import { useState } from 'react'
import { showUndo } from '../toast'
import { pct as pctOf, num } from '../../../core/format'

/** A chance, to one place. */
const pct = (x: number) => pctOf(x, 1)
import type { StatsInputs } from '../../../core/statsInputs'
import { combatReport, type Caps } from '../../../core/statsModel'
import { className } from '../../../shared/game/classes'
import { avoidanceFromHitRate, hitChance, skillName, stanceAccuracy, WEAPON_SKILLS } from '../../../core/combatModel'
import { Notes, NumField, Trace, type SetSheet, type TabProps } from './statsBits'
import { useInvoke } from '../hooks'
import { isoDays } from '../../../core/format'
import type { StatsFromLog } from '../../../shared/ipc'

/** The days of melee a measured rate is taken over. */
const LOG_DAYS = 14
/** A sample this large settles a crit rate to about a point (TODO.md asks for ~3,000 hits of a Warrior trio). */
const SETTLED_HITS = 3000

export function CombatTab({ s, set, setOverride, auto, val, trio, primary, caps, skill, character }: TabProps & { caps: Caps; character: string }) {
  const { weaponName, offense, acc, dp, crit, swings, notes, rows } = combatReport(s, val, trio, caps, skill)
  const fromLog = useInvoke(character ? 'stats:fromLog' : null, [character, LOG_DAYS]).data ?? null

  return (
    <div className="stack gap-16">
      {fromLog && <FromLog s={s} set={set} log={fromLog} acc={acc} caps={caps} />}
      <div className="stats-grid">
        <div className="stack gap-16">
          <div className="card">
            <div className="grid four">
              <div className="stat">
                <span className="label">Attack: offense / accuracy</span>
                <span className="value stats-big">
                  {num(offense)} / {num(acc)}
                </span>
                <span className="sub">as the Inventory window shows it, before any stance bonus</span>
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

        <div className="stack gap-16">
          <div className="card stack gap-12">
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
              <NumField
                label="Ambidexterity"
                hint="dual wield bonus"
                value={s.overrides.ambidexterity}
                auto={auto.ambidexterity}
                autoFrom="AAs"
                onChange={(v) => setOverride('ambidexterity', v)}
              />
              <NumField label="Double attack bonus" hint="%" value={s.doubleAttackBonus} onChange={(v) => set({ doubleAttackBonus: v ?? 0 })} />
            </div>
          </div>
          <div className="card stack gap-12">
            <h2>Crit</h2>
            <div className="stats-fields two">
              <NumField label="Measured crit rate" hint="%, from a parse" step={0.1} max={100} value={s.measuredCrit} onChange={(v) => set({ measuredCrit: v ?? 0 })} />
              <NumField
                label="Crit chance AAs"
                hint="%"
                title="Spell effect 169"
                value={s.overrides.spa169}
                auto={auto.spa169}
                autoFrom="AAs"
                onChange={(v) => setOverride('spa169', v)}
              />
              <NumField
                label="Crit difficulty"
                hint="8900 as a rule"
                title="The server's crit difficulty: 8900 in classic EverQuest's rules"
                value={s.critDifficulty}
                min={1}
                onChange={(v) => set({ critDifficulty: v || 1 })}
              />
              <NumField label="Heroic dexterity" hint="0 on Legends" value={s.heroicDex} onChange={(v) => set({ heroicDex: v ?? 0 })} />
            </div>
          </div>
          <SkillsCard s={s} set={set} caps={caps} trio={trio} />
        </div>
      </div>
      <p className="faint small">
        Skill caps from the game's own Resources/skillcaps.txt, best of your {trio.length > 1 ? 'three classes' : 'class'} per skill (classic EverQuest numbering). Attack, hit and
        swing formulas are the EverQuest server's own (as EQEmu has them), confirmed against the stats window and parses; the crit model is not. Primary class for class rules:{' '}
        {className(primary)}.
      </p>
    </div>
  )
}

/**
 * What the log and the worn gear measure, which this tab otherwise asks to be typed (LT-739): the crit
 * and hit rates of your own melee, each skill's last value, the Primary's weapon skill and the ATK
 * items give. Typed values stay until Use is pressed, and Undo puts them back.
 */
function FromLog({ s, set, log, acc, caps }: { s: StatsInputs; set: SetSheet; log: StatsFromLog; acc: number; caps: Caps }) {
  const m = log.melee
  const swingsSeen = m ? m.hits + m.misses : 0
  const critRate = m && m.hits ? (m.crits / m.hits) * 100 : 0
  const hitRate = swingsSeen ? (m!.hits / swingsSeen) * 100 : 0
  const capped = new Map(caps.skills.map((x) => [x.id, x.cap]))
  // A skill the log saw higher than what is typed (GM training prints nothing, so it can also be lower).
  const higher = Object.entries(log.skills).filter(([id, v]) => capped.has(Number(id)) && v > (s.skills[Number(id)] ?? 0))
  const use = () => {
    const before = { measuredCrit: s.measuredCrit, parseHit: s.parseHit, parseAccuracy: s.parseAccuracy, weapon: s.weapon, itemATK: s.itemATK }
    set({
      ...(m && m.hits ? { measuredCrit: Math.round(critRate * 10) / 10 } : {}),
      ...(swingsSeen ? { parseHit: Math.round(hitRate * 100) / 100, parseAccuracy: acc } : {}),
      ...(log.weapon !== undefined ? { weapon: log.weapon } : {}),
      ...(log.itemATK !== undefined ? { itemATK: log.itemATK } : {})
    })
    showUndo('Filled in from your log and worn gear.', () => set(before))
  }
  const fillSkills = () => {
    const before = s.skills
    set({ skills: { ...s.skills, ...Object.fromEntries(higher.map(([id, v]) => [Number(id), Math.min(v, capped.get(Number(id)) ?? v)])) } })
    showUndo(`${higher.length} skill${higher.length === 1 ? '' : 's'} filled in from your log.`, () => set({ skills: before }))
  }
  if (!m && !higher.length && log.weapon === undefined && log.itemATK === undefined) return null
  return (
    <div className="card row">
      <div className="grow small">
        <b>From your log</b>
        {m ? (
          <>
            {' '}
            · crit {pct(critRate / 100)} of {num(m.hits)} hits, hit {pct(hitRate / 100)} of {num(swingsSeen)} swings ({isoDays(m.from)} to {isoDays(m.to)})
            {m.hits < SETTLED_HITS && <span className="faint"> · a small sample: about {num(SETTLED_HITS)} hits settle a crit rate</span>}
          </>
        ) : (
          <span className="faint"> · no melee of yours in the last {LOG_DAYS} days</span>
        )}
        {log.weapon !== undefined && <> · {skillName(log.weapon)} in your Primary</>}
        {log.itemATK !== undefined && <> · {num(log.itemATK)} ATK from items</>}
        <div className="faint">The hit rate is against whatever you fought; for one target, work it out below from a parse of it.</div>
      </div>
      <button className="btn small" onClick={use}>
        Use these
      </button>
      {higher.length > 0 && (
        <button
          className="btn small"
          onClick={fillSkills}
          title="Each skill the log last saw higher than what is typed. A skill raised at a guildmaster prints no line, so the log can be behind: check the Skills window."
        >
          Fill {higher.length} skill{higher.length === 1 ? '' : 's'} from your log
        </button>
      )}
    </div>
  )
}

function SkillsCard({ s, set, caps, trio }: { s: StatsInputs; set: SetSheet; caps: Caps; trio: string[] }) {
  return (
    <div className="card stack gap-12">
      <div className="card-head">
        <h2>Your skills</h2>
        <span className="spacer" />
        <span className="row tight">
          <button
            className="btn ghost small"
            onClick={() => {
              const before = s.skills
              set({ skills: Object.fromEntries(caps.skills.map((x) => [x.id, x.cap])) })
              showUndo('Every skill set to its cap.', () => set({ skills: before }))
            }}
          >
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
      </div>
      <p className="faint small" style={{ margin: 0 }}>
        Type them from your in-game Skills window, or fill them from your log above (its skill-up lines). Caps are the best of your classes at level {s.level}.
      </p>
      <div className="stats-skills">
        {[...caps.skills]
          .sort((a, b) => Number(!(s.skills[a.id] > 0)) - Number(!(s.skills[b.id] > 0)) || skillName(a.id).localeCompare(skillName(b.id)))
          .map((x) => {
            const have = s.skills[x.id] ?? 0
            return (
              <div key={x.id} className="stats-skill">
                <span className="small">{skillName(x.id)}</span>
                <span className="bar thin teal">
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

function StanceCard({ s, set, baseAcc, weaponName }: { s: StatsInputs; set: SetSheet; baseAcc: number; weaponName: string }) {
  const D = Math.max(1, Math.floor(s.targetAvoidance || 1))
  const [solveNote, setSolveNote] = useState('')
  const stances = s.stances.map((st) => ({ ...st, acc: stanceAccuracy(baseAcc, st.pct) }))
  const setStance = (i: number, patch: Partial<{ name: string; pct: number }>) => set({ stances: s.stances.map((st, j) => (j === i ? { ...st, ...patch } : st)) })
  const ladder = [0.75, 0.9, 0.95, 0.99].map((p) => `${p * 100}% needs ${num(Math.ceil(D / (2 * (1 - p))))}`).join(', ')
  return (
    <div className="card stack gap-12">
      <h2>Stances and chance to hit</h2>
      <p className="faint small" style={{ margin: 0 }}>
        Your Accuracy ({num(baseAcc)} with {weaponName}) is multiplied by the stance's hit bonus, then rolled against the target's avoidance. Each stance is a point on one curve.
      </p>
      <HitChart stances={stances} avoidance={D} />
      <div className="table-scroll">
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
                  <input
                    type="number"
                    min={0}
                    max={200}
                    style={{ width: 70 }}
                    aria-label={`${st.name} hit bonus %`}
                    value={st.pct}
                    onChange={(e) => setStance(i, { pct: Math.max(0, Math.min(200, Math.floor(Number(e.target.value) || 0))) })}
                  />
                </td>
                <td className="mono">{num(st.acc)}</td>
                <td className="mono">{pct(hitChance(st.acc, D))}</td>
                <td>
                  <button
                    className="btn ghost small x-btn"
                    aria-label={`Remove ${st.name}`}
                    disabled={s.stances.length < 2}
                    onClick={() => {
                      const before = s.stances
                      set({ stances: s.stances.filter((_, j) => j !== i) })
                      showUndo(`${st.name || 'Stance'} removed.`, () => set({ stances: before }))
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
        Against avoidance {num(D)}: {ladder} Accuracy. It never reaches 100%; each doubling of Accuracy halves your misses. Striker's +25% applies to skill attacks only and
        Ranged's to archery, so both are 0% on this melee curve.
      </p>
    </div>
  )
}

function HitChart({ stances, avoidance }: { stances: { name: string; acc: number }[]; avoidance: number }) {
  const W = 640
  const H = 240
  const m = { l: 50, r: 16, t: 16, b: 38 }
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
    <svg viewBox={`0 0 ${W} ${H}`} className="stats-chart stats-hit-chart" role="img" aria-label="Chance to hit against Accuracy">
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
