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
      reportsDirectory: 'coverage',
      // Where coverage stood when these were last set (2026-09-30, after the untested core files got tests), a point under: a change that drops a
      // folder below its floor fails `npm run coverage`, which CI runs. Raise them as tests are added.
      thresholds: {
        'src/core/**': { lines: 92, statements: 89, functions: 89, branches: 78 },
        'src/shared/**': { lines: 95, statements: 94, functions: 95, branches: 89 },
        'src/main/engine/**': { lines: 74, statements: 71, functions: 67, branches: 61 },
        'src/main/**': { lines: 43, statements: 40, functions: 39, branches: 32 },
        'src/features/**': { lines: 50, statements: 48, functions: 47, branches: 55 }
      }
    },
    // Anything that finds its folders from the environment (the cache folder) gets a scratch one,
    // never the real profile.
    env: { EQL_USER_DATA: join(tmpdir(), 'lt-vitest-profile') }
  }
})
