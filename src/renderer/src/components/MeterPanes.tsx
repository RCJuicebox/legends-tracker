import { clock, num, num1, pct, round } from '../../../core/format'
import { useMemo } from 'react'
import { showToast } from '../toast'
import { Icon, Info } from './ui'
import { EntityBar, HealBar, HEAL_TEXT, PROC_COLOR, PROC_HINT, PROC_TEXT, PROC_WORD, SkillBar } from './MeterBars'
import {
  attackerSkillRows,
  damageRows,
  durationSec,
  fmtRate,
  healSpellRows,
  healTargetRows,
  healedRows,
  MIN_PROC_ACTIVE_SEC,
  procAmount,
  exaltRows,
  procRows,
  procSummary,
  procText,
  skillRows,
  takenRows,
  targetRows,
  totalsOf,
  type HealRow,
  type Row
} from '../../../core/combatView'
import type { Defense, MeterMode, MeterScope, Segment } from '../../../shared/types'

// The damage meter's panes (LT-638): the headline, an entity's numbers, damage, incoming and healing, and the cards beside them.

/** What the meter is drilled into: an entity's breakdown, or a target's. */
export type Drill = null | { kind: 'entity'; key: string; name: string } | { kind: 'target'; name: string }

export function Headline({
  seg,
  name,
  mode,
  head,
  active
}: {
  seg: Segment
  name: string
  mode: MeterMode
  head: ReturnType<typeof totalsOf> & { raw?: number }
  active: boolean
}) {
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
        <span className="dm-big" style={{ color: mode === 'healing' ? HEAL_TEXT : mode === 'incoming' ? 'var(--red-text)' : 'var(--accent-2)' }}>
          {num(rate)} <small>{active && mode !== 'healing' ? `active ${per}` : per}</small>
        </span>
        <span className="dm-kv">
          <b>{num(head.total)}</b> {mode === 'healing' ? 'healed' : mode === 'incoming' ? 'taken' : 'damage'}
        </span>
        {mode === 'healing' && head.raw !== undefined && head.raw > head.total && (
          <span className="dm-kv">
            <b>{pct((head.raw - head.total) / head.raw)}</b> overhealed
          </span>
        )}
        <span className="dm-kv">
          <b>{clock(dur)}</b> {seg.open ? 'so far' : 'long'}
        </span>
        {mode === 'damage' && !active && seg.activeMs > 0 && seg.activeMs < dur * 1000 && (
          <span className="dm-kv" title="Damage over the time spent striking: gaps between hits capped at 3 s">
            <b>{num(head.activeDps)}</b> active DPS
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
            <b>+{num(seg.enemyHeal)}</b> enemy healed
          </span>
        )}
      </div>
    </div>
  )
}

export function Crumb({ text, back }: { text: string; back: () => void }) {
  return (
    <button className="btn ghost small dm-crumb" onClick={back}>
      <Icon name="back" /> {text}
    </button>
  )
}

/** One entity's damage at a glance, above its skills: what the row's hover title used to hold. */
export function EntityStats({ row }: { row: Row }) {
  const swings = row.hits + row.misses
  return (
    <div className="row gap-12 dm-entity-stats">
      <span className="dm-kv">
        <b>{num(row.total)}</b> damage
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
        <b>{row.hits}</b> hit{row.hits === 1 ? '' : 's'}
      </span>
      {row.hits > 0 && (
        <span className="dm-kv">
          <b>{pct(row.crits / row.hits)}</b> crit
        </span>
      )}
      {row.misses > 0 && (
        <span className="dm-kv" title={`${row.misses} of ${swings} swings missed`}>
          <b>{pct(row.hits / swings)}</b> landed
        </span>
      )}
      {row.max > 0 && (
        <span className="dm-kv">
          <b>{num(row.max)}</b> best
        </span>
      )}
      <span className="dm-kv">
        <b>{pct(row.share)}</b> of the damage
      </span>
    </div>
  )
}

export function DamagePane({
  seg,
  rows,
  drill,
  setDrill,
  active,
  scope
}: {
  seg: Segment
  rows: Row[]
  drill: Drill
  setDrill: (d: Drill) => void
  active: boolean
  scope: MeterScope
}) {
  if (drill?.kind === 'entity') {
    const row = rows.find((r) => r.key === drill.key) ?? damageRows(seg, 'everyone', false).find((r) => r.key === drill.key)
    const skills = row ? skillRows(seg, row) : []
    return (
      <>
        <Crumb text={`${drill.name} · back to everyone`} back={() => setDrill(null)} />
        {row && <EntityStats row={row} />}
        {!skills.length && (
          <div className="empty">
            Nothing from {drill.name} in this {seg.kind}.
          </div>
        )}
        {skills.map((s, i) => (
          <SkillBar key={s.key} s={s} rank={i + 1} onClick={s.how === 'pet' ? () => setDrill({ kind: 'entity', key: s.key.slice(2), name: s.name }) : undefined} />
        ))}
      </>
    )
  }
  return (
    <>
      {drill?.kind === 'target' && <Crumb text={`Damage to ${drill.name} · back to all targets`} back={() => setDrill(null)} />}
      {!rows.length && (
        <div className="empty">
          No damage dealt {scope === 'you' ? 'by you' : scope === 'group' ? 'by your group' : ''} in this {seg.kind} yet.
        </div>
      )}
      {rows.map((r, i) => (
        <EntityBar key={r.key} r={r} rank={i + 1} activeDps={active} onClick={() => setDrill({ kind: 'entity', key: r.key, name: r.name })} />
      ))}
    </>
  )
}

