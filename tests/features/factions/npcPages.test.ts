import { describe, expect, it } from 'vitest'
import { bareNpc, isNamedNpc, npcTitles, parseHp, parseNpcPage, parseRespawn } from '../../../src/features/factions/npcPages'

// A named NPC's eqlwiki page, made up in {{Namedmobpage}}'s shape.
const PAGE = `{{Classic Era}}
{{Namedmobpage

| name              = Gate Guard Bram
| race              = Kaladim Citizen
| level             = 25

| zone              = [[Test Pass]]
| location          = 100% @ (83, 2443)
| respawn_time      = 6m 40s

| AC                = 181
| HP                = 1,512
| special           = None

| known_loot =

<ul><li>  {{:Rusty Short Sword}}       <span class='drare'>(Uncommon)</span> <span class='ddb'>[2] 1x 35% (100%)</span>
</li></ul>

| factions =

* [[Test Miners]] <span class='profac'>(-5)</span>
* [[Test Bankers]]

| opposing_factions =

* [[Test Rogues]] <span class='oppfac'>(5)</span>
* [[Hall of the Test Mask|Test Mask]] (3)

| related_quests =

* None

}}

[[Category:Test Pass]]`

describe("eqlwiki's NPC pages", () => {
  it('reads health, respawn and the amounts a kill gives, own factions down and foes up', () => {
    expect(parseNpcPage(PAGE)).toEqual({ hp: 1512, respawnSec: 400, hits: { 'Test Miners': -5, 'Test Rogues': 5, 'Hall of the Test Mask': 3 } })
    // A page that gives none of it.
    expect(parseNpcPage('{{Namedmobpage\n| name = Somebody\n| HP =\n}}')).toEqual({})
    // A page marked for deletion as an NPC the game does not have; one marked for another reason is still Legends'.
    expect(parseNpcPage("{{Delete}}\n\n'''Reason for deletion:''' this NPC does not exist in the game.\n\n{{Namedmobpage\n| name = Somebody\n| HP = 51000\n}}")).toEqual({
      hp: 51_000,
      gone: true
    })
    expect(parseNpcPage("{{Delete}}\n'''Reason for deletion:''' moved to Somebody (Test Hold).\n{{Namedmobpage\n| name = Somebody\n}}")).toEqual({})
    // A guildmaster by its class, not a shaman who leads a camp.
    expect(parseNpcPage('{{Namedmobpage\n| name = Somebody\n| class             = GM [[Necromancer]]\n| HP = 20000\n}}')).toEqual({ hp: 20_000, guildmaster: true })
    expect(parseNpcPage('{{Namedmobpage\n| name = Somebody\n| class             = [[Shaman]]\n}}')).toEqual({})
  })

  it('reads health however it is written', () => {
    expect([parseHp('2,500,000'), parseHp('5000ish'), parseHp('Under 10k'), parseHp('20000 (10,000 triggered)'), parseHp(''), parseHp('unknown')]).toEqual([
      2_500_000,
      5000,
      10_000,
      20_000,
      undefined,
      undefined
    ])
  })

  it('reads a respawn however it is written, the first of a range', () => {
    expect([
      parseRespawn('6:40'),
      parseRespawn('15:00'),
      parseRespawn('1:00:00'),
      parseRespawn('6m 40s'),
      parseRespawn('4 minutes 24 seconds'),
      parseRespawn('9 mins; a pawn as PH.'),
      parseRespawn('20 min - 1 hr'),
      parseRespawn('Instant'),
      parseRespawn('')
    ]).toEqual([400, 900, 3600, 400, 264, 540, 1200, undefined, undefined])
  })

  it('tells a named NPC from one of many alike, and asks under each title eqlwiki may keep it', () => {
    expect(['Gate Guard Bram', 'Lord Brute - Test Keep', 'a pass bandit', 'pass rat', 'A Pass Bandit', 'An Ogre'].map(isNamedNpc)).toEqual([true, true, false, false, false, false])
    expect(bareNpc('Lord Brute - Test Keep')).toBe('Lord Brute')
    expect(npcTitles('Ambassador D`Vinn')).toEqual(['Ambassador D`Vinn', 'Ambassador DVinn', "Ambassador D'Vinn"])
    expect(npcTitles('Gate Guard Bram')).toEqual(['Gate Guard Bram'])
  })
})
