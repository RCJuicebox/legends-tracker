import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Anything that finds its folders from the environment (the cache folder) gets a scratch one,
    // never the real profile.
    env: { EQL_USER_DATA: join(tmpdir(), 'lt-vitest-profile') }
  }
})
