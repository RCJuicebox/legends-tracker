import type { UpdateState } from '../shared/runtime'
import type { EngineOutputs } from './engine/contracts'
import type { Pushes, PushChannel } from '../shared/ipc'
import type { CharacterSettings, WatchStatus } from '../shared/types'
import type { SelfWho } from '../core/selfWho'
import { describeClasses, recordFromWho } from '../core/selfWho'
import { respawnChanges } from '../core/respawns'
import { sources } from './sources/registry'
import { log } from './log'
import type { PetStore } from './pets'

// What createContext wires, as functions of what they need (LT-638): the update notices and the
// engine's outputs, each testable without an app around it.

type ToMain = <K extends PushChannel>(channel: K, ...args: Parameters<Pushes[K]>) => void

export interface UpdateDeps {
  toMain: ToMain
  pushFeed: (kind: 'info' | 'warn', text: string) => void
  /** A Windows notification, said once per key; clicking it runs `onClick`. */
  announce: (key: string, title: string, body: string, onClick: () => void) => void
  showMain: () => void
  install: (unasked?: boolean) => void
  autoRestart: () => boolean
  heldBack: (version: string) => boolean
  /** How play stands, for a restart at the next lull. */
  play: () => { fighting: boolean; lastLineAt: number; watching: boolean; gameInFront: boolean }
  now?: () => number
  later?: (fn: () => void, ms: number) => void
}

/** What the app does with each update state: the Data Sources row, the feed, a notice, and a restart at a lull when asked for. */
export function updateListener(d: UpdateDeps): (s: UpdateState) => void {
  const now = d.now ?? Date.now
  const later = d.later ?? ((fn, ms) => void setTimeout(fn, ms).unref())
  let lastUpdate = 'idle'
  let lastUpdateCheck = 0
  return (s) => {
    d.toMain('state:update', s)
    const was = lastUpdate
    lastUpdate = s.state
    if (s.state === 'idle' && s.checkedAt) lastUpdateCheck = s.checkedAt
    // Offline is not a fault of the updater: said plainly, with when it last got through, rather than
    // a red error first in every diagnostics paste all evening (LT-444).
    if (s.state === 'error' && /could not reach GitHub/.test(s.message))
      sources.missing(
        'updates',
        `Offline: GitHub could not be reached; ${lastUpdateCheck ? `last checked ${new Date(lastUpdateCheck).toLocaleString()}` : 'not checked yet this run'}. Tried again within the hour.`
      )
    else if (s.state === 'error') sources.fail('updates', new Error(s.message))
    else if (s.state === 'idle') sources.ok('updates', s.checkedAt ? `Up to date, checked ${new Date(s.checkedAt).toLocaleTimeString()}` : 'Up to date')
    else if (s.state === 'ready') sources.ok('updates', `${s.version} downloaded; installs at restart`)
    else if (s.state === 'downloading') sources.reading('updates', `Downloading ${s.version}, ${s.percent}%`)
    else if (s.state === 'dev') sources.missing('updates', 'Running from source: only the installed app updates.')
    if (s.state === 'error' && was === 'downloading') {
      // A download that failed is said once; the next hourly check tries again.
      d.pushFeed('warn', `The update could not be downloaded: ${s.message}. It will be tried again within the hour.`)
      d.announce(`failed:${now() - (now() % 86_400_000)}`, 'Legends Tracker could not download its update', `${s.message}. It will be tried again within the hour.`, d.showMain)
    } else if (s.state === 'downloading') {
      d.announce(`found:${s.version}`, `Legends Tracker ${s.version} is available`, 'Downloading it now. You can restart into it once it has arrived.', d.showMain)
    } else if (s.state === 'ready' && d.autoRestart() && d.heldBack(s.version)) {
      // Its install was started last time and did not take: not again by itself (LT-597).
      d.pushFeed('warn', `Version ${s.version} has downloaded again, but its install did not take last time: Restart and update on Settings › General tries once more.`)
    } else if (s.state === 'ready' && d.autoRestart()) {
      // The player chose not to be asked: restart into it at the first lull in play, so no fight's
      // timers are lost to it (LT-430): never mid-fight, and otherwise with the log quiet a minute or
      // the game not in front (alt-tabbed mid-pull is still mid-fight, LT-598), looked at every half
      // minute, and at most two hours on.
      d.pushFeed('info', `Version ${s.version} has downloaded: restarting into it at the next lull in play.`)
      log.info(`Restarting into ${s.version} by itself at the next lull (Restart into updates by itself is on)`)
      const readyAt = now()
      const atLull = () => {
        const p = d.play()
        const quiet = now() - p.lastLineAt > 60_000
        if ((!p.fighting && (quiet || !p.gameInFront)) || !p.watching || now() - readyAt > 2 * 3600_000) d.install(true)
        else later(atLull, 30_000)
      }
      later(atLull, 2000)
    } else if (s.state === 'ready') {
      d.pushFeed('info', `Version ${s.version} is ready: restart to update.`)
      d.announce(`ready:${s.version}`, `Legends Tracker ${s.version} is ready`, 'Click to restart and update. Your settings and overlays stay as they are.', () => d.install())
    }
  }
}

