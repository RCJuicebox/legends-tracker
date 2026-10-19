import { describe, expect, it } from 'vitest'
import { ginaToTriggers, parseXml, triggersToGina } from '../../src/core/gina'
import { TriggerEngine } from '../../src/core/triggers'
import { TimerBoard } from '../../src/core/timers'
import { parseLogLine } from '../../src/core/logLine'
import type { Notification } from '../../src/shared/types'

// A GINA ShareData.xml as GINA writes one (FEAT-029): nested groups, a timer with its ending and ended
// speech as nested triggers, an early ender, entities in the text.

const SHARE_DATA = `<?xml version="1.0" encoding="utf-8"?>
<SharedData>
  <TriggerGroups>
    <TriggerGroup>
      <Name>Raids</Name>
      <Comments />
      <Triggers />
      <TriggerGroups>
        <TriggerGroup>
          <Name>Fear</Name>
          <Triggers>
            <Trigger>
              <Name>Mez worn</Name>
              <TriggerText>Your Mesmerize spell has worn off of {S}.</TriggerText>
              <Comments>Remez &amp; go</Comments>
              <EnableRegex>False</EnableRegex>
              <UseText>True</UseText>
              <DisplayText>REMEZ {S}</DisplayText>
              <UseTextToVoice>True</UseTextToVoice>
              <InterruptSpeech>True</InterruptSpeech>
              <TextToVoiceText>Remez {S}</TextToVoiceText>
              <TimerType>NoTimer</TimerType>
            </Trigger>
            <Trigger>
              <Name>Dread fear</Name>
              <TriggerText>^(?&lt;S1&gt;.+) begins to cast a spell\\.$</TriggerText>
              <EnableRegex>True</EnableRegex>
              <UseText>False</UseText>
              <UseTextToVoice>False</UseTextToVoice>
              <TimerType>Timer</TimerType>
              <TimerName>Fear {S1}</TimerName>
              <TimerMillisecondDuration>36000</TimerMillisecondDuration>
              <TimerStartBehavior>IgnoreIfRunning</TimerStartBehavior>
              <TimerEndingTime>6</TimerEndingTime>
              <UseTimerEnding>True</UseTimerEnding>
              <UseTimerEnded>True</UseTimerEnded>
              <TimerEndingTrigger><UseTextToVoice>True</UseTextToVoice><TextToVoiceText>Fear soon</TextToVoiceText></TimerEndingTrigger>
              <TimerEndedTrigger><UseTextToVoice>True</UseTextToVoice><TextToVoiceText>Fear now</TextToVoiceText></TimerEndedTrigger>
              <TimerEarlyEnders>
                <EarlyEnder><EarlyEndText>{S1} has been slain</EarlyEndText><EnableRegex>False</EnableRegex></EarlyEnder>
              </TimerEarlyEnders>
            </Trigger>
          </Triggers>
        </TriggerGroup>
      </TriggerGroups>
    </TriggerGroup>
  </TriggerGroups>
</SharedData>`

describe('GINA packages (FEAT-029)', () => {
  it('reads nested elements, self-closing ones and entities', () => {
    const doc = parseXml('<a><b>x &amp; y</b><c/><![CDATA[<raw>]]></a>')
    expect(doc.children[0].children.map((c) => [c.name, c.text])).toEqual([
      ['b', 'x & y'],
      ['c', '']
    ])
    expect(doc.children[0].text).toBe('<raw>')
  })

  it("turns GINA's triggers into this app's: folders from the groups, text, speech and the timer with its speech and early ender", () => {
    const [mez, fear] = ginaToTriggers(SHARE_DATA)
    expect(mez).toMatchObject({
      name: 'Mez worn',
      folder: 'Raids / Fear',
      comment: 'Remez & go',
      phrases: [{ text: 'Your Mesmerize spell has worn off of {S}.', regex: false }],
      actions: [
        { type: 'text', text: 'REMEZ {S}' },
        { type: 'speak', text: 'Remez {S}', interrupt: true }
      ]
    })
    expect(fear.phrases).toEqual([{ text: '^(?<S1>.+) begins to cast a spell\\.$', regex: true }])
    expect(fear.actions).toEqual([
      {
        type: 'timer',
        name: 'Fear {S1}',
        durationSec: 36,
        color: '#5ad1ff',
        overlay: 'targets',
        warnSec: 6,
        warnSpeech: 'Fear soon',
        endSpeech: 'Fear now',
        restart: 'ignore',
        endEarly: [{ text: '{S1} has been slain', regex: false }]
      }
    ])
  })

  it('runs an imported trigger as GINA would, and comes back the same through its own export', () => {
    const triggers = ginaToTriggers(SHARE_DATA)
    const notes: Notification[] = []
    const engine = new TriggerEngine(new TimerBoard({ onChange: () => {}, onNotify: () => {} }), { notify: (n) => notes.push(...n), feed: () => {} })
    engine.load(triggers, 'Kelwyn')
    engine.handle(parseLogLine('[Sat Sep 12 23:11:00 2026] Your Mesmerize spell has worn off of a gnoll pup.')!)
    expect(notes.find((n) => n.kind === 'speak')).toMatchObject({ text: 'Remez a gnoll pup' })
    const again = ginaToTriggers(triggersToGina(triggers))
    expect(again.map(({ id: _id, ...t }) => t)).toEqual(triggers.map(({ id: _id, ...t }) => t))
  })
})
