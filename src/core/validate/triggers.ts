import { type Phrase, type Trigger, type TriggerAction } from '../../shared/types'
import { TRIGGER_TIMER_COLOR } from '../../shared/overlays'
import { isObj } from './args'
import { bool, num, oneOf, str } from './settings'

// triggers.json and a trigger the tester is given.

export function phrases(v: unknown): Phrase[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((p): Phrase[] => {
    if (typeof p === 'string') return [{ text: p, regex: false }]
    if (!isObj(p) || typeof p.text !== 'string') return []
    return [{ text: p.text, regex: bool(p.regex, false) }]
  })
}

export const DAY = 86_400

export function action(v: unknown): TriggerAction | null {
  if (!isObj(v)) return null
  switch (v.type) {
    case 'speak':
      return { type: 'speak', text: str(v.text, ''), interrupt: bool(v.interrupt, false) }
    case 'sound':
      return { type: 'sound', file: str(v.file, ''), volume: num(v.volume, 1, 0, 1) }
    case 'text':
      return { type: 'text', text: str(v.text, ''), color: str(v.color, '#ffd84d'), durationSec: num(v.durationSec, 5, 0, 3600) }
    case 'timer':
      return {
        type: 'timer',
        name: str(v.name, ''),
        durationSec: num(v.durationSec, 30, 0, 7 * DAY),
        color: str(v.color, TRIGGER_TIMER_COLOR),
        overlay: str(v.overlay, 'targets'),
        warnSec: num(v.warnSec, 0, 0, 7 * DAY),
        warnSpeech: str(v.warnSpeech, ''),
        endSpeech: str(v.endSpeech, ''),
        restart: oneOf(v.restart, ['restart', 'ignore'] as const, 'restart'),
        endEarly: phrases(v.endEarly)
      }
    default:
      return null
  }
}

let idSeq = 0

/**
 * A list of triggers from a page or an imported file. Entries that are not objects are dropped;
 * missing fields get the new-trigger defaults; unknown action types are dropped. Null when it is
 * not a list at all.
 */
export function sanitizeTriggers(v: unknown): Trigger[] | null {
  if (!Array.isArray(v)) return null
  return v.flatMap((t): Trigger[] => {
    if (!isObj(t)) return []
    return [
      {
        id: typeof t.id === 'string' && t.id ? t.id : `t${Date.now().toString(36)}${(idSeq++).toString(36)}`,
        name: str(t.name, 'Trigger'),
        folder: str(t.folder, ''),
        enabled: bool(t.enabled, true),
        comment: str(t.comment, ''),
        phrases: phrases(t.phrases),
        cooldownSec: num(t.cooldownSec, 0, 0, DAY),
        actions: Array.isArray(t.actions) ? t.actions.map(action).filter((x) => x !== null) : []
      }
    ]
  })
}

/** One trigger, as the trigger tester takes it. */
export function sanitizeTrigger(v: unknown): Trigger | null {
  return sanitizeTriggers([v])?.[0] ?? null
}
