import { clock, duration, num, timeOfDay } from '../../../core/format'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { LIVE, useSegment } from '../combat'
import { EntityBar, HealBar, SkillBar } from '../components/MeterBars'
import {
  attackerRows,
  attackerSkillRows,
  damageRows,
  durationSec,
  fmtRate,
  healSpellRows,
  healTotals,
  healerRows,
  skillRows,
  totalsOf,
  type HealRow,
  type Row,
  type SkillRow
} from '../../../core/combatView'
import type { CombatSnapshot, MeterMode, MeterOverlayOptions, MeterSpan, OverlayConfig, Segment, SegmentSummary, TimerView } from '../../../shared/types'
import type { AchievementTrack, SkillRow as SkillGoalRow, TrackKind, TrackedAchievement } from '../../../shared/tracking'
import { TimerBars, useNow } from '../components/TimerBars'
import { DEFAULT_METER_OPTIONS } from '../../../shared/overlays'

const MODE_NEXT: Record<MeterMode, MeterMode> = { damage: 'incoming', incoming: 'healing', healing: 'damage' }
const MODE_WORD: Record<MeterMode, string> = { damage: 'Damage', incoming: 'Incoming', healing: 'Healing' }

/**
 * Which fight or session the meter shows: a menu drawn inside the overlay. A native <select> would
 * not do: its list is a popup window that needs focus, and overlay windows are never focusable (the
 * game must keep the keyboard), so the list never opened.
 */
