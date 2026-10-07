import koffi from 'koffi'
import type { Frame } from '../core/groupHealth'

// A small piece of the screen, copied straight from Windows (GDI's BitBlt), for the group health
// watch: a few hundred pixels four times a second costs a millisecond, where desktopCapturer pictures
// every monitor whole. It reads what is on the screen, as a player looks at it; it never touches the
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

/** The screen's pixels in this rectangle: blue, green, red and an unused byte each. Throws when Windows will not copy them. */
export function captureRect(x: number, y: number, width: number, height: number): Frame {
  const w = load()
  const screen = w.GetDC(null)
  if (!screen) throw new Error('Windows gave no screen to copy from')
  const mem = w.CreateCompatibleDC(screen)
  const bmp = w.CreateCompatibleBitmap(screen, width, height)
  const old = w.SelectObject(mem, bmp)
  try {
    if (!w.BitBlt(mem, 0, 0, width, height, screen, x, y, SRCCOPY)) throw new Error('Windows would not copy the screen')
    // GetDIBits wants the bitmap out of the DC it reads.
    w.SelectObject(mem, old)
    const data = Buffer.alloc(width * height * 4)
    if (w.GetDIBits(mem, bmp, 0, height, data, bitmapInfo(width, height), DIB_RGB_COLORS) !== height) throw new Error('Windows would not hand over the copied pixels')
    return { data, width, height, x, y }
  } finally {
    w.SelectObject(mem, old)
    w.DeleteObject(bmp)
    w.DeleteDC(mem)
    w.ReleaseDC(null, screen)
  }
}
