import { spawn } from 'node:child_process'
import { desktopCapturer, screen } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Composite, OcrWord } from '../core/screenText'
import { log } from './log'
import { yieldPriority } from './priority'
import { cacheDir } from './paths'

// Reads text off the screen with Windows' own OCR (Windows.Media.Ocr). It looks at pixels, the way a
// player reads a window; it never touches the game's process or memory. The capture is enlarged 3×
// and inverted to dark-on-light first: the game's small light-on-dark font reads far better that way.
const SCRIPT = `
param([string]$Path, [int]$Scale, [string]$Out, [string]$Compose = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
# The OCR API wants a full path with backslashes.
$Path = [System.IO.Path]::GetFullPath($Path)
$src = [System.Drawing.Bitmap]::FromFile($Path)
# Compose is 'width,height;sx,sy,w,h,dx,dy;...': pieces of the capture redrawn onto a fresh dark image.
if ($Compose) {
  $parts = $Compose.Split(';'); $size = $parts[0].Split(',')
  $comp = New-Object System.Drawing.Bitmap ([int]$size[0]), ([int]$size[1])
  $cg = [System.Drawing.Graphics]::FromImage($comp); $cg.Clear([System.Drawing.Color]::Black)
  foreach ($piece in $parts[1..($parts.Count - 1)]) {
    $n = $piece.Split(',') | ForEach-Object { [int]$_ }
    $cg.DrawImage($src, (New-Object System.Drawing.Rectangle $n[4], $n[5], $n[2], $n[3]), $n[0], $n[1], $n[2], $n[3], [System.Drawing.GraphicsUnit]::Pixel)
  }
  $cg.Dispose(); $src.Dispose(); $src = $comp
}
$w = $src.Width * $Scale; $h = $src.Height * $Scale
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$m = [float[][]]@(@(-0.3,-0.3,-0.3,0,0), @(-0.59,-0.59,-0.59,0,0), @(-0.11,-0.11,-0.11,0,0), @(0,0,0,1,0), @(1,1,1,0,1))
$ia = New-Object System.Drawing.Imaging.ImageAttributes
$ia.SetColorMatrix((New-Object System.Drawing.Imaging.ColorMatrix(,$m)))
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), 0, 0, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
$prepared = [System.IO.Path]::GetFullPath($Out)
$bmp.Save($prepared, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose(); $src.Dispose()
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($prepared)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$sb = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$r = Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
$words = foreach ($line in $r.Lines) { foreach ($wd in $line.Words) { $b = $wd.BoundingRect; @{ t = $wd.Text; x = [int]($b.X / $Scale); y = [int]($b.Y / $Scale); w = [int]($b.Width / $Scale); h = [int]($b.Height / $Scale) } } }
$stream.Dispose(); Remove-Item $prepared -ErrorAction SilentlyContinue
[Console]::Out.Write((ConvertTo-Json -Compress -Depth 3 -InputObject @($words)))
`

/** How long one OCR read may take before it is stopped. */
const OCR_TIMEOUT_MS = 45_000

let scriptWritten: Promise<string> | null = null
/** OCR runs under way: stopped when the app quits, so none outlives it holding a picture of the screen (LT-439). */
const running = new Set<{ kill: () => void }>()

/** Stops any OCR still running: the app is quitting. */
export function stopOcr(): void {
  for (const p of running) p.kill()
  running.clear()
}

/**
 * Removes screen pictures a crash, a forced exit or a shutdown mid-read left in the cache folder:
 * each is a picture of the whole desktop (LT-439). Once at start.
 */
export async function sweepScreenCaptures(): Promise<void> {
  const dir = cacheDir()
  const names = await fs.readdir(dir).catch(() => [] as string[])
  await Promise.all(names.filter((n) => /^(?:screen|ocr)-[\w-]+\.(?:png|bmp)$/.test(n)).map((n) => fs.rm(join(dir, n), { force: true }).catch(() => undefined)))
}

/** The OCR script in the cache folder: written once a run, and again if something cleared it away. */
function scriptFile(): Promise<string> {
  const path = join(cacheDir(), 'ocr.ps1')
  if (scriptWritten && existsSync(path)) return scriptWritten
  scriptWritten = fs.writeFile(path, SCRIPT, 'utf8').then(() => path)
  scriptWritten.catch(() => (scriptWritten = null))
  return scriptWritten
}

