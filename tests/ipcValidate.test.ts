import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../src/main/storeCore'
import { intArg, isCharacterKey, isRecordKey, sanitizeCharacter, sanitizeSettings, sanitizeTriggers, stringsArg, textArg } from '../src/core/validate'
import { channelAllowed } from '../src/preload/channels'

describe('character keys from a page', () => {
  it('takes Name_server and nothing that could leave a folder', () => {
    expect(isCharacterKey('Kelwyn_neriak')).toBe(true)
    expect(isCharacterKey('..\\..\\x')).toBe(false)
    expect(isCharacterKey('../x')).toBe(false)
    expect(isCharacterKey('C:\\x')).toBe(false)
    expect(isCharacterKey('')).toBe(false)
    expect(isCharacterKey(42)).toBe(false)
    expect(isCharacterKey('..')).toBe(false)
    expect(isCharacterKey('a*b')).toBe(false)
  })

  it('takes any name the game can put in a file name', () => {
    expect(isCharacterKey('Jean-Luc_neriak')).toBe(true)
    expect(isCharacterKey('Björn_neriak')).toBe(true)
  })

  it("takes no name Windows keeps for a device, and none that is an object's own", () => {
    for (const k of ['CON', 'con', 'NUL.json', 'com1', 'LPT9', 'aux', 'PRN', '__proto__', 'constructor', 'prototype']) expect(isCharacterKey(k)).toBe(false)
    expect(isCharacterKey('Conan_neriak')).toBe(true)
    expect(isCharacterKey('Nul_tunare')).toBe(true)
  })
})

