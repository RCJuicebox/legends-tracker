import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

// npm run bench: the timing runs (tests/**/*.bench.ts), one file at a time so nothing else competes.
export default defineConfig({
  test: {
    include: ['tests/**/*.bench.ts'],
    environment: 'node',
    fileParallelism: false,
    env: { EQL_USER_DATA: join(tmpdir(), 'lt-vitest-profile') }
  }
})
