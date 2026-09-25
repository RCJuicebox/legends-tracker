// Alternate Advancement, read from the log. In game, /alternateadv list writes every held ability to
// chat: "Ability #<id>: <Name>", "Description: <text>", "Cost per Level: <n>". Each description
// states the effect at the rank held, so the numbers come straight out of the prose.

import { parseLogLine } from './logLine'

const ABILITY = /^Ability #(\d+): (.+?)\s*$/
const DESCRIPTION = /^Description: ?(.*)$/
const COST = /^Cost per Level: ?(\d+)/

/**
 * Matched literally on purpose. "Melee avoidance" in particular must not be read loosely:
 * strikethrough abilities describe the opponent's defences.
 */
const EFFECTS: [AaEffect, RegExp][] = [
  ['softcap_pct', /armor class soft cap(?: of your class)? by (\d+)%/i],
  ['melee_crit_pct', /critical (?:melee )?hit with (?:all skills|your melee)[^.]*?by (\d+)%/i],
  ['attack', /increases your attack power by (\d+)/i],
  ['dual_wield_pct', /chance to successfully dual wield by (\d+)%/i],
  ['avoidance_pct', /increases your melee avoidance by (\d+)%/i],
  ['all_stats', /increases your strength, stamina, agility, dexterity, wisdom, intelligence, and charisma by (\d+)/i],
  ['base_hp_pct', /increases your maximum base health .*? by (\d+)%/i],
  ['hp_regen', /increases your health regeneration by (\d+)/i],
  ['resists_all', /improves your cold, disease, fire, magic, and poison resistances by (\d+)/i],
  ['double_riposte_pct', /(\d+)% chance to perform a double riposte/i],
  ['strikethrough_pct', /strike through your opponent[^.]*?by (\d+)%/i],
  ['melee_dmg_pct', /improves the base damage of your melee attacks[^.]*?by (\d+)%/i]
]

export type AaEffect =
  | 'softcap_pct'
  | 'melee_crit_pct'
  | 'attack'
  | 'dual_wield_pct'
  | 'avoidance_pct'
  | 'all_stats'
  | 'base_hp_pct'
  | 'hp_regen'
  | 'resists_all'
  | 'double_riposte_pct'
  | 'strikethrough_pct'
  | 'melee_dmg_pct'

/** What each effect feeds. Stats already include Innate Eminence, so it is shown, never added. */
export const AA_USES: Record<AaEffect, { label: string; unit: string; feeds: string; applied: boolean }> = {
  softcap_pct: { label: 'AC soft cap', unit: '%', feeds: 'AC: Combat Stability', applied: true },
  avoidance_pct: { label: 'Melee avoidance', unit: '%', feeds: 'AC: avoidance', applied: true },
  melee_crit_pct: { label: 'Melee crit chance', unit: '%', feeds: 'Combat: crit (classic model)', applied: true },
  attack: { label: 'Attack power', unit: '', feeds: 'Combat: ATK', applied: true },
  dual_wield_pct: { label: 'Dual wield chance', unit: '%', feeds: 'Combat: Ambidexterity', applied: true },
  all_stats: { label: 'All seven stats', unit: '', feeds: 'already in your window stats', applied: false },
  base_hp_pct: { label: 'Base hit points', unit: '%', feeds: 'shown only', applied: false },
  hp_regen: { label: 'HP regeneration', unit: '', feeds: 'shown only', applied: false },
  resists_all: { label: 'All resists', unit: '', feeds: 'shown only', applied: false },
  double_riposte_pct: { label: 'Double riposte', unit: '%', feeds: 'shown only', applied: false },
  strikethrough_pct: { label: 'Strikethrough', unit: '%', feeds: 'shown only', applied: false },
  melee_dmg_pct: { label: 'Melee base damage', unit: '%', feeds: 'shown only', applied: false }
}

export interface AaAbility {
  id: number
  name: string
  cost: number | null
  description: string
  effects: Partial<Record<AaEffect, number>>
}

export interface AaSummary {
  /** The dump's timestamp as the log wrote it. */
  when: string
  count: number
  abilities: AaAbility[]
  totals: Partial<Record<AaEffect, { sum: number; from: [string, number][] }>>
}

/** Ability entries further apart than this belong to different dumps. */
const DUMP_GAP_MS = 5000

interface RawEntry {
  id: number
  name: string
  description: string
  cost: number | null
  when: string
  inDescription: boolean
}

/** Every /alternateadv list dump in the lines, oldest first. A dump is a run of Ability entries seconds apart. */
export function findAaDumps(lines: string[]): RawEntry[][] {
  const dumps: RawEntry[][] = []
  let cur: RawEntry[] = []
  let entry: RawEntry | null = null
  let lastTime: number | null = null
  const close = () => {
    if (entry) cur.push(entry)
    entry = null
  }
  for (const line of lines) {
    const raw = line.replace(/\r$/, '')
    const l = parseLogLine(raw)
    if (!l) {
      // Descriptions wrap onto untimestamped lines.
      if (entry?.inDescription && raw.trim()) entry.description += '\n' + raw.trim()
      continue
    }
    const body = l.text
    const a = ABILITY.exec(body)
    if (a) {
      close()
      if (lastTime !== null && cur.length && Math.abs(l.time - lastTime) > DUMP_GAP_MS) {
        dumps.push(cur)
        cur = []
      }
      // The stamp exactly as written (padded day and all), so callers can find the line again.
      const when = raw.slice(1, raw.indexOf(']'))
      entry = { id: Number(a[1]), name: a[2].trim(), description: '', cost: null, when, inDescription: false }
      lastTime = l.time
      continue
    }
    if (!entry) continue
    const d = DESCRIPTION.exec(body)
    if (d) {
      entry.description = d[1].trim()
      entry.inDescription = true
      continue
    }
    const c = COST.exec(body)
    if (c) {
      entry.cost = Number(c[1])
      entry.inDescription = false
      continue
    }
    close()
    if (cur.length) dumps.push(cur)
    cur = []
    lastTime = null
  }
  close()
  if (cur.length) dumps.push(cur)
  return dumps
}

export function aaEffects(description: string): Partial<Record<AaEffect, number>> {
  const out: Partial<Record<AaEffect, number>> = {}
  for (const [key, re] of EFFECTS) {
    const m = re.exec(description || '')
    if (m) out[key] = Number(m[1])
  }
  return out
}

/** One of each ability (the list repeats some), and every effect totalled with who gave it. */
export function summarizeAas(list: RawEntry[]): AaSummary {
  const seen = new Set<string>()
  const abilities: AaAbility[] = []
  const totals: AaSummary['totals'] = {}
  for (const e of list) {
    const k = `${e.id}|${e.name}`
    if (seen.has(k)) continue
    seen.add(k)
    const effects = aaEffects(e.description)
    abilities.push({ id: e.id, name: e.name, cost: e.cost, description: e.description, effects })
    for (const [key, v] of Object.entries(effects) as [AaEffect, number][]) {
      const t = (totals[key] ??= { sum: 0, from: [] })
      t.sum += v
      t.from.push([e.name, v])
    }
  }
  abilities.sort((x, y) => x.name.localeCompare(y.name))
  return { when: list[0]?.when ?? '', count: abilities.length, abilities, totals }
}

/** The newest dump in some log text, or null when there is none. */
export function latestAas(text: string): AaSummary | null {
  const dumps = findAaDumps(text.split('\n'))
  return dumps.length ? summarizeAas(dumps[dumps.length - 1]) : null
}

export const aaTotal = (s: AaSummary | null | undefined, key: AaEffect) => s?.totals[key]?.sum ?? 0
