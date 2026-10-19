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
      /**
       * What the bar is about, as snippets ("{S1}"), for a grouped overlay to put it under its mob
       * (LT-745). Absent: what the phrase caught as ${Target}, {S1} or {S}.
       */
      target?: string
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
  /** When it may fire beyond its phrase matching (FEAT-030); none means always. */
  when?: TriggerWhen
}

/** A number snippet against a value: "{N1} over 300". */
export interface TriggerCompare {
  /** The snippet: "N", "N1" … "N9". */
  snippet: string
  op: '>' | '>=' | '<' | '<=' | '='
  value: number
}

/** A trigger's conditions (FEAT-030): each one set must hold for it to fire. */
export interface TriggerWhen {
  /** Only in a zone whose name holds this text, any case. */
  zone?: string
  /** Only while fighting (true) or only out of a fight (false). */
  fighting?: boolean
  /** Only for these characters, by name (the log's): an alt's triggers stay its own. */
  characters?: string[]
  /** Only on the n-th match within so many seconds ("the third resist in 20 s"); the count starts again after it fires. */
  count?: { n: number; withinSec: number }
  compare?: TriggerCompare
}

export interface TriggerTestResult {
  matched: boolean
  phraseIndex: number
  captures: Record<string, string>
  outputs: string[]
  error: string
}
