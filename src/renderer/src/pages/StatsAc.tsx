import { num } from '../../../core/format'
import { acInputs, acReport } from '../../../core/statsModel'
import { className } from '../../../shared/game/classes'
import { Notes, NumField, Trace, type TabProps } from './statsBits'

export function AcTab({ s, set, setOverride, auto, val, trio, primary, tableCap, skill, hasInventory }: TabProps & { tableCap?: { cap: number; mult: number }; hasInventory: boolean }) {
  const i = acInputs(s, trio, primary, val, skill)
  const { r, full, sum, notes, rows } = acReport(i, primary)

  return (
    <div className="stats-grid">
      <div className="stack gap-14">
        <div className="card">
          <div className="grid three">
            <div className="stat">
              <span className="label">Mitigation AC</span>
              <span className="value stats-big">{num(r.mitigation)}</span>
            </div>
            <div className="stat">
              <span className="label">Soft cap</span>
              <span className="value stats-big">{num(r.effCap)}</span>
            </div>
            <div className="stat">
              <span className="label">Avoidance</span>
              <span className="value stats-big">{num(r.avoidance)}</span>
            </div>
          </div>
          <p className="faint small" style={{ margin: '10px 0 0' }}>
            The Inventory window's three AC figures, in its order. With your unbuffed numbers these match the game exactly.
          </p>
        </div>
        <div className="card stack gap-8">
          <b>
            {num(r.srv.total)} AC Sum against a {num(r.effCap)} soft cap
          </b>
          <div className="stats-bar">
            <i className="full" style={{ width: `${(full / sum) * 100}%` }} />
            <i className="over" style={{ width: `${(r.kept / sum) * 100}%` }} />
            <i className="lost" style={{ width: `${(r.lost / sum) * 100}%` }} />
          </div>
          <div className="row small muted" style={{ gap: 16 }}>
            <span>
              <i className="stats-key full" /> Counts in full <b>{num(full)}</b>
            </span>
            {r.over && (
              <>
                <span>
                  <i className="stats-key over" /> Counts at {(i.multiplier * 100).toFixed(1)}% <b>{num(r.kept)}</b>
                </span>
                <span>
                  <i className="stats-key lost" /> Eaten by the cap <b>{num(r.lost)}</b>
                </span>
              </>
            )}
          </div>
          <Notes notes={notes} />
          <Trace rows={rows} />
        </div>
      </div>

      <div className="stack gap-14">
        <div className="card stack gap-10">
          <h2>Worn gear</h2>
          <div className="stats-fields two">
            <NumField label="AC on equipped items" hint="every slot but ammo" value={s.overrides.itemAC} auto={auto.itemAC} autoFrom="inventory" onChange={(v) => setOverride('itemAC', v)} />
            <NumField label="AC on your shield" hint="secondary slot" value={s.overrides.shieldAC} auto={auto.shieldAC} autoFrom="inventory" onChange={(v) => setOverride('shieldAC', v)} />
            <NumField label="Avoidance from items" hint="up to 100" value={s.itemAvoidance} onChange={(v) => set({ itemAvoidance: v ?? 0 })} />
            <NumField label="AC from food and drink" value={s.foodDrinkAC} onChange={(v) => set({ foodDrinkAC: v ?? 0 })} />
            <NumField label="AC from tribute and trophies" value={s.tributeAC} onChange={(v) => set({ tributeAC: v ?? 0 })} />
          </div>
          {!hasInventory && <p className="faint small">No inventory export yet, so type your worn AC. Type /outputfile inventory in game to fill it in.</p>}
        </div>
        <div className="card stack gap-10">
          <h2>Character</h2>
          <div className="stats-fields two">
            <NumField label="Agility" hint="Inventory window" value={s.agility} onChange={(v) => set({ agility: v ?? 0 })} />
            <NumField label="Heroic agility" value={s.heroicAgility} onChange={(v) => set({ heroicAgility: v ?? 0 })} />
            <NumField label="Heroic strength" value={s.heroicStrength} onChange={(v) => set({ heroicStrength: v ?? 0 })} />
            {trio.includes('mnk') && <NumField label="Total weight" hint="Inventory window" step={0.1} value={s.weight} onChange={(v) => set({ weight: v ?? 0 })} />}
            <NumField label="Drunkenness" hint="0 to 200" max={200} value={s.drunk} onChange={(v) => set({ drunk: v ?? 0 })} />
          </div>
          <p className="faint small">Defence skill ({num(skill(15))}) comes from your skills on the Combat tab.</p>
        </div>
        <div className="card stack gap-10">
          <h2>Buffs and AAs</h2>
          <div className="stats-fields two">
            <NumField label="AC from buffs" hint="SPA 1 + 416" value={s.acBuffs} onChange={(v) => set({ acBuffs: v ?? 0 })} />
            <NumField label="Armor of Wisdom AC" value={s.armorOfWisdom} onChange={(v) => set({ armorOfWisdom: v ?? 0 })} />
            <NumField label="Hero's Fortitude AC" value={s.herosFortitude} onChange={(v) => set({ herosFortitude: v ?? 0 })} />
            <NumField label="Combat Stability" hint="SPA 259, %" value={s.overrides.combatStability} auto={auto.combatStability} autoFrom="AAs" onChange={(v) => setOverride('combatStability', v)} />
            <NumField label="Melee avoidance AAs" hint="SPA 172, %" value={s.overrides.evasion} auto={auto.evasion} autoFrom="AAs" onChange={(v) => setOverride('evasion', v)} />
          </div>
        </div>
        <div className="card stack gap-10">
          <h2>Soft cap</h2>
          <div className="stats-fields two">
            <NumField label="Soft cap" value={s.overrides.softCap} auto={auto.softCap} autoFrom="game table" onChange={(v) => setOverride('softCap', v)} />
            <NumField label="Post-cap multiplier" step={0.005} max={1} value={s.overrides.multiplier} auto={auto.multiplier} autoFrom="game table" onChange={(v) => setOverride('multiplier', v)} />
          </div>
          <p className="faint small">
            {tableCap
              ? `From the game's Resources/ACMitigation.txt: ${className(primary)}${trio.length > 1 ? `, the sturdiest of ${trio.map(className).join(', ')},` : ''} at level ${s.level} caps at ${tableCap.cap} and keeps ${(tableCap.mult * 100).toFixed(1)}% beyond it.`
              : 'The game folder has no ACMitigation.txt; type the cap in.'}
          </p>
        </div>
        <p className="faint small">
          Transcribed from "What is your 'Real AC'?" by Dzarn, an EverQuest developer, as reposted to r/EQLegends by neodraykl. Avoidance follows EQEmu's
          GetTotalDefense.
        </p>
      </div>
    </div>
  )
}
