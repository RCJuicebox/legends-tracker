import { clock, num } from '../../core/format'
import { createReadStream } from 'node:fs'
import { zoneEntered, type LogLine } from '../../core/logLine'
import { CombatMeter, summarize as summarizeFight } from '../../core/combatMeter'
import { LootLedger } from '../../core/loot'
import { RespawnLog, respawnView, type RespawnView } from '../../core/respawns'
import { durationSec } from '../../core/combatView'
import { readLines } from '../../core/logReading'
import { offsetBefore } from '../sources/logHistory'
import { lastZoneLine } from '../game'
import { log } from '../log'
import { Backlog, Throttled } from './throttle'
import type { SpellBook } from '../../core/spells'
import type { CombatSnapshot, Segment } from '../../shared/types'
import type { EngineOutputs, EngineStore, LootView } from './contracts'
import type { Notifier } from './notifier'
import type { BuffCoordinator } from './buffs'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** How often the size of the meter's push is logged while fighting. */
const MEASURE_MS = 5 * 60_000

export interface CombatHooks {
  book: () => SpellBook | null
  /** The zone the status line shows, for a line the meter has not placed. */
  zone: () => string
}

/**
 * The damage meter, the loot ledger and the respawn log, which all read the same lines and file what
 * they find under the meter's fights and sessions. Recent fights are read back from the log when
 * watching starts, with live lines held until that is done so everything is seen in order.
 */
export class CombatFeed {
  readonly meter: CombatMeter
  readonly loot: LootLedger
  /** How long mobs take to respawn, from kills and sightings. */
  readonly respawns: RespawnLog
  readonly backlog = new Backlog<LogLine>()
  private readonly combatOut: Throttled
  private readonly lootOut: Throttled
  private readonly respawnsOut: Throttled

  constructor(
    private readonly store: EngineStore,
    private readonly out: Pick<EngineOutputs, 'combat' | 'loot' | 'respawns'>,
    private readonly notifier: Notifier,
    private readonly buffs: BuffCoordinator,
    private readonly hooks: CombatHooks
  ) {
    this.combatOut = new Throttled(500, () => {
      const snap = this.meter.snapshot()
      this.out.combat(snap)
      this.measure(snap)
    })
    this.lootOut = new Throttled(500, () => this.out.loot(this.lootView()))
    this.respawnsOut = new Throttled(1000, () => this.out.respawns(this.respawnView()))
    this.loot = new LootLedger({
      onChange: () => this.lootOut.mark(),
      onLoot: (e) => {
        // What was kept or merged is news; what auto-loot sold or stored is not, and history is not.
        if (this.backlog.active || (e.outcome !== 'kept' && e.outcome !== 'merged')) return
        const who = e.looter === 'You' ? 'Looted' : `${e.looter} looted`
        this.notifier.pushFeed('loot', `${who} ${e.count > 1 ? `${e.count} × ` : ''}${e.item} from ${e.source}${e.into ? ` → ${e.into}` : ''}`)
      }
    })
    this.meter = new CombatMeter(this.meterConfig(), {
      onChange: () => this.combatOut.mark(),
      onFightEnd: (f) => {
        // Fights read from history are not news.
        if (this.backlog.active || !f.mine) return
        const sum = summarizeFight(f)
        this.notifier.pushFeed('fight', `${sum.name} · ${clock(durationSec(f))} · ${num(sum.dps)} DPS (yours ${num(sum.yours / durationSec(f))})`)
      }
    })
    this.respawns = new RespawnLog(store.respawns.get(), {
      onChange: () => {
        this.store.respawns.set(this.respawns.records)
        this.respawnsOut.mark()
      },
      kindOf: (name) => this.meter.kindOf(name).kind
    })
  }

  private measuredAt = 0

  /**
   * Every five minutes of fighting, how big the meter's push is and how many are in the session:
   * the cost of sending the whole session twice a second, which grows with a raid (README, Measuring).
   */
  private measure(snap: CombatSnapshot): void {
    const now = Date.now()
    if (!this.meter.fighting || this.backlog.active || now - this.measuredAt < MEASURE_MS) return
    this.measuredAt = now
    const started = performance.now()
    const kb = JSON.stringify(snap).length / 1024
    const entities = Object.keys(snap.liveSession?.entities ?? {}).length
    log.info(`Meter push: ${kb.toFixed(0)} KB, ${entities} in the session, ${snap.fights.length} fights kept (${Math.round(performance.now() - started)} ms to measure)`)
  }