export interface OutputDeps {
  toMain: ToMain
  /** Whether the main window takes this live view now (Windows.mainWatches). */
  mainWatches: (channel: PushChannel) => boolean
  overlays: () => { timers: EngineOutputs['timers']; alert: EngineOutputs['alert']; combat: EngineOutputs['combat'] }
  toAudio: EngineOutputs['audio']
  combatToMain: EngineOutputs['combat']
  reportStatus: (s: WatchStatus) => void
  characterKey: () => string
  /** The pet store: merges an update (true when it changed anything), and the record as it now stands. */
  pet: Pick<PetStore, 'merge' | 'get'>
  /** The record of a character, and keeping a new one. */
  record: { get: (key: string) => CharacterSettings | null; set: (key: string, rec: CharacterSettings) => void }
  reconfigure: () => void
}

/** Where the engine's views go: the overlays and the main window, the latter only what changed where it can (LT-369, LT-555). */
export function engineOutputs(d: OutputDeps): EngineOutputs {
  /** The newest loot entry the main window was sent whole or added to; 0 when it should get the whole list. */
  let lootSent = 0
  /** The respawn rows the main window has, by key (respawnChanges). */
  const respawnSent = new Map<string, string>()
  return {
    timers: (views) => {
      d.overlays().timers(views)
      d.toMain('state:timers', views)
    },
    alert: (p) => d.overlays().alert(p),
    audio: (cmd) => d.toAudio(cmd),
    status: (s) => {
      d.toMain('state:status', s)
      d.reportStatus(s)
    },
    feed: (item) => d.toMain('state:feed', item),
    archive: (a) => d.toMain('state:archive', a),
    motes: (m) => d.toMain('state:motes', m),
    moteScan: (s) => d.toMain('state:moteScan', s),
    stock: (s) => d.toMain('state:stock', s),
    combat: (snap) => {
      d.overlays().combat(snap)
      d.combatToMain(snap)
    },
    loot: (view) => {
      // The main window has the entries up to the newest it was sent: only those after go (LT-369).
      // Hidden, or with no page listening, it is sent the whole list, as only the last push is kept for it.
      const newest = view.entries[0]?.id ?? 0
      const oldest = view.entries.at(-1)?.id ?? 0
      const sent = d.mainWatches('state:loot')
      const push = sent && lootSent > 0 && newest >= lootSent ? { ...view, entries: view.entries.filter((e) => e.id > lootSent), addedOnly: { oldest } } : view
      lootSent = sent ? newest : 0
      d.toMain('state:loot', push)
    },
    // The rows that changed, while the window shows; the whole view while it is hidden, so the one held for it is whole (LT-555).
    respawns: (view) => {
      if (!d.mainWatches('state:respawns')) {
        respawnSent.clear()
        return d.toMain('state:respawns', view)
      }
      const first = !respawnSent.size
      const changes = respawnChanges(view, respawnSent)
      if (first) d.toMain('state:respawns', view)
      else if (changes) d.toMain('state:respawns', changes)
    },
    pet: (update) => {
      const character = d.characterKey()
      if (!character) return
      void d.pet.merge(character, update).then(async (changed) => changed && d.toMain('state:pet', { character, ...(await d.pet.get(character)) }))
    },
    push: d.toMain,
    // A /who of yourself names your race and classes: the character record follows them, so a change
    // of either reaches the faction cons, the AC sums, spell durations and the gear you can wear.
    selfSeen: (who: SelfWho) => {
      const key = d.characterKey()
      const rec = key ? d.record.get(key) : null
      const next = rec ? recordFromWho(rec, who) : null
      if (!key || !rec || !next) return
      if (next.race !== rec.race) log.info(`Race for ${key}: ${rec.race || 'none'} → ${next.race} (from /who).`)
      const [was, now] = [describeClasses(rec.classLevels), describeClasses(next.classLevels)]
      if (was !== now) log.info(`Classes for ${key}: ${was} → ${now} (from /who).`)
      d.record.set(key, next)
      d.reconfigure()
      d.toMain('state:character', next)
    }
  }
}
