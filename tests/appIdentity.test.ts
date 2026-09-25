import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { APP_ID } from '../src/main/appIdentity'

describe('app identity', () => {
  it('is the appId the installer gives its shortcuts, or the taskbar and notifications lose track of the app', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { build: { appId: string } }
    expect(APP_ID).toBe(pkg.build.appId)
  })
})
