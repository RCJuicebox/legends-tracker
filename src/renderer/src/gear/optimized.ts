// The owned pieces the optimiser's best set would put on, kept per character when the Optimize tab works
// it out, so Best merge can rank a +1 on one of them beside what is worn (LT-741).

/** Remembered under `${OPTIMIZED_KEY}.${character}`. */
export const OPTIMIZED_KEY = 'gear.optimized'

export interface OptimizedPick {
  slot: string
  name: string
}
