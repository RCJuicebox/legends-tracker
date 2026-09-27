// Prints one version's section of CHANGELOG.md, for its GitHub Release notes:
//   node scripts/release-notes.mjs 1.10.0
// Fails when the changelog has no section for that version, so a release never goes out without notes.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/)
  const heading = `## ${version}`
  const start = lines.findIndex((l) => l === heading || l.startsWith(`${heading} `))
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
  // Sections inside a version are ### in the changelog and ## on the release page.
  return body ? body.replace(/^###/gm, '##') : null
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]
  const notes = version && releaseNotes(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), version)
  if (!notes) {
    console.error(`CHANGELOG.md has no section "## ${version}". Write the release notes there first.`)
    process.exit(1)
  }
  process.stdout.write(`${notes}\n\nDownload Legends-Tracker-Setup-${version}.exe below; installed copies update themselves.\n`)
}
