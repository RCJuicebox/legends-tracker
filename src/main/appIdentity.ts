import { app, nativeImage, shell } from 'electron'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './log'

// Who the app is to Windows. The taskbar draws a window's button with the icon of the Start Menu
// shortcut carrying the same AppUserModelID, and with the running program's own icon when there is
// none. Installed, that program is Legends Tracker.exe and the installer's shortcuts carry the
// electron-builder appId. From source it is electron.exe, whose icon is Electron's, so a shortcut
// of our own is kept in the Start Menu to give the taskbar the hourglass.

/** electron-builder's appId (package.json "build.appId"): the installer's shortcuts carry it. */
export const APP_ID = 'com.rcjuicebox.legendstracker'

export function appUserModelId(): string {
  return app.isPackaged ? APP_ID : `${APP_ID}.source`
}

/** A Windows .ico of the PNG at the sizes the shell asks for, each stored as PNG (Vista and later read these). */
export function icoFromPng(pngPath: string): Buffer {
  const src = nativeImage.createFromPath(pngPath)
  if (src.isEmpty()) throw new Error(`${pngPath} is not an image`)
  const sizes = [256, 64, 48, 32, 24, 16]
  const images = sizes.map((s) => src.resize({ width: s, height: s, quality: 'best' }).toPNG())
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i
    header.writeUInt8(s >= 256 ? 0 : s, e)
    header.writeUInt8(s >= 256 ? 0 : s, e + 1)
    header.writeUInt8(0, e + 2)
    header.writeUInt8(0, e + 3)
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(images[i].length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += images[i].length
  })
  return Buffer.concat([header, ...images])
}

/**
 * From source only: a Start Menu shortcut, "Legends Tracker (source)", that starts this checkout
 * and carries its AppUserModelID and the hourglass, so the taskbar shows the hourglass rather than
 * Electron's icon. Kept up to date on each start; a test run on a scratch profile leaves it alone.
 */
export function ensureSourceShortcut(iconPng: string): void {
  if (app.isPackaged || process.platform !== 'win32' || process.env['EQL_USER_DATA']) return
  try {
    const ico = join(app.getPath('userData'), 'app-icon.ico')
    if (!existsSync(ico) || statSync(ico).mtimeMs < statSync(iconPng).mtimeMs) writeFileSync(ico, icoFromPng(iconPng))
    const lnk = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Legends Tracker (source).lnk')
    const want = {
      target: process.execPath,
      args: `"${app.getAppPath()}"`,
      cwd: app.getAppPath(),
      description: 'Legends Tracker, run from its source checkout',
      icon: ico,
      iconIndex: 0,
      appUserModelId: appUserModelId()
    }
    let have: Electron.ShortcutDetails | null = null
    try {
      have = existsSync(lnk) ? shell.readShortcutLink(lnk) : null
    } catch {
      have = null
    }
    const same = have && have.target === want.target && have.args === want.args && have.icon === want.icon && have.appUserModelId === want.appUserModelId
    if (!same && !shell.writeShortcutLink(lnk, have ? 'replace' : 'create', want)) log.warn(`Could not write the Start Menu shortcut ${lnk}`)
  } catch (e) {
    log.warn('Could not set up the Start Menu shortcut for the taskbar icon:', e)
  }
}
