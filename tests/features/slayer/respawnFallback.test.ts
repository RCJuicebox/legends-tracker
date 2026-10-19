import { describe, expect, it } from 'vitest'
import { respawnFallback } from '../../../src/features/slayer/main'

describe("the Respawns page's fallback from the spawn tables (LT-736)", () => {
  it("gives a mob the tables know their timer, a zone they lack nothing, and the zone's median once the records make one", () => {
    const f = respawnFallback(() => ({}))
    const here = f('Befallen', 'Gynok Moltor')
    expect(here?.mob).toMatchObject({ from: 'classic' })
    expect(here?.mob?.seconds).toBeGreaterThan(0)
    expect(here?.zone).toBeNull()
    expect(f('The Plane of Nowhere', 'a nobody')).toBeNull()
  })
})
