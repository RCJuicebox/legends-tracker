// Publishes the version in package.json as a GitHub Release that installed copies will update to.
//
//   1. bump "version" in package.json and commit
//   2. npm run release
//
// This pushes the commit and its version tag; GitHub Actions (.github/workflows/release.yml) then
// builds the installer from that commit on a clean Windows machine and publishes it. Releases are
// only ever built there, the same way every time, from the public source. `npm run dist` still builds
// an installer locally for testing, without publishing anything.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = `v${version}`

if (out('git status --porcelain')) throw new Error('Commit your changes first: the release is built from what is committed.')
if (out(`git ls-remote --tags origin ${tag}`)) throw new Error(`${tag} is already released. Bump "version" in package.json first.`)

run('git push origin HEAD')
run(`git tag -a ${tag} -m "Legends Tracker ${version}"`)
run(`git push origin ${tag}`)
console.log(`\nPushed ${tag}. GitHub Actions is building and publishing it:`)
console.log('  https://github.com/RCJuicebox/legends-tracker/actions/workflows/release.yml')
console.log('Follow along with: gh run watch')
