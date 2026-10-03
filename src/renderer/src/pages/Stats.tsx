import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CharacterPicker } from '../components/CharacterPicker'
import { api, errorMessage } from '../api'
import { useRemembered } from '../remember'
import { useInvoke, useVisibleInterval } from '../hooks'
import { Pending, Tabs } from '../components/ui'
import { who } from '../../../core/format'
import { parseLogLine } from '../../../core/logLine'
import { readStatsInputs, type StatsInputs } from '../../../core/statsInputs'
import { useExportCharacter, useInventory } from '../gear/model'
import { wornSummary } from '../../../core/wornGear'
import { autoValues, classTrio, primaryClass, valOf } from '../../../core/statsModel'
import { CLASSES, className, type ClassName } from '../../../shared/game/classes'
import { PLAYABLE_RACES, playableRace } from '../../../shared/game/races'
import { DEITIES, deityName } from '../../../shared/game/deities'
import { useCharacterRecord, withClasses, withRecord, recordLevel } from '../character'
import { LEVEL_CAP } from '../../../core/buffs'
import type { CharacterSheet } from '../../../shared/types'
import type { SetSheet } from './statsBits'
import { CharacterTab } from './StatsCharacter'
import { AcTab } from './StatsAc'
import { CombatTab } from './StatsCombat'
import { AasTab } from './StatsAas'

type Tab = 'character' | 'ac' | 'combat' | 'aas'
const TABS: [Tab, string][] = [
  // The in-game Stats window, read off the screen; the character record is the card above the tabs.
  ['character', 'Inventory › Stats'],
  ['ac', 'AC'],
  ['combat', 'Combat'],
  ['aas', 'AAs']
]

/** While Stats › AAs is open, how often the log is looked at again for new purchases. */
const AA_RELOAD_MS = 30_000

export function Stats() {
  const exp = useExportCharacter('inventory')
  const { exports, available, character, setCharacter } = exp
  const inv = useInventory(character, !!exports, available.join(','))
  const { view, sheet: charSheet, updateSheet } = inv
  const [tab, setTab] = useRemembered<Tab>('stats.tab', 'character')
  const [aaStatus, setAaStatus] = useState('')

  const rec = useCharacterRecord(character)
  const record = rec.record
  const s = useMemo(() => withRecord(readStatsInputs(charSheet?.stats), record), [charSheet, record])
  const trio = useMemo(() => classTrio(s), [s])
  const capsQ = useInvoke('stats:caps', [trio, s.level])
  const caps = capsQ.data

  // Builds on the latest sheet, so a change that lands after an await (the AAs, a screen read) never
  // undoes what was typed meanwhile.
  const set = useCallback<SetSheet>(
    (patch) =>
      updateSheet((cs) => {
        const cur = readStatsInputs(cs.stats)
        const p = typeof patch === 'function' ? patch(cur) : patch
        return { ...cs, stats: { ...cur, ...p } as unknown as CharacterSheet['stats'] }
      }),
    [updateSheet]
  )
  const setOverride = (key: keyof StatsInputs['overrides'], v: number | undefined) =>
    set((cur) => {
      const o = { ...cur.overrides }
      if (v === undefined) delete o[key]
      else o[key] = v
      return { overrides: o }
    })

  // The picked character's own log, whichever character is being played. The sheet written is the
  // one picked when the read ends, so a read the pick has moved on from is dropped.
  const picked = useRef(character)
  picked.current = character
  const readAas = useCallback(
    async (quiet: boolean) => {
      setAaStatus('Reading your log…')
      try {
        const aa = await api.invoke('stats:readAAs', character)
        if (picked.current !== character) return
        if (aa) {
          set({ aa })
          setAaStatus('')
        } else setAaStatus(quiet ? '' : `No /alternateadv list in ${who(character) || 'this character'}'s log yet.`)
      } catch (e) {
        if (picked.current === character) setAaStatus(quiet ? '' : `Could not read your log: ${errorMessage(e)}`)
      }
    },
    [character, set]
  )

  // What the log and its archives saw bought, for the AAs tab, and when the newest list was typed.
  // Answers for another character (the pick just changed) are not this one's.
  const aaQ = useInvoke(character ? 'stats:aaHistory' : null, [character])
  const aaHistory = aaQ.data?.character === character ? aaQ.data.view : null
  const reloadAaHistory = aaQ.reload
  useVisibleInterval(reloadAaHistory, AA_RELOAD_MS, tab === 'aas')

  // Looks for AAs without being asked: on a character's first visit, and when the log holds a newer
  // /alternateadv list than the one kept (typed again after buying some). Once for each: readAas
  // writes through updateSheet, which always works on the latest sheet, so nothing it reads is stale.
  const hasSheet = !!charSheet
  const listAt = aaHistory?.listAt ?? 0
  const keptAt = s.aa ? (parseLogLine(`[${s.aa.when}] `)?.time ?? 0) : 0
  const looked = useRef('')
  useEffect(() => {
    if (!hasSheet || !character) return
    const k = !s.aa || listAt > keptAt ? `${character}@${listAt}` : ''
    if (!k || looked.current === k) return
    looked.current = k
    void readAas(true)
  }, [character, hasSheet, s.aa, listAt, keptAt, readAas])

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
            AC, melee and AAs for {who(character) || 'your character'}. AC and melee are worked out the way the server does: worn gear comes from the Gear page, skill caps and soft
            caps from the game's own tables, and AAs from your log.
          </p>
        </div>
        <div className="actions">
          <CharacterPicker character={character} available={available} onPick={setCharacter} />
        </div>
      </div>

      <div className="card stack gap-12 mb-14">
        <h2 style={{ margin: 0 }}>Character</h2>
        <p className="hint">
          {who(character) || 'This character'}&apos;s classes, levels, race and deity, for every page: spell durations, AC and melee, gear and the upgrade finder, spell upgrades,
          buffs and faction cons. A /who of yourself while the tracker runs keeps the classes and race up to date: it shows your lowest class level, so no class is put below it.
          /who does not show your deity: set it here.
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
            <select value={playableRace(record?.race ?? '') || (s.race === 'iksar' ? 'Iksar' : '')} onChange={(e) => void rec.save((c) => ({ ...c, race: e.target.value }))}>
              <option value="">not known</option>
              {PLAYABLE_RACES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Deity</span>
            <select value={deityName(record?.deity ?? '')} onChange={(e) => void rec.save((c) => ({ ...c, deity: e.target.value }))}>
              <option value="">not known</option>
              {DEITIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <Tabs className="mb-12" label="Stats view" value={tab} onChange={setTab} tabs={TABS} />

      {tab === 'character' ? (
        <CharacterTab s={s} set={set} val={val} trio={trio} primary={primary} skill={skill} gear={gear?.totals ?? null} />
      ) : tab === 'ac' ? (
        <AcTab
          s={s}
          set={set}
          setOverride={setOverride}
          auto={auto}
          val={val}
          trio={trio}
          primary={primary}
          tableCap={tableCap}
          skill={skill}
          hasInventory={!!gear}
          exportedAt={view.modified}
        />
      ) : tab === 'combat' ? (
        <CombatTab s={s} set={set} setOverride={setOverride} auto={auto} val={val} trio={trio} primary={primary} caps={caps} skill={skill} />
      ) : (
        <AasTab aa={s.aa} status={aaStatus} onRead={() => void readAas(false)} history={aaHistory} error={aaQ.error} retry={aaQ.reload} />
      )}
    </>
  )
}
