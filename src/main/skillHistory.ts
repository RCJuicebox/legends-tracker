import { joinSkillValues, skillUp, type SkillValues } from '../core/skillAchievements'
import type { HistoryConsumer, HistoryWhere, LogHistory } from './sources/logHistory'

// Each skill's last value the log gave ("You have become better at Divination! (190)"), over a
// character's log and its archives, read with everything else LogHistory counts.

export const skillConsumer: HistoryConsumer<SkillValues> = {
  version: 1,
  empty: () => ({}),
  reader: () => (line, into) => {
    const s = line.text.startsWith('You have become better at ') ? skillUp(line.text) : null
    if (s) into[s.skill] = { value: s.value, at: line.time }
  }
}

export class SkillHistory {
  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  /** Every skill's last value, over the live log and every archive of it. */
  async view(where: HistoryWhere): Promise<SkillValues> {
    const slice = await this.history.get<SkillValues>(this.key, where)
    return joinSkillValues([...slice.archives.map((a) => a.value), slice.live])
  }
}
