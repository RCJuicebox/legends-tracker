import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state'
import { act, showToast, actDone } from '../toast'
import { useRemembered } from '../remember'
import { LIVE, useCombat, useSegment } from '../combat'
import { useInvoke } from '../hooks'
import { ConfirmButton, Icon, Info, Segmented } from './ui'
import { EntityBar, HealBar, HEAL_COLOR, KIND_COLOR, PROC_COLOR, PROC_HINT, PROC_WORD, SkillBar, kindTag } from './MeterBars'
import {
  attackerRows, attackerSkillRows, copyText, damageRows, defenseOf, durationSec, fmtClock, fmtNum, fmtPct, fmtRate,
  healSpellRows, healTargetRows, healTotals, healedRows, healerRows, MIN_PROC_ACTIVE_SEC, procAmount, procRows, procSummary, procText, rolling, skillRows, sourcesFor, takenRows, targetRows, totalsOf,
  type HealRow, type Row
} from '../../../core/combatView'
import type { CombatSnapshot, Defense, MeterMode, MeterScope, MeterSpan, Segment, SegmentSummary } from '../../../shared/types'

// The damage meter on the Damage Meter page: one segment (the fight or the session) read three ways
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

export function Meter({ standalone = false }: { standalone?: boolean }) {
  const { state, patchSettings } = useApp()
  const snap = useCombat()
  const [span, setSpan] = useRemembered<MeterSpan>('meter.span', 'fight')
  const [mode, setMode] = useRemembered<MeterMode>('meter.mode', 'damage')
  const [scope, setScope] = useRemembered<MeterScope>('meter.scope', 'everyone')
  const [active, setActive] = useRemembered<boolean>('meter.active', false)
  const [selection, setSelection] = useState(LIVE)
  const [drill, setDrill] = useState<Drill>(null)
  const [compareId, setCompareId] = useState('')
  const combinePet = state.settings.combat.combinePet
  const seg = useSegment(snap, span, selection)

  // A new span or mode starts at the top; a new segment keeps the drill, so a name can be followed across fights.
  useEffect(() => setDrill(null), [span, mode])
  useEffect(() => setSelection(LIVE), [span])
  useEffect(() => setCompareId(''), [span])

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
        {standalone ? (
          <span className="row tight">
            {snap?.reading && <span className="chip warn">{snap.reading}</span>}
            {live?.open && span === 'fight' && <span className="chip ok">in combat</span>}
          </span>
        ) : (
          <h2 className="m-0">
            Damage meter
            {snap?.reading && <span className="chip warn">{snap.reading}</span>}
            {live?.open && span === 'fight' && <span className="chip ok">in combat</span>}
          </h2>
        )}
        <span className="spacer" />
        <button className="btn small" onClick={() => void actDone('New session started.', 'combat:newSession')} title="Close the current session and start a new one counting from now">
          <Icon name="flag" /> New session
        </button>
        <button className="btn small" onClick={copy} disabled={!seg} title="Copy this list as text, for chat or a note">
          <Icon name="copy" /> Copy
        </button>
      </div>
      <div className="dm-controls">
        <Segmented value={span} options={[['fight', 'Fight'], ['session', 'Overall']]} onChange={setSpan} label="Fight or session" />
        <SegmentPicker list={list} span={span} selection={selection} onChange={setSelection} live={live} />
        {span === 'fight' && list.length > 1 && (
          <select className="dm-pick" value={compareId} onChange={(e) => setCompareId(e.target.value)} aria-label="Compare with another fight">
            <option value="">Compare with…</option>
            {list
              .filter((s) => s.id !== seg?.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {when(s.startedAt)} · {s.name} · {fmtRate(s.dps)} DPS
                </option>
              ))}
          </select>
        )}
        <Segmented value={scope} options={SCOPES} onChange={setScope} label="Whose rows" />
        <Segmented value={mode} options={MODES} onChange={setMode} label="What to list" />
        <span className="spacer" />
        <label className="check small" title="Fold each pet's damage into its owner's row">
          <input type="checkbox" checked={combinePet} onChange={(e) => patchSettings((s) => ({ ...s, combat: { ...s.combat, combinePet: e.target.checked } }))} />
          Pets with owners
        </label>
        <label className="check small">
          <input type="checkbox" checked={state.settings.combat.charmPets} onChange={(e) => patchSettings((s) => ({ ...s, combat: { ...s.combat, charmPets: e.target.checked } }))} />
          Charm pets
          <Info
            label="About charm pets"
            text="Counts a mob charmed by you or a groupmate as that player's pet. The log names a charm pet as the mob, so this is a guess: it goes wrong when two people charm mobs of one name (their pets then share a row), or when mobs of the pet's name fight other mobs. Turning it on or off reads the last hour of the log again."
          />
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
          {compareId && compareId !== seg.id ? (
            <ComparePane seg={seg} name={name} otherId={compareId} mode={mode} scope={scope} combinePet={combinePet} active={active} close={() => setCompareId('')} />
          ) : (
          <div className="dm-body">
            <div className="dm-main">
              {!drill && rows.length > 0 && <p className="hint">Click a row to see what it did, skill by skill.</p>}
              {mode === 'damage' && <DamagePane seg={seg} rows={rows as Row[]} drill={drill} setDrill={setDrill} active={active} scope={scope} />}
              {mode === 'incoming' && <IncomingPane seg={seg} rows={rows as Row[]} drill={drill} setDrill={setDrill} scope={scope} active={active} />}
              {mode === 'healing' && <HealingPane seg={seg} rows={rows as HealRow[]} drill={drill} setDrill={setDrill} />}
            </div>
            <div className="dm-side">
              {mode === 'damage' && <TargetsCard seg={seg} scope={scope} drill={drill} setDrill={setDrill} />}
              {mode !== 'incoming' && <ProcsCard seg={seg} scope={scope} name={name} />}
              {mode === 'incoming' && <DefenseCard d={defenseOf(seg, scope)} scope={scope} />}
              {mode === 'incoming' && <TakenCard seg={seg} scope={scope} />}
              {mode === 'healing' && <HealedCard seg={seg} scope={scope} />}
              {mode !== 'healing' && <DpsChart seg={seg} />}
            </div>
          </div>
          )}
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

