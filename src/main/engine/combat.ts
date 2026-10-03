import { clock, num } from '../../core/format'
import { createReadStream } from 'node:fs'
import { zoneEntered, type LogLine } from '../../core/logLine'
import { CombatMeter, SAME_NAME_MS, summarize as summarizeFight } from '../../core/combatMeter'
import { LootLedger } from '../../core/loot'
import { RespawnLog, respawnView, type RespawnView } from '../../core/respawns'
import { durationSec } from '../../core/combatView'
import { readLines } from '../../core/logReading'
import { lineStartAfter, offsetBefore } from '../sources/logHistory'
import { lastZoneLine } from '../game'
import { log } from '../log'
import { Backlog, Throttled } from '../../core/throttle'
import type { SpellBook } from '../../core/spells'
import type { CombatSnapshot, Segment } from '../../shared/types'
import type { EngineOutputs, EngineStore, LootView } from './contracts'
import type { EngineFeature } from './feature'
import type { Notifier } from './notifier'
import type { BuffCoordinator } from './buffs'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** How often the size of the meter's push is logged while fighting. */
const MEASURE_MS = 5 * 60_000
/** The most of the log read back for recent fights: a raid's last ten minutes or so, a second or two of reading. */
const SEED_MAX_BYTES = 24 * 2 ** 20

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
export class CombatFeed implements EngineFeature {
  readonly id = 'combat'
  /** SEED_MAX_BYTES, which a test may lower. */
  static seedMaxBytes = SEED_MAX_BYTES
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
        // Fights read from history are not news. Said once it is over for good: another of the same
        // name may take it up again for a few seconds (SAME_NAME_MS), and it is said at its real end.
        if (this.backlog.active || !f.mine) return
        setTimeout(() => {
          if (f.open || this.said.has(f)) return
          this.said.add(f)
          const sum = summarizeFight(f)
          this.notifier.pushFeed('fight', `${sum.name} · ${clock(durationSec(f))} · ${num(sum.dps)} DPS (yours ${num(sum.yours / durationSec(f))})`)
        }, SAME_NAME_MS + 250).unref?.()
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

  /** Fights said in the feed, so one taken up again is said once. */
  private said = new WeakSet<Segment>()
  private measuredAt = 0

  /**
   * Every five minutes of fighting, how big the meter's push is and how many are in the session:
   * the cost of sending the live fight and every summary twice a second (the session goes as a summary;
   * a page showing it fetches it), which grows with a raid (README, Measuring).
   */
  private measure(snap: CombatSnapshot): void {
    const now = Date.now()
    if (!this.meter.fighting || this.backlog.active || now - this.measuredAt < MEASURE_MS) return
    this.measuredAt = now
    const started = performance.now()
    const kb = JSON.stringify(snap).length / 1024
    const entities = Object.keys(this.meter.liveSession?.entities ?? {}).length
    // The open session as a page showing it fetches it every two seconds (LT-366: kept so, but seen).
    const sessionKb = this.meter.liveSession ? JSON.stringify(this.meter.liveSession).length / 1024 : 0
    log.info(
      `Meter push: ${kb.toFixed(0)} KB, ${entities} in the session, ${snap.fights.length} fights kept; the session itself ${sessionKb.toFixed(0)} KB a fetch (${Math.round(performance.now() - started)} ms to measure)`
    )
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
  applySettings(): boolean {
    const charmWas = this.meter.charmPets
    this.meter.configure(this.meterConfig())
    return charmWas !== this.meter.charmPets
  }

  /** A live line: held while history is read, else through the meter and the rest. */
  line(line: LogLine): void {
    if (!this.backlog.hold(line)) this.read(line)
  }

  /**
   * A line through the damage meter, then the loot ledger, which files loot under the meter's
   * session, and the respawn log, which goes by the meter's idea of who is a mob.
   */
  private read(line: LogLine): void {
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
        // which zone it is in; the zone it began in is the last zone line before the read. A raid's hour
        // can be 150 MB: past SEED_MAX_BYTES, only the last of it is read.
        let from = await offsetBefore(logFile, since)
        const cap = CombatFeed.seedMaxBytes
        if (end - from > cap) {
          log.info(`Recent fights: the last ${minutes} minutes are ${Math.round((end - from) / 2 ** 20)} MB of log; reading the last ${Math.round(cap / 2 ** 20)} MB of them.`)
          from = await lineStartAfter(logFile, end - cap)
        }
        const entered = from > 0 ? await lastZoneLine(logFile, { end: from }) : null
        if (entered && current()) this.meter.handle(entered)
        if (end > from && current()) {
          const take = (line: LogLine) => {
            if (!current()) return
            if (line.time >= since) this.read(line)
            else if (zoneEntered(line.text)) this.meter.handle(line)
          }
          // A chunk at a time between yields, so the timers and overlays keep going while it reads; and
          // it gives up once the live lines held back while it reads grow too many.
          const stop = () => !current() || this.backlog.full
          await readLines(createReadStream(logFile, { start: from, end: end - 1 }), take, { flushLast: false, yieldEvery: 1, stop })
          if (this.backlog.full) log.warn(`Recent fights: the log grew faster than it could be read back; stopped reading history at ${this.backlog.size} live lines held.`)
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Reading recent fights from ${logFile} failed:`, e)
    } finally {
      for (const line of this.backlog.end()) this.read(line)
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