  meterConfig() {
    const c = this.store.settings.get().combat
    return {
      fightGapSec: c.fightGapSec,
      newSessionOnZone: c.newSessionOnZone,
      charmPets: c.charmPets,
      charmLand: (spell: string) => {
        const s = this.hooks.book()?.resolve(spell)?.spell
        return s?.category === 'charm' && s.landOther ? s.landOther : undefined
      }
    }
  }

  /** New settings; true when charm pets were switched, which changes whose every past blow was. */
  reconfigure(): boolean {
    const charmWas = this.meter.charmPets
    this.meter.configure(this.meterConfig())
    return charmWas !== this.meter.charmPets
  }

  /** A live line: held while history is read, else through the meter and the rest. */
  live(line: LogLine): void {
    if (!this.backlog.hold(line)) this.line(line)
  }

  /**
   * A line through the damage meter, then the loot ledger, which files loot under the meter's
   * session, and the respawn log, which goes by the meter's idea of who is a mob.
   */
  private line(line: LogLine): void {
    const ev = this.meter.handle(line)
    this.buffs.handle(line.text, line.time)
    this.respawns.handle(line, this.meter.currentZone || this.hooks.zone(), ev)
    const c = line.text.charCodeAt(0)
    if (c === 89 || c === 45) this.loot.handle(line, this.meter.currentZone, this.meter.sessionAt(line.time).id)
  }

  /**
   * Recent fights: the live tailer starts at the end of the log, so the last `minutes` of it are read
   * here first, with live lines held back until the read is done. The meter's clock is held too, or
   * an old fight would be cut off mid-read. `attachedAt` answers where the tailer took over, -1 until
   * it knows; `current` turns false when watching has moved on; `after` is a read to wait for first.
   */
  async seed(logFile: string, attachedAt: () => number, current: () => boolean, minutes: number, after?: Promise<unknown>): Promise<void> {
    if (minutes <= 0 || this.backlog.active) return
    this.backlog.begin()
    this.meter.reading = `Reading the last ${minutes} minutes of the log…`
    this.loot.reading = this.meter.reading
    this.combatOut.mark()
    this.lootOut.mark()
    try {
      // Another read of the same log goes first (catching up on motes at start-up): one at a time.
      await after
      // The tailer reads on from where it attached; history is everything before that.
      for (let i = 0; i < 200 && attachedAt() < 0 && current(); i++) await sleep(25)
      const end = attachedAt()
      if (end > 0 && current()) {
        const since = Date.now() - minutes * 60_000
        // The read starts a few kilobytes early, so a line from before the window only tells the meter
        // which zone it is in; the zone it began in is the last zone line before the read.
        const from = await offsetBefore(logFile, since)
        const entered = from > 0 ? await lastZoneLine(logFile, { end: from }) : null
        if (entered && current()) this.meter.handle(entered)
        if (end > from && current()) {
          const take = (line: LogLine) => {
            if (!current()) return
            if (line.time >= since) this.line(line)
            else if (zoneEntered(line.text)) this.meter.handle(line)
          }
          await readLines(createReadStream(logFile, { start: from, end: end - 1 }), take, { flushLast: false })
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Reading recent fights from ${logFile} failed:`, e)
    } finally {
      for (const line of this.backlog.end()) this.line(line)
      this.meter.reading = ''
      this.loot.reading = ''
      this.combatOut.mark()
      this.lootOut.mark()
    }
  }

  /** Another character: nothing the last one had running applies any more. */
  reset(): void {
    this.meter.reset()
    this.loot.reset()
  }

  tick(now: number): void {
    if (!this.backlog.active) this.meter.tick(now)
    this.combatOut.tick(now)
    this.lootOut.tick(now)
    this.respawnsOut.tick(now)
  }

  /** The page shows which mobs have timers, so it hears when the triggers change. */
  triggersChanged(): void {
    this.respawnsOut.mark()
  }

  respawnView(): RespawnView {
    return respawnView(this.respawns.records, this.store.triggers.get(), this.hooks.zone())
  }

  lootView(): LootView {
    return { ...this.loot.snapshot(), sessions: [...this.meter.sessions].reverse().map((s) => this.meter.summaryOf(s)) }
  }

  snapshot(): CombatSnapshot {
    return this.meter.snapshot()
  }

  segment(id: string): Segment | null {
    return this.meter.segment(id)
  }

  newSession(): CombatSnapshot {
    this.meter.newSession(Date.now())
    this.notifier.pushFeed('fight', 'New session started.')
    return this.meter.snapshot()
  }
}
