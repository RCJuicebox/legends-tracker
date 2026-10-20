import { describe, expect, it } from 'vitest'
import { parseUiSkin, uiFilesOf } from '../../src/core/uiSkin'

describe('parseUiSkin', () => {
  it("reads the skin from a UI file's [Main] section", () => {
    expect(parseUiSkin('[Main]\r\nUISkin=JuiceboxUI\r\nAtlasSkin=Default\r\n[MainChat]\r\nINIVersion=1\r\n')).toBe('JuiceboxUI')
  })

  it('is null for the stock skin, however it is spelled', () => {
    expect(parseUiSkin('[Main]\nUISkin=Default\n')).toBeNull()
    expect(parseUiSkin('[Main]\nUISkin=default\n')).toBeNull()
  })

  it('is null with no skin named, or one outside [Main]', () => {
    expect(parseUiSkin('[Main]\nAtlasSkin=Default\n[Other]\nUISkin=Elsewhere\n')).toBeNull()
    expect(parseUiSkin('')).toBeNull()
  })

  it('refuses a name that is not a folder name', () => {
    expect(parseUiSkin('[Main]\nUISkin=..\\..\\Windows\n')).toBeNull()
  })
})

describe('uiFilesOf', () => {
  const names = [
    'UI_Kelwyn_test.ini',
    'UI_Kelwyn_test_LO1.ini',
    'UI_kelwyn_test_LO2.ini',
    'UI_Kelwyn_test_LO1_Backup_1.ini',
    'UI_Kelwyn_testing_LO1.ini',
    'UI_Other_test_LO1.ini',
    'eqclient.ini'
  ]

  it("finds a character's UI files and layouts, in any case, and not the backups", () => {
    expect(uiFilesOf('Kelwyn_test', names)).toEqual(['UI_Kelwyn_test.ini', 'UI_Kelwyn_test_LO1.ini', 'UI_kelwyn_test_LO2.ini'])
  })

  it('finds nothing with no character', () => {
    expect(uiFilesOf('', names)).toEqual([])
  })
})
