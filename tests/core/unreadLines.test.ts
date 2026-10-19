import { describe, expect, it } from 'vitest'
import { shapeOf, UnreadLines, unreadText } from '../../src/core/unreadLines'

describe('the lines nothing read (FEAT-025)', () => {
  it('counts by shape, leaves chat out, and copies the shapes without the examples', () => {
    const u = new UnreadLines()
    u.add('It begins to rain.')
    u.add('Jabann begins to regenerate.')
    u.add('Dorran begins to regenerate.')
    u.add("Aldric tells the group, 'pull'")
    u.add("McNeal Jocub told you, 'I'll give you 1 silver 4 copper for the Dark Shield of Ebon.'")
    u.add('Description: This passive ability increases your chance to land a critical hit by 10%.')
    expect(u.total).toBe(3)
    expect(u.top(1)).toEqual([{ shape: 'X begins to regenerate.', n: 2, example: 'Jabann begins to regenerate.' }])
    const text = unreadText(u, 10)
    expect(text).toContain('2  X begins to regenerate.')
    expect(text).not.toContain('Jabann')
    u.clear()
    expect(unreadText(u, 10)).toBe('')
  })

  it('strips numbers, quotes and a leading name from a shape', () => {
    expect(shapeOf("Merchant Tenra told you, 'I'll give you 6 silver'")).toBe("X told you, '…'")
    expect(shapeOf('You have become better at Kick! (113)')).toBe('You have become better at Kick! (N)')
  })
})
