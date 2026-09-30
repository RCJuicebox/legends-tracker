import { basename } from 'node:path'
import type { AppSettings } from '../shared/types'

// The words of a bug report that do not need the app running: the settings on one line, and any path
// with the Windows user's folder taken out.

/** Paths with the Windows user's folder replaced, so a pasted report does not carry their name. */
export function redact(text: string, home: string): string {
  return home ? text.split(home).join('%USERPROFILE%') : text
}

/** The settings a support question turns on, on one line. */
export function settingsSummary(s: AppSettings, triggers: number, home: string): string {
  const voice = !s.audio.voice ? 'Windows default' : s.audio.voice.startsWith('azure:') ? `Azure ${s.audio.voice.slice(6)}` : s.audio.voice
  const overlays = s.overlays.map((o) => `${o.id}${o.visible ? '' : ' (hidden)'}`).join(', ')
  return redact(
    [
      `game folder ${s.installDir || 'not set'}`,
      `log ${s.logFile ? basename(s.logFile) : 'none'}`,
      `watch at start ${s.autoStart ? 'on' : 'off'}`,
      `overlays ${overlays || 'none'}${s.overlaysOnlyWithGame ? ', only with the game' : ''}`,
      `voice ${voice}${s.audio.muted ? ', muted' : ''}`,
      `tracking ${s.tracking.enabled ? 'on' : 'off'} (self buffs ${s.tracking.selfBuffs ? 'on' : 'off'}, dots ${s.tracking.dots ? 'on' : 'off'}, group buffs ${s.tracking.groupBuffs ? 'on' : 'off'})`,
      `${triggers} trigger${triggers === 1 ? '' : 's'}`,
      `archive ${s.archive.autoEnabled ? `auto at ${s.archive.thresholdMB} MB` : 'by hand'}`,
      `yield to game ${s.yieldToGame ? 'on' : 'off'}`
    ].join('; '),
    home
  )
}
