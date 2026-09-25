import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state'
import { act, showToast } from '../toast'
import { useRemembered } from '../remember'
import { LIVE, useCombat, useSegment } from '../combat'
import { Icon, Info } from './ui'
import { EntityBar, HealBar, HEAL_COLOR, KIND_COLOR, SkillBar, kindTag } from './MeterBars'
import {
  attackerRows, attackerSkillRows, copyText, damageRows, defenseOf, durationSec, fmtClock, fmtNum, fmtPct, fmtRate,
  healSpellRows, healTargetRows, healTotals, healedRows, healerRows, rolling, skillRows, sourcesFor, takenRows, targetRows, totalsOf,
  type HealRow, type Row
} from '../../../core/combatView'
import type { CombatSnapshot, Defense, MeterMode, MeterScope, MeterSpan, Segment, SegmentSummary } from '../../../shared/types'

// The damage meter on the Live page: one segment (the fight or the session) read three ways
// (damage out, damage in, healing), the rows clickable down into skills, targets and attackers.

type Drill = null | { kind: 'entity'; key: string; name: string } | { kind: 'target'; name: string }

const MODES: [MeterMode, string][] = [
  ['damage', 'Damage'],
  ['incoming', 'Incoming'],
  ['healing', 'Healing']
]
const SCOPES: [MeterScope, string][] = [
  ['everyone', 'Everyone'],
  ['group', 'Group'],
  ['you', 'You']
]

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <span className="lt-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </span>
  )
}

