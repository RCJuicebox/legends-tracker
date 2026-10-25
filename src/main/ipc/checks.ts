import type { InvokeChannel, Invokes } from '../../shared/ipc'

/**
 * The first look at what a page sends on each invoke channel (LT-754), run by `handle` before the handler:
 * the right number of arguments of the right kinds, or the call is refused. Typed over the contract, so a
 * channel added without its entry, or with the wrong kinds, does not compile. An object or a list is only
 * checked to be one here: its handler still puts it through its sanitiser before storing it or building a
 * path from it.
 */

/** A value that failed its check. */
const BAD = Symbol('bad')
/** One argument's check, with the kind it takes named, for the handler tests to send that kind (LT-754). */
type Arg<T> = ((v: unknown) => T | typeof BAD) & { readonly kind: string }
/** A channel's check, with the kinds of its arguments in order. */
export type Check<P extends unknown[]> = ((args: readonly unknown[]) => P | null) & { readonly kinds: readonly string[] }

const arg = <T>(kind: string, fn: (v: unknown) => T | typeof BAD): Arg<T> => Object.assign(fn, { kind })
const str = arg<string>('string', (v) => (typeof v === 'string' ? v : BAD))
const num = arg<number>('number', (v) => (typeof v === 'number' && Number.isFinite(v) ? v : BAD))
const bool = arg<boolean>('boolean', (v) => (typeof v === 'boolean' ? v : BAD))
const strs = arg<string[]>('strings', (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : BAD))
/** An object, its fields left to the handler's sanitiser: typed `never` so it stands for any one. */
const obj = arg<never>('object', (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as never) : BAD))
/** A list, its items left to the handler's sanitiser. */
const list = arg<never>('list', (v) => (Array.isArray(v) ? (v as never) : BAD))
const opt = <T>(c: Arg<T>): Arg<T | undefined> => arg(`${c.kind}?`, (v) => (v === undefined ? undefined : c(v)))
const nullable = <T>(c: Arg<T>): Arg<T | null> => arg(`${c.kind}|null`, (v) => (v === null ? null : c(v)))
const oneOf = <T extends string>(...values: T[]): Arg<T> => arg(`oneOf:${values.join(',')}`, (v) => (values.includes(v as T) ? (v as T) : BAD))

/** The channel's arguments, each through its check; more than it takes are dropped. */
function args<T extends unknown[]>(...checks: { [I in keyof T]: Arg<T[I]> }): Check<T> {
  const each = checks as readonly Arg<unknown>[]
  const check = (given: readonly unknown[]) => {
    const out: unknown[] = []
    for (const c of each) {
      const v = c(given[out.length])
      if (v === BAD) return null
      out.push(v)
    }
    // Trailing optional arguments left out, or sent as undefined, are not passed on.
    while (out.length && out[out.length - 1] === undefined) out.pop()
    return out as T
  }
  return Object.assign(check, { kinds: each.map((c) => c.kind) })
}
const none: Check<[]> = Object.assign(() => [] as [], { kinds: [] })

