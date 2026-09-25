// Renders build/icon-source.webp to build/icon.png (512×512, transparent) with Electron's own renderer.
// The artwork is a rounded square on black; this crops to the square and makes the black corners
// transparent. electron-builder turns the PNG into the Windows .ico. Run: npm run icon
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

// The rounded square inside the 1254×1254 artwork, measured from its pixels.
const SQUARE = { left: 68, top: 65, right: 1185, bottom: 1172, radius: 235 }
// Trimmed off every side so the dark anti-aliased rim does not show against light backgrounds.
const INSET = 3
const SIZE = 512

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const src = 'data:image/webp;base64,' + readFileSync(join(__dirname, '..', 'build', 'icon-source.webp')).toString('base64')
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('about:blank')
  const png = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = ${JSON.stringify(src)}
    await img.decode()
    const s = ${JSON.stringify(SQUARE)}, inset = ${INSET}, size = ${SIZE}
    const x = s.left + inset, y = s.top + inset, w = s.right - s.left + 1 - 2 * inset, h = s.bottom - s.top + 1 - 2 * inset
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, x, y, w, h, 0, 0, size, size)
    // Keep only the rounded square.
    g.globalCompositeOperation = 'destination-in'
    g.beginPath()
    g.roundRect(0, 0, size, size, ((s.radius - inset) / w) * size)
    g.fill()
    return c.toDataURL('image/png')
  })()`)
  writeFileSync(join(__dirname, '..', 'build', 'icon.png'), Buffer.from(png.split(',')[1], 'base64'))
  console.log('wrote build/icon.png', `${SIZE}×${SIZE}`)
  app.quit()
})