function when(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function SegmentPicker({ list, span, selection, onChange, live }: { list: SegmentSummary[]; span: MeterSpan; selection: string; onChange: (id: string) => void; live: Segment | null }) {
  const liveLabel = span === 'fight' ? (live ? 'Live fight' : list[0] ? 'Last fight' : 'No fights yet') : 'Current session'
  return (
    <select className="dm-pick" value={selection} onChange={(e) => onChange(e.target.value)} aria-label={span === 'fight' ? 'Which fight' : 'Which session'}>
      <option value={LIVE}>{liveLabel}</option>
      {list.map((s) => (
        <option key={s.id} value={s.id}>
          {when(s.startedAt)} · {s.name} · {fmtClock((s.endedAt - s.startedAt) / 1000 + 1)} · {fmtRate(s.dps)} DPS
          {s.mine ? '' : ' · not yours'}
        </option>
      ))}
    </select>
  )
}

export function Meter() {
  const { state, patchSettings } = useApp()
  const snap = useCombat()
  const [span, setSpan] = useRemembered<MeterSpan>('meter.span', 'fight')
  const [mode, setMode] = useRemembered<MeterMode>('meter.mode', 'damage')
  const [scope, setScope] = useRemembered<MeterScope>('meter.scope', 'everyone')
  const [active, setActive] = useRemembered<boolean>('meter.active', false)
  const [selection, setSelection] = useState(LIVE)
  const [drill, setDrill] = useState<Drill>(null)
  const combinePet = state.settings.combat.combinePet
  const seg = useSegment(snap, span, selection)

  // A new span or mode starts at the top; a new segment keeps the drill, so a name can be followed across fights.
  useEffect(() => setDrill(null), [span, mode])
  useEffect(() => setSelection(LIVE), [span])

  const list = span === 'fight' ? (snap?.fights ?? []) : (snap?.sessions ?? [])
  const live = span === 'fight' ? (snap?.liveFight ?? null) : (snap?.liveSession ?? null)
  const name = seg ? (seg.kind === 'fight' ? (list.find((s) => s.id === seg.id)?.name ?? seg.name ?? 'Fight') : seg.name || seg.zone || 'Session') : ''

  const rows = useMemo<Row[] | HealRow[]>(() => {
    if (!seg) return []
    if (mode === 'damage') return drill?.kind === 'target' ? sourcesFor(seg, scope, drill.name) : damageRows(seg, scope, combinePet)
    if (mode === 'incoming') return attackerRows(seg, scope)
    return healerRows(seg, scope)
  }, [seg, mode, scope, combinePet, drill])

  const head = useMemo(() => (seg ? (mode === 'healing' ? healTotals(seg, rows as HealRow[]) : totalsOf(seg, rows)) : null), [seg, mode, rows])

  const copy = () => {
    if (!seg) return
    navigator.clipboard.writeText(copyText(seg, mode, scope, rows, name)).then(
      () => showToast('Copied to the clipboard'),
      () => showToast('Could not copy', { tone: 'bad' })
    )
  }

  return (
    <div className="card dm">
      <div className="dm-head">
        <h2 className="m-0">
          Damage meter
          {snap?.reading && <span className="chip warn">{snap.reading}</span>}
          {live?.open && span === 'fight' && <span className="chip ok">in combat</span>}
        </h2>
        <span className="spacer" />
        <button className="btn small" onClick={() => void act('combat:newSession')} title="Close the current session and start a new one counting from now">
          <Icon name="flag" /> New session
        </button>
        <button className="btn small" onClick={copy} disabled={!seg} title="Copy this list as text, for chat or a note">
          <Icon name="copy" /> Copy
        </button>
      </div>
      <div className="dm-controls">
        <Seg value={span} options={[['fight', 'Fight'], ['session', 'Overall']]} onChange={setSpan} label="Fight or session" />
        <SegmentPicker list={list} span={span} selection={selection} onChange={setSelection} live={live} />
        <Seg value={scope} options={SCOPES} onChange={setScope} label="Whose rows" />
        <Seg value={mode} options={MODES} onChange={setMode} label="What to list" />
        <span className="spacer" />
        <label className="check small" title="Fold each pet's damage into its owner's row">
          <input type="checkbox" checked={combinePet} onChange={(e) => patchSettings((s) => ({ ...s, combat: { ...s.combat, combinePet: e.target.checked } }))} />
          Pets with owners
        </label>
        <label className="check small" title="Rate over the time actually spent hitting (gaps between hits capped at 3 s) instead of the whole fight">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active DPS
        </label>
      </div>
      {scope === 'group' && snap && <Roster snap={snap} />}

      {!seg ? (
        <div className="empty">{snap?.reading ? 'Reading recent fights from the log…' : 'No fights yet. Hit something while watching and it appears here, with the last hour read from the log at start.'}</div>
      ) : (
        <>
          <Headline seg={seg} name={name} mode={mode} head={head!} active={active} />
          <div className="dm-body">
            <div className="dm-main">
              {mode === 'damage' && <DamagePane seg={seg} rows={rows as Row[]} drill={drill} setDrill={setDrill} active={active} scope={scope} />}
              {mode === 'incoming' && <IncomingPane seg={seg} rows={rows as Row[]} drill={drill} setDrill={setDrill} scope={scope} active={active} />}
              {mode === 'healing' && <HealingPane seg={seg} rows={rows as HealRow[]} drill={drill} setDrill={setDrill} />}
            </div>
            <div className="dm-side">
              {mode === 'damage' && <TargetsCard seg={seg} scope={scope} drill={drill} setDrill={setDrill} />}
              {mode === 'incoming' && <DefenseCard d={defenseOf(seg, scope)} scope={scope} />}
              {mode === 'incoming' && <TakenCard seg={seg} scope={scope} />}
              {mode === 'healing' && <HealedCard seg={seg} scope={scope} />}
              {mode !== 'healing' && <DpsChart seg={seg} />}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Headline({ seg, name, mode, head, active }: { seg: Segment; name: string; mode: MeterMode; head: ReturnType<typeof totalsOf> & { raw?: number }; active: boolean }) {
  const dur = durationSec(seg)
  const per = mode === 'healing' ? 'HPS' : 'DPS'
  const rate = active && mode !== 'healing' ? head.activeDps : head.dps
  return (
    <div className="dm-headline">
      <div className="dm-title" title={seg.zone ? `In ${seg.zone}` : undefined}>
        <b>{name}</b>
        <span className="faint">{seg.zone && seg.kind === 'fight' ? ` · ${seg.zone}` : ''}</span>
      </div>
      <div className="dm-figures">
        <span className="dm-big" style={{ color: mode === 'healing' ? HEAL_COLOR : mode === 'incoming' ? 'var(--red)' : 'var(--accent-2)' }}>
          {fmtNum(rate)} <small>{active && mode !== 'healing' ? `active ${per}` : per}</small>
        </span>
        <span className="dm-kv">
          <b>{fmtNum(head.total)}</b> {mode === 'healing' ? 'healed' : mode === 'incoming' ? 'taken' : 'damage'}
        </span>
        {mode === 'healing' && head.raw !== undefined && head.raw > head.total && (
          <span className="dm-kv">
            <b>{fmtPct((head.raw - head.total) / head.raw)}</b> overhealed
          </span>
        )}
        <span className="dm-kv">
          <b>{fmtClock(dur)}</b> {seg.open ? 'so far' : 'long'}
        </span>
        {mode === 'damage' && !active && seg.activeMs > 0 && seg.activeMs < dur * 1000 && (
          <span className="dm-kv" title="Damage over the time spent striking: gaps between hits capped at 3 s">
            <b>{fmtNum(head.activeDps)}</b> active DPS
          </span>
        )}
        {seg.kills > 0 && (
          <span className="dm-kv">
            <b>{seg.kills}</b> kill{seg.kills === 1 ? '' : 's'}
          </span>
        )}
        {seg.deaths > 0 && (
          <span className="dm-kv warn-text">
            <b>{seg.deaths}</b> death{seg.deaths === 1 ? '' : 's'}
          </span>
        )}
        {seg.enemyHeal > 0 && mode === 'damage' && (
          <span className="dm-kv" title="Hit points enemies healed during this fight: damage undone">
            <b>+{fmtNum(seg.enemyHeal)}</b> enemy healed
          </span>
        )}
      </div>
    </div>
  )
}

function Crumb({ text, back }: { text: string; back: () => void }) {
  return (
    <button className="btn ghost small dm-crumb" onClick={back}>
      <Icon name="back" /> {text}
    </button>
  )
}

function DamagePane({ seg, rows, drill, setDrill, active, scope }: { seg: Segment; rows: Row[]; drill: Drill; setDrill: (d: Drill) => void; active: boolean; scope: MeterScope }) {
  if (drill?.kind === 'entity') {
    const row = rows.find((r) => r.key === drill.key) ?? damageRows(seg, 'everyone', false).find((r) => r.key === drill.key)
    const skills = row ? skillRows(seg, row) : []
    return (
      <>
        <Crumb text={`${drill.name} · back to everyone`} back={() => setDrill(null)} />
        {!skills.length && <div className="empty">Nothing from {drill.name} in this {seg.kind}.</div>}
        {skills.map((s, i) => (
          <SkillBar key={s.key} s={s} rank={i + 1} onClick={s.how === 'pet' ? () => setDrill({ kind: 'entity', key: s.key.slice(2), name: s.name }) : undefined} />
        ))}
      </>
    )
  }
  return (
    <>
      {drill?.kind === 'target' && <Crumb text={`Damage to ${drill.name} · back to all targets`} back={() => setDrill(null)} />}
      {!rows.length && <div className="empty">No damage dealt {scope === 'you' ? 'by you' : scope === 'group' ? 'by your group' : ''} in this {seg.kind} yet.</div>}
      {rows.map((r, i) => (
        <EntityBar key={r.key} r={r} rank={i + 1} activeDps={active} onClick={() => setDrill({ kind: 'entity', key: r.key, name: r.name })} />
      ))}
    </>
  )
}

function IncomingPane({ seg, rows, drill, setDrill, scope, active }: { seg: Segment; rows: Row[]; drill: Drill; setDrill: (d: Drill) => void; scope: MeterScope; active: boolean }) {
  if (drill?.kind === 'entity') {
    const skills = attackerSkillRows(seg, scope, drill.name)
    return (
      <>
        <Crumb text={`${drill.name} · back to every attacker`} back={() => setDrill(null)} />
        {!skills.length && <div className="empty">No breakdown for {drill.name}.</div>}
        {skills.map((s, i) => (
          <SkillBar key={s.key} s={s} rank={i + 1} />
        ))}
      </>
    )
  }
  const who = scope === 'you' ? 'you' : scope === 'group' ? 'your group' : 'your side'
  return (
    <>
      {!rows.length && <div className="empty">Nothing has hit {who} in this {seg.kind}.</div>}
      {rows.map((r, i) => (
        <EntityBar key={r.key} r={r} rank={i + 1} activeDps={active} onClick={() => setDrill({ kind: 'entity', key: r.key, name: r.name })} />
      ))}
    </>
  )
}

function HealingPane({ seg, rows, drill, setDrill }: { seg: Segment; rows: HealRow[]; drill: Drill; setDrill: (d: Drill) => void }) {
  if (drill?.kind === 'entity') {
    const spells = healSpellRows(seg, drill.name)
    const targets = healTargetRows(seg, drill.name)
    return (
      <>
        <Crumb text={`${drill.name} · back to every healer`} back={() => setDrill(null)} />
        <div className="dm-sub">By spell</div>
        {spells.map((h, i) => (
          <HealBar key={h.key} h={h} rank={i + 1} />
        ))}
        <div className="dm-sub">On whom</div>
        {targets.map((h) => (
          <HealBar key={h.key} h={h} />
        ))}
      </>
    )
  }
  return (
    <>
      {!rows.length && <div className="empty">No healing in this {seg.kind}.</div>}
      {rows.map((h, i) => (
        <HealBar key={h.key} h={h} rank={i + 1} onClick={() => setDrill({ kind: 'entity', key: h.key, name: h.name })} />
      ))}
    </>
  )
}

function TargetsCard({ seg, scope, drill, setDrill }: { seg: Segment; scope: MeterScope; drill: Drill; setDrill: (d: Drill) => void }) {
  const targets = useMemo(() => targetRows(seg, scope), [seg, scope])
  return (
    <div className="dm-aux">
      <div className="dm-aux-head">
        Damage by mob <Info label="About damage by mob" text="Where the listed rows' damage went. Click a mob to see who did what to it." />
      </div>
      {!targets.length && <div className="faint small">Nothing hit yet.</div>}
      {targets.slice(0, 12).map((t, i) => (
        <EntityBar key={t.key} r={t} rank={i + 1} selected={drill?.kind === 'target' && drill.name === t.name} onClick={() => setDrill(drill?.kind === 'target' && drill.name === t.name ? null : { kind: 'target', name: t.name })} />
      ))}
      {targets.length > 12 && <div className="faint small">+{targets.length - 12} more</div>}
    </div>
  )
}

function DefenseCard({ d, scope }: { d: Defense; scope: MeterScope }) {
  const rows: [string, number, string][] = [
    ['Hit', d.hit, 'swings that landed'],
    ['Missed', d.miss, 'swings that missed outright'],
    ['Dodged', d.dodge, ''],
    ['Parried', d.parry, ''],
    ['Blocked', d.block, ''],
    ['Riposted', d.riposte, 'a riposte is also a swing back'],
    ['Absorbed', d.absorb, 'a rune or magical skin took it']
  ]
  const avoided = d.swings - d.hit
  return (
    <div className="dm-aux">
      <div className="dm-aux-head">
        {scope === 'you' ? 'Your defence' : 'Defence'}
        <span className="faint small">{d.swings ? `${d.swings} swings · ${fmtPct(avoided / d.swings)} avoided` : ''}</span>
      </div>
      {!d.swings && <div className="faint small">Nothing has swung at {scope === 'you' ? 'you' : 'your side'} yet.</div>}
      {d.swings > 0 &&
        rows
          .filter(([, n]) => n > 0)
          .map(([label, n, hint]) => (
            <div key={label} className="lt-bar" title={hint}>
              <span>{label}</span>
              <span className="lt-bar-track">
                <i style={{ width: `${(n / d.swings) * 100}%`, background: label === 'Hit' ? 'var(--red)' : undefined }} />
              </span>
              <b>
                {n} <small className="faint">{fmtPct(n / d.swings)}</small>
              </b>
            </div>
          ))}
    </div>
  )
}

function TakenCard({ seg, scope }: { seg: Segment; scope: MeterScope }) {
  const rows = useMemo(() => takenRows(seg, scope), [seg, scope])
  return (
    <div className="dm-aux">
      <div className="dm-aux-head">Damage taken by</div>
      {!rows.length && <div className="faint small">Nobody has been hit yet.</div>}
      {rows.slice(0, 10).map((r, i) => (
        <EntityBar key={r.key} r={r} rank={i + 1} />
      ))}
    </div>
  )
}

function HealedCard({ seg, scope }: { seg: Segment; scope: MeterScope }) {
  const rows = useMemo(() => healedRows(seg, scope), [seg, scope])
  const runes = Object.values(seg.entities).reduce((s, e) => s + e.runes, 0)
  return (
    <div className="dm-aux">
      <div className="dm-aux-head">Healed</div>
      {!rows.length && <div className="faint small">Nobody has been healed yet.</div>}
      {rows.slice(0, 10).map((h, i) => (
        <HealBar key={h.key} h={h} rank={i + 1} />
      ))}
      {runes > 0 && (
        <div className="faint small mt-10">
          Runes absorbed {fmtNum(runes)} on top.
        </div>
      )}
      {seg.enemyHeal > 0 && <div className="faint small">Enemies healed themselves for {fmtNum(seg.enemyHeal)}.</div>}
    </div>
  )
}

const LINES: { key: keyof NonNullable<Segment['timeline']>; label: string; color: string }[] = [
  { key: 'you', label: 'you', color: 'var(--accent)' },
  { key: 'pet', label: 'pet', color: 'var(--violet)' },
  { key: 'group', label: 'others', color: 'var(--teal)' },
  { key: 'inc', label: 'incoming', color: 'var(--red)' }
]
const WINDOW_SEC = 6

function DpsChart({ seg }: { seg: Segment }) {
  const [hidden, setHidden] = useRemembered<string[]>('meter.chartHidden', [])
  const tl = seg.timeline
  const seconds = Math.max(1, Math.ceil(durationSec(seg)))
  const series = useMemo(() => {
    if (!tl) return null
    return LINES.map((l) => ({ ...l, values: rolling(tl[l.key], seconds, WINDOW_SEC), any: tl[l.key].some((v) => v > 0) }))
  }, [tl, seconds])
  if (!series) {
    return (
      <div className="dm-aux">
        <div className="dm-aux-head">DPS over time</div>
        <div className="faint small">A session has no chart; pick a fight.</div>
      </div>
    )
  }
  const shown = series.filter((s) => s.any && !hidden.includes(s.key))
  const max = Math.max(1, ...shown.flatMap((s) => s.values))
  const W = 520
  const H = 140
  const L = 36
  const B = 18
  const x = (i: number) => L + (i / Math.max(1, seconds - 1)) * (W - L - 6)
  const y = (v: number) => 6 + (1 - v / max) * (H - B - 6)
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const step = seconds > 600 ? 120 : seconds > 240 ? 60 : seconds > 90 ? 30 : seconds > 30 ? 10 : 5
  const ticks: number[] = []
  for (let t = 0; t < seconds; t += step) ticks.push(t)
  return (
    <div className="dm-aux">
      <div className="dm-aux-head">
        DPS over time <span className="faint small">{WINDOW_SEC}s rolling</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="stats-chart dm-chart" role="img" aria-label="Damage per second over the fight">
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line className="grid" x1={L} x2={W - 6} y1={y(max * f)} y2={y(max * f)} />
            <text x={L - 4} y={y(max * f) + 4} textAnchor="end">
              {fmtRate(max * f)}
            </text>
          </g>
        ))}
        <line className="grid" x1={L} x2={W - 6} y1={y(0)} y2={y(0)} />
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 4} textAnchor="middle">
            {fmtClock(t)}
          </text>
        ))}
        {shown.map((s) => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.key === 'inc' ? 1.2 : 1.8} opacity={s.key === 'inc' ? 0.8 : 1} />
        ))}
      </svg>
      <div className="row tight small">
        {series
          .filter((s) => s.any)
          .map((s) => (
            <button
              key={s.key}
              className={`dm-legend${hidden.includes(s.key) ? ' off' : ''}`}
              aria-pressed={!hidden.includes(s.key)}
              onClick={() => setHidden(hidden.includes(s.key) ? hidden.filter((k) => k !== s.key) : [...hidden, s.key])}
              title={hidden.includes(s.key) ? 'Show this line' : 'Hide this line'}
            >
              <i style={{ background: s.color }} /> {s.label}
            </button>
          ))}
      </div>
    </div>
  )
}