describe('other arguments from a page', () => {
  it('keys, text, numbers and lists are checked and cut to size', () => {
    expect(isRecordKey('Envenomed Bolt')).toBe(true)
    expect(isRecordKey('__proto__')).toBe(false)
    expect(isRecordKey('x'.repeat(121))).toBe(false)
    expect(isRecordKey(7)).toBe(false)
    expect(textArg('x'.repeat(500), 300)).toHaveLength(300)
    expect(textArg({ toString: () => 'boo' }, 300)).toBe('')
    expect(intArg(1e9, 1, 2048, 100)).toBe(2048)
    expect(intArg(-5, 1, 2048, 100)).toBe(1)
    expect(intArg(NaN, 1, 2048, 100)).toBe(100)
    expect(intArg('64', 1, 2048, 100)).toBe(100)
    expect(stringsArg(['SHD', 3, '', 'x'.repeat(50), 'MNK'], 16, 40)).toEqual(['SHD', 'MNK'])
    expect(stringsArg('SHD', 16)).toEqual([])
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
        overlays: [
          { ...s.overlays[0], opacity: -1, fontSize: 1000, width: 'wide' },
          { ...s.overlays[2], opacity: 0 }
        ]
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
    // A panel may fade to nothing; the alerts are text alone and keep a fifth.
    expect(out.overlays[0].opacity).toBe(0)
    expect(out.overlays[1]).toMatchObject({ kind: 'alerts', opacity: 0.2 })
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
    const out = sanitizeSettings(
      { ...s, characters: { Kel_x: { level: 500, classLevels: { Druid: 60, Pirate: 3 }, focusSources: [{ id: 'f', pct: 'x' }, 'bad'] }, Bad: 'x' } },
      current
    )!
    expect(Object.keys(out.characters)).toEqual(['Kel_x'])
    expect(out.characters.Kel_x.level).toBe(255)
    expect(out.characters.Kel_x.classLevels).toEqual({ Druid: 60 })
    expect(out.characters.Kel_x.focusSources).toHaveLength(1)
    expect(out.characters.Kel_x.focusSources[0]).toMatchObject({ id: 'f', pct: 0, kind: 'item', appliesTo: 'both', enabled: true })
  })

  it("keeps only the faction plan's assumptions the player changed, held to their inputs' ranges", () => {
    const was = { ...defaultSettings(), factionPlan: { assumptions: { travelMin: 10, goal: 'positive' as const, raceSwaps: false }, choices: {} } }
    const out = sanitizeSettings(
      { ...defaultSettings(), factionPlan: { assumptions: { travelMin: 'x', killsPerHour: 5000, handInSec: -3, goal: 'slowest', raceSwaps: 1, unlocksFirst: true, junk: 4 } } },
      was
    )!
    // A bad value keeps what was there; one not sent stays unset.
    expect(out.factionPlan.assumptions).toEqual({ travelMin: 10, killsPerHour: 1000, handInSec: 0, goal: 'positive', raceSwaps: false, unlocksFirst: true })
    expect(sanitizeSettings({ ...defaultSettings(), factionPlan: { assumptions: {} } }, was)!.factionPlan.assumptions).toEqual({})
    // No faction plan sent: what was saved stays.
    const { factionPlan: _, ...rest } = defaultSettings()
    expect(sanitizeSettings(rest, was)!.factionPlan).toEqual(was.factionPlan)
  })

  it("keeps each character's plan choices, checked, and none for a character with none", () => {
    const out = sanitizeSettings(
      {
        ...defaultSettings(),
        factionPlan: {
          assumptions: {},
          choices: {
            Tester_neriak: { locks: { 'Guards of Qeynos': 'a1', __proto__: 'x', Other: 5 }, excluded: ['a2', 'a2', 3], perHour: { a3: 20, a4: -1, a5: 'x', a6: 1e9 } },
            Tester_qeynos: { locks: {}, excluded: [], perHour: {} },
            'bad/key': { locks: { A: 'a1' }, excluded: [], perHour: {} },
            Tester_x: 'junk'
          }
        }
      },
      current
    )!
    expect(out.factionPlan.choices).toEqual({ Tester_neriak: { locks: { 'Guards of Qeynos': 'a1' }, excluded: ['a2'], perHour: { a3: 20, a6: 100_000 } } })
  })

  it("keeps the Live page's checklist flags", () => {
    const out = sanitizeSettings({ ...defaultSettings(), setup: { hidden: true, accepted: ['sound', 'sound', 7, 'x'.repeat(50)], arranged: 'yes' } }, current)!
    expect(out.setup).toEqual({ hidden: true, accepted: ['sound'], arranged: false })
  })

  it('keeps an old flat focus figure only as a number', () => {
    const c = sanitizeCharacter(
      { level: 50, classLevels: {}, focusSources: [], beneficialFocusPct: 15, detrimentalFocusPct: 'x' },
      { level: 50, classLevels: {}, focusSources: [] }
    )!
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
      {
        id: 'a',
        name: 'Mez',
        phrases: [{ text: 'You have been mesmerized', regex: false }, 'plain text', { regex: true }],
        cooldownSec: -5,
        actions: [{ type: 'speak', text: 'mez' }, { type: 'explode' }, { type: 'sound', file: 'x.wav', volume: 3 }]
      },
      'junk',
      { name: 'No id' }
    ])!
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      id: 'a',
      name: 'Mez',
      folder: '',
      enabled: true,
      comment: '',
      cooldownSec: 0,
      phrases: [
        { text: 'You have been mesmerized', regex: false },
        { text: 'plain text', regex: false }
      ],
      actions: [
        { type: 'speak', text: 'mez', interrupt: false },
        { type: 'sound', file: 'x.wav', volume: 1 }
      ]
    })
    expect(out[1].id).toMatch(/^t/)
    expect(out[1].phrases).toEqual([])
  })

  it('checks timer actions', () => {
    const [t] = sanitizeTriggers([{ id: 't', actions: [{ type: 'timer', name: 'Pull', durationSec: 'long', restart: 'sometimes', endEarly: [{ text: 'dies', regex: false }] }] }])!
    expect(t.actions[0]).toEqual({
      type: 'timer',
      name: 'Pull',
      durationSec: 30,
      color: '#e8b44c',
      overlay: 'targets',
      warnSec: 0,
      warnSpeech: '',
      endSpeech: '',
      restart: 'restart',
      endEarly: [{ text: 'dies', regex: false }]
    })
  })
})

describe('the preload channel list', () => {
  it('lets through every channel the contract names, each only the way it is used', () => {
    for (const c of ['app:state', 'app:openLogs', 'settings:save', 'simulate', 'gear:catalogRefresh', 'character:saveSheet', 'overlays:arrange', 'logs:reveal']) {
      expect(channelAllowed(c, 'invoke'), c).toBe(true)
    }
    for (const c of ['state:moteScan', 'overlay:config', 'audio:play']) expect(channelAllowed(c, 'on'), c).toBe(true)
    for (const c of ['overlay:mouse', 'overlay:meter', 'audio:devices']) expect(channelAllowed(c, 'send'), c).toBe(true)
    expect(channelAllowed('state:moteScan', 'invoke')).toBe(false)
    expect(channelAllowed('settings:save', 'on')).toBe(false)
  })

  it('refuses channels nobody declared', () => {
    for (const c of ['statement', 'state', 'simulated', 'simulate:x', 'app:state:x', 'other:thing', 'spells:explain', 'audio:mute', '', 'APP:state', 'toString', '__proto__']) {
      expect(channelAllowed(c, 'invoke'), c).toBe(false)
    }
    expect(channelAllowed(undefined, 'invoke')).toBe(false)
  })
})
