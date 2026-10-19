/**
 * JSON.parse of a file's text, a leading byte-order mark allowed. PowerShell 5.1's Out-File and
 * Set-Content, older Notepads and many tools write one, and JSON.parse refuses it ("Unexpected token
 * \uFEFF"), which set a player's spell rules aside as corrupt (2026-10-06).
 */
export function parseJson(text: string): unknown {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
}
