import { defineConfig } from 'vitest/config'

// npm run replay: the replay check over the player's own log (tests/replay, FEAT-019). Never in CI.
export default defineConfig({
  test: {
    include: ['tests/replay/**/*.check.ts'],
    environment: 'node',
    fileParallelism: false
  }
})
