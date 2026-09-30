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
      // Where coverage stood when these were set (2026-09-30), a point under: a change that drops a
      // folder below its floor fails `npm run coverage`, which CI runs. Raise them as tests are added.
      thresholds: {
        'src/core/**': { lines: 89, statements: 86, functions: 85, branches: 75 },
        'src/shared/**': { lines: 95, statements: 94, functions: 95, branches: 89 },
        'src/main/engine/**': { lines: 72, statements: 68, functions: 61, branches: 61 },
        'src/main/**': { lines: 42, statements: 40, functions: 38, branches: 32 },
        'src/features/**': { lines: 46, statements: 44, functions: 45, branches: 54 }
      }
    },
    // Anything that finds its folders from the environment (the cache folder) gets a scratch one,
    // never the real profile.
    env: { EQL_USER_DATA: join(tmpdir(), 'lt-vitest-profile') }
  }
})
