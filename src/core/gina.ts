import type { Phrase, Trigger, TriggerAction } from '../shared/types'

// GINA trigger packages (FEAT-029). A .gtp file is a zip holding ShareData.xml: trigger groups (nested,
// each a folder) of triggers. GINA's TriggerText speaks this engine's own snippets ({S}, {S1}, {N},
// {C}); its display text, text-to-voice and timer (with its ending and ended speech and early enders)
// map onto the text, speak and timer actions. Guild packs travel in that form. This is the pure part:
// XML in and out; main unzips and zips.

/** An XML element as read: its name, its children and the text directly inside it. */
interface Node {
  name: string
  children: Node[]
  text: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m)
  )
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A small reader for GINA's XML: elements, text and entities; attributes, comments and the declaration skipped. */
export function parseXml(xml: string): Node {
  const root: Node = { name: '', children: [], text: '' }
  const stack: Node[] = [root]
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)[^>]*?(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = tag.exec(xml))) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.text += m[1]
    else if (m[5] !== undefined) top.text += decode(m[5])
    else if (m[3]) {
      if (m[2]) {
        // A closing tag: back to its parent (a stray one is ignored).
        if (stack.length > 1 && top.name === m[3]) stack.pop()
      } else {
        const node: Node = { name: m[3], children: [], text: '' }
        top.children.push(node)
        if (!m[4]) stack.push(node)
      }
    }
  }
  return root
}

const child = (n: Node | undefined, name: string) => n?.children.find((c) => c.name === name)
const val = (n: Node | undefined, name: string) => (child(n, name)?.text ?? '').trim()
const flag = (n: Node | undefined, name: string) => val(n, name).toLowerCase() === 'true'

/**
 * What a speech of GINA's ends up as: a timer's ending or ended speech is either its own element
 * (TimerEndingTextToVoice) or a nested trigger (TimerEndingTrigger › TextToVoiceText), as GINA writes it.
 */
function nestedSpeech(t: Node, flat: string, nested: string, use: string): string {
  const own = val(t, flat)
  if (own) return own
  const n = child(t, nested)
  if (!n) return ''
  if (child(t, use) && !flag(t, use)) return ''
  return flag(n, 'UseTextToVoice') ? val(n, 'TextToVoiceText') : ''
}

let seq = 0

function ginaTrigger(t: Node, folder: string): Trigger {
  const regex = flag(t, 'EnableRegex')
  const actions: TriggerAction[] = []
  if (flag(t, 'UseText') && val(t, 'DisplayText')) actions.push({ type: 'text', text: val(t, 'DisplayText'), color: '#ffd84d', durationSec: 5 })
  if (flag(t, 'UseTextToVoice') && val(t, 'TextToVoiceText')) actions.push({ type: 'speak', text: val(t, 'TextToVoiceText'), interrupt: flag(t, 'InterruptSpeech') })
  const timerType = val(t, 'TimerType')
  if (timerType && timerType !== 'NoTimer') {
    const ms = Number(val(t, 'TimerMillisecondDuration'))
    const sec = Number.isFinite(ms) && ms > 0 ? ms / 1000 : Number(val(t, 'TimerDuration')) || 30
    const enders = (child(t, 'TimerEarlyEnders')?.children ?? []).map((e): Phrase => ({ text: val(e, 'EarlyEndText'), regex: flag(e, 'EnableRegex') })).filter((p) => p.text)
    actions.push({
      type: 'timer',
      name: val(t, 'TimerName'),
      durationSec: Math.max(1, Math.round(sec)),
      color: '#5ad1ff',
      overlay: 'targets',
      warnSec: flag(t, 'UseTimerEnding') || val(t, 'TimerEndingTextToVoice') ? Number(val(t, 'TimerEndingTime')) || 0 : 0,
      warnSpeech: nestedSpeech(t, 'TimerEndingTextToVoice', 'TimerEndingTrigger', 'UseTimerEnding'),
      endSpeech: nestedSpeech(t, 'TimerEndedTextToVoice', 'TimerEndedTrigger', 'UseTimerEnded'),
      restart: val(t, 'TimerStartBehavior') === 'IgnoreIfRunning' ? 'ignore' : 'restart',
      endEarly: enders
    })
  }
  return {
    id: `gina-${Date.now().toString(36)}-${(seq++).toString(36)}`,
    name: val(t, 'Name') || 'GINA trigger',
    folder,
    enabled: true,
    comment: val(t, 'Comments'),
    phrases: [{ text: val(t, 'TriggerText'), regex }],
    cooldownSec: 0,
    actions
  }
}