export function IncomingPane({
  seg,
  rows,
  drill,
  setDrill,
  scope,
  active
}: {
  seg: Segment
  rows: Row[]
  drill: Drill
  setDrill: (d: Drill) => void
  scope: MeterScope
  active: boolean
}) {
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
      {!rows.length && (
        <div className="empty">
          Nothing has hit {who} in this {seg.kind}.
        </div>
      )}
      {rows.map((r, i) => (
        <EntityBar key={r.key} r={r} rank={i + 1} activeDps={active} onClick={() => setDrill({ kind: 'entity', key: r.key, name: r.name })} />
      ))}
    </>
  )
}

export function HealingPane({ seg, rows, drill, setDrill }: { seg: Segment; rows: HealRow[]; drill: Drill; setDrill: (d: Drill) => void }) {
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

export function TargetsCard({ seg, scope, drill, setDrill }: { seg: Segment; scope: MeterScope; drill: Drill; setDrill: (d: Drill) => void }) {
  const targets = useMemo(() => targetRows(seg, scope), [seg, scope])
  return (
    <div className="dm-aux">
      <div className="dm-aux-head">
        Damage by mob <Info label="About damage by mob" text="Where the listed rows' damage went. Click a mob to see who did what to it." />
      </div>
      {!targets.length && <div className="faint small">Nothing hit yet.</div>}
      {targets.slice(0, 12).map((t, i) => (
        <EntityBar
          key={t.key}
          r={t}
          rank={i + 1}
          selected={drill?.kind === 'target' && drill.name === t.name}
          onClick={() => setDrill(drill?.kind === 'target' && drill.name === t.name ? null : { kind: 'target', name: t.name })}
        />
      ))}
      {targets.length > 12 && <div className="faint small">+{targets.length - 12} more</div>}
    </div>
  )
}

export function ProcsCard({ seg, scope, name }: { seg: Segment; scope: MeterScope; name: string }) {
  const rows = useMemo(() => procRows(seg, scope), [seg, scope])
  const sum = useMemo(() => procSummary(seg, scope, rows), [seg, scope, rows])
  const exalts = useMemo(() => exaltRows(seg), [seg])
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
              {sum.ppm !== null ? ` · ${num1(round(sum.ppm, 1))}/min` : ''}
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
            <em className="dm-tag" style={{ color: PROC_TEXT[r.origin] }}>
              {PROC_WORD[r.origin]}
            </em>
            {r.item && (
              <em className="dm-tag" title="Its exaltation fired in the same second, the last time it did">
                {r.item}
              </em>
            )}
          </span>
          <span className="dm-right">
            {r.ppm === null ? '–' : `${num1(round(r.ppm, 1))}/min`} · <b>×{r.count}</b> · {procAmount(r)}
          </span>
        </div>
      ))}
      {rows.length > 12 && <div className="faint small">+{rows.length - 12} more</div>}
      {exalts.length > 0 && (
        <div className="dm-exalts small">
          <span className="faint" title="Your worn items' exaltation lines, counted whatever they did: most are foci, some fire a proc">
            Exaltations:
          </span>{' '}
          {exalts.map((x, i) => (
            <span key={x.item}>
              {i > 0 && ' · '}
              {x.item} ×{num(x.count)}
              {x.ppm !== null && <span className="faint"> ({num1(round(x.ppm, 1))}/min)</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function DefenseCard({ d, scope }: { d: Defense; scope: MeterScope }) {
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
  const spells = d.spellsResisted > 0 && (
    <div className="faint small" title="Spells cast at you that you resisted outright, or that a mob's cast never landed on you: not swings, so not in the bars">
      {num(d.spellsResisted)} spell{d.spellsResisted === 1 ? '' : 's'} resisted
    </div>
  )
  return (
    <div className="dm-aux">
      <div className="dm-aux-head">
        {scope === 'you' ? 'Your defence' : 'Defence'}
        <span className="faint small">{d.swings ? `${d.swings} swings · ${pct(avoided / d.swings)} avoided` : ''}</span>
      </div>
      {!d.swings && <div className="faint small">Nothing has swung at {scope === 'you' ? 'you' : 'your side'} yet.</div>}
      {spells}
      {d.swings > 0 &&
        rows
          .filter(([, n]) => n > 0)
          .map(([label, n, hint]) => (
            <div key={label} className="lt-bar" title={hint}>
              <span>{label}</span>
              <span className="bar soft">
                <i style={{ width: `${(n / d.swings) * 100}%`, background: label === 'Hit' ? 'var(--red)' : undefined }} />
              </span>
              <b>
                {n} <small className="faint">{pct(n / d.swings)}</small>
              </b>
            </div>
          ))}
    </div>
  )
}

export function TakenCard({ seg, scope }: { seg: Segment; scope: MeterScope }) {
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

export function HealedCard({ seg, scope }: { seg: Segment; scope: MeterScope }) {
  const rows = useMemo(() => healedRows(seg, scope), [seg, scope])
  const runes = Object.values(seg.entities).reduce((s, e) => s + e.runes, 0)
  return (
    <div className="dm-aux">
      <div className="dm-aux-head">Healed</div>
      {!rows.length && <div className="faint small">Nobody has been healed yet.</div>}
      {rows.slice(0, 10).map((h, i) => (
        <HealBar key={h.key} h={h} rank={i + 1} />
      ))}
      {runes > 0 && <div className="faint small mt-12">Runes absorbed {num(runes)} on top.</div>}
      {seg.enemyHeal > 0 && <div className="faint small">Enemies healed themselves for {num(seg.enemyHeal)}.</div>}
    </div>
  )
}
