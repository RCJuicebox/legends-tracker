import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../src/main/storeCore'
import { isCharacterKey, sanitizeCharacter, sanitizeSettings, sanitizeTriggers } from '../src/main/validate'
import { channelAllowed } from '../src/preload/channels'

describe('character keys from a page', () => {
  it('takes Name_server and nothing that could leave a folder', () => {
    expect(isCharacterKey('Kelwyn_neriak')).toBe(true)
    expect(isCharacterKey('..\\..\\x')).toBe(false)
    expect(isCharacterKey('../x')).toBe(false)
    expect(isCharacterKey('C:\\x')).toBe(false)
    expect(isCharacterKey('')).toBe(false)
    expect(isCharacterKey(42)).toBe(false)
  })
})

describe('settings from a page', () => {
  const current = defaultSettings()

  it('passes good settings through unchanged', () => {
    expect(sanitizeSettings(defaultSettings(), current)).toEqual(current)
  })

  it('refuses something that is not settings at all', () => {
    expect(sanitizeSettings(null, current)).toBeNull()
    expect(sanitizeSettings([1, 2], current)).toBeNull()
    expect(sanitizeSettings('x', current)).toBeNull()
  })

  it('holds numbers to their range and falls back on the wrong type', () => {
    const s = defaultSettings()
    const out = sanitizeSettings(
      {
        ...s,
        autoStart: 'yes',
        installDir: 7,
        audio: { ...s.audio, masterVolume: 5, speechVolume: -1, soundVolume: Number.NaN, rate: 9 },
        tracking: { ...s.tracking, buffWarnSec: -3, tierDurationPct: { ...s.tracking.tierDurationPct, dot: 'lots' } },
        overlays: [{ ...s.overlays[0], opacity: 0, fontSize: 1000, width: 'wide' }]
      },
      current
    )!
    expect(out.autoStart).toBe(current.autoStart)
    expect(out.installDir).toBe('')
    expect(out.audio.masterVolume).toBe(1)
    expect(out.audio.speechVolume).toBe(0)
    expect(out.audio.soundVolume).toBe(current.audio.soundVolume)
    expect(out.audio.rate).toBe(2)
    expect(out.tracking.buffWarnSec).toBe(0)
    expect(out.tracking.tierDurationPct.dot).toBe(current.tracking.tierDurationPct.dot)
    expect(out.overlays[0].opacity).toBe(0.05)
    expect(out.overlays[0].fontSize).toBe(200)
    expect(out.overlays[0].width).toBe(current.overlays[0].width)
  })

  it('drops overlays with no id and repeats of one', () => {
    const s = defaultSettings()
    const out = sanitizeSettings({ ...s, overlays: [s.overlays[0], { name: 'no id' }, s.overlays[0], 'junk', { id: 'mine', kind: 'alerts' }] }, current)!
    expect(out.overlays.map((o) => o.id)).toEqual(['buffs', 'mine'])
    expect(out.overlays[1]).toMatchObject({ kind: 'alerts', visible: true, opacity: 1 })
  })

  it('drops fields nobody knows, keeps ones the current settings have', () => {
    const fb = { ...defaultSettings(), newerField: 3 } as ReturnType<typeof defaultSettings>
    const out = sanitizeSettings({ ...defaultSettings(), newerField: 4, junk: { a: 1 } }, fb) as unknown as Record<string, unknown>
    expect(out.newerField).toBe(4)
    expect('junk' in out).toBe(false)
  })

  it('checks each character', () => {
    const s = defaultSettings()
    const out = sanitizeSettings({ ...s, characters: { Kel_x: { level: 500, classLevels: { Druid: 60, Pirate: 3 }, focusSources: [{ id: 'f', pct: 'x' }, 'bad'] }, Bad: 'x' } }, current)!
    expect(Object.keys(out.characters)).toEqual(['Kel_x'])
    expect(out.characters.Kel_x.level).toBe(255)
    expect(out.characters.Kel_x.classLevels).toEqual({ Druid: 60 })
    expect(out.characters.Kel_x.focusSources).toHaveLength(1)
    expect(out.characters.Kel_x.focusSources[0]).toMatchObject({ id: 'f', pct: 0, kind: 'item', appliesTo: 'both', enabled: true })
  })

  it('keeps an old flat focus figure only as a number', () => {
    const c = sanitizeCharacter({ level: 50, classLevels: {}, focusSources: [], beneficialFocusPct: 15, detrimentalFocusPct: 'x' }, { level: 50, classLevels: {}, focusSources: [] })!
    expect(c.beneficialFocusPct).toBe(15)
    expect('detrimentalFocusPct' in c).toBe(false)
  })
})

describe('triggers from a page or a file', () => {
  it('refuses something that is not a list', () => {
    expect(sanitizeTriggers({ triggers: [] })).toBeNull()
    expect(sanitizeTriggers(undefined)).toBeNull()
  })

  it('fills missing fields, drops junk entries and unknown actions', () => {
    const out = sanitizeTriggers([
      { id: 'a', name: 'Mez', phrases: [{ text: 'You have been mesmerized', regex: false }, 'plain text', { regex: true }], cooldownSec: -5, actions: [{ type: 'speak', text: 'mez' }, { type: 'explode' }, { type: 'sound', file: 'x.wav', volume: 3 }] },
      'junk',
      { name: 'No id' }
    ])!
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      id: 'a', name: 'Mez', folder: '', enabled: true, comment: '', cooldownSec: 0,
      phrases: [{ text: 'You have been mesmerized', regex: false }, { text: 'plain text', regex: false }],
      actions: [{ type: 'speak', text: 'mez', interrupt: false }, { type: 'sound', file: 'x.wav', volume: 1 }]
    })
    expect(out[1].id).toMatch(/^t/)
    expect(out[1].phrases).toEqual([])
  })

  it('checks timer actions', () => {
    const [t] = sanitizeTriggers([{ id: 't', actions: [{ type: 'timer', name: 'Pull', durationSec: 'long', restart: 'sometimes', endEarly: [{ text: 'dies', regex: false }] }] }])!
    expect(t.actions[0]).toEqual({
      type: 'timer', name: 'Pull', durationSec: 30, color: '#e8b44c', overlay: 'targets', warnSec: 0, warnSpeech: '', endSpeech: '',
      restart: 'restart', endEarly: [{ text: 'dies', regex: false }]
    })
  })
})

describe('the preload channel list', () => {
  it('lets through every channel the pages use', () => {
    for (const c of ['app:state', 'app:openLogs', 'settings:save', 'simulate', 'state:moteScan', 'gear:catalogRefresh', 'character:saveSheet', 'overlay:config', 'overlays:arrange', 'audio:play', 'logs:reveal']) {
      expect(channelAllowed(c), c).toBe(true)
    }
  })

  it('needs the colon, and takes simulate only whole', () => {
    for (const c of ['statement', 'appfoo', 'state', 'simulated', 'simulate:x', 'state:', 'app:state:x', 'other:thing', 'app: state', '', 'APP:state']) {
      expect(channelAllowed(c), c).toBe(false)
    }
    expect(channelAllowed(undefined)).toBe(false)
  })
})