/** Every trigger of a GINA ShareData.xml, each group's name as its folder ("Raids / Fear"). */
export function ginaToTriggers(xml: string): Trigger[] {
  const out: Trigger[] = []
  const walk = (groups: Node | undefined, path: string[]) => {
    for (const g of groups?.children ?? []) {
      if (g.name !== 'TriggerGroup') continue
      const here = [...path, val(g, 'Name')].filter(Boolean)
      for (const t of child(g, 'Triggers')?.children ?? []) if (t.name === 'Trigger' && val(t, 'TriggerText')) out.push(ginaTrigger(t, here.join(' / ')))
      walk(child(g, 'TriggerGroups'), here)
    }
  }
  const doc = parseXml(xml)
  const shared = child(doc, 'SharedData') ?? doc
  walk(child(shared, 'TriggerGroups'), [])
  return out
}

const el = (name: string, value: string | number | boolean) => `<${name}>${encode(String(typeof value === 'boolean' ? (value ? 'True' : 'False') : value))}</${name}>`

/** A trigger as GINA writes one: its first phrase (GINA has one), text, speech and timer. Sounds have no file GINA would find, so they are left out. */
function triggerXml(t: Trigger): string {
  const text = t.actions.find((a) => a.type === 'text')
  const speak = t.actions.find((a) => a.type === 'speak')
  const timer = t.actions.find((a) => a.type === 'timer')
  const p = t.phrases.find((x) => x.text.trim()) ?? { text: '', regex: false }
  const speech = (words: string) => `${el('UseTextToVoice', !!words)}${el('TextToVoiceText', words)}${el('InterruptSpeech', false)}`
  return [
    '<Trigger>',
    el('Name', t.name),
    el('TriggerText', p.text),
    el('Comments', t.comment),
    el('EnableRegex', p.regex),
    el('UseText', !!text),
    el('DisplayText', text?.type === 'text' ? text.text : ''),
    el('UseTextToVoice', !!speak),
    el('InterruptSpeech', speak?.type === 'speak' ? speak.interrupt : false),
    el('TextToVoiceText', speak?.type === 'speak' ? speak.text : ''),
    el('PlayMediaFile', false),
    el('TimerType', timer ? 'Timer' : 'NoTimer'),
    el('TimerName', timer?.type === 'timer' ? timer.name : ''),
    el('TimerDuration', timer?.type === 'timer' ? Math.round(timer.durationSec) : 0),
    el('TimerMillisecondDuration', timer?.type === 'timer' ? Math.round(timer.durationSec * 1000) : 0),
    el('TimerStartBehavior', timer?.type === 'timer' && timer.restart === 'ignore' ? 'IgnoreIfRunning' : 'RestartTimer'),
    el('TimerEndingTime', timer?.type === 'timer' ? timer.warnSec : 0),
    el('UseTimerEnding', timer?.type === 'timer' && timer.warnSec > 0),
    el('UseTimerEnded', timer?.type === 'timer' && !!timer.endSpeech),
    `<TimerEndingTrigger>${speech(timer?.type === 'timer' ? timer.warnSpeech : '')}</TimerEndingTrigger>`,
    `<TimerEndedTrigger>${speech(timer?.type === 'timer' ? timer.endSpeech : '')}</TimerEndedTrigger>`,
    `<TimerEarlyEnders>${(timer?.type === 'timer' ? timer.endEarly : []).map((e) => `<EarlyEnder>${el('EarlyEndText', e.text)}${el('EnableRegex', e.regex)}</EarlyEnder>`).join('')}</TimerEarlyEnders>`,
    '</Trigger>'
  ].join('')
}

/** Triggers as a GINA ShareData.xml: one trigger group a folder. */
export function triggersToGina(list: readonly Trigger[]): string {
  const folders = new Map<string, Trigger[]>()
  for (const t of list) folders.set(t.folder || 'Legends Tracker', [...(folders.get(t.folder || 'Legends Tracker') ?? []), t])
  const groups = [...folders].map(([name, ts]) => `<TriggerGroup>${el('Name', name)}${el('Comments', '')}<Triggers>${ts.map(triggerXml).join('')}</Triggers></TriggerGroup>`)
  return `<?xml version="1.0" encoding="utf-8"?>\n<SharedData><TriggerGroups>${groups.join('')}</TriggerGroups></SharedData>\n`
}
