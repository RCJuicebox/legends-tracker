import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, errorMessage } from '../api'
import { useRemembered } from '../remember'
import { useInvoke } from '../hooks'
import { Pending, Tabs } from '../components/ui'
import { who } from '../../../core/format'
import { readSheet, type StatsSheet } from '../../../core/statsSheet'
import { useExportCharacter, useInventory } from '../gear/model'
import { wornSummary } from '../../../core/wornGear'
import { autoValues, classTrio, primaryClass, valOf } from '../../../core/statsModel'
import { CLASSES, className, type ClassName } from '../../../shared/game/classes'
import { useCharacterRecord, withClasses, withRecord, recordLevel } from '../character'
import { LEVEL_CAP } from '../../../core/buffs'
import { AA_USES, type AaEffect, type AaSummary } from '../../../core/aa'
import type { CharacterSheet } from '../../../shared/types'
import type { SetSheet } from './statsBits'
import { CharacterTab } from './StatsCharacter'
import { AcTab } from './StatsAc'
import { CombatTab } from './StatsCombat'

type Tab = 'character' | 'ac' | 'combat'
const TABS: [Tab, string][] = [
  ['character', 'Character'],
  ['ac', 'AC'],
  ['combat', 'Combat']
]

export function Stats() {
  const exp = useExportCharacter('inventory')
  const { exports, available, character, setCharacter } = exp
  const inv = useInventory(character, !!exports, available.join(','))
  const { view, sheet: charSheet, updateSheet } = inv
  const [tab, setTab] = useRemembered<Tab>('stats.tab', 'character')
  const [aaStatus, setAaStatus] = useState('')

  const rec = useCharacterRecord(character)
  const record = rec.record
  const s = useMemo(() => withRecord(readSheet(charSheet?.stats), record), [charSheet, record])
  const trio = useMemo(() => classTrio(s), [s])
  const capsQ = useInvoke('stats:caps', [trio, s.level])
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
      const aa = await api.invoke('stats:readAAs')
      if (aa) {
        set({ aa })
        setAaStatus('')
      } else setAaStatus(quiet ? '' : 'No /alternateadv list in your current log yet.')
    } catch (e) {
      setAaStatus(quiet ? '' : `Could not read your log: ${errorMessage(e)}`)
    }
  }
  // First visit for a character: look for AAs without being asked.
  // Once per character and sheet arrival, not on every edit: readAas writes through updateSheet,
  // which always works on the latest sheet, so nothing it reads can be stale.
  const hasSheet = !!charSheet
  useEffect(() => {
    if (hasSheet && !s.aa) void readAas(true)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on character and sheet arrival
  }, [character, hasSheet])

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
            AC and melee for {who(character) || 'your character'}, worked out the way the server does. Worn gear comes from the Inventory page, skill caps and soft caps from the
            game's own tables, and AAs from your log.
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
        <p className="hint">
          {who(character) || 'This character'}&apos;s classes, levels and race, for every page: spell durations, AC and melee, gear and the upgrade finder, spell upgrades and
          buffs.
        </p>
        <div className="stats-fields">
          {[0, 1, 2].map((i) => {
            const ids = s.classes
            const setClass = (id: string) => {
              const next = [...ids]
              next[i] = id
              void rec.save((c) => withClasses(c, [...new Set(next.filter(Boolean))], (x) => c.classLevels[className(x) as ClassName] ?? recordLevel(c)))
            }
            const lv = ids[i] ? record?.classLevels[className(ids[i]) as ClassName] : undefined
            return (
              <div key={i} className="field">
                <span>Class {['one', 'two', 'three'][i]}</span>
                <div className="row tight">
                  <select aria-label={`Class ${['one', 'two', 'three'][i]}`} value={ids[i]} onChange={(e) => setClass(e.target.value)}>
                    {i > 0 && <option value="">none</option>}
                    {CLASSES.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {ids[i] && (
                    <input
                      type="number"
                      aria-label={`${className(ids[i])} level`}
                      style={{ width: 64 }}
                      min={1}
                      max={LEVEL_CAP}
                      value={lv ?? s.level}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(LEVEL_CAP, Number(e.target.value) || 1))
                        void rec.save((c) => ({ ...c, classLevels: { ...c.classLevels, [className(ids[i])]: v } }))
                      }}
                    />
                  )}
                </div>
              </div>
            )
          })}
          <label className="field">
            <span>Race</span>
            <select value={s.race} onChange={(e) => void rec.save((c) => ({ ...c, race: e.target.value === 'iksar' ? 'Iksar' : '' }))}>
              <option value="other">Any other race</option>
              <option value="iksar">Iksar</option>
            </select>
          </label>
        </div>
        <AaLine aa={s.aa} status={aaStatus} onRead={() => void readAas(false)} />
      </div>

      <Tabs className="mb-12" label="Stats view" value={tab} onChange={setTab} tabs={TABS} />

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
                <span className="muted"> · {(Object.entries(a.effects) as [AaEffect, number][]).map(([k, v]) => `${AA_USES[k].label} ${v}${AA_USES[k].unit}`).join(', ')}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
