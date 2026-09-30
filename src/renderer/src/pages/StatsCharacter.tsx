import { useState } from 'react'
import { api } from '../api'
import { num } from '../../../core/format'
import type { StatsInputs } from '../../../core/statsInputs'
import { acInputs, type Val } from '../../../core/statsModel'
import { computeAc } from '../../../core/acModel'
import { baseAccuracy, OFFENSE, windowOffense } from '../../../core/combatModel'
import type { WornTotals } from '../../../core/inventory'
import type { SetSheet } from './statsBits'
import { Ago, Tip } from '../components/ui'

const HEROIC = [
  'Accuracy',
  'Avoidance',
  'Combat Effects',
  'Damage Shielding',
  'Damage Shield Mitigation',
  'DoT Shielding',
  'Melee Shielding',
  'Spell Shielding',
  'Strike Through',
  'Stun Resist'
]
const SPELL_MODS = ['Heal Amount', 'Spell Damage', 'Clairvoyance', 'Luck']
const SKILL_MODS = ['Bash', 'Backstab', 'Dragon Punch', 'Eagle Strike', 'Flying Kick', 'Frenzy', 'Kick', 'Round Kick', 'Tiger Claw']
const STATS: [string, string][] = [
  ['Strength', 'STR'],
  ['Stamina', 'STA'],
  ['Intelligence', 'INT'],
  ['Wisdom', 'WIS'],
  ['Agility', 'AGI'],
  ['Dexterity', 'DEX'],
  ['Charisma', 'CHA']
]
const RESISTS: [string, string][] = [
  ['Magic', 'MAGIC'],
  ['Fire', 'FIRE'],
  ['Cold', 'COLD'],
  ['Disease', 'DISEASE'],
  ['Poison', 'POISON'],
  ['Void', 'VOID']
]

/**
 * The in-game Inventory window's Stats tab, read off the screen, with what the tracker predicts
 * beside it: the AC and attack calculators, and what worn gear contributes.
 */
export function CharacterTab({
  s,
  set,
  val,
  trio,
  primary,
  skill,
  gear
}: {
  s: StatsInputs
  set: SetSheet
  val: Val
  trio: string[]
  primary: string
  skill: (id: number) => number
  gear: WornTotals | null
}) {
  const [busy, setBusy] = useState(false)
  // What the last read found, or why it failed: said plainly, not in the faintest text.
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)
  const w = s.window?.values ?? {}
  const has = !!s.window
  const ac = computeAc(acInputs(s, trio, primary, val, skill))
  const offense = windowOffense(skill(s.weapon), s.strength)
  const accuracy = baseAccuracy(skill(OFFENSE), skill(s.weapon))

  const read = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.invoke('stats:readScreen')
      const found = Object.keys(r.values).length
      if (found < 5) {
        setMessage({
          bad: true,
          text: `Could not find the Stats window on ${r.screens} screen${r.screens === 1 ? '' : 's'}. Open your Inventory window on its Stats tab, uncovered, and try again.`
        })
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
      setMessage({ bad: false, text: `Read ${found} lines. Strength, Agility and Dexterity on the AC and Combat tabs now follow it.` })
    } catch (e) {
      setMessage({ bad: true, text: `Could not read the screen: ${(e as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  const n = (label: string, i = 0) => w[label]?.[i]
  const show = (v: number | undefined) => (v === undefined ? '—' : num(v))
  const pair = (label: string) => (w[label] ? `${num(w[label][0])} / ${num(w[label][1] ?? w[label][0])}` : '—')
  // Beside a figure the Stats window gave: ✓ when the calculator, from your gear, skills and AAs,
  // gives exactly that; else what it gives.
  const check = (actual: number | undefined, predicted: number, what: string) =>
    actual === undefined ? (
      <Tip className="faint" text={`The calculator gives ${num(predicted)} for ${what}; read the Stats window to compare`}>
        calc {num(predicted)}
      </Tip>
    ) : actual === predicted ? (
      <Tip className="ok-text" text={`The calculator gives ${num(predicted)} for ${what} too, the Stats window's figure exactly`}>
        ✓
      </Tip>
    ) : (
      <Tip className="warn-text" text={`The calculator gives ${num(predicted)} for ${what} with your inputs; the Stats window says ${num(actual)}`}>
        calc {num(predicted)}
      </Tip>
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
          {has ? (
            <>
              Read <Ago t={s.window!.at} />. Open your Inventory window on its Stats tab and read again whenever your gear or buffs change.
            </>
          ) : (
            'Open your Inventory window on its Stats tab in game, then read it. This window steps aside for a moment while it looks.'
          )}
        </span>
        {message && (
          <div className={`notice small${message.bad ? ' bad' : ''}`} role={message.bad ? 'alert' : 'status'}>
            {message.text}
          </div>
        )}
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
                {check(n('AC', 0), ac.mitigation, 'mitigation AC')} {check(n('AC', 1), ac.effCap, 'the soft cap')} {check(n('AC', 2), ac.avoidance, 'avoidance AC')}
              </>
            )}
            {row(
              'Attack',
              pair('Attack'),
              <>
                {check(n('Attack', 0), offense, 'Offense')}
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
        Read with Windows&apos; own text recognition from a picture of your screen; nothing touches the game. A dash is a line it could not read. The notes beside each figure are
        what the AC and Combat tabs work out from your current inputs (a tick when they agree with the game) and what your worn gear adds.
      </p>
    </div>
  )
}
