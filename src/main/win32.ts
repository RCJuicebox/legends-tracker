import koffi from 'koffi'
import { log } from './log'

// Direct calls into Windows, in place of launching command-line tools (reg.exe, tasklist, a
// resident PowerShell loop). Asking the system itself is far quicker, costs nothing between calls,
// and does not look like the process-spawning that antivirus watches for. If the library cannot
// load, each call answers as if it found nothing, and the callers treat that as "not known".

interface Api {
  GetForegroundWindow: () => unknown
  GetWindowRect: (hwnd: unknown, rect: Record<string, number>) => boolean
  GetWindowThreadProcessId: (hwnd: unknown, pid: number[]) => number
  OpenProcess: (access: number, inherit: boolean, pid: number) => unknown
  QueryFullProcessImageNameW: (h: unknown, flags: number, buf: Buffer, size: number[]) => boolean
  CloseHandle: (h: unknown) => boolean
  WaitForSingleObject: (h: unknown, ms: number) => number
  CreateToolhelp32Snapshot: (flags: number, pid: number) => unknown
  Process32FirstW: (snap: unknown, entry: Record<string, unknown>) => boolean
  Process32NextW: (snap: unknown, entry: Record<string, unknown>) => boolean
  GetDriveTypeW: (root: string) => number
  RegGetValueW: (hkey: number, subKey: string, value: string, flags: number, type: null, data: Buffer, size: number[]) => number
  entrySize: number
}

let api: Api | null | undefined

function load(): Api | null {
  if (api !== undefined) return api
  try {
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    const advapi32 = koffi.load('advapi32.dll')
    koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
    const ENTRY = koffi.struct('PROCESSENTRY32W', {
      dwSize: 'uint32',
      cntUsage: 'uint32',
      th32ProcessID: 'uint32',
      th32DefaultHeapID: 'uintptr_t',
      th32ModuleID: 'uint32',
      cntThreads: 'uint32',
      th32ParentProcessID: 'uint32',
      pcPriClassBase: 'int32',
      dwFlags: 'uint32',
      szExeFile: koffi.array('char16_t', 260, 'String')
    })
    api = {
      GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ RECT *rect)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)'),
      OpenProcess: kernel32.func('void* __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ uint8_t *buf, _Inout_ uint32 *size)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *h)'),
      WaitForSingleObject: kernel32.func('uint32 __stdcall WaitForSingleObject(void *h, uint32 ms)'),
      CreateToolhelp32Snapshot: kernel32.func('void* __stdcall CreateToolhelp32Snapshot(uint32 flags, uint32 pid)'),
      Process32FirstW: kernel32.func('bool __stdcall Process32FirstW(void *snap, _Inout_ PROCESSENTRY32W *entry)'),
      Process32NextW: kernel32.func('bool __stdcall Process32NextW(void *snap, _Inout_ PROCESSENTRY32W *entry)'),
      RegGetValueW: advapi32.func('int32 __stdcall RegGetValueW(intptr_t hkey, str16 subKey, str16 value, uint32 flags, void *type, _Out_ uint8_t *data, _Inout_ uint32 *size)'),
      GetDriveTypeW: kernel32.func('uint32 __stdcall GetDriveTypeW(str16 root)'),
      entrySize: koffi.sizeof(ENTRY)
    }
  } catch (e) {
    // Game detection then assumes the game is running; worth knowing why.
    log.warn('Windows API unavailable (koffi):', e)
    api = null
  }
  return api
}

