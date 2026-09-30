import { describe, expect, it } from 'vitest'
import { notesText } from '../src/core/releaseNotes'

describe('release notes from GitHub', () => {
  it('come out as plain text, lists and all', () => {
    const html = '<h2>Gear</h2><ul><li>Faster <strong>finder</strong></li><li>Fixes &amp; more</li></ul><p>Download it below.</p>'
    expect(notesText(html)).toBe('Gear\n- Faster finder\n- Fixes & more\nDownload it below.')
  })

  it('join a list of versions, and are absent when empty', () => {
    expect(
      notesText([
        { version: '1.2', note: '<p>a</p>' },
        { version: '1.1', note: null }
      ])
    ).toBe('a')
    expect(notesText('')).toBeUndefined()
    expect(notesText(null)).toBeUndefined()
  })
})
