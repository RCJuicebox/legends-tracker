import { clock, timeOfDay } from '../../../core/format'
import { useEffect, useMemo, useState } from 'react'
import { useActions, useLive, useSettled } from '../state'
import { showToast, actDone } from '../toast'
import { useRemembered } from '../remember'
import { LIVE, useCombat, useSegment } from '../combat'
import { Icon, Info, Segmented, Switch } from './ui'
import { attackerRows, copyText, damageRows, defenseOf, fmtRate, healTotals, healerRows, sourcesFor, totalsOf, type HealRow, type Row } from '../../../core/combatView'
import type { MeterMode, MeterScope, MeterSpan, Segment, SegmentSummary } from '../../../shared/types'
import { DpsChart } from './MeterChart'
import { ComparePane } from './MeterCompare'
import { DamagePane, DefenseCard, Headline, HealedCard, HealingPane, IncomingPane, ProcsCard, TakenCard, TargetsCard, type Drill } from './MeterPanes'
import { KIND_TEXT, kindTag } from './MeterBars'
import { GroupRoster } from './GroupRoster'

// The damage meter on the Damage Meter page: one segment (the fight or the session) read three ways
// (damage out, damage in, healing), the rows clickable down into skills, targets and attackers.

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

function SegmentPicker({
  list,
  span,
  selection,
  onChange,
  live
}: {
  list: SegmentSummary[]
  span: MeterSpan
  selection: string
  onChange: (id: string) => void
  live: Segment | SegmentSummary | null
}) {
  const liveLabel = span === 'fight' ? (live ? 'Live fight' : list[0] ? 'Last fight' : 'No fights yet') : 'Current session'
  return (
    <select className="dm-pick" value={selection} onChange={(e) => onChange(e.target.value)} aria-label={span === 'fight' ? 'Which fight' : 'Which session'}>
      <option value={LIVE}>{liveLabel}</option>
      {list.map((s) => (
        <option key={s.id} value={s.id}>
          {timeOfDay(s.startedAt)} · {s.name} · {clock((s.endedAt - s.startedAt) / 1000 + 1)} · {fmtRate(s.dps)} DPS
          {s.mine ? '' : ' · not yours'}
        </option>
      ))}
    </select>
  )
}

export function Meter({ standalone = false }: { standalone?: boolean }) {
  const { patchSettings } = useActions()
  const combat = useSettled((s) => s.settings.combat)
  const watching = useLive((l) => l.status.watching)
  const minutes = combat.historyMinutes || 60
  const snap = useCombat()
  const [span, setSpan] = useRemembered<MeterSpan>('meter.span', 'fight')
  const [mode, setMode] = useRemembered<MeterMode>('meter.mode', 'damage')
  const [scope, setScope] = useRemembered<MeterScope>('meter.scope', 'everyone')
  const [active, setActive] = useRemembered<boolean>('meter.active', false)
  const [selection, setSelection] = useState(LIVE)
  const [drill, setDrill] = useState<Drill>(null)
  const [compareId, setCompareId] = useState('')
  const combinePet = combat.combinePet
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
        <button
          className="btn small"
          onClick={() => void actDone('New session started.', 'combat:newSession')}
          title="Close the current session and start a new one counting from now"
        >
          <Icon name="flag" /> New session
        </button>
        <button className="btn small" onClick={copy} disabled={!seg} title="Copy this list as text, for chat or a note">
          <Icon name="copy" /> Copy
        </button>
      </div>
      <div className="dm-controls">
        <Segmented
          value={span}
          options={[
            ['fight', 'Fight'],
            ['session', 'Session']
          ]}
          onChange={setSpan}
          label="Fight or session"
        />
        <SegmentPicker list={list} span={span} selection={selection} onChange={setSelection} live={live} />
        {span === 'fight' && list.length > 1 && (
          <select className="dm-pick" value={compareId} onChange={(e) => setCompareId(e.target.value)} aria-label="Compare with another fight">
            <option value="">Compare with…</option>
            {list
              .filter((s) => s.id !== seg?.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {timeOfDay(s.startedAt)} · {s.name} · {fmtRate(s.dps)} DPS
                </option>
              ))}
          </select>
        )}
        <Segmented value={scope} options={SCOPES} onChange={setScope} label="Whose rows" />
        <Segmented value={mode} options={MODES} onChange={setMode} label="What to list" />
        <span className="spacer" />
        <label className="check small" title="Fold each pet's damage into its owner's row">
          <Switch on={combinePet} onChange={(v) => patchSettings((s) => ({ ...s, combat: { ...s.combat, combinePet: v } }))} />
          Pets with owners
        </label>
        <label className="check small">
          <Switch on={combat.charmPets} onChange={(v) => patchSettings((s) => ({ ...s, combat: { ...s.combat, charmPets: v } }))} />
          Charm pets
          <Info
            label="About charm pets"
            text="Counts a mob charmed by you or a groupmate as that player's pet. The log names a charm pet as the mob, so this is a guess: it goes wrong when two people charm mobs of one name (their pets then share a row), or when mobs of the pet's name fight other mobs. Turning it on or off reads the last hour of the log again."
          />
        </label>
        <label className="check small" title="Rate over the time actually spent hitting (gaps between hits capped at 3 s) instead of the whole fight">
          <Switch on={active} onChange={(v) => setActive(v)} />
          Active DPS
        </label>
      </div>
      {/* The group, as Buffs' Your group shows it too, with the group-mates' pets the log has owned. */}
      {scope === 'group' && snap && (
        <GroupRoster members={snap.roster} compact>
          {Object.entries(snap.otherPets).map(([pet, owner]) => (
            <span key={pet} className="chip" style={{ color: KIND_TEXT.pet }}>
              {pet} <small className="faint">{kindTag('pet', owner)}</small>
            </span>
          ))}
        </GroupRoster>
      )}

      {!seg ? (
        <div className="empty">
          {snap?.reading ? (
            'Reading recent fights from the log…'
          ) : watching ? (
            <>
              No fights in the last {minutes} minutes of the log. Hit something and it appears here, or{' '}
              <button className="link-button inline" onClick={() => void actDone('Reading the last 3 hours of the log.', 'combat:rebuild', 180)}>
                read the last 3 hours
              </button>{' '}
              for older ones.
            </>
          ) : (
            `No fights yet. Hit something while watching and it appears here, with the last ${minutes} minutes read from the log at start.`
          )}
        </div>
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
