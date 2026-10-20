import { remember, useRemembered } from '../remember'
import { useState } from 'react'
import { useActions, useLive, useSettled } from '../state'
import { api, clock } from '../api'
import { SEARCH_MIN, useInvoke, useSearch } from '../hooks'
import { showError, showUndo } from '../toast'
import { duration, pct, who } from '../../../core/format'
import { Ago, CategoryChip, Disclosure, Field, FilterBox, Info, LoadError, NumberInput, PageLink, Pending, type Sort, sortRows, SortTh, SpellIcon, Switch } from '../components/ui'
import { CATEGORY_LABELS, DEFAULT_TIER_DURATION_PCT, type ClassName, type KnownSpell, type SpellCategory, type SpellRule } from '../../../shared/types'
import type { Go } from '../nav'
import { FocusSources } from './SpellsFocus'
import { SpellDefaults } from './SpellsDefaults'
import { RuleEditor, useSpellDrafts } from './SpellRule'
import { LogCheck } from './SpellsLogCheck'
import { NotWatching } from '../components/NotWatching'
import { TryLogLineLink } from '../components/TryLogLine'
import { takeHandOff } from '../handoff'

type SpellKey = 'name' | 'type' | 'resisted' | 'window' | 'wears' | 'last'

/** A spell's casts and resists over the last two weeks (LT-722). */
type ResistCount = { casts: number; resisted: number }

/** The share of casts resisted, once there are casts to go by; null for none. */
const resistRate = (r: ResistCount | undefined): number | null => (r && r.casts > 0 ? Math.min(1, r.resisted / r.casts) : null)

