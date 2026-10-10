import { Tip } from '../../../renderer/src/components/ui'
import { Fragment } from 'react'
import { duration, wikiUrl } from '../../../core/format'
import { fmtCoin } from '../../../core/loot'
import type { HandInItem, PlanActivity } from '../catalog'

// What the Plan tab's parts share (planPage.tsx and the rest of this folder, and the Standings tab
// for an activity): how a way to raise a faction is named, where its figures come from, what could
// make it slower, what its hand-ins take, and the numbers as the tab writes them.

/** How long a number being typed waits before it is saved. */
export const TYPING_SAVE_MS = 150

export { signed } from '../../../core/format'
/** A standing with a true minus: "−702". */
export const plain = (n: number) => (n < 0 ? `−${-n}` : String(n))
/** A standing with thousands separators and a true minus: "1,415", "−702". */
export const signedPlain = (n: number) => (n < 0 ? `−${(-n).toLocaleString()}` : n.toLocaleString())

/** "Human", "Human or Erudite", "Human, Erudite or Gnome". */
export const listed = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`)

export const KIND_LABEL: Record<PlanActivity['kind'], string> = { kill: 'Kill', turnin: 'Hand-in', quest: 'Quest' }

/** Where a hand-in's item comes from, in a few words. */
function itemSource(it: HandInItem): string {
  const where = it.where ? ` ${it.where}` : ''
  switch (it.how) {
    case 'coin':
      return 'coin'
    case 'bought':
      return `you bought it from${where}${it.each ? `, ${fmtCoin(Math.round(it.each))} each` : ''}`
    case 'vendor':
      return `sold by${where}`
    case 'crafted':
      return `crafted${where}${it.sec ? `, about ${duration(it.sec)} each` : ''}`
    case 'drop':
      return it.named ? `from${where || ' a named mob'} (named: one a respawn)` : `drops${it.where ? ` from ${it.where}` : ''}${it.sec ? `, about ${duration(it.sec)} each` : ''}`
    default:
      return 'the wiki does not say where it comes from'
  }
}

/**
 * What a step's hand-ins take: all of it for `units` of them, with each one's share when it is more
 * than one, and what the NPC gives back to be handed back (`back`).
 */
export function ItemsLine({ items, units, back }: { items: HandInItem[]; units?: number; back?: string }) {
  if (!items.length) return <span className="faint">The walkthrough does not say what goes in.</span>
  return (
    <>
      {items.map((it, i) => (
        <Fragment key={it.name + i}>
          {i > 0 && ', '}
          <span className="mono">{(units ? units * it.count : it.count).toLocaleString()}</span> {it.name}
          {it.to && <span className="faint"> to {it.to}</span>}
          {!!units && it.count > 1 && <span className="faint"> ({it.count} a hand-in)</span>}
          {it.makes && <span className="faint"> (combined into {it.makes})</span>}
          <span className="faint"> — {itemSource(it)}</span>
          {!!it.have && (
            <span className="ok-text">
              {' '}
              · you hold {it.have.toLocaleString()}
              {units ? ` (${Math.min(units, Math.floor(it.have / it.count)).toLocaleString()} hand-ins' worth)` : ''}
            </span>
          )}
        </Fragment>
      ))}
      {back && <span className="faint"> · then hand back the {back} you get for each, for as much again</span>}
    </>
  )
}

/** "Kill A gnoll, A gnoll guardsman and 19 more", "Hand in to Lashun Novashine", "Bone Chips (Kaladim)". */
export function Doing({ a }: { a: PlanActivity }) {
  const link = a.page ? (
    <a href={wikiUrl(a.page)} target="_blank" rel="noreferrer" title="Open on eqlwiki" onClick={(e) => e.stopPropagation()}>
      {a.kind === 'quest' ? a.title : '↗'}
    </a>
  ) : null
  if (a.kind === 'kill')
    return (
      <span title={a.mobs?.join(', ')}>
        Kill <b>{a.title}</b> {a.page && link}
      </span>
    )
  if (a.kind === 'turnin')
    return (
      <span>
        Hand in to <b>{a.npc ?? a.title}</b>
      </span>
    )
  return (
    <span>
      <b>{link ?? a.title}</b>
      {a.npc ? <span className="faint"> — hand in to {a.npc}</span> : null}
    </span>
  )
}

/** Other characters' names for a sentence: "Kelwyn's", "Kelwyn's and Aldric's". */
export const theirLogs = (keys: string[]) => keys.map((k) => `${k.split('_')[0]}'s`).join(' and ')

/** Where a figure came from. */
export function sourceNote(a: PlanActivity): string {
  if (a.source === 'log') {
    const n = `${(a.seen ?? 0).toLocaleString()} ${a.kind === 'kill' ? 'kills' : 'hand-ins'}`
    if (a.theirs && a.others?.length) return `from ${theirLogs(a.others)} log (${n})`
    if (a.others?.length) return `from your log and ${theirLogs(a.others)} (${n})`
    return `from your log (${n})`
  }
  const site = a.site ?? 'eqlwiki'
  // The named mobs' respawns, eqlwiki's or found in play, which set the camp's pace: "respawn 6:40".
  const back = [...new Set(a.respawnSec ?? [])].map((s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
  const respawn = back.length ? `, respawn ${back.join(', ')}` : ''
  return a.guessed?.length ? `from ${site}, amounts guessed${respawn}` : `from ${site}${respawn}`
}

/** What could make a step slower or rougher than planned: said on the step and on each way to raise an achievement. */
export function Flags({ a }: { a: PlanActivity }) {
  const flags: { tone: string; label: string; why: string }[] = []
  if (a.city)
    flags.push({
      tone: 'warn',
      label: 'city NPCs',
      why: "A city's people: its guards may join in, and the city's own factions drop."
    })
  if (a.blocked)
    flags.push({
      tone: 'warn',
      label: `needs ${a.needs ?? 'better faction'}`,
      why: a.swap?.length
        ? `Your race and classes' con keeps it closed now: it ${a.blocked}. As ${listed(a.swap)} it is open, so the plan may swap in Loadouts for it (Assumptions), or raise the faction first; or lock it in.`
        : `Closed now: it ${a.blocked}. The plan may raise the faction first, where that is quicker than the other ways, or swap to a race it unlocks; or lock it in.`
    })
  if (a.conUnknown?.length)
    flags.push({
      tone: 'warn',
      label: 'con unknown',
      why: `Its NPC wants ${a.needs ?? 'a con'} with ${a.conUnknown.join(' and ')}, and the plan cannot tell yours: the faction is in neither the factions export nor the achievements list, so its race and class modifiers are unknown, or the character has no race on record. The plan counts the standing alone (0 where the export has none), or takes it as open without a race; /con its NPC in game to be sure.`
    })
  if (a.source === 'wiki' && a.guessed?.length)
    flags.push({ tone: '', label: 'amounts guessed', why: 'eqlwiki names the factions but not the amounts: a typical amount stands in until your log measures it.' })
  if (a.items?.some((it) => it.how === 'unknown'))
    flags.push({ tone: 'warn', label: 'item source unknown', why: 'Nothing says where its item comes from, so the time to get it is a guess.' })
  if (a.kind === 'kill' && !a.common && (a.named ?? 0) > 0 && !a.measured)
    flags.push({ tone: '', label: 'named only', why: 'Named or single mobs only: one kill each per respawn.' })
  return (
    <>
      {flags.map((f) => (
        <Tip key={f.label} className={`chip fp-flag ${f.tone}`.trim()} text={f.why}>
          {f.label}
        </Tip>
      ))}
    </>
  )
}
