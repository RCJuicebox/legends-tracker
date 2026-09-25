import { describe, expect, it } from 'vitest'
import { StockCursor } from '../src/core/moteCalc'
import { parseLogLine } from '../src/core/logLine'

const t = (s: string) => parseLogLine(`[Thu Sep 24 ${s} 2026] x`)!.time

describe('StockCursor', () => {
  it('counts every loot line of a reward chest, all logged in one second', () => {
    const c = new StockCursor(t('15:45:00'), 1)
    expect(c.accept(t('15:41:00'))).toBe(false) // counted long ago
    expect(c.accept(t('15:46:00'))).toBe(true) // 11 Major from the chest
    expect(c.accept(t('15:46:00'))).toBe(true) // 1 Greater, same second
  })

  it('skips exactly the lines already counted when a restart replays their second', () => {
    // Counted: two loot lines at 15:46:00. The replay sees three there; only the third is new.
    const c = new StockCursor(t('15:46:00'), 2)
    expect([c.accept(t('15:46:00')), c.accept(t('15:46:00')), c.accept(t('15:46:00'))]).toEqual([false, false, true])
    expect(c.seenAtSecond).toBe(3)
    expect(c.accept(t('15:47:00'))).toBe(true)
  })
})

describe('StockCursor across a clock change', () => {
  it('keeps counting when the clocks go back and the log repeats an hour', () => {
    const c = new StockCursor(t('01:59:00'), 1)
    expect(c.accept(t('01:59:59'))).toBe(true)
    // Fall-back: the next line is an hour earlier by the log's clock.
    expect(c.accept(t('01:00:00'))).toBe(true)
    expect(c.accept(t('01:00:00'))).toBe(true)
    expect(c.accept(t('01:20:00'))).toBe(true)
    expect(c.seenUntil).toBe(t('01:20:00'))
  })

  it('still skips a replay that starts behind the cursor', () => {
    const c = new StockCursor(t('15:45:00'), 1)
    expect([c.accept(t('15:40:00')), c.accept(t('15:44:00')), c.accept(t('15:45:00')), c.accept(t('15:45:00'))]).toEqual([false, false, false, true])
  })
})
