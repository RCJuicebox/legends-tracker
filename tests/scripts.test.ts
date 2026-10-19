import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error: a plain JavaScript script, checked on its own (tsconfig.scripts.json)
import { releaseNotes } from '../scripts/release-notes.mjs'

// The release-notes gate (LT-645): a release goes out only with its version's section of the
// changelog, which becomes the GitHub Release's notes.

const notes = releaseNotes as (changelog: string, version: string) => string | null

const CHANGELOG = `# Changelog

Intro.

## Unreleased

- Not yet.

## 2.1.0 (2026-10-20)

- **A line.**

### Fixes

- Another.

## 2.0.0

- The last section.
`

describe('releaseNotes', () => {
  it('takes a dated section up to the next, its ### headings made ##', () => {
    expect(notes(CHANGELOG, '2.1.0')).toBe('- **A line.**\n\n## Fixes\n\n- Another.')
  })

  it('takes the last section to the end, and an undated heading', () => {
    expect(notes(CHANGELOG, '2.0.0')).toBe('- The last section.')
  })

  it('gives nothing for a version with no section, an empty one, or one that only starts the same', () => {
    expect(notes(CHANGELOG, '3.0.0')).toBeNull()
    expect(notes(CHANGELOG, '2.1')).toBeNull()
    expect(notes('## 1.0.0\n\n## 0.9.0\n- x', '1.0.0')).toBeNull()
  })

  it('reads a changelog with Windows line ends', () => {
    expect(notes(CHANGELOG.replace(/\n/g, '\r\n'), '2.1.0')).toBe('- **A line.**\n\n## Fixes\n\n- Another.')
  })

  it("finds the real changelog's sections", () => {
    const real = readFileSync(join(__dirname, '..', 'CHANGELOG.md'), 'utf8')
    expect(notes(real, '2.14.3')).toMatch(/^- \*\*/)
  })
})
