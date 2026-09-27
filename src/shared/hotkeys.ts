// The global hotkeys: keys EverQuest leaves alone, for what is wanted mid-fight with the game in front.

export const HOTKEYS = {
  mute: 'Control+Shift+F9',
  newSession: 'Control+Shift+F10',
  arrange: 'Control+Shift+F11'
} as const

/** "Control+Shift+F9" as a player reads it. */
export const hotkeyLabel = (accel: string) => accel.replace('Control', 'Ctrl').replace(/\+/g, ' + ')
