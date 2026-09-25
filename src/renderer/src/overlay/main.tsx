import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { api } from '../api'
import { TimerBars } from '../components/TimerBars'
import { LIVE, useSegment } from '../combat'
import { EntityBar, HealBar, SkillBar } from '../components/MeterBars'
import { attackerRows, attackerSkillRows, damageRows, durationSec, fmtClock, fmtNum, fmtRate, healSpellRows, healTotals, healerRows, skillRows, totalsOf, type HealRow, type Row, type SkillRow } from '../../../core/combatView'
import type { CombatSnapshot, MeterMode, MeterOverlayOptions, OverlayConfig, TimerView } from '../../../shared/types'

interface Alert {
  id: number
  text: string
  color: string
  until: number
}

const METER_DEFAULTS: MeterOverlayOptions = { mode: 'damage', span: 'fight', scope: 'everyone', rows: 8, combinePet: true, header: true }
const MODE_NEXT: Record<MeterMode, MeterMode> = { damage: 'incoming', incoming: 'healing', healing: 'damage' }
const MODE_WORD: Record<MeterMode, string> = { damage: 'Damage', incoming: 'Incoming', healing: 'Healing' }

function Overlay() {
  const [config, setConfig] = useState<OverlayConfig | null>(null)
  const [arranging, setArranging] = useState(false)
  const [timers, setTimers] = useState<TimerView[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [combat, setCombat] = useState<CombatSnapshot | null>(null)

  useEffect(() => {
    const offs = [
      api.on('overlay:config', (p: { config: OverlayConfig; arranging: boolean }) => {
        setConfig(p.config)
        setArranging(p.arranging)
      }),
      api.on('overlay:timers', (views: TimerView[]) => setTimers(views)),
      api.on('overlay:combat', (snap: CombatSnapshot) => setCombat(snap)),
      api.on('overlay:alert', (a: { text: string; color: string; durationSec: number }) => {
        const id = Math.random()
        setAlerts((list) => [...list.slice(-5), { id, text: a.text, color: a.color || '#ffd84d', until: Date.now() + (a.durationSec || 5) * 1000 }])
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    if (!alerts.length) return
    const id = setInterval(() => setAlerts((list) => list.filter((a) => a.until > Date.now())), 250)
    return () => clearInterval(id)
  }, [alerts.length])

  if (!config) return null
  const mine = timers.filter((t) => t.overlay === config.id)
  return (
    <div className={`overlay${arranging ? ' arranging' : ''}`}>
      {config.kind === 'timers' ? (
        <TimerBars timers={mine} grouped={config.groupByTarget} fontSize={config.fontSize} />
      ) : config.kind === 'meter' ? (
        <MeterOverlay config={config} snap={combat} arranging={arranging} />
      ) : (
        <div className="alerts">
          {alerts.map((a) => (
            <div key={a.id} className="alert-line" style={{ color: a.color, fontSize: config.fontSize }}>
              {a.text}
            </div>
          ))}
          {arranging && !alerts.length && (
            <div className="alert-line" style={{ color: '#ffd84d', fontSize: config.fontSize }}>
              Alert text appears here
            </div>
          )}
        </div>
      )}
      {arranging && <div className="arrange-label">{config.name} — drag to move, drag edges to resize</div>}
    </div>
  )
}

/**
 * The damage meter over the game. The window lets clicks through; while the pointer is on the
 * header the page asks for the mouse back, so the header's controls work, and gives it back as the
 * pointer leaves. Unlocking (the pin) keeps the mouse for the whole window, so rows can be clicked
 * into, until it is locked again.
 */
function MeterOverlay({ config, snap, arranging }: { config: OverlayConfig; snap: CombatSnapshot | null; arranging: boolean }) {
  const opts = config.meter ?? METER_DEFAULTS
  const [unlocked, setUnlocked] = useState(false)
  const [selection, setSelection] = useState(LIVE)
  const [drill, setDrill] = useState<{ key: string; name: string } | null>(null)
  const seg = useSegment(snap, opts.span, selection)
  const list = opts.span === 'fight' ? (snap?.fights ?? []) : (snap?.sessions ?? [])
  const live = opts.span === 'fight' ? snap?.liveFight : snap?.liveSession

  useEffect(() => setDrill(null), [opts.mode, opts.span, selection])
  useEffect(() => setSelection(LIVE), [opts.span])
  // A locked window has the mouse only while the pointer is on the header.
  useEffect(() => {
    if (!arranging) api.send('overlay:mouse', config.id, unlocked)
  }, [unlocked, arranging, config.id])

  const patch = (p: Partial<MeterOverlayOptions>) => api.send('overlay:meter', config.id, p)
  const mouse = (on: boolean) => {
    if (!unlocked && !arranging) api.send('overlay:mouse', config.id, on)
  }

  const rows = useMemo<Row[] | HealRow[]>(() => {
    if (!seg) return []
    if (opts.mode === 'damage') return damageRows(seg, opts.scope, opts.combinePet)
    if (opts.mode === 'incoming') return attackerRows(seg, opts.scope)
    return healerRows(seg, opts.scope)
  }, [seg, opts.mode, opts.scope, opts.combinePet])
  const head = seg ? (opts.mode === 'healing' ? healTotals(seg, rows as HealRow[]) : totalsOf(seg, rows)) : null
  const name = seg ? (seg.kind === 'fight' ? (list.find((s) => s.id === seg.id)?.name ?? seg.name ?? 'Fight') : seg.name || seg.zone || 'Session') : opts.span === 'fight' ? 'No fight yet' : 'No session yet'
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
    <div className={`dm-ov${unlocked ? ' unlocked' : ''}`} style={style}>
      {opts.header && (
        <div className="dm-ov-head" onMouseEnter={() => mouse(true)} onMouseLeave={() => mouse(false)}>
          <span className={`status-dot${live?.open ? ' live' : ''}`} title={live?.open ? 'In combat' : 'Idle'} />
          {drill ? (
            <button className="dm-ov-btn" onClick={() => setDrill(null)} title="Back">
              ‹ {drill.name}
            </button>
          ) : (
            <select className="dm-ov-pick" value={selection} onChange={(e) => setSelection(e.target.value)} aria-label="Which fight" title={name}>
              <option value={LIVE}>{live ? (opts.span === 'fight' ? 'Live' : 'Now') : 'Last'}</option>
              {list.slice(0, 20).map((s) => (
                <option key={s.id} value={s.id}>
                  {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {s.name} · {fmtRate(s.dps)}
                </option>
              ))}
            </select>
          )}
          <span className="dm-ov-title" title={name}>
            {name}
          </span>
          <span className="dm-ov-total">
            {head ? (
              <>
                <b>{fmtRate(head.dps)}</b> {opts.mode === 'healing' ? 'HPS' : 'DPS'} · {fmtNum(head.total)} · {fmtClock(durationSec(seg!))}
              </>
            ) : (
              '—'
            )}
          </span>
          <span className="dm-ov-tools">
            <button className="dm-ov-btn" onClick={() => patch({ span: opts.span === 'fight' ? 'session' : 'fight' })} title={opts.span === 'fight' ? 'Showing the fight; click for the whole session' : 'Showing the session; click for the fight'}>
              {opts.span === 'fight' ? 'Fight' : 'Overall'}
            </button>
            <button className="dm-ov-btn" onClick={() => patch({ mode: MODE_NEXT[opts.mode] })} title="Damage → Incoming → Healing">
              {MODE_WORD[opts.mode]}
            </button>
            <button className="dm-ov-btn" onClick={() => patch({ scope: opts.scope === 'everyone' ? 'group' : opts.scope === 'group' ? 'you' : 'everyone' })} title="Everyone → Group → You">
              {opts.scope === 'everyone' ? 'All' : opts.scope === 'group' ? 'Group' : 'You'}
            </button>
            <button className="dm-ov-btn" onClick={() => void api.invoke('combat:newSession').catch(() => {})} title="Start a new session from now">
              ⚑
            </button>
            <button className={`dm-ov-btn${unlocked ? ' on' : ''}`} onClick={() => setUnlocked(!unlocked)} title={unlocked ? 'Rows can be clicked; lock to let clicks through to the game' : 'Unlock to click rows for their breakdown'}>
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

createRoot(document.getElementById('root')!).render(<Overlay />)
