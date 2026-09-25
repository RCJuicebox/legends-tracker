import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The pages' Content-Security-Policy carries what the dev server needs: inline scripts for React's
 * refresh preamble, and a websocket to localhost for hot reload. A build ships neither, so they come
 * out of the built pages.
 */
function productionCsp(): Plugin {
  const drop: Record<string, string[]> = {
    'script-src': ["'unsafe-inline'"],
    'connect-src': ['ws:', 'http://localhost:*']
  }
  const tighten = (policy: string) =>
    policy
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...sources] = d.split(/\s+/)
        const keep = sources.filter((src) => !(drop[name] ?? []).includes(src))
        return [name, ...keep].join(' ')
      })
      .join('; ')
  return {
    name: 'lt-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/, (_m, a: string, policy: string, b: string) => a + tighten(policy) + b)
    }
  }
}

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } }
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), productionCsp()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html'),
          audio: resolve('src/renderer/audio.html')
        }
      }
    }
  }
})
