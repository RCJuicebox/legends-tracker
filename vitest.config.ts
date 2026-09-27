import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Transformed modules are kept between runs (in node_modules/.vitest-cache): a cold run is quicker.
    fsModuleCache: true,
    // npm run coverage: what the tests reach, for the code that is not the pages.
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/main/**', 'src/shared/**', 'src/features/*/core.ts', 'src/features/*/main.ts'],
      reporter: ['text-summary', 'html'],
      reportsDirectory: 'coverage'
    },
    // Anything that finds its folders from the environment (the cache folder) gets a scratch one,
    // never the real profile.
    env: { EQL_USER_DATA: join(tmpdir(), 'lt-vitest-profile') }
  }
})
