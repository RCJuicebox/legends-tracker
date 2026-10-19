import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Each test file's tempDir folders are removed after it (LT-643).
    setupFiles: ['tests/setup.ts'],
    environment: 'node',
    // Transformed modules are kept between runs (in node_modules/.vitest-cache): a cold run is quicker.
    fsModuleCache: true,
    // npm run coverage: what the tests reach, for the code that is not the pages.
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/main/**', 'src/shared/**', 'src/features/**/*.ts', 'src/renderer/src/**/*.ts'],
      reporter: ['text-summary', 'html'],
      reportsDirectory: 'coverage',
      // Where coverage stood when these were last set (2026-10-18, LT-629; before that 2026-09-30), a point under: a change that drops a
      // folder below its floor fails `npm run coverage`, which CI runs. Raise them as tests are added.
      thresholds: {
        'src/core/**': { lines: 93, statements: 90, functions: 90, branches: 80 },
        'src/shared/**': { lines: 99, statements: 98, functions: 96, branches: 89 },
        'src/main/engine/**': { lines: 80, statements: 76, functions: 72, branches: 65 },
        'src/main/ipc/**': { lines: 78, statements: 74, functions: 75, branches: 50 },
        'src/main/sources/**': { lines: 80, statements: 78, functions: 77, branches: 72 },
        'src/main/**': { lines: 58, statements: 55, functions: 54, branches: 46 },
        'src/features/**': { lines: 96, statements: 94, functions: 93, branches: 86 },
        // The renderer's own TypeScript (hooks, state, the overlay's maths), not the pages: measured since 2026-10-18 (LT-629).
        'src/renderer/src/**/*.ts': { lines: 33, statements: 31, functions: 28, branches: 21 }
      }
    },
    // GitHub's Windows runners are slow some days: tests that take well under a second here timed out at
    // the default five seconds and failed the 2.14.2 release build (2026-10-15). On CI they get thirty;
    // here a hung test still fails quickly.
    testTimeout: process.env['CI'] ? 30_000 : 5_000,
    hookTimeout: process.env['CI'] ? 60_000 : 10_000,
    // Anything that finds its folders from the environment (the cache folder) gets a scratch one,
    // never the real profile.
    env: { EQL_USER_DATA: join(tmpdir(), 'lt-vitest-profile') }
  }
})
