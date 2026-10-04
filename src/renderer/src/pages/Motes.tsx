import { useRemembered } from '../remember'
import { Tabs } from '../components/ui'
import { TAB_KEY, type Go, type MotesTab } from '../nav'
import { Gear } from './Gear'
import { MoteRuns } from './MoteRuns'
import { MotePlanner } from './MotePlanner'
import { MoteSpells } from './MoteSpells'

// Motes, coming and going: what was looted and on which run, then where they go: the gear merge
// that gains most for them, the planner for one item, and the spells worth ranking up. One page,
// since all of it is one stock.

const TABS: [MotesTab, string][] = [
  ['runs', 'Runs'],
  ['merge', 'Best merge'],
  ['planner', 'Merge planner'],
  ['spells', 'Spell upgrades']
]

const INTRO: Record<Exclude<MotesTab, 'runs'>, string> = {
  merge: 'Which of the gear you wear gains most for the motes its next merge takes, by your stat weights.',
  planner: 'Which motes an item needs to reach the level you want, and how to get them from your stock.',
  spells: "Which of the spells and songs you cast to put motes into next: the most gained per xp, by the guide's categories."
}

export function Motes({ go }: { go?: Go }) {
  const [saved, setTab] = useRemembered<MotesTab>(TAB_KEY.motes, 'runs')
  const tab = TABS.some(([id]) => id === saved) ? saved : 'runs'
  return (
    <>
      <div className="page-head">
        <h1>Motes</h1>
      </div>
      <Tabs className="mb-14" label="Motes view" value={tab} onChange={setTab} tabs={TABS} />
      {tab === 'runs' ? (
        <MoteRuns />
      ) : (
        <>
          <div className="page-head">
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
          {tab === 'merge' ? <Gear only="merge" go={go} onPlan={() => setTab('planner')} /> : tab === 'planner' ? <MotePlanner /> : <MoteSpells go={go} />}
        </>
      )}
    </>
  )
}
