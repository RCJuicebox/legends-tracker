import { spawn } from 'node:child_process'
import { desktopCapturer, screen } from 'electron'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OcrWord } from '../core/screenText'

// Reads text off the screen with Windows' own OCR (Windows.Media.Ocr). It looks at pixels, the way a
// player reads a window; it never touches the game's process or memory. The capture is enlarged 3×
// and inverted to dark-on-light first: the game's small light-on-dark font reads far better that way.
const SCRIPT = `
param([string]$Path, [int]$Scale)
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
$w = $src.Width * $Scale; $h = $src.Height * $Scale
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$m = [float[][]]@(@(-0.3,-0.3,-0.3,0,0), @(-0.59,-0.59,-0.59,0,0), @(-0.11,-0.11,-0.11,0,0), @(0,0,0,1,0), @(1,1,1,0,1))
$ia = New-Object System.Drawing.Imaging.ImageAttributes
$ia.SetColorMatrix((New-Object System.Drawing.Imaging.ColorMatrix(,$m)))
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), 0, 0, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
$prepared = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), [Guid]::NewGuid().ToString() + '.png')
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

/** OCR of an image file: every word with its box, in the image's own pixel coordinates. */
export async function ocrImage(path: string, scale = 3): Promise<OcrWord[]> {
  const script = join(tmpdir(), 'legends-tracker-ocr.ps1')
  await fs.writeFile(script, SCRIPT, 'utf8')
  const out = await new Promise<string>((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', path, '-Scale', String(scale)], {
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    p.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    p.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr.split('\n').find((l) => l.trim()) || `OCR exited ${code}`))))
  })
  type Raw = { t: string; x: number; y: number; w: number; h: number }
  // PowerShell writes a single-element array as a bare object.
  const parsed = JSON.parse(out || '[]') as Raw[] | Raw
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.map((w) => ({ text: w.t, x: w.x, y: w.y, w: w.w, h: w.h }))
}

/** Captures every monitor at full resolution and returns the PNG paths. */
export async function captureScreens(): Promise<string[]> {
  const largest = screen.getAllDisplays().reduce(
    (m, d) => ({ width: Math.max(m.width, Math.round(d.size.width * d.scaleFactor)), height: Math.max(m.height, Math.round(d.size.height * d.scaleFactor)) }),
    { width: 0, height: 0 }
  )
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: largest })
  const paths: string[] = []
  for (const [i, s] of sources.entries()) {
    const p = join(tmpdir(), `legends-tracker-screen-${i}.png`)
    await fs.writeFile(p, s.thumbnail.toPNG())
    paths.push(p)
  }
  return paths
}
