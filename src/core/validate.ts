// What the pages send the main process is checked before it is stored. A page is our own code,
// but a bug in one should not be able to write a setting that breaks the app on its next start.
// Nothing is rejected for one bad field: the field falls back to what was there, and numbers are held
// to the range their control allows.

// Each subject is a file of validate/ (LT-638): what a page sends (args), settings.json and the
// character records (settings), triggers, the files the log keeps (logFiles), and the Stats sheet and
// Tradeskills favourites (sheets).

export * from './validate/args'
export * from './validate/settings'
export * from './validate/triggers'
export * from './validate/logFiles'
export * from './validate/sheets'
