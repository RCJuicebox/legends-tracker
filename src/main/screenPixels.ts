import koffi from 'koffi'
import type { Frame } from '../core/groupHealth'

// A small piece of the screen, copied straight from Windows (GDI's BitBlt), for the group health
// watch, where desktopCapturer pictures every monitor whole. A copy is not free: a 204×320 piece takes
// 4–6 ms of wall time (0.2–1 ms of CPU), most of it waiting on the desktop compositor, and a whole
// 3440×1440 monitor some 25 ms (LT-551; what it costs the game's frames is not yet measured). It reads what is on the screen, as a player looks at it; it never touches the
// game's process. Coordinates are physical pixels of the whole desktop, as Electron's
// dipToScreenRect gives them. No Electron or log import, so the group health worker can use it.

interface Gdi {
  GetDC: (hwnd: null) => unknown
  ReleaseDC: (hwnd: null, dc: unknown) => number
  CreateCompatibleDC: (dc: unknown) => unknown
  DeleteDC: (dc: unknown) => boolean
  CreateCompatibleBitmap: (dc: unknown, w: number, h: number) => unknown
  SelectObject: (dc: unknown, obj: unknown) => unknown
  DeleteObject: (obj: unknown) => boolean
  BitBlt: (dst: unknown, x: number, y: number, w: number, h: number, src: unknown, sx: number, sy: number, rop: number) => boolean
  GetDIBits: (dc: unknown, bmp: unknown, start: number, lines: number, bits: Buffer, info: Buffer, usage: number) => number
}

let gdi: Gdi | null | undefined

function load(): Gdi {
  if (gdi) return gdi
  if (gdi === null) throw new Error('Windows screen copying is unavailable')
  try {
    const user32 = koffi.load('user32.dll')
    const gdi32 = koffi.load('gdi32.dll')
    gdi = {
      GetDC: user32.func('void* __stdcall GetDC(void *hwnd)'),
      ReleaseDC: user32.func('int __stdcall ReleaseDC(void *hwnd, void *dc)'),
      CreateCompatibleDC: gdi32.func('void* __stdcall CreateCompatibleDC(void *dc)'),
      DeleteDC: gdi32.func('bool __stdcall DeleteDC(void *dc)'),
      CreateCompatibleBitmap: gdi32.func('void* __stdcall CreateCompatibleBitmap(void *dc, int w, int h)'),
      SelectObject: gdi32.func('void* __stdcall SelectObject(void *dc, void *obj)'),
      DeleteObject: gdi32.func('bool __stdcall DeleteObject(void *obj)'),
      BitBlt: gdi32.func('bool __stdcall BitBlt(void *dst, int x, int y, int w, int h, void *src, int sx, int sy, uint32 rop)'),
      GetDIBits: gdi32.func('int __stdcall GetDIBits(void *dc, void *bmp, uint32 start, uint32 lines, _Out_ uint8_t *bits, _Inout_ uint8_t *info, uint32 usage)')
    }
    return gdi
  } catch (e) {
    gdi = null
    throw e
  }
}

const SRCCOPY = 0x00cc0020
const DIB_RGB_COLORS = 0

/** A BITMAPINFO asking for 32-bit pixels, top row first. */
function bitmapInfo(width: number, height: number): Buffer {
  const b = Buffer.alloc(44)
  b.writeUInt32LE(40, 0) // biSize
  b.writeInt32LE(width, 4)
  b.writeInt32LE(-height, 8) // negative: top row first
  b.writeUInt16LE(1, 12) // planes
  b.writeUInt16LE(32, 14) // bits a pixel
  return b
}

/** Whether the Windows calls (koffi, gdi32) load here: inside the worker, from app.asar.unpacked in a packaged build. */
export function gdiAvailable(): boolean {
  return load() !== null
}

/** A copy's own memory DC, bitmap and pixels, kept for the next copy of the same size. */
interface Surface {
  mem: unknown
  bmp: unknown
  info: Buffer
  data: Buffer
}

/**
 * The screen DC and a surface per copy size, made once rather than on every copy: five copies a second
 * each made and freed a DC, a bitmap and a zeroed buffer (LT-559). The sizes are the bars' area and a
 * monitor or two, so a handful at most; the oldest goes past MAX_SURFACES.
 */
let screenDc: unknown = null
const surfaces = new Map<string, Surface>()
const MAX_SURFACES = 4

function surface(w: Gdi, width: number, height: number): Surface {
  const key = `${width}x${height}`
  const had = surfaces.get(key)
  if (had) return had
  const mem = w.CreateCompatibleDC(screenDc)
  const bmp = w.CreateCompatibleBitmap(screenDc, width, height)
  if (!mem || !bmp) {
    if (bmp) w.DeleteObject(bmp)
    if (mem) w.DeleteDC(mem)
    throw new Error('Windows would not make a bitmap to copy into')
  }
  // Every byte is written by GetDIBits before it is read, so the buffer need not be zeroed.
  const s = { mem, bmp, info: bitmapInfo(width, height), data: Buffer.allocUnsafe(width * height * 4) }
  surfaces.set(key, s)
  if (surfaces.size > MAX_SURFACES) freeSurface(w, surfaces.keys().next().value!)
  return s
}

function freeSurface(w: Gdi, key: string): void {
  const s = surfaces.get(key)
  surfaces.delete(key)
  if (!s) return
  w.DeleteObject(s.bmp)
  w.DeleteDC(s.mem)
}

/**
 * The screen's pixels in this rectangle: blue, green, red and an unused byte each. Throws when Windows
 * will not copy them. The frame's pixels are the surface's own: the next copy of the same size writes
 * over them, so a frame is read before the next copy is asked.
 */
export function captureRect(x: number, y: number, width: number, height: number): Frame {
  const w = load()
  screenDc ||= w.GetDC(null)
  if (!screenDc) throw new Error('Windows gave no screen to copy from')
  const s = surface(w, width, height)
  const old = w.SelectObject(s.mem, s.bmp)
  try {
    if (!w.BitBlt(s.mem, 0, 0, width, height, screenDc, x, y, SRCCOPY)) throw new Error('Windows would not copy the screen')
  } finally {
    // GetDIBits wants the bitmap out of the DC it reads.
    w.SelectObject(s.mem, old)
  }
  if (w.GetDIBits(s.mem, s.bmp, 0, height, s.data, s.info, DIB_RGB_COLORS) !== height) throw new Error('Windows would not hand over the copied pixels')
  return { data: s.data, width, height, x, y }
}

/** Frees the screen DC and every surface: the worker does so when told to stop. */
export function releaseCapture(): void {
  if (!gdi) return
  for (const key of [...surfaces.keys()]) freeSurface(gdi, key)
  if (screenDc) gdi.ReleaseDC(null, screenDc)
  screenDc = null
}
