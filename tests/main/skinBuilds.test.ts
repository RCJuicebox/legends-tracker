import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSkinBuilds, runSkinBuild } from '../../src/main/skinBuilds'
import { SKIN_BUILD_FILE } from '../../src/core/skinBuild'

// Skins in the game's uifiles folder that ask for a rebuild button, and running one: the command
// comes from the skin's own file, and the character goes to it as EQL_CHARACTER.

function gameFolder(skins: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-skins-'))
  for (const [skin, build] of Object.entries(skins)) {
    mkdirSync(join(dir, 'uifiles', skin), { recursive: true })
    if (build !== undefined) writeFileSync(join(dir, 'uifiles', skin, SKIN_BUILD_FILE), typeof build === 'string' ? build : JSON.stringify(build))
  }
  return dir
}

// The test runner's own node.exe stands in for a script's interpreter.
const node = process.execPath

describe('listSkinBuilds', () => {
  it('lists only the skins whose folder asks for a button', async () => {
    const dir = gameFolder({ default: undefined, Mine: { label: 'Rebuild bags', command: [node, '-e', '1'] }, Broken: 'not json' })
    expect(await listSkinBuilds(dir)).toEqual([{ skin: 'Mine', label: 'Rebuild bags', command: [node, '-e', '1'] }])
  })

  it('finds nothing without a game folder or a uifiles folder', async () => {
    expect(await listSkinBuilds('')).toEqual([])
    expect(await listSkinBuilds(mkdtempSync(join(tmpdir(), 'lt-skins-')))).toEqual([])
  })
})

describe('runSkinBuild', () => {
  it("runs the skin's command and hands it the character", async () => {
    const dir = gameFolder({ Mine: { command: [node, '-e', 'console.log("built for " + process.env.EQL_CHARACTER)'] } })
    expect(await runSkinBuild(dir, 'Mine', 'Kelwyn_test')).toEqual({ skin: 'Mine', ok: true, output: 'built for Kelwyn_test' })
  })

  it('says what went wrong when the command fails', async () => {
    const dir = gameFolder({ Mine: { command: [node, '-e', 'console.error("no export"); process.exit(2)'] } })
    const r = await runSkinBuild(dir, 'Mine', '')
    expect(r.ok).toBe(false)
    expect(r.output).toBe('no export')
  })

  it('runs nothing for a skin that does not ask, or a name that is not a skin', async () => {
    const dir = gameFolder({ Plain: undefined })
    expect((await runSkinBuild(dir, 'Plain', '')).ok).toBe(false)
    expect((await runSkinBuild(dir, '../Plain', '')).ok).toBe(false)
  })
})
