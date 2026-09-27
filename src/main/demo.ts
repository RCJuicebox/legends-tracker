import { handle } from './ipc/handle'
import { timerKey } from '../core/spellTracker'
import { CombatMeter } from '../core/combatMeter'
import { parseLogLine } from '../core/logLine'
import type { AppContext } from './context'

// Overlays › Show demo: made-up timers, an alert and a fight, so the player can see and place the
// overlays without playing.

export function registerDemoIpc(ctx: AppContext): void {
  handle('overlays:demo', () => demoTimers(ctx))
}

function demoTimers(ctx: AppContext): void {
  const { engine } = ctx
  const book = engine.book
  const now = Date.now()
  const add = (spellName: string, rank: number, target: string, seconds: number, overlay: string) => {
    const s = book?.named(spellName)
    engine.board.upsert({
      key: timerKey(`demo ${spellName}`, target),
      id: engine.board.nextId(),
      label: spellName,
      target,
      source: 'spell',
      spell: spellName,
      category: s?.category ?? 'buff',
      icon: s?.icon,
      color: s?.beneficial ? '#3fb6a8' : '#b46ae0',
      overlay,
      startedAt: now,
      endsAt: now + seconds * 1000,
      exact: seconds % 2 === 0,
      warnSec: 10,
      rank,
      onWarn: [],
      onExpire: [],
      warned: true,
      graceMs: 0
    })
  }
  add('Spirit of the Puma', 10, 'You', 45, 'buffs')
  add('Slugs Healing', 5, 'Aldric', 22, 'buffs')
  add('Envenomed Bolt', 10, 'A ratman warrior', 54, 'targets')
  add('Odium', 10, 'A ratman warrior', 12, 'targets')
  add('Plague', 7, 'Slizik the Mighty', 96, 'targets')
  ctx.overlays.alert({ text: 'Demo alert — overlays are here', color: '#ffd84d', durationSec: 6 })
  demoCombat(ctx)
}

/**
 * A made-up fight for the meter windows, run through a meter of its own so the real one keeps its
 * fights. The next real snapshot replaces it.
 */
function demoCombat(ctx: AppContext): void {
  const me = ctx.engine.status.character || 'Kelwyn'
  const meter = new CombatMeter({ fightGapSec: 10, newSessionOnZone: true })
  meter.setSelf(me)
  const stamp = (t: number) => {
    const d = new Date(t)
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]
    const two = (n: number) => String(n).padStart(2, '0')
    return `${day} ${mon} ${String(d.getDate()).padStart(2, ' ')} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} ${d.getFullYear()}`
  }
  const t0 = Date.now() - 42_000
  const lines: [number, string][] = [
    [0, 'You have entered The Plane of Fear 4 (Refined).'],
    [1, "Jobarab told you, 'Attacking a fetid fiend Master.'"],
    [1, 'Aldric has joined the group.'],
    [1, 'You punch a fetid fiend for 142 points of damage.'],
    [1, 'Jobarab slashes a fetid fiend for 61 points of damage.'],
    [2, 'A fetid fiend hits YOU for 95 points of damage.'],
    [2, 'You kick a fetid fiend for 611 points of damage. (Critical)'],
    [3, 'Aldric hit a fetid fiend for 402 points of magic damage by Ice Spear.'],
    [4, 'You try to punch a fetid fiend, but miss!'],
    [4, 'A fetid fiend tries to hit YOU, but YOU dodge!'],
    [5, 'A fetid fiend has taken 525 damage from your Envenomed Bolt X.'],
    [6, 'Brenna slashes a fetid fiend for 88 points of damage.'],
    [7, 'Aldric healed Kelwyn for 320 (410) hit points by Superior Healing.'],
    [8, 'You strike a fetid fiend for 129 points of damage. (Critical)'],
    [9, 'A fetid fiend is pierced by YOUR thorns for 3 points of non-melee damage.'],
    [11, 'A fetid fiend has taken 534 damage from your Envenomed Bolt X.'],
    [12, 'Jobarab hit a fetid fiend for 200 points of prismatic damage by Puma Maw V.'],
    [14, 'You punch a fetid fiend for 156 points of damage.'],
    [15, 'A fetid fiend hits YOU for 122 points of damage.'],
    [17, 'A fetid fiend has taken 540 damage from your Envenomed Bolt X.'],
    [18, 'Brenna hit a fetid fiend for 260 points of cold damage by Frost Spear.'],
    [20, 'You bash a fetid fiend for 214 points of damage.'],
    [21, 'You have slain a fetid fiend!']
  ]
  for (const [sec, text] of lines) {
    const line = parseLogLine(`[${stamp(t0 + sec * 1000)}] ${text.replace(/Kelwyn/g, me)}`)
    if (line) meter.handle(line)
  }
  const snap = meter.snapshot()
  ctx.overlays.combat(snap)
  ctx.windows.toMain('state:combat', snap)
}
