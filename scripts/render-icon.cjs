// Renders build/icon.svg to build/icon.png (512×512, transparent) with Electron's own renderer.
// electron-builder turns the PNG into the Windows .ico. Run: npx electron scripts/render-icon.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const svg = readFileSync(join(__dirname, '..', 'build', 'icon.svg'), 'utf8')
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })
  win.webContents.setFrameRate(1)
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  let done = false
  win.webContents.on('paint', (_e, _dirty, image) => {
    if (done || image.getSize().width < 512) return
    done = true
    writeFileSync(join(__dirname, '..', 'build', 'icon.png'), image.toPNG())
    console.log('wrote build/icon.png', image.getSize())
    app.quit()
  })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  setTimeout(() => {
    if (!done) {
      console.error('no frame painted')
      app.exit(1)
    }
  }, 10000)
})