/** Whether Windows can be asked at all; when not, callers should assume rather than conclude. */
export function win32Available(): boolean {
  return load() !== null
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const SYNCHRONIZE = 0x00100000
const WAIT_OBJECT_0 = 0
const TH32CS_SNAPPROCESS = 0x2
const INVALID_HANDLE = -1n

const isNull = (h: unknown) => h === null || koffi.address(h) === 0n || koffi.address(h) === BigInt.asUintN(64, INVALID_HANDLE)

/** "C:\...\eqgame.exe" → "eqgame" */
const baseName = (path: string) =>
  path
    .split(/[\\/]/)
    .pop()!
    .replace(/\.exe$/i, '')
    .toLowerCase()

/**
 * The game watcher asks these four times a second: one that throws (a koffi fault, a handle Windows
 * takes back mid-call) answers as if it found nothing, said once in main.log, rather than throwing
 * into a timer twice in half a second, which ends the app (LT-437).
 */
const warned = new Set<string>()
function safely<T>(what: string, fallback: T, ask: () => T): T {
  try {
    return ask()
  } catch (e) {
    if (!warned.has(what)) {
      warned.add(what)
      log.warn(`Windows call failed (${what}); answering as if nothing was found:`, e)
    }
    return fallback
  }
}

/** The id of the process that owns the foreground window; 0 when there is none. */
export function foregroundPid(): number {
  const w = load()
  if (!w) return 0
  return safely('foreground window', 0, () => {
    const hwnd = w.GetForegroundWindow()
    if (isNull(hwnd)) return 0
    const pid = [0]
    w.GetWindowThreadProcessId(hwnd, pid)
    return pid[0]
  })
}

/** Where the foreground window is, in physical screen pixels; null when there is none or Windows will not say. */
export function foregroundWindowRect(): { x: number; y: number; width: number; height: number } | null {
  const w = load()
  if (!w) return null
  return safely<{ x: number; y: number; width: number; height: number } | null>('foreground window rect', null, () => {
    const hwnd = w.GetForegroundWindow()
    if (isNull(hwnd)) return null
    const r: Record<string, number> = {}
    if (!w.GetWindowRect(hwnd, r)) return null
    return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }
  })
}

/** A process's name by id, without .exe, lowercased; '' when Windows will not say. */
export function processName(pid: number): string {
  const w = load()
  if (!w || !pid) return ''
  return safely('process name', '', () => {
    const h = w.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
    if (isNull(h)) return ''
    try {
      const buf = Buffer.alloc(1040)
      const size = [520]
      return w.QueryFullProcessImageNameW(h, 0, buf, size) ? baseName(buf.toString('utf16le', 0, size[0] * 2)) : ''
    } finally {
      w.CloseHandle(h)
    }
  })
}

/** The id of a running process with this executable name ("eqgame.exe"): 0 for none, null when Windows cannot be asked. */
export function findProcess(exe: string): number | null {
  const w = load()
  if (!w) return null
  return safely<number | null>('process list', null, () => {
    const snap = w.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if (isNull(snap)) return null
    const want = exe.toLowerCase()
    try {
      const entry: Record<string, unknown> = { dwSize: w.entrySize }
      let ok = w.Process32FirstW(snap, entry)
      while (ok) {
        if (String(entry.szExeFile).toLowerCase() === want) return Number(entry.th32ProcessID) || 0
        ok = w.Process32NextW(snap, entry)
      }
      return 0
    } finally {
      w.CloseHandle(snap)
    }
  })
}

/**
 * A process held to learn when it ends, without walking the process list (LT-558): a SYNCHRONIZE
 * handle, asked with a zero wait. Null when it cannot be opened (gone already, or not ours to ask).
 */
export interface ProcessWatch {
  /** Whether the process has ended. */
  ended(): boolean
  close(): void
}

export function watchProcess(pid: number): ProcessWatch | null {
  const w = load()
  if (!w || !pid) return null
  return safely<ProcessWatch | null>('process watch', null, () => {
    const h = w.OpenProcess(SYNCHRONIZE, false, pid)
    if (isNull(h)) return null
    let open = true
    return {
      ended: () => !open || safely('process wait', true, () => w.WaitForSingleObject(h, 0) === WAIT_OBJECT_0),
      close: () => {
        if (open) w.CloseHandle(h)
        open = false
      }
    }
  })
}

export const HKEY_CURRENT_USER = 0x80000001
export const HKEY_LOCAL_MACHINE = 0x80000002
const RRF_RT_REG_SZ = 0x2
const RRF_RT_REG_EXPAND_SZ = 0x4

/** A string value from the registry, or '' when the key or value is not there. */
export function registryString(hkey: number, subKey: string, value: string): string {
  const w = load()
  if (!w) return ''
  const buf = Buffer.alloc(4096)
  const size = [buf.length]
  // HKEY constants are sign-extended handles on 64-bit Windows.
  const key = hkey | 0
  const rc = w.RegGetValueW(key, subKey, value, RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ, null, buf, size)
  if (rc !== 0) return ''
  return buf.toString('utf16le', 0, Math.max(0, size[0] - 2)).replace(/\0+$/, '')
}

/** Drive type 3: a fixed disk, as opposed to removable, network, CD or RAM. */
const DRIVE_FIXED = 3

/** Whether a drive letter is a local fixed disk; null when Windows cannot be asked. Asking never touches the drive itself. */
export function isFixedDrive(letter: string): boolean | null {
  const w = load()
  if (!w) return null
  return w.GetDriveTypeW(`${letter}:\\`) === DRIVE_FIXED
}