/** OCR of an image file: every word with its box, in the image's own pixel coordinates. */
export async function ocrImage(path: string, scale = 3, layout?: Composite): Promise<OcrWord[]> {
  const script = await scriptFile()
  // The enlarged picture the OCR reads, in the app's own cache folder: removed here whatever the
  // script got to, since it is a picture of the screen.
  const prepared = join(cacheDir(), `ocr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`)
  const out = await new Promise<string>((resolve, reject) => {
    const p = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Path',
        path,
        '-Scale',
        String(scale),
        '-Out',
        prepared,
        ...(layout ? ['-Compose', composeArg(layout)] : [])
      ],
      {
        windowsHide: true
      }
    )
    yieldPriority(p.pid)
    running.add(p)
    p.on('exit', () => running.delete(p))
    let stdout = ''
    let stderr = ''
    p.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    p.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    p.on('error', reject)
    // Windows OCR normally answers in a second or two; one that has not in 45 s is not going to.
    const timer = setTimeout(() => {
      p.kill()
      reject(new Error('Reading the screen took too long and was stopped'))
    }, OCR_TIMEOUT_MS)
    p.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.split('\n').find((l) => l.trim()) || `OCR exited ${code}`))
    })
  }).finally(() => fs.rm(prepared, { force: true }).catch((e: unknown) => log.warn(`Could not delete ${prepared}`, e)))
  type Raw = { t: string; x: number; y: number; w: number; h: number }
  // PowerShell writes a single-element array as a bare object.
  const parsed = JSON.parse(out || '[]') as Raw[] | Raw
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.map((w) => ({ text: w.t, x: w.x, y: w.y, w: w.w, h: w.h }))
}

/** The rebuilt image's layout as the OCR script takes it. Coordinates are whole pixels of the capture. */
function composeArg(c: Composite): string {
  const r = Math.round
  return [`${r(c.width)},${r(c.height)}`, ...c.pieces.map((p) => [p.from.x, p.from.y, p.from.w, p.from.h, p.x, p.y].map(r).join(','))].join(';')
}

/**
 * Captures every monitor at its own full resolution and returns the PNG paths. Pass them to
 * discardScreens() when done.
 *
 * desktopCapturer fits every screen into the one thumbnail size it is asked for, so with monitors of
 * different sizes (or one scaled to 200%) a smaller screen comes back stretched, and the game's small
 * font smeared past reading: a 3440×1440 screen beside a 4K one read 1 mote row of 10 (2026-10-02).
 * So it is asked once for each size there is, and each monitor is taken from the request at its own size.
 */
export async function captureScreens(): Promise<string[]> {
  const displays = screen.getAllDisplays().map((d) => ({ id: String(d.id), width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) }))
  const sizes = [...new Map(displays.map((d) => [`${d.width}x${d.height}`, { width: d.width, height: d.height }])).values()]
  const paths: string[] = []
  const stamp = Date.now().toString(36)
  try {
    for (const size of sizes) {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
      // The monitors of this size, by id; a source whose id names no monitor counts when its picture is this size.
      const wanted = new Set(displays.filter((d) => d.width === size.width && d.height === size.height).map((d) => d.id))
      for (const s of sources) {
        const pic = s.thumbnail.getSize()
        const own = wanted.has(s.display_id) || (!displays.some((d) => d.id === s.display_id) && pic.width === size.width && pic.height === size.height)
        if (!own || s.thumbnail.isEmpty()) continue
        // A bitmap as it is, not a PNG: encoding a 4K screen held the main process (the tick, the
        // log, the pushes) for 100 ms, the raw pixels take 3 ms (LT-440). The OCR script reads either.
        const pixels = s.thumbnail.toBitmap()
        const bmp = pixels.length === pic.width * pic.height * 4
        const p = join(cacheDir(), `screen-${stamp}-${paths.length}.${bmp ? 'bmp' : 'png'}`)
        paths.push(p)
        if (bmp) await writeBmp(p, pic.width, pic.height, pixels)
        else await fs.writeFile(p, s.thumbnail.toPNG())
      }
    }
  } catch (e) {
    await discardScreens(paths)
    throw e
  }
  return paths
}

/**
 * The headers of a 32-bit BMP of `width` × `height` pixels stored top row first, as Chromium's
 * toBitmap() gives them on Windows (blue, green, red, then a byte the format ignores).
 */
export function bmpHeader(width: number, height: number): Buffer {
  const pixels = width * height * 4
  const h = Buffer.alloc(54)
  h.write('BM', 0, 'ascii')
  h.writeUInt32LE(54 + pixels, 2) // file size
  h.writeUInt32LE(54, 10) // where the pixels start
  h.writeUInt32LE(40, 14) // BITMAPINFOHEADER
  h.writeInt32LE(width, 18)
  h.writeInt32LE(-height, 22) // negative: top row first
  h.writeUInt16LE(1, 26) // planes
  h.writeUInt16LE(32, 28) // bits a pixel
  h.writeUInt32LE(0, 30) // BI_RGB
  h.writeUInt32LE(pixels, 34)
  return h
}

async function writeBmp(path: string, width: number, height: number, pixels: Buffer): Promise<void> {
  const f = await fs.open(path, 'w')
  try {
    await f.writev([bmpHeader(width, height), pixels])
  } finally {
    await f.close()
  }
}

/** Deletes captures: they are pictures of the whole desktop, and have no business staying on disk. */
export async function discardScreens(paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => fs.rm(p, { force: true }).catch((e) => log.warn(`Could not delete the screen capture ${p}`, e))))
}