export function Spells({ go }: { go?: Go }) {
  const character = useSettled((s) => s.character)
  const tracking = useSettled((s) => s.settings.tracking)
  const spellsLoaded = useLive((l) => l.status.spellsLoaded)
  // Each settings push is a fresh object: the list is asked for again only when what it depends on
  // reads differently, not on every save or overlay move.
  // A focus's name and "from" are labels: typing them does not ask for every spell's duration again (LT-394).
  const timing = { ...character, focusSources: character.focusSources.map(({ name: _name, from: _from, ...f }) => f) }
  const deps = JSON.stringify([timing, tracking])
  const q = useInvoke('spells:known', [], [deps, spellsLoaded])
  const known = q.data ?? []
  const setKnown = q.setData
  const resistsQ = useInvoke('spells:resists', [], [spellsLoaded])
  const resists = resistsQ.data ?? {}
  // Sent here from a timer on Live: its row open (LT-691).
  const [open, setOpen] = useState<string | null>(() => takeHandOff('spells') ?? null)
  const [filter, setFilter] = useState('')

  const [sort, setSort] = useRemembered<Sort<SpellKey>>('spells.sort', { key: 'last', dir: -1 })
  const shown = sortRows(
    known.filter((k) => !filter || k.rankedName.toLowerCase().includes(filter.toLowerCase())),
    sort,
    {
      name: (k) => k.rankedName,
      type: (k) => k.category,
      resisted: (k) => (k.beneficial ? null : resistRate(resists[k.name])),
      window: (k) => (k.duration.permanent ? Infinity : k.duration.spellWindowSec),
      wears: (k) => (k.duration.permanent ? Infinity : k.duration.seconds),
      last: (k) => k.lastCast || null
    }
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Spell Timers</h1>
          <p>
            Durations are calculated from the game's spell data, your level, the spell's rank and your focus effects — the same sum the in-game Spell window shows in brackets.
            Every spell you cast appears here automatically. <TryLogLineLink /> to see a cast timed without casting it.
          </p>
        </div>
      </div>

      <NotWatching what="your casts and their timers" />

      <div className="stack">
        {q.error && <LoadError what="your spells" error={q.error} retry={q.reload} />}
        <CharacterCard go={go} />

        <div className="card">
          <div className="card-head">
            <h2>
              Your spells <span className="chip">{filter.trim() ? `${shown.length} of ${known.length}` : known.length}</span>
            </h2>
            <span className="spacer" />
            <FilterBox label="Filter spells" value={filter} onChange={setFilter} width={200} />
          </div>
          {!q.data && !q.error ? (
            <Pending what="your spells" />
          ) : known.length === 0 ? (
            <div className="empty">No spells yet. Cast something while watching, or add a spell below.</div>
          ) : !shown.length ? (
            <div className="empty">Nothing matches “{filter.trim()}”.</div>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th />
                    <SortTh k="name" sort={sort} onSort={setSort}>
                      Spell
                    </SortTh>
                    <SortTh k="type" sort={sort} onSort={setSort}>
                      Type
                    </SortTh>
                    <SortTh
                      k="resisted"
                      sort={sort}
                      onSort={setSort}
                      after={<Info label="About Resisted" text="Of your casts of it over the last two weeks of play, the share a target resisted outright" />}
                    >
                      Resisted
                    </SortTh>
                    <SortTh
                      k="window"
                      sort={sort}
                      onSort={setSort}
                      after={<Info label="About Spell window" text="As the in-game Spell window shows it: base (with rank and focus)" />}
                    >
                      Spell window
                    </SortTh>
                    <SortTh k="wears" sort={sort} onSort={setSort} after={<Info label="About Wears off" text="Including the partial tick it lands in" />}>
                      Wears off
                    </SortTh>
                    <th>Tracking</th>
                    <th>
                      Recast cue <Info label="About Recast cue" text="The spoken “Recast …” warning before it ends" />
                    </th>
                    <th>
                      Fade cue <Info label="About Fade cue" text="The spoken announcement when it wears off" />
                    </th>
                    <SortTh k="last" sort={sort} onSort={setSort}>
                      Last cast
                    </SortTh>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((k) => (
                    <SpellRow key={k.name} k={k} resist={resists[k.name]} open={open === k.name} toggle={() => setOpen(open === k.name ? null : k.name)} onSaved={setKnown} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AddSpell onAdded={setKnown} />
        </div>

        <SpellDefaults />
        <LogCheck known={known} onSaved={setKnown} />
        <TierTable go={go} />
      </div>
    </>
  )
}

/**
 * Whose spells these are: the character's classes, levels and race, which the Stats page edits for
 * every page, and the duration focus that is this page's own.
 */
function CharacterCard({ go }: { go?: Go }) {
  const c = useSettled((s) => s.character)
  const characterKey = useSettled((s) => s.characterKey)
  const classes = Object.entries(c.classLevels) as [ClassName, number][]
  if (!characterKey) {
    return <div className="notice">Choose a character log on Settings › Log files to set up focus and levels.</div>
  }
  return (
    <div className="card">
      <div className="card-head">
        <h2>{who(characterKey)}</h2>
        <span className="spacer" />
        <button
          className="btn small"
          onClick={() => {
            // Stats shows the character picked there: this one, the one being played.
            remember('character', characterKey)
            go?.('stats')
          }}
        >
          Edit classes and levels
        </button>
      </div>
      {classes.length ? (
        <div className="row tight mb-12">
          {classes.map(([name, lv]) => (
            <span key={name} className="chip">
              {name} {lv}
            </span>
          ))}
          {c.race && <span className="chip">{c.race}</span>}
        </div>
      ) : (
        <div className="notice warn mb-12">
          No classes set, so every spell is timed as if cast at level {c.level}. Set your classes and their levels on the <PageLink page="stats">Stats page</PageLink>: a spell uses
          the level of a class that can cast it.
        </div>
      )}
      <FocusSources />
    </div>
  )
}

/** Flips one of a spell's cues straight from the table, keeping the rest of its rule. */
async function setCue(k: KnownSpell, patch: Partial<SpellRule>, onSaved: (list: KnownSpell[]) => void): Promise<void> {
  try {
    onSaved(await api.invoke('spells:rule', k.name, { ...k.rule, ...patch }))
  } catch (e) {
    showError(`Could not change ${k.name}`, e)
  }
}

function trackLabel(rule: SpellRule): string {
  return rule.track === undefined ? 'Default' : rule.track ? 'Always' : 'Off'
}

function SpellRow({
  k,
  resist,
  open,
  toggle,
  onSaved
}: {
  k: KnownSpell
  resist: ResistCount | undefined
  open: boolean
  toggle: () => void
  onSaved: (list: KnownSpell[]) => void
}) {
  const rate = k.beneficial ? null : resistRate(resist)
  const d = k.duration
  const unsaved = useSpellDrafts().has(k.name)
  return (
    <>
      <tr className={`clickable${open ? ' selected' : ''}`} onClick={toggle}>
        <td style={{ width: 36 }}>
          <SpellIcon icon={k.icon} />
        </td>
        <td>
          {/* The row opens on a click anywhere; this is the same for the keyboard. */}
          <Disclosure open={open} onToggle={toggle} stop>
            {k.rule.alias ? `${k.rule.alias}` : k.rankedName}
          </Disclosure>
          {unsaved && (
            <span className="unsaved-mark" title="Changes not saved yet">
              {' '}
              ● not saved
            </span>
          )}
          {k.rule.alias && <div className="faint small">{k.rankedName}</div>}
        </td>
        <td>
          <span className="row tight">
            <CategoryChip category={k.category} />
            {!k.beneficial && k.resist !== 'none' && (
              <span className="chip" title={`Resisted with ${k.resist} resistance`}>
                {k.resist}
              </span>
            )}
          </span>
        </td>
        <td className="nowrap" title={resist && rate !== null ? `${resist.resisted} of ${resist.casts} casts in the last two weeks` : undefined}>
          {rate === null ? <span className="faint">—</span> : pct(rate)}
        </td>
        <td className="mono nowrap">{d.permanent ? 'Permanent' : `${clock(d.baseSec)} (${clock(d.spellWindowSec)})`}</td>
        <td className="nowrap muted">{d.permanent ? '—' : `${clock(d.earliestSec)}–${clock(d.latestSec)}`}</td>
        <td>
          <span className="row tight">
            <span className={`chip${k.rule.track === false ? ' bad' : k.rule.track ? ' ok' : ''}`}>{trackLabel(k.rule)}</span>
            {k.rule.others && (
              <span className="chip ok" title="Other players' casts of this spell are timed too">
                anyone's
              </span>
            )}
          </span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <span className="row tight nowrap">
            <Switch
              on={k.rule.recastCue !== false && k.rule.track !== false}
              disabled={k.rule.track === false}
              title={k.rule.track === false ? 'Not timed: no cues' : 'Recast warning'}
              label={`Recast warning for ${k.rankedName}`}
              onChange={(v) => void setCue(k, { recastCue: v ? undefined : false }, onSaved)}
            />
            {k.rule.recastCue !== false && k.rule.track !== false && <span className="faint small">{k.rule.warnSec !== undefined ? duration(k.rule.warnSec) : 'default'}</span>}
          </span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <Switch
            on={k.rule.fadeCue !== false && k.rule.track !== false}
            disabled={k.rule.track === false}
            title={k.rule.track === false ? 'Not timed: no cues' : 'Fade announcement'}
            label={`Fade announcement for ${k.rankedName}`}
            onChange={(v) => void setCue(k, { fadeCue: v ? undefined : false }, onSaved)}
          />
        </td>
        <td className="faint small nowrap">
          <Ago t={k.lastCast ?? 0} never="rule only" />
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} style={{ background: 'var(--bg-2)' }}>
            <RuleEditor k={k} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  )
}

function AddSpell({ onAdded }: { onAdded: (list: KnownSpell[]) => void }) {
  const [q, setQ] = useState('')
  const { results, answered } = useSearch('spells:search', q)
  const withDuration = results.filter((r) => r.formula !== 0 || r.cap !== 0)
  return (
    <div className="mt-16">
      <div className="row">
        <input
          placeholder="Find a spell to add, one you have not cast yet (three letters or more)…"
          aria-label="Add a spell: search the spell book"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      {answered === q && q.trim().length >= SEARCH_MIN && !withDuration.length && <div className="faint small mt-8">No spell with a duration matches “{q.trim()}”.</div>}
      {withDuration.length > 0 && (
        <div className="stack" style={{ gap: 2, marginTop: 8, maxHeight: 260, overflow: 'auto' }}>
          {withDuration.map((r) => (
            <button
              key={r.id}
              className="tree-item"
              onClick={async () => {
                try {
                  onAdded(await api.invoke('spells:rule', r.name, { track: true }))
                  setQ('')
                } catch (e) {
                  showError(`Could not add ${r.name}`, e)
                }
              }}
            >
              <SpellIcon icon={r.icon} />
              <span className="name">{r.name}</span>
              <CategoryChip category={r.category} />
              <span className="faint small">{r.classes}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TierTable({ go }: { go?: Go }) {
  const { patchSettings } = useActions()
  const tracking = useSettled((s) => s.settings.tracking)
  const pct = tracking.tierDurationPct
  const cats = ['dot', 'hot', 'buff', 'debuff', 'mez', 'charm'] as SpellCategory[]
  return (
    <div className="card">
      <div className="card-head">
        <h2>Rank bonuses</h2>
        <span className="spacer" />
        <button
          className="btn small ghost"
          onClick={() => {
            // Six typed numbers go back to the guide's: said, with a way back (LT-467).
            const before = { ...tracking.tierDurationPct }
            void patchSettings((s) => ({ ...s, tracking: { ...s.tracking, tierDurationPct: { ...DEFAULT_TIER_DURATION_PCT } } }))
            showUndo('Rank bonuses set back to the guide values.', () => void patchSettings((s) => ({ ...s, tracking: { ...s.tracking, tierDurationPct: before } })))
          }}
        >
          Reset to guide values
        </button>
      </div>
      <p className="muted small mt-0">
        Duration bonus per rank, from the EQL spell upgrade guide: rank X is ten tiers, an unranked spell none. Confirmed in game for DoTs (Envenomed Bolt X 0:36 → 0:54) and buffs
        (Spirit of the Puma X). Heal over time is fitted rather than from the guide: 7% matches Slugs Healing V's Spell window and log, where the guide's 5% does not.{' '}
        {go ? (
          <button className="link-button inline" onClick={() => go('motes', 'spells')}>
            Motes › Spell upgrades
          </button>
        ) : (
          'Motes › Spell upgrades'
        )}{' '}
        values a rank by these too.
      </p>
      <div className="grid three">
        {cats.map((c) => (
          <Field key={c} label={CATEGORY_LABELS[c]}>
            <div className="row tight">
              <NumberInput
                value={pct[c]}
                step={0.5}
                onChange={(v) => patchSettings((s) => ({ ...s, tracking: { ...s.tracking, tierDurationPct: { ...s.tracking.tierDurationPct, [c]: v ?? 0 } } }))}
              />
              <span className="muted">% per rank</span>
            </div>
          </Field>
        ))}
      </div>
    </div>
  )
}
