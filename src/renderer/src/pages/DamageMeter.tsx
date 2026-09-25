import { Meter } from '../components/Meter'

export function DamageMeter() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Damage Meter</h1>
          <p>
            Every fight the log can see, read from the last hour at start and live from then on: who dealt what, what hit your side,
            who healed, and what fired on its own. Fight or Overall, for everyone, your group, or just you.
          </p>
        </div>
      </div>
      <Meter standalone />
    </>
  )
}
