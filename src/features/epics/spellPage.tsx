import { SPELL_QUESTS } from './core'
import { ChecklistPage, checklistParts, type ChecklistPageConfig } from './page'

// Goals › Spell Quests (an optional module of its own, Settings › Modules): the five class spells a
// quest gives (Tashania, Ice Comet, Divine Might, Life Leech, Call of Flame), each as a checklist like
// an epic's, from the counts and ticks the Epics module keeps. It opens on every class's quests; the
// class pick narrows them to the character's.

/** The classes a spell quest is for, as a sentence ends: "an Enchanter, a Wizard, … and a Ranger". */
const SPELL_CLASSES = SPELL_QUESTS.map((q) => `${/^[AEIOU]/.test(q.cls) ? 'an' : 'a'} ${q.cls}`)
  .join(', ')
  .replace(/, ([^,]*)$/, ' and $1')

const SPELLS: ChecklistPageConfig = {
  kind: 'spell',
  id: 'spellquests',
  title: 'Spell Quests',
  lead: 'What each class spell a quest gives takes, and how much of it you hold; where to hunt for the rest.',
  how: (
    <>
      <div>
        <b>The quests</b> are the five class spells a quest gives (Tashania, Ice Comet, Divine Might, Life Leech and Call of Flame), each from its eqlwiki quest page; SEQO chose
        the five. A step with steps under it is a hand-in or a combine: its reward in hand covers what makes it, as does the spell’s scroll. Most pieces are ground spawns, which
        may leave no line in your log: the inventory export counts them, or tick them off. The ten Old Silver Coins share one name, and the ten Rods too, so they are counted
        together: tick each spot off as you pick it up.
      </div>
      {checklistParts.WHAT_YOU_HOLD}
      {checklistParts.TICK_OFF}
    </>
  ),
  credit: <>Spell quests from their eqlwiki quest pages, with SEQO’s (RealMaeel) notes from the EQ Legends Tools quest guides.</>,
  cls: 'all',
  classes: SPELL_QUESTS.map((q) => q.cls),
  empty: (picked) => `No spell quest for ${picked}: the five are for ${SPELL_CLASSES}.`
}

export function SpellQuests() {
  return <ChecklistPage config={SPELLS} />
}
