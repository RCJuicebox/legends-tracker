import { describe, expect, it } from 'vitest'
import { LIVE_MODELS_MARK, liveModelArchives, liveModelLines, withLiveModels, withoutLiveModels } from '../../src/core/liveModels'

// A cut-down GlobalLoad.txt in the game's own shape: phase,?,flags,archive,message, CRLF throughout.
const LOAD = [
  '1,1,TFFFE,frogequip,Loading Froglok Equipment',
  '1,1,TFFTC,lsk_chr,Loading Luclin Skeletons',
  '2,0,TFFFE,it101084,Loading Furniture Files',
  '3,0,TFFFC,rap_chr,Loading Raptors',
  '3,0,TFFFC,Global4_chr,Loading Characters',
  '3,1,TFFFC,Global_chr,Loading Player Characters',
  '4,0,TFFFC,bea_chr,Loading Bears',
  ''
].join('\r\n')

const everything = new Set(liveModelArchives())
const all = (a: string) => everything.has(a)

describe('Live player models in GlobalLoad.txt', () => {
  it('load each newer model just before the classic line, with its animations, and the Froglok at the top', () => {
    const edit = withLiveModels(LOAD, all)
    expect(edit.problem).toBeUndefined()
    expect(edit.models).toBe(28)
    const lines = edit.text.split('\r\n')
    expect(lines[0]).toBe(`1,1,TFFTC,globalpcfroglok_chr2,Loading Live Froglok male and female ${LIVE_MODELS_MARK}`)
    expect(lines[1]).toBe(`1,1,TFFTC,globalpcfroglok_chr,Loading Live Froglok male and female ${LIVE_MODELS_MARK}`)
    const at = (archive: string) => lines.findIndex((l) => l.split(',')[3] === archive)
    // Read first wins: the newer ones come before the classic archive, its <archive>2 first.
    expect(at('globalhum_chr2')).toBeLessThan(at('globalhum_chr'))
    expect(at('globalgnf_chr')).toBeLessThan(at('Global_chr'))
    expect(at('globalikf_chr')).toBeLessThan(at('Global4_chr'))
    expect(lines[at('globalhum_chr')]).toMatch(/^3,1,TFFTC,/)
    expect(lines[at('globalikm_chr')]).toMatch(/^3,0,TFFTC,/)
    expect(at('LGEquip_amr2')).toBe(at('it101084') + 1)
    expect(lines.at(-1)).toBe('')
  })

  it('come out again exactly, and adding twice gives the same file', () => {
    const once = withLiveModels(LOAD, all)
    expect(withLiveModels(once.text, all).text).toBe(once.text)
    expect(withoutLiveModels(once.text).text).toBe(LOAD)
    expect(liveModelLines(once.text)).toBe(once.text.split('\r\n').length - LOAD.split('\r\n').length)
    expect(liveModelLines(LOAD)).toBe(0)
  })

  it('replace the lines the playermodels script added, so no archive is read twice', () => {
    const script = '3,1,TFFTC,globalhum_chr,Loading Live Human male (playermodels.py)\r\n' + LOAD
    expect(withoutLiveModels(script).text).toBe(LOAD)
    expect(withLiveModels(script, all).text).toBe(withLiveModels(LOAD, all).text)
  })

  it('leave out what the game folder lacks, and say so when nothing is left', () => {
    const some = withLiveModels(LOAD, (a) => a === 'globalhum_chr')
    expect(some.models).toBe(1)
    expect(liveModelLines(some.text)).toBe(1)
    expect(withLiveModels(LOAD, () => false).problem).toMatch(/none of the newer/)
    const changed = withLiveModels('1,1,TFFFE,frogequip,x\r\n', (a) => a === 'globalhum_chr')
    expect(changed.problem).toMatch(/no Global_chr line/)
    expect(changed.text).toBe('1,1,TFFFE,frogequip,x\r\n')
  })

  it('keep a file with LF line ends as LF', () => {
    const lf = LOAD.replace(/\r\n/g, '\n')
    const edit = withLiveModels(lf, all)
    expect(edit.text).not.toContain('\r')
    expect(withoutLiveModels(edit.text).text).toBe(lf)
  })
})
