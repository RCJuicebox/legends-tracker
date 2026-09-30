import { useRemembered } from '../remember'
import { UPGRADES_TAB } from '../constants'
import { Tabs } from '../components/ui'
import { Gear } from './Gear'
import { MotePlanner } from './MotePlanner'
import { MoteSpells } from './MoteSpells'
import type { PageId } from '../main'

// Where motes go: the gear merge that gains most for them, the planner for one item, and the spells
// worth ranking up. One page, since all three spend the same stock.

export type UpgradesTab = 'merge' | 'planner' | 'spells'

const TABS: [UpgradesTab, string][] = [
  ['merge', 'Best merge'],
  ['planner', 'Merge planner'],
  ['spells', 'Spell upgrades']
]

const INTRO: Record<UpgradesTab, string> = {
  merge: 'Which of the gear you wear gains most for the motes its next merge takes, by your stat weights.',
  planner: 'Which motes an item needs to reach the level you want, and how to get them from your stock.',
  spells: "Which of the spells and songs you cast to put motes into next: the most gained per xp, by the guide's categories."
}

export function Upgrades({ go }: { go?: (page: PageId) => void }) {
  const [tab, setTab] = useRemembered<UpgradesTab>(UPGRADES_TAB, 'merge')
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Upgrades</h1>
          <p>
            {INTRO[tab]} Your motes on hand are kept in the{' '}
            {tab === 'planner' ? (
              'Merge planner'
            ) : (
              <button className="link-button inline" onClick={() => setTab('planner')}>
                Merge planner
              </button>
            )}
            : typed in, read from the screen, or added as you loot them.
          </p>
        </div>
      </div>
      <Tabs className="mb-14" label="Upgrades view" value={tab} onChange={setTab} tabs={TABS} />
      {tab === 'merge' ? <Gear only="merge" go={go} onPlan={() => setTab('planner')} /> : tab === 'planner' ? <MotePlanner /> : <MoteSpells go={go} />}
    </>
  )
}