export const CHECKS: { [K in InvokeChannel]: Check<Parameters<Invokes[K]>> } = {
  'app:state': none,
  'app:openLogs': none,
  'app:diagnostics': none,
  'app:bugReport': none,
  'setup:export': none,
  'setup:open': none,
  'setup:apply': args(strs),
  'setup:undo': none,
  simulate: args(str),
  'groupHealth:selfTest': none,
  'groupHealth:calibrate': none,
  'settings:save': args(obj),
  'character:save': args(obj),
  'character:get': args(str),
  'character:put': args(str, obj),
  'watch:start': none,
  'watch:stop': none,
  'triggers:get': none,
  'triggers:save': args(list),
  'triggers:test': args(obj, str),
  'triggers:import': none,
  'triggers:export': args(list),
  'triggers:defaults': none,
  'triggers:importGina': none,
  'triggers:exportGina': args(list),
  'spells:known': none,
  'spells:search': args(str),
  'spells:rule': args(str, nullable(obj)),
  'spells:checkLog': args(num),
  'spells:resists': none,
  'focus:search': args(str),
  'logs:list': none,
  'logs:overview': none,
  'logs:archive': args(str),
  'logs:compress': args(str),
  'logs:reveal': args(str),
  'logs:folders': args(opt(bool)),
  'logs:followOther': args(nullable(str)),
  'logs:addFolder': none,
  'overlays:arrange': args(bool),
  'overlays:demo': none,
  'combat:get': none,
  'combat:segment': args(str),
  'combat:sessionTimeline': args(str),
  'overlay:hostState': args(num),
  'combat:newSession': none,
  'combat:addMember': args(str),
  'combat:removeMember': args(str),
  'combat:clearGroup': none,
  'combat:rebuild': args(num),
  'loot:get': none,
  'loot:offers': none,
  'loot:byMob': none,
  'trade:wanted': none,
  'hunter:autoTimers': args(bool),
  'buffs:get': none,
  'buffs:setWanted': args(nullable(strs)),
  'respawns:get': none,
  'respawns:setTimer': args(obj),
  'respawns:removeTimer': args(str),
  'respawns:forget': args(str),
  'respawns:link': args(obj),
  'respawns:unlink': args(str),
  'trade:recipes': none,
  'trade:refresh': none,
  'trade:craftEras': none,
  'trade:purchases': args(str),
  'trade:favorites': none,
  'trade:saveFavorites': args(obj),
  'pet:state': args(str, strs, num),
  'pet:profile': args(str, opt(bool)),
  'motes:get': none,
  'motes:start': none,
  'motes:stop': none,
  'motes:pause': args(opt(num)),
  'motes:resume': none,
  'motes:rescan': none,
  'motes:setKind': args(str, oneOf('crawl', 'instance')),
  'motes:forget': args(str),
  'motes:spellCasts': args(str, num),
  'stock:get': none,
  'stock:counts': args(obj),
  'stock:item': args(obj),
  'stock:autoAdd': args(bool),
  'stock:apply': none,
  'stock:readScreen': none,
  'update:status': none,
  'update:check': none,
  'update:install': none,
  'audio:test': args(str),
  'audio:sound': args(str),
  'audio:sounds': none,
  'audio:watchDevices': args(bool),
  'audio:voices': none,
  'audio:kokoro': none,
  'achievements:load': args(str),
  'achievements:marks': args(str, obj),
  'achievements:progress': args(str),
  'factions:get': args(str),
  'factions:sources': args(str),
  'factions:plan': args(str, opt(bool), opt(bool)),
  'factions:moved': args(str, str),
  'factions:lookup': args(str, str),
  'factions:follow': args(str, nullable(obj)),
  'factions:follow-step': args(str, num),
  'slayer:plan': args(str, opt(bool)),
  'slayer:kills': args(str),
  'slayer:choices': args(str, obj),
  'slayer:map': args(str, strs),
  'slayer:mark': args(list, opt(oneOf('hunter'))),
  'slayer:said': none,
  'slayer:sayRace': args(str, nullable(str)),
  'hunter:plan': args(str),
  'hunter:broken': args(str, bool),
  'hunter:found': args(str, str, str, str),
  'hunter:unfound': args(str, str, num),
  'hunter:foundSpots': none,
  'sky:state': args(str),
  'sky:wish': args(str, str, num, opt(num)),
  'sky:have': args(str, str, num),
  'sky:mark': args(str, str, oneOf('favorite', 'ignored'), bool),
  'sky:turnIns': args(str, str, num),
  'epics:state': args(str),
  'epics:tick': args(str, str, bool),
  'epics:have': args(str, str, num),
  'epics:zoneAlert': args(opt(bool)),
  'achievements:track': args(opt(bool)),
  'game:location': none,
  'character:exports': none,
  'character:sheet': args(str),
  'character:saveSheet': args(str, obj),
  'inventory:load': args(str, opt(bool)),
  'inventory:lookup': args(strs, opt(bool)),
  'gear:catalog': args(opt(num)),
  'gear:catalogRefresh': none,
  'gear:foci': args(strs, strs, num, str, num),
  'gear:effects': args(strs, str, num),
  'stats:caps': args(strs, num),
  'stats:fromLog': args(str, num),
  'stats:readAAs': args(str),
  'stats:aaHistory': args(str),
  'stats:readScreen': none,
  'game:check': args(opt(str)),
  'game:find': none,
  'game:choose': none,
  'skins:builds': none,
  'skins:list': none,
  'skins:build': args(str, str, opt(bool)),
  'skins:layout': args(str, str),
  'skins:saveLayout': args(str, obj),
  'dialog:folder': none,
  'sources:list': none,
  'jobs:list': none,
  'jobs:cancel': args(str),
  'sources:refresh': args(str)
}
