import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OFFERED_BEFORE_RECORD, offerShipped } from '../../src/core/shippedTriggers'
import type { Trigger } from '../../src/shared/types'

const trig = (id: string): Trigger => ({ id, name: id, folder: '', enabled: true, comment: '', phrases: [], cooldownSec: 0, actions: [] })
const legacy = OFFERED_BEFORE_RECORD.map(trig)

describe('offerShipped', () => {
  it('adds a new shipped trigger to a profile from before the record, but none it took out', () => {
    const have = [legacy[0], trig('mine')]
    const r = offerShipped([...legacy, trig('dispelled')], have, undefined)
    expect(r.add.map((t) => t.id)).toEqual(['dispelled'])
    expect(r.offered).toEqual([...OFFERED_BEFORE_RECORD, 'dispelled'])
    expect(r.changed).toBe(true)
  })

  it('offers each once: one deleted afterwards stays out, and nothing changes after that', () => {
    const r = offerShipped([trig('dispelled'), trig('next')], [trig('mine')], ['dispelled'])
    expect(r.add.map((t) => t.id)).toEqual(['next'])
    expect(r.changed).toBe(true)
    const again = offerShipped([trig('dispelled'), trig('next')], [trig('mine')], r.offered)
    expect(again).toEqual({ add: [], offered: ['dispelled', 'next'], changed: false })
  })

  it('does not add one the list already has, and keeps ids no longer shipped', () => {
    const r = offerShipped([trig('a')], [trig('a')], ['gone'])
    expect(r.add).toEqual([])
    expect(r.offered).toEqual(['gone', 'a'])
  })

  it('names only triggers the defaults ship, and Dispelled, shipped after them, is not one', () => {
    const shipped = JSON.parse(readFileSync(join(__dirname, '../../defaults/triggers.json'), 'utf8')) as Trigger[]
    const ids = new Set(shipped.map((t) => t.id))
    expect(OFFERED_BEFORE_RECORD.filter((id) => !ids.has(id))).toEqual([])
    expect(OFFERED_BEFORE_RECORD).not.toContain(shipped.find((t) => t.name === 'Dispelled')!.id)
  })
})