/** The rows a mode lists, in one shape for comparing: a name, its rate and its total. */
function comparable(seg: Segment, mode: MeterMode, scope: MeterScope, combinePet: boolean, active: boolean) {
  if (mode === 'healing') return healerRows(seg, scope).map((h) => ({ key: h.key, name: h.name, rate: h.hps, total: h.total }))
  const rows = mode === 'incoming' ? attackerRows(seg, scope) : damageRows(seg, scope, combinePet)
  return rows.map((r) => ({ key: r.key, name: r.name, rate: active ? r.activeDps : r.dps, total: r.total }))
}

/** Two fights side by side: everyone in either, their rate and total in each, and the change. */
function ComparePane({ seg, name, otherId, mode, scope, combinePet, active, close }: {
  seg: Segment; name: string; otherId: string; mode: MeterMode; scope: MeterScope; combinePet: boolean; active: boolean; close: () => void
}) {
  const other = useInvoke('combat:segment', [otherId], [otherId]).data
  const rows = useMemo(() => {
    if (!other) return []
    const a = comparable(seg, mode, scope, combinePet, active)
    const b = new Map(comparable(other, mode, scope, combinePet, active).map((r) => [r.key, r]))
    const keys = [...new Set([...a.map((r) => r.key), ...b.keys()])]
    const byKey = new Map(a.map((r) => [r.key, r]))
    return keys
      .map((k) => ({ key: k, name: byKey.get(k)?.name ?? b.get(k)!.name, now: byKey.get(k), then: b.get(k) }))
      .sort((x, y) => (y.now?.total ?? 0) + (y.then?.total ?? 0) - ((x.now?.total ?? 0) + (x.then?.total ?? 0)))
      .slice(0, 20)
  }, [seg, other, mode, scope, combinePet, active])
  const unit = mode === 'healing' ? 'HPS' : 'DPS'
  const change = (now?: { rate: number }, then?: { rate: number }) => {
    if (!now || !then || !then.rate) return now && !then ? 'new' : then && !now ? 'gone' : '—'
    const pct = (now.rate - then.rate) / then.rate
    return `${pct >= 0 ? '+' : '−'}${fmtPct(Math.abs(pct))}`
  }
  if (!other) return <div className="empty">Reading the other fight…</div>
  return (
    <div className="dm-compare">
      <div className="row">
        <span className="small muted">
          <b>{name}</b> ({fmtClock(durationSec(seg))}, {seg.kills} kill{seg.kills === 1 ? '' : 's'}) against <b>{other.name}</b> ({fmtClock(durationSec(other))}, {other.kills} kill
          {other.kills === 1 ? '' : 's'}), {mode === 'incoming' ? 'damage taken' : mode === 'healing' ? 'healing' : 'damage dealt'}
          {active && mode !== 'healing' ? ', active' : ''}
        </span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={close}>
          Stop comparing
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Who</th>
            <th className="num">This fight</th>
            <th className="num">The other</th>
            <th className="num" title={`The change in ${unit} from the other fight to this one`}>Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.name}</td>
              <td className="num mono">{r.now ? `${fmtRate(r.now.rate)} ${unit} · ${fmtNum(r.now.total)}` : '—'}</td>
              <td className="num mono">{r.then ? `${fmtRate(r.then.rate)} ${unit} · ${fmtNum(r.then.total)}` : '—'}</td>
              <td className="num mono">{change(r.now, r.then)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

/** One entity's damage at a glance, above its skills: what the row's hover title used to hold. */
function EntityStats({ row }: { row: Row }) {
  const swings = row.hits + row.misses
  return (
    <div className="row gap-12 dm-entity-stats">
      <span className="dm-kv">
        <b>{fmtNum(row.total)}</b> damage
      </span>
      <span className="dm-kv">
        <b>{fmtRate(row.dps)}</b> DPS
      </span>
      {row.activeDps > 0 && row.activeDps !== row.dps && (
        <span className="dm-kv" title="Over the time spent striking: gaps between hits capped at 3 s">
          <b>{fmtRate(row.activeDps)}</b> while striking
        </span>
      )}
      <span className="dm-kv">
        <b>{row.hits}</b> hits
      </span>
      {row.hits > 0 && (
        <span className="dm-kv">
          <b>{fmtPct(row.crits / row.hits)}</b> crit
        </span>
      )}
      {row.misses > 0 && (
        <span className="dm-kv" title={`${row.misses} of ${swings} swings missed`}>
          <b>{fmtPct(row.hits / swings)}</b> landed
        </span>
      )}
      {row.max > 0 && (
        <span className="dm-kv">
          <b>{fmtNum(row.max)}</b> best
        </span>
      )}
      <span className="dm-kv">
        <b>{fmtPct(row.share)}</b> of the damage
      </span>
    </div>
  )
}

function DamagePane({ seg, rows, drill, setDrill, active, scope }: { seg: Segment; rows: Row[]; drill: Drill; setDrill: (d: Drill) => void; active: boolean; scope: MeterScope }) {
  if (drill?.kind === 'entity') {
    const row = rows.find((r) => r.key === drill.key) ?? damageRows(seg, 'everyone', false).find((r) => r.key === drill.key)
    const skills = row ? skillRows(seg, row) : []
    return (
      <>
        <Crumb text={`${drill.name} · back to everyone`} back={() => setDrill(null)} />
        {row && <EntityStats row={row} />}
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

function ProcsCard({ seg, scope, name }: { seg: Segment; scope: MeterScope; name: string }) {
  const rows = useMemo(() => procRows(seg, scope), [seg, scope])
  const sum = useMemo(() => procSummary(seg, scope, rows), [seg, scope, rows])
  const copy = () =>
    navigator.clipboard.writeText(procText(seg, scope, name)).then(
      () => showToast('Copied to the clipboard'),
      () => showToast('Could not copy', { tone: 'bad' })
    )
  return (
    <div className="dm-aux">
      <div className="dm-aux-head">
        <span>
          Procs{' '}
          <Info
            label="About procs"
            text={`An effect that landed with no cast line behind it: a weapon proc, a buff's proc, an item. Rated per minute of the source's active combat time (gaps between hits capped at 3 s), withheld under ${MIN_PROC_ACTIVE_SEC} s of it. Abilities you press print the same way and are marked. (Finishing Blow) swings count as the AA.`}
          />
        </span>
        <span className="row tight">
          {rows.length > 0 && (
            <span className="faint small">
              {sum.count} firing{sum.count === 1 ? '' : 's'}
              {sum.ppm !== null ? ` · ${sum.ppm.toFixed(1)}/min` : ''}
            </span>
          )}
          {rows.length > 0 && (
            <button className="btn ghost small x-btn" onClick={copy} title="Copy this list as text" aria-label="Copy the proc list">
              <Icon name="copy" />
            </button>
          )}
        </span>
      </div>
      {!rows.length && <div className="faint small">Nothing has fired on its own yet.</div>}
      {rows.slice(0, 12).map((r) => (
        <div key={r.key} className="dm-procrow" title={`${PROC_HINT[r.origin]}${r.ppm === null ? ` No rate yet: that needs ${MIN_PROC_ACTIVE_SEC} s of active combat.` : ''}`}>
          <i className="dm-dot" style={{ background: PROC_COLOR[r.origin] }} />
          <span className="dm-name">
            {r.name}
            {r.sourceKind !== 'you' && <em className="dm-tag">{r.source}</em>}
            <em className="dm-tag" style={{ color: PROC_COLOR[r.origin] }}>
              {PROC_WORD[r.origin]}
            </em>
          </span>
          <span className="dm-right">
            {r.ppm === null ? '–' : `${r.ppm.toFixed(1)}/min`} · <b>×{r.count}</b> · {procAmount(r)}
          </span>
        </div>
      ))}
      {rows.length > 12 && <div className="faint small">+{rows.length - 12} more</div>}
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
  const session = seg.kind === 'session'
  // A session's chart is its fights end to end, from the main process; asked again at most every
  // ten seconds while the session runs.
  const stitched = useInvoke(session ? 'combat:sessionTimeline' : null, [seg.id], [session && seg.open ? Math.floor(seg.endedAt / 10_000) : 0]).data
  const tl = session ? stitched : seg.timeline
  const seconds = Math.max(1, session ? (stitched?.you.length ?? 0) : Math.ceil(durationSec(seg)))
  const marks = session ? (stitched?.marks ?? []) : []
  const series = useMemo(() => {
    if (!tl) return null
    return LINES.map((l) => ({ ...l, values: rolling(tl[l.key], seconds, WINDOW_SEC), any: tl[l.key].some((v) => v > 0) }))
  }, [tl, seconds])
  if (!series || (session && !marks.length)) {
    return (
      <div className="dm-aux">
        <div className="dm-aux-head">DPS over time</div>
        <div className="faint small">{session ? 'No fights in this session yet.' : 'Nothing to chart yet.'}</div>
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
        DPS over time <span className="faint small">{session ? `${marks.length} fight${marks.length === 1 ? '' : 's'} end to end · ` : ''}{WINDOW_SEC}s rolling</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="stats-chart dm-chart" role="img" aria-label={session ? 'Damage per second over the fights of this session, end to end' : 'Damage per second over the fight'}>
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
        {marks.slice(1).map((m) => (
          <line key={m.at} className="dm-chart-mark" x1={x(m.at)} x2={x(m.at)} y1={6} y2={H - B}>
            <title>{m.name}</title>
          </line>
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
      {snap.roster.length > 0 && (
        <ConfirmButton
          className="btn ghost small"
          question="Forget everyone in the group?"
          title="Forget everyone in the group; the log fills it again as people join, or add them by name"
          onConfirm={() => void act('combat:clearGroup')}
        >
          Reset group
        </ConfirmButton>
      )}
    </div>
  )
}
