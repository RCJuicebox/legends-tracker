import { afterAll } from 'vitest'
import { removeTempDirs } from './tempDir'

// Run before each test file (vitest.config.ts setupFiles): what tempDir made goes when the file is done.
afterAll(removeTempDirs)
