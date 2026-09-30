// Starts the app on a throwaway profile, checks that its window came up with a state, and asks it
// to quit, as a player's second copy would. For CI after a build:
//
//   node scripts/smoke.mjs                      the built source (out/) under node_modules' Electron
//   node scripts/smoke.mjs dist/win-unpacked/Legends Tracker.exe   a packaged copy
//
// Exits 0 when the app started, answered app:state and quit by itself; 1 otherwise.

import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const exe = process.argv[2] ? resolve(process.argv[2]) : join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const appArgs = process.argv[2] ? [] : [root]
const port = 9400 + Math.floor(Math.random() * 400)
const profile = mkdtempSync(join(tmpdir(), 'lt-smoke-'))
const env = { ...process.env, EQL_USER_DATA: profile }

// A tiny game folder beside the profile: the test spell files and one character log with a mote in
// it. A first start with no mote history reads it on the mote worker thread, which only a packaged
// build lays out the way an installed copy does.
const game = join(profile, 'game')
mkdirSync(join(game, 'Logs'), { recursive: true })
for (const f of ['spells_us.txt', 'spells_us_str.txt']) copyFileSync(join(root, 'tests', 'fixtures', f), join(game, f))
writeFileSync(
  join(game, 'Logs', 'eqlog_Smoke_test.txt'),
  '[Thu Sep 24 16:00:00 2026] You have entered The Plane of Fear 4 (Refined).\r\n' +
    '[Thu Sep 24 16:23:16 2026] You looted 4 Mote of Major Potential from Reward Chest and stored it in your currency.\r\n'
)
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ installDir: game, logFile: '', autoStart: false, hotkeys: false, audio: { muted: true } }))

function fail(message) {
  console.error(`smoke: ${message}`)
  process.exitCode = 1
}

/** Waits for `test` to return something, trying every 250 ms for `ms`. */
async function until(what, ms, test) {
  const end = Date.now() + ms
  for (;;) {
    try {
      const v = await test()
      if (v) return v
    } catch {
      // not up yet
    }
    if (Date.now() > end) throw new Error(`gave up waiting for ${what}`)
    await sleep(250)
  }
}

/** Evaluates `expression` in the page, awaiting a promise. */
async function evaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl)
  await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)))
  const reply = new Promise((ok) => (ws.onmessage = (ev) => ok(JSON.parse(ev.data))))
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  const m = await reply
  ws.close()
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? 'page error')
  return m.result?.result?.value
}

const app = spawn(exe, [...appArgs, `--remote-debugging-port=${port}`], { env, stdio: 'ignore' })
let exited = null
app.on('exit', (code) => (exited = code ?? 0))

try {
  const page = await until('the main window', 45_000, async () => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    return targets.find((t) => t.type === 'page' && /index\.html/.test(t.url))
  })
  const state = await until('app:state', 20_000, () =>
    evaluate(page.webSocketDebuggerUrl, "window.eql.invoke('app:state').then((s) => ({ keys: Object.keys(s), overlays: s.settings.overlays.length }))")
  )
  for (const key of ['settings', 'status', 'timers', 'feed', 'character']) if (!state.keys.includes(key)) fail(`app:state has no ${key}`)
  if (!state.overlays) fail('app:state has no overlays')
  console.log(`smoke: the window came up; app:state has ${state.keys.length} fields and ${state.overlays} overlays`)

  // The mote worker read the fake log: its mote is in the history.
  const motes = await until('the mote history', 30_000, () =>
    evaluate(page.webSocketDebuggerUrl, "window.eql.invoke('motes:get').then((m) => (m.scanning ? null : m.daily['2026-09-24'] ?? { none: true }))")
  )
  if (motes.major !== 4) fail(`the mote history did not come from the worker: ${JSON.stringify(motes)}`)
  else console.log('smoke: the mote worker read the log (4 Major on 2026-09-24)')

  // A second copy with --quit asks the first to save and close, and exits itself.
  const quitter = spawn(exe, [...appArgs, '--quit'], { env, stdio: 'ignore' })
  await until('the app to quit', 20_000, () => exited !== null)
  quitter.kill()
  console.log(`smoke: the app quit when asked (exit ${exited})`)
  if (exited !== 0) fail(`the app exited with ${exited}`)
} catch (e) {
  fail(e.message)
} finally {
  if (exited === null) app.kill()
  await sleep(500)
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
}
