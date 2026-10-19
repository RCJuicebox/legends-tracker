// A step of Plan › Slayer another page sends the player to (the Achievements page's "Step 4 · Lake
// Rathetear"): asked for before the page is opened, taken by the page once its plan is drawn.

let wanted: number | null = null

/** Asks Plan › Slayer to scroll to a step (its index) when it next draws its plan. */
export function requestSlayerStep(index: number): void {
  wanted = index
}

/** The step asked for, once; null when none was. */
export function takeRequestedSlayerStep(): number | null {
  const w = wanted
  wanted = null
  return w
}