function SegmentMenu({
  list,
  span,
  selection,
  live,
  onPick,
  onOpen
}: {
  list: SegmentSummary[]
  span: MeterSpan
  selection: string
  live: Segment | SegmentSummary | null | undefined
  onPick: (id: string) => void
  onOpen: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = (v: boolean) => {
    setOpen(v)
    onOpen(v)
  }
  const pick = (id: string) => {
    onPick(id)
    toggle(false)
  }
  const liveLabel = live ? (span === 'fight' ? 'Live' : 'Now') : 'Last'
  const current = selection === LIVE ? liveLabel : (list.find((s) => s.id === selection)?.name ?? liveLabel)
  return (
    <>
      <button
        className={`dm-ov-btn dm-ov-pick${open ? ' on' : ''}`}
        onClick={() => toggle(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={span === 'fight' ? 'Which fight' : 'Which session'}
        title={current}
      >
        {current} ▾
      </button>
      {open && (
        <>
          <div className="dm-ov-shade" onClick={() => toggle(false)} />
          <div className="dm-ov-menu" role="listbox" aria-label={span === 'fight' ? 'Fights' : 'Sessions'}>
            <button className={selection === LIVE ? 'on' : ''} role="option" aria-selected={selection === LIVE} onClick={() => pick(LIVE)}>
              {liveLabel}
            </button>
            {list.slice(0, 20).map((s) => (
              <button key={s.id} className={s.id === selection ? 'on' : ''} role="option" aria-selected={s.id === selection} onClick={() => pick(s.id)}>
                <span className="dm-ov-menu-time">{timeOfDay(s.startedAt)}</span>
                <span className="dm-ov-menu-name">{s.name}</span>
                <span className="dm-ov-menu-dps">{fmtRate(s.dps)}</span>
              </button>
            ))}
            {!list.length && <div className="dm-ov-empty">No {span === 'fight' ? 'fights' : 'sessions'} yet</div>}
          </div>
        </>
      )}
    </>
  )
}

/**
 * The damage meter over the game. The window lets clicks through; while the pointer is on the
 * header the page asks for the mouse back, so the header's controls work, and gives it back as the
 * pointer leaves. Unlocking (the pin) keeps the mouse for the whole window, so rows can be clicked
 * into, until it is locked again. An open fight menu keeps it too: the list hangs below the header.
 */
function MeterOverlay({ config, snap, arranging }: { config: OverlayConfig; snap: CombatSnapshot | null; arranging: boolean }) {
  const opts = config.meter ?? DEFAULT_METER_OPTIONS
  const [unlocked, setUnlocked] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const overHead = useRef(false)
  const overMeter = useRef(false)
  const [selection, setSelection] = useState(LIVE)
  const [drill, setDrill] = useState<{ key: string; name: string } | null>(null)
  const seg = useSegment(snap, opts.span, selection)
  const list = opts.span === 'fight' ? (snap?.fights ?? []) : (snap?.sessions ?? [])
  const live = opts.span === 'fight' ? snap?.liveFight : snap?.liveSession

  useEffect(() => setDrill(null), [opts.mode, opts.span, selection])
  useEffect(() => setSelection(LIVE), [opts.span])
  // A locked meter has the mouse only while the pointer is on the header or the fight menu is open;
  // an unlocked one while the pointer is anywhere on it. Never beyond it: the window may be a host
  // that other overlays share. The pointer does not leave the header as a menu closes, so that moment
  // is covered here too.
  const wants = () => menuOpen || overHead.current || (unlocked && overMeter.current)
  useEffect(() => {
    if (!arranging) api.send('overlay:mouse', config.id, menuOpen || overHead.current || (unlocked && overMeter.current))
  }, [unlocked, menuOpen, arranging, config.id])

  const patch = (p: Partial<MeterOverlayOptions>) => api.send('overlay:meter', config.id, p)
  const mouse = (on: boolean) => {
    overHead.current = on
    if (!arranging) api.send('overlay:mouse', config.id, wants())
  }
  const over = (on: boolean) => {
    overMeter.current = on
    if (!arranging) api.send('overlay:mouse', config.id, wants())
  }

  const rows = useMemo<Row[] | HealRow[]>(() => {
    if (!seg) return []
    if (opts.mode === 'damage') return damageRows(seg, opts.scope, opts.combinePet)
    if (opts.mode === 'incoming') return attackerRows(seg, opts.scope)
    return healerRows(seg, opts.scope)
  }, [seg, opts.mode, opts.scope, opts.combinePet])
  const head = seg ? (opts.mode === 'healing' ? healTotals(seg, rows as HealRow[]) : totalsOf(seg, rows)) : null
  const name = seg
    ? seg.kind === 'fight'
      ? (list.find((s) => s.id === seg.id)?.name ?? seg.name ?? 'Fight')
      : seg.name || seg.zone || 'Session'
    : opts.span === 'fight'
      ? 'No fight yet'
      : 'No session yet'
  const shown = rows.slice(0, drill ? 50 : opts.rows)
  const more = rows.length - shown.length

  const drilled = useMemo<SkillRow[] | HealRow[] | null>(() => {
    if (!seg || !drill) return null
    if (opts.mode === 'incoming') return attackerSkillRows(seg, opts.scope, drill.name)
    if (opts.mode === 'healing') return healSpellRows(seg, drill.name)
    const row = (rows as Row[]).find((r) => r.key === drill.key) ?? damageRows(seg, 'everyone', false).find((r) => r.key === drill.key)
    return row ? skillRows(seg, row) : []
  }, [seg, drill, opts.mode, opts.scope, rows])

  const canClick = unlocked || arranging
  const style = { ['--fs' as string]: `${config.fontSize}px` }
  return (
    <div className={`dm-ov${unlocked ? ' unlocked' : ''}`} style={style} onMouseEnter={() => over(true)} onMouseLeave={() => over(false)}>
      {opts.header && (
        <div className="dm-ov-head" onMouseEnter={() => mouse(true)} onMouseLeave={() => mouse(false)}>
          <span className={`status-dot${live?.open ? ' live' : ''}`} title={live?.open ? 'In combat' : 'Idle'} />
          {drill ? (
            <button className="dm-ov-btn" onClick={() => setDrill(null)} title="Back">
              ‹ {drill.name}
            </button>
          ) : (
            <SegmentMenu list={list} span={opts.span} selection={selection} live={live} onPick={setSelection} onOpen={setMenuOpen} />
          )}
          <span className="dm-ov-title" title={name}>
            {name}
          </span>
          <span className="dm-ov-total">
            {head ? (
              <>
                <b>{fmtRate(head.dps)}</b> {opts.mode === 'healing' ? 'HPS' : 'DPS'} · {num(head.total)} · {clock(durationSec(seg!))}
              </>
            ) : (
              '—'
            )}
          </span>
          <span className="dm-ov-tools">
            <button
              className="dm-ov-btn"
              onClick={() => patch({ span: opts.span === 'fight' ? 'session' : 'fight' })}
              title={opts.span === 'fight' ? 'Showing the fight; click for the whole session' : 'Showing the session; click for the fight'}
            >
              {opts.span === 'fight' ? 'Fight' : 'Session'}
            </button>
            <button className="dm-ov-btn" onClick={() => patch({ mode: MODE_NEXT[opts.mode] })} title="Damage → Incoming → Healing">
              {MODE_WORD[opts.mode]}
            </button>
            <button
              className="dm-ov-btn"
              onClick={() => patch({ scope: opts.scope === 'everyone' ? 'group' : opts.scope === 'group' ? 'you' : 'everyone' })}
              title="Everyone → Group → You"
            >
              {opts.scope === 'everyone' ? 'All' : opts.scope === 'group' ? 'Group' : 'You'}
            </button>
            <button className="dm-ov-btn" onClick={() => void api.invoke('combat:newSession').catch(() => {})} title="Start a new session from now">
              ⚑
            </button>
            <button
              className={`dm-ov-btn${unlocked ? ' on' : ''}`}
              onClick={() => setUnlocked(!unlocked)}
              title={unlocked ? 'Rows can be clicked; lock to let clicks through to the game' : 'Unlock to click rows for their breakdown'}
            >
              {unlocked ? '🔓' : '📌'}
            </button>
          </span>
        </div>
      )}
      <div className="dm-ov-rows">
        {!seg && <div className="dm-ov-empty">{snap?.reading ? 'Reading the log…' : 'Waiting for combat…'}</div>}
        {seg && drilled
          ? opts.mode === 'healing'
            ? (drilled as HealRow[]).map((h, i) => <HealBar key={h.key} h={h} rank={i + 1} />)
            : (drilled as SkillRow[]).map((s, i) => <SkillBar key={s.key} s={s} rank={i + 1} />)
          : opts.mode === 'healing'
            ? (shown as HealRow[]).map((h, i) => <HealBar key={h.key} h={h} rank={i + 1} onClick={canClick ? () => setDrill({ key: h.key, name: h.name }) : undefined} />)
            : (shown as Row[]).map((r, i) => <EntityBar key={r.key} r={r} rank={i + 1} onClick={canClick ? () => setDrill({ key: r.key, name: r.name }) : undefined} />)}
        {seg && !drilled && !rows.length && <div className="dm-ov-empty">Nothing yet in this {seg.kind}.</div>}
        {more > 0 && <div className="dm-ov-more">+{more} more</div>}
      </div>
      <div className="dm-ov-foot">
        {opts.scope} · {opts.span === 'fight' ? 'fight' : 'session'}
      </div>
    </div>
  )
}

/** How long a Slayer count stays on the achievements overlay after a kill moved it. */
const SLAYER_RECENT_MS = 30 * 60_000
/** Slayer counts, and skills, shown at most each. */
const SLAYER_ROWS = 3
/** Tracked achievements shown at most, and the objectives or skills of each. */
const TRACKED_ROWS = 5
const TRACKED_LINES = 3

const UNITS: Record<TrackKind, [string, string]> = { kill: ['kill', 'kills'], turnin: ['hand-in', 'hand-ins'], quest: ['hand-in', 'hand-ins'] }

/** What a step has the player do, in a few words: "Kill a gnoll, …", "Hand in to Mojax Hikspin", "Message Intercept: hand in to Raltur Caliskon". */
const doing = (s: { kind: TrackKind; title: string; npc?: string }) =>
  s.kind === 'kill' ? `Kill ${s.title}` : s.kind === 'turnin' ? `Hand in to ${s.npc ?? s.title}` : s.npc ? `${s.title}: hand in to ${s.npc}` : s.title

/**
 * The achievements overlay: the achievements the player tracks (the star on the Achievements page),
 * the step of the faction plan being followed, counting down as the factions move, the Slayer counts
 * the kills of the last half hour moved, and the skills the skill achievements want that went up in
 * that time. It draws nothing while there is nothing to show, so it costs no room over the game.
 */
function AchievementsRegion({ config, track, arranging }: { config: OverlayConfig; track: AchievementTrack | null; arranging: boolean }) {
  const now = useNow(15_000)
  const style = { ['--fs' as string]: `${config.fontSize}px` }
  // Hidden from this overlay at the player's choice; the plan is followed (and spoken) all the same.
  const plan = config.achievements?.factionPlan === false ? null : (track?.faction ?? null)
  const tracked = track?.tracked ?? []
  const trackedNames = new Set(tracked.map((t) => t.name))
  const trackedSkills = new Set(tracked.flatMap((t) => (t.done ? [] : (t.skills ?? []).map((k) => k.skill))))
  // What is tracked shows in its own place, not again among what moved lately.
  const slayer = (track?.slayer?.rows ?? []).filter((r) => r.since > 0 && now - r.last < SLAYER_RECENT_MS && !trackedNames.has(r.name)).sort((a, b) => b.last - a.last)
  // Skills the open skill achievements want that went up lately, once each however many achievements want them.
  const skills = [
    ...(track?.skills?.rows ?? [])
      .filter((r) => r.value !== null && r.target > 0 && now - r.last < SLAYER_RECENT_MS && !trackedNames.has(r.achievement) && !trackedSkills.has(r.skill))
      .reduce((m, r) => {
        const had = m.get(r.skill)
        m.set(r.skill, { ...r, target: Math.max(r.target, had?.target ?? 0), wants: [...(had?.wants ?? []), r.achievement] })
        return m
      }, new Map<string, SkillGoalRow & { wants: string[] }>())
      .values()
  ].sort((a, b) => b.last - a.last)
  const step = plan?.current ?? null
  // Shown on purpose and empty would look broken; one faint line says what it waits for.
  if (!tracked.length && !plan && !slayer.length && !skills.length)
    return (
      <div className="ach-ov" style={style}>
        <div className="ach-ov-empty">
          {arranging
            ? 'Tracked achievements, the faction plan’s step, and the Slayer counts and skills your kills move show here.'
            : track?.faction
              ? 'Nothing tracked. The faction plan is hidden from this overlay (Overlays).'
              : 'Nothing tracked. Track an achievement, or show your faction plan here from Factions › Plan.'}
        </div>
      </div>
    )
  return (
    <div className="ach-ov" style={style}>
      {tracked.length > 0 && (
        <section className="ach-ov-tracked">
          <div className="ach-ov-head">
            <span>Tracked</span>
            {tracked.length > TRACKED_ROWS && <span className="ach-ov-faint">+{tracked.length - TRACKED_ROWS} more</span>}
          </div>
          {tracked.slice(0, TRACKED_ROWS).map((t) => (
            <TrackedRow key={t.key} t={t} now={now} />
          ))}
        </section>
      )}
      {plan && (
        <section className="ach-ov-plan">
          <div className="ach-ov-head">
            <span>Faction plan</span>
            <span className="ach-ov-faint">
              {plan.done} of {plan.steps} steps done
            </span>
          </div>
          {step ? (
            <>
              <div className="ach-ov-step now">
                <div className="ach-ov-tag">Now · step {step.index + 1}</div>
                <div className="ach-ov-title" title={doing(step)}>
                  {doing(step)}
                </div>
                <div className="ach-ov-faint">{step.zone}</div>
                <div className="ach-ov-bar">
                  <i style={{ width: `${Math.round(step.progress * 100)}%` }} />
                </div>
                <div className="ach-ov-line">
                  <b>{step.unitsLeft.toLocaleString()}</b> {UNITS[step.kind][step.unitsLeft === 1 ? 0 : 1]} left
                  {step.secondsLeft > 0 && <span className="ach-ov-faint"> · ≈ {duration(step.secondsLeft)}</span>}
                </div>
                {step.goals
                  .filter((g) => !g.done)
                  .slice(0, 3)
                  .map((g) => (
                    <div key={g.faction} className="ach-ov-goal">
                      <span>{g.achievement ?? g.faction}</span>
                      <span className="ach-ov-num">
                        {Math.round(g.standing).toLocaleString()} / {g.to.toLocaleString()}
                      </span>
                    </div>
                  ))}
              </div>
              {plan.next ? (
                <div className="ach-ov-step next">
                  <div className="ach-ov-tag">Next · step {plan.next.index + 1}</div>
                  <div className="ach-ov-title" title={doing(plan.next)}>
                    {doing(plan.next)}
                  </div>
                  {plan.next.zone && <div className="ach-ov-faint">{plan.next.zone === step.zone ? `${plan.next.zone}, here too` : plan.next.zone}</div>}
                </div>
              ) : (
                <div className="ach-ov-step next">
                  <div className="ach-ov-tag">Last step of the plan</div>
                </div>
              )}
            </>
          ) : (
            <div className="ach-ov-line">Every step is done.</div>
          )}
        </section>
      )}
      {slayer.length > 0 && (
        <section className="ach-ov-slayer">
          <div className="ach-ov-head">
            <span>Slayer</span>
            <span className="ach-ov-faint">since your export</span>
          </div>
          {slayer.slice(0, SLAYER_ROWS).map((r) => {
            const n = Math.min(r.max, r.count + r.since)
            return (
              <div key={r.name} className="ach-ov-count" title={`${r.races}: ${r.count.toLocaleString()} at your achievements export, +${r.since.toLocaleString()} since`}>
                <div className="ach-ov-goal">
                  <span>
                    {r.done ? '✓ ' : ''}
                    {r.name}
                  </span>
                  <span className="ach-ov-num">
                    {n.toLocaleString()} / {r.max.toLocaleString()} <span className="ach-ov-plus">+{r.since.toLocaleString()}</span>
                  </span>
                </div>
                <div className="ach-ov-bar thin">
                  <i style={{ width: `${Math.round((n / r.max) * 100)}%` }} />
                </div>
              </div>
            )
          })}
        </section>
      )}
      {skills.length > 0 && (
        <section className="ach-ov-skills">
          <div className="ach-ov-head">
            <span>Skills</span>
            <span className="ach-ov-faint">to the cap at {skills[0].level}</span>
          </div>
          {skills.slice(0, SLAYER_ROWS).map((r) => {
            const v = Math.min(r.value ?? 0, r.target)
            return (
              <div key={r.skill} className="ach-ov-count" title={r.wants.join('\n')}>
                <div className="ach-ov-goal">
                  <span>
                    {v >= r.target ? '✓ ' : ''}
                    {r.skill}
                  </span>
                  <span className="ach-ov-num">
                    {(r.value ?? 0).toLocaleString()} / {r.target.toLocaleString()}
                  </span>
                </div>
                <div className="ach-ov-bar thin">
                  <i style={{ width: `${Math.round((v / r.target) * 100)}%` }} />
                </div>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}

/** One tracked achievement on the overlay, with its progress in whatever way it has one. */
function TrackedRow({ t, now }: { t: TrackedAchievement; now: number }) {
  if (t.done)
    return (
      <div className="ach-ov-goal ach-ov-done">
        <span>✓ {t.name}</span>
        <span className="ach-ov-faint">done</span>
      </div>
    )
  if (t.count) {
    const c = t.count
    const filled = c.faction ? (c.value + 2000) / 4000 : c.value / Math.max(1, c.max)
    return (
      <div className="ach-ov-count" title={c.faction ? `${c.faction}: done at 2000` : t.section}>
        <div className="ach-ov-goal">
          <span>{t.name}</span>
          <span className="ach-ov-num">
            {c.value.toLocaleString()} / {c.max.toLocaleString()}
            {!!c.since && <span className="ach-ov-plus"> +{c.since.toLocaleString()}</span>}
          </span>
        </div>
        <div className="ach-ov-bar thin">
          <i style={{ width: `${Math.max(0, Math.min(100, Math.round(filled * 100)))}%` }} />
        </div>
      </div>
    )
  }
  if (t.skills) {
    const open = t.skills.filter((k) => k.value === null || k.value < k.target)
    return (
      <div className="ach-ov-count" title={t.section}>
        <div className="ach-ov-goal">
          <span>{t.name}</span>
          <span className="ach-ov-faint">
            {t.skills.length - open.length} / {t.skills.length}
          </span>
        </div>
        {open.slice(0, TRACKED_LINES).map((k) => (
          <div key={k.skill} className="ach-ov-sub">
            <div className="ach-ov-goal">
              <span>{k.skill}</span>
              <span className="ach-ov-num">{k.value === null ? 'not in your logs' : `${k.value.toLocaleString()} / ${k.target.toLocaleString()}`}</span>
            </div>
            {k.value !== null && (
              <div className="ach-ov-bar thin skill">
                <i style={{ width: `${Math.min(100, Math.round((k.value / Math.max(1, k.target)) * 100))}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }
  const left = t.left ?? []
  const fresh = (t.justDone ?? []).filter((x) => now - x.at < SLAYER_RECENT_MS)
  return (
    <div className="ach-ov-count" title={left.join('\n')}>
      <div className="ach-ov-goal">
        <span>{t.name}</span>
        <span className="ach-ov-faint">{t.total ? `${left.length} of ${t.total} left` : ''}</span>
      </div>
      {fresh.slice(0, 2).map((x) => (
        <div key={x.name} className="ach-ov-sub ach-ov-plus">
          ✓ {x.name}
        </div>
      ))}
      {left.length > 0 && (
        <div className="ach-ov-sub ach-ov-left">
          {left.slice(0, TRACKED_LINES).join(', ')}
          {left.length > TRACKED_LINES ? ` +${left.length - TRACKED_LINES}` : ''}
        </div>
      )}
    </div>
  )
}

/** Lines of text that fade on their own (the alerts overlay), in a host window. */
function AlertsRegion({ config }: { config: OverlayConfig }) {
  const [alerts, setAlerts] = useState<{ id: number; text: string; color: string; until: number }[]>([])
  useEffect(
    () =>
      api.on('overlay:alert', (a: { text: string; color: string; durationSec: number }) => {
        const id = Date.now() + Math.random()
        setAlerts((list) => [...list.slice(-5), { id, text: a.text, color: a.color || '#ffd84d', until: Date.now() + (a.durationSec || 5) * 1000 }])
      }),
    []
  )
  useEffect(() => {
    if (!alerts.length) return
    const t = setInterval(() => setAlerts((list) => list.filter((a) => a.until > Date.now())), 250)
    return () => clearInterval(t)
  }, [alerts.length])
  return (
    <div className="alerts">
      {alerts.map((a) => (
        <div key={a.id} className="alert-line" style={{ color: a.color, fontSize: config.fontSize }}>
          {a.text}
        </div>
      ))}
    </div>
  )
}

/**
 * What an overlay draws, by its kind: the one place a kind is matched to its region, for a host and
 * for an overlay's own window while arranging. `timers` are the overlay's own already.
 */
export function OverlayRegion({
  config,
  timers,
  combat,
  track,
  arranging
}: {
  config: OverlayConfig
  timers: TimerView[]
  combat: CombatSnapshot | null
  track: AchievementTrack | null
  arranging: boolean
}) {
  switch (config.kind) {
    case 'timers':
      return <TimerBars timers={timers} grouped={config.groupByTarget} fontSize={config.fontSize} />
    case 'meter':
      return <MeterOverlay config={config} snap={combat} arranging={arranging} />
    case 'achievements':
      return <AchievementsRegion config={config} track={track} arranging={arranging} />
    case 'alerts':
      return <AlertsRegion config={config} />
  }
}
