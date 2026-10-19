import { describe, expect, it } from 'vitest'
import { applySetup, buildSetup, readSetup, setupSummary } from '../../src/core/setup'
import { defaultSettings } from '../../src/main/storeCore'
import type { Trigger } from '../../src/shared/types'

// Share my setup (FEAT-028): a file out, read back through the sanitisers, applied section by section.

const SCHEMAS = { 'settings.json': 1, 'triggers.json': 1, 'spell-rules.json': 1 }
const trigger = (id: string, name: string): Trigger => ({ id, name, folder: '', enabled: true, comment: '', cooldownSec: 0, phrases: [{ text: name, regex: false }], actions: [] })
const A = trigger('a1f0c9d2-4e3b-4a71-9c58-7d21b8e40011', 'Gaze')
const B = trigger('a1f0c9d2-4e3b-4a71-9c58-7d21b8e40012', 'Fear')

describe('share my setup', () => {
  it('writes each section with its schema, and leaves the audio device and mute behind', () => {
    const s = { ...defaultSettings(), audio: { ...defaultSettings().audio, deviceId: 'speakers-1', muted: true, speechVolume: 0.5 } }
    const f = buildSetup(s, [A], { 'Envenomed Bolt': { warnSec: 6 } }, SCHEMAS, '2.16.0', new Date('2026-10-19T12:00:00Z'))
    expect(f.sections.triggers).toEqual({ schema: 1, value: [A] })
    expect(f.sections.audio!.value).not.toHaveProperty('deviceId')
    expect(f.sections.audio!.value).not.toHaveProperty('muted')
    expect(f.sections.audio!.value.speechVolume).toBe(0.5)
  })

  it('reads a file back, lists it, and applies only what is ticked', () => {
    const theirs = { ...defaultSettings(), uiScale: 1.25, tracking: { ...defaultSettings().tracking, dotWarnSec: 5 } }
    const json = JSON.parse(JSON.stringify(buildSetup(theirs, [{ ...A, name: 'Gaze (theirs)' }, B], { 'Envenomed Bolt': { warnSec: 6 } }, SCHEMAS, '2.16.0', new Date())))
    const mine = { ...defaultSettings(), audio: { ...defaultSettings().audio, deviceId: 'mine' } }
    const r = readSetup(json, mine, SCHEMAS)!
    expect(setupSummary(r).map((x) => x.id)).toEqual(['triggers', 'spellRules', 'overlays', 'audio', 'tracking'])
    const out = applySetup(r, ['triggers', 'tracking'], { settings: mine, triggers: [A], rules: {} })
    // The same id replaced in place, a new one added; the rules and overlays left as they were.
    expect(out.triggers.map((t) => t.name)).toEqual(['Gaze (theirs)', 'Fear'])
    expect(out.rules).toEqual({})
    expect(out.settings.uiScale).toBe(mine.uiScale)
    expect(out.settings.tracking.dotWarnSec).toBe(5)
    const all = applySetup(r, ['overlays', 'audio', 'spellRules'], { settings: mine, triggers: [], rules: {} })
    expect(all.settings.uiScale).toBe(1.25)
    expect(all.settings.audio.deviceId).toBe('mine')
    expect(all.rules['Envenomed Bolt']).toMatchObject({ warnSec: 6 })
  })

  it('leaves out a section a newer version wrote, and is not fooled by another file', () => {
    const f = JSON.parse(JSON.stringify(buildSetup(defaultSettings(), [A], {}, { ...SCHEMAS, 'triggers.json': 2 }, '9.0.0', new Date())))
    const r = readSetup(f, defaultSettings(), SCHEMAS)!
    expect(r.triggers).toBeUndefined()
    expect(r.newer).toEqual(['Triggers'])
    expect(readSetup([A], defaultSettings(), SCHEMAS)).toBeNull()
    expect(readSetup({ app: 'something else', sections: {} }, defaultSettings(), SCHEMAS)).toBeNull()
  })
})
