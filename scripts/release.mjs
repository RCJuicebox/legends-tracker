// Publishes the version in package.json as a GitHub Release that installed copies will update to.
//
//   1. bump "version" in package.json and commit
//   2. npm run release
//
// Order matters: GitHub only accepts a published release for a tag that already exists, and
// electron-builder uploads the installer and latest.yml in parallel, so the release is created
// first as a draft, filled, and published only once every file is up.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts })
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = `v${version}`

if (out('git status --porcelain')) throw new Error('Commit your changes first: the release is built from what is committed.')
if (out(`git ls-remote --tags origin ${tag}`)) throw new Error(`${tag} is already released. Bump "version" in package.json first.`)

run('git push origin HEAD')
run(`git tag -a ${tag} -m "Legends Tracker ${version}"`)
run(`git push origin ${tag}`)
run(`gh release create ${tag} --draft --title "${version}" --notes "Legends Tracker ${version}. Download Legends-Tracker-Setup-${version}.exe below; installed copies update themselves."`)

const token = out('gh auth token')
run('npx electron-vite build')
run('npx electron-builder --win --publish always', { env: { ...process.env, GH_TOKEN: token } })

const assets = JSON.parse(out(`gh release view ${tag} --json assets`)).assets.map((a) => a.name)
for (const need of ['latest.yml', `Legends-Tracker-Setup-${version}.exe`, `Legends-Tracker-Setup-${version}.exe.blockmap`]) {
  if (!assets.includes(need)) throw new Error(`${need} did not upload; the release is still a draft. Fix and re-run electron-builder --publish always.`)
}
run(`gh release edit ${tag} --draft=false --latest`)
console.log(`\nReleased ${tag}: https://github.com/RCJuicebox/legends-tracker/releases/tag/${tag}`)
