import { isSkinName } from './skinBuild'

// The UI skin a character plays with. The game keeps it per character, in that character's UI layout
// file in the game folder: UI_<Name>_<server>.ini, or UI_<Name>_<server>_LO<n>.ini, one per saved
// layout (the one played last is the one written last). Its [Main] section names the skin:
//
//   [Main]
//   UISkin=JuiceboxUI
//
// A skin folder (uifiles/<skin>/) holds only what it changes and the game takes the rest from
// uifiles/default/, so a skin can carry its own icon sheets; the icons are read the same way.

/** The skin a UI file names, or null for the stock one (Default) or none. */
export function parseUiSkin(text: string): string | null {
  let main = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      if (main) break
      main = line.toLowerCase() === '[main]'
    } else if (main) {
      const m = /^uiskin\s*=\s*(.*)$/i.exec(line)
      if (m) return isSkinName(m[1]) && m[1].toLowerCase() !== 'default' ? m[1] : null
    }
  }
  return null
}

/** Which of a game folder's file names are a character's (`Name_server`) UI files: not the game's backups. */
export function uiFilesOf(character: string, names: readonly string[]): string[] {
  if (!character) return []
  const want = character.toLowerCase()
  return names.filter((n) => {
    const m = /^UI_(.+?)(?:_LO\d+)?\.ini$/i.exec(n)
    return !!m && m[1].toLowerCase() === want
  })
}
