// A UI skin can ask for a rebuild button. A skin made by a script (one that sizes its windows from
// the inventory export, say) leaves a file in its folder naming the command that rebuilds it:
//
//   uifiles/<skin>/legends-tracker.json   { "label": "Rebuild bag sizes", "command": ["C:/…/python.exe", "build.py", "--install"] }
//
// The app shows a button for each skin that has one and runs the command, with no shell, when it is
// pressed. A skin without the file shows nothing.

/** The file a skin folder holds to ask for a rebuild button. */
export const SKIN_BUILD_FILE = 'legends-tracker.json'

/** A skin's rebuild button: what it says and the command it runs. */
export interface SkinBuild {
  skin: string
  label: string
  command: string[]
}

/** What a rebuild printed, and whether it finished well. */
export interface SkinBuildResult {
  skin: string
  ok: boolean
  output: string
  /** Not run: a command not run before, shown whole to be agreed to first (LT-442). */
  confirm?: string[]
}

const MAX_ARGS = 20
const MAX_ARG = 1000

/** A skin folder's name as the game's /loadskin takes it. */
export function isSkinName(v: unknown): v is string {
  return typeof v === 'string' && /^[\w][\w .-]{0,63}$/.test(v) && !v.endsWith('.') && !v.endsWith(' ')
}

/**
 * The rebuild a skin's file asks for, or null when the file is not one: the command is a program
 * named by its full path (an .exe) and its arguments, each a string.
 */
export function parseSkinBuild(skin: string, text: string): SkinBuild | null {
  if (!isSkinName(skin)) return null
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { label, command } = data as { label?: unknown; command?: unknown }
  if (!Array.isArray(command) || !command.length || command.length > MAX_ARGS) return null
  if (!command.every((a): a is string => typeof a === 'string' && a.length > 0 && a.length <= MAX_ARG && ![...a].some((c) => c.charCodeAt(0) < 32))) return null
  if (!/^[a-z]:[\\/].+\.exe$/i.test(command[0])) return null
  const named = typeof label === 'string' ? label.trim().slice(0, 60) : ''
  return { skin, label: named || `Rebuild ${skin}`, command }
}

/** The end of what a command printed, enough to show what went wrong. */
export function tailOutput(text: string, max = 2000): string {
  const t = text.replace(/\r\n/g, '\n').trim()
  return t.length > max ? '…' + t.slice(-max) : t
}
