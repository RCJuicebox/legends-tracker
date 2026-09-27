import { useEffect } from 'react'
import { api, ago } from '../api'
import { useApp, useLive } from '../state'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { useCombat } from '../combat'
import { useNow } from './TimerBars'
import { durationSec, fmtClock, fmtNum } from '../../../core/combatView'
import { fmtCoin } from '../../../core/loot'
import type { PageId } from '../main'

// The Live page's summaries: what to set up still, a log that has gone quiet, the fight in hand and
// the session so far.

/** Remembered once the overlays have been arranged: the checklist's last step. */
export const ARRANGED_KEY = 'setup.arranged'

/** How long the log may go without a line while the game runs before the Live page asks why. */
const QUIET_MS = 5 * 60_000

type Go = (p: PageId) => void

interface Step {
  id: string
  done: boolean
  text: string
  page: PageId
  button: string
  /** Marks a step as fine as it is, where "done" is a matter of taste (the audio device). */
  accept?: string
}

/** First-run setup, step by step, until every step is done or the player hides it. */
export function SetupChecklist({ go }: { go: Go }) {
  const { state } = useApp()
  const spellsLoaded = useLive((l) => l.status.spellsLoaded)
  const [hidden, setHidden] = useRemembered<boolean>('setup.hidden', false)
  const [accepted, setAccepted] = useRemembered<string[]>('setup.accepted', [])
  // Set by the shell whenever the overlays are arranged, from anywhere.
  const [arranged] = useRemembered<boolean>(ARRANGED_KEY, false)
  const s = state.settings
  const steps: Step[] = [
    { id: 'folder', done: !!s.installDir && spellsLoaded > 0, text: 'Find the game folder, so spells can be timed', page: 'settings', button: 'Settings' },
    { id: 'log', done: !!s.logFile, text: 'Choose your character log (type /log on in game if there is none)', page: 'settings', button: 'Settings' },
    {
      id: 'classes',
      done: Object.keys(state.character.classLevels).length > 0,
      text: 'Set your classes and their levels, so durations use the right level',
      page: 'stats',
      button: 'Stats'
    },
    { id: 'audio', done: s.audio.deviceId !== 'default', text: 'Pick where speech and sounds play', page: 'audio', button: 'Audio', accept: 'The default is fine' },
    {
      id: 'overlays',
      done: arranged,
      text: 'Place the overlays over your game (Arrange, drag, then Lock)',
      page: 'overlays',
      button: 'Overlays',
      accept: 'They are fine where they are'
    }
  ]
  const left = steps.filter((x) => !x.done && !accepted.includes(x.id))
  if (hidden || !left.length) return null
  return (
    <div className="card mb-16">
      <h2>
        Getting set up{' '}
        <span className="chip">
          {steps.length - left.length} of {steps.length}
        </span>
        <span className="spacer" />
        <button className="btn small ghost" onClick={() => setHidden(true)}>
          Hide
        </button>
      </h2>
      <div className="stack gap-6">
        {steps.map((x) => {
          const ok = x.done || accepted.includes(x.id)
          return (
            <div key={x.id} className="row">
              <span className={`chip ${ok ? 'ok' : 'warn'}`}>{ok ? 'Done' : 'To do'}</span>
              <span className={`grow${ok ? ' faint' : ''}`}>{x.text}</span>
              {!ok && x.accept && (
                <button className="btn small ghost" onClick={() => setAccepted([...accepted, x.id])}>
                  {x.accept}
                </button>
              )}
              {!ok && (
                <button className="btn small" onClick={() => go(x.page)}>
                  {x.button}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The game runs but the watched log gets nothing: logging off, or another character being played. */
export function QuietLogNotice({ go }: { go: Go }) {
  const status = useLive((l) => l.status)
  const gameRunning = useLive((l) => l.archive.gameRunning)
  const now = useNow(30_000)
  const quiet = status.watching && gameRunning && status.lastLineAt > 0 && now - status.lastLineAt > QUIET_MS
  if (!quiet || status.elsewhere) return null
  return (
    <div className="notice warn mb-16">
      The game is running, but {status.character || 'this character'}&apos;s log has had nothing new since {ago(status.lastLineAt, now)}. Is logging on (type{' '}
      <span className="mono">/log on</span>), and is this the character you are playing?{' '}
      <button className="btn small" onClick={() => go('settings')}>
        Choose the log
      </button>
    </div>
  )
}

/** The fight in hand (or the last one) and the session so far, with the meter a click away. */
export function FightSummary({ go }: { go: Go }) {
  const snap = useCombat()
  const lootQ = useInvoke('loot:get')
  const setLoot = lootQ.setData
  useEffect(() => api.on('state:loot', (v) => setLoot(v)), [setLoot])
  useNow(1000)
  const fight = snap?.liveFight ?? null
  const last = snap?.fights[0]
  const session = snap?.liveSession ?? null
  if (!snap || (!fight && !last && !session)) return null
  const fightsInSession = session ? snap.fights.filter((f) => f.startedAt >= session.startedAt).length : 0
  const coin = session ? lootQ.data?.coin[session.id] : undefined
  const sessionHours = session ? Math.max(durationSec(session) / 3600, 1 / 60) : 0
  return (
    <div className="grid two mb-16">
      <button className="card stat card-button" onClick={() => go('meter')}>
        <span className="label">{fight?.open ? 'Fighting' : 'Last fight'}</span>
        <span className="value">{fight ? fight.name || 'Fight' : (last?.name ?? '—')}</span>
        <span className="sub">
          {fight
            ? `${fmtClock(durationSec(fight))} · ${fmtNum(fight.kills)} killed`
            : last
              ? `${fmtClock((last.endedAt - last.startedAt) / 1000)} · ${fmtNum(last.dps)} DPS, yours ${fmtNum(last.yours / Math.max(1, (last.endedAt - last.startedAt) / 1000))}`
              : ''}
        </span>
      </button>
      <button className="card stat card-button" onClick={() => go('meter')}>
        <span className="label">This session{session?.zone ? ` · ${session.zone}` : ''}</span>
        <span className="value">
          {fightsInSession} fight{fightsInSession === 1 ? '' : 's'} · {session?.kills ?? 0} killed · {session?.deaths ?? 0} died
        </span>
        <span className="sub">
          {session
            ? `${fmtClock(durationSec(session))} · coin ${fmtCoin((coin?.corpse ?? 0) + (coin?.sales ?? 0))} · ${Math.round((session.kills ?? 0) / sessionHours)} kills/hour`
            : 'no session yet'}
        </span>
      </button>
    </div>
  )
}