function Roster({ snap }: { snap: CombatSnapshot }) {
  const [name, setName] = useState('')
  const add = () => {
    if (!name.trim()) return
    void act('combat:addMember', name.trim())
    setName('')
  }
  const pets = Object.entries(snap.otherPets)
  return (
    <div className="dm-roster">
      <span className="faint small">Group:</span>
      {!snap.roster.length && <span className="faint small">nobody seen joining yet. The log names who joins after you; add anyone already there.</span>}
      {snap.roster.map((m) => (
        <span key={m.name} className="chip" style={{ color: KIND_COLOR.group }} title={m.from === 'log' ? 'Seen joining in the log' : 'Added by you'}>
          {m.name}
          <button className="btn ghost small x-btn" aria-label={`Remove ${m.name}`} onClick={() => void act('combat:removeMember', m.name)}>
            ×
          </button>
        </span>
      ))}
      {pets.map(([pet, owner]) => (
        <span key={pet} className="chip" style={{ color: KIND_COLOR.pet }}>
          {pet} <small className="faint">{kindTag('pet', owner)}</small>
        </span>
      ))}
      <input value={name} placeholder="Add a name" aria-label="Add a group member by name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} style={{ width: 130 }} />
      <button className="btn small" onClick={add} disabled={!name.trim()}>
        Add
      </button>
    </div>
  )
}
