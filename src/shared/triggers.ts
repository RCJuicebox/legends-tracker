// Triggers: a log phrase and what it sets off.

export interface Phrase {
  text: string
  regex: boolean
}

export type TriggerAction =
  | { type: 'speak'; text: string; interrupt: boolean }
  | { type: 'sound'; file: string; volume: number }
  | { type: 'text'; text: string; color: string; durationSec: number }
  | {
      type: 'timer'
      name: string
      durationSec: number
      color: string
      overlay: string
      warnSec: number
      warnSpeech: string
      endSpeech: string
      restart: 'restart' | 'ignore'
      endEarly: Phrase[]
    }

export interface Trigger {
  id: string
  name: string
  folder: string
  enabled: boolean
  comment: string
  phrases: Phrase[]
  cooldownSec: number
  actions: TriggerAction[]
}

export interface TriggerTestResult {
  matched: boolean
  phraseIndex: number
  captures: Record<string, string>
  outputs: string[]
  error: string
}
