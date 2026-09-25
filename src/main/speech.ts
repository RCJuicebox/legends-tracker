import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { log } from './log'
import { yieldPriority } from './priority'

// A resident PowerShell process driving Windows speech. Speech is rendered to WAV and handed to
// the audio window, which mixes it with alert sounds on the chosen output device. (Chromium's
// built-in speechSynthesis always plays on the system default device.)
//
// Two engines: WinRT (Windows.Media.SpeechSynthesis) speaks the OneCore voices, which are the ones
// Settings → Speech → Manage voices installs; System.Speech (SAPI 5) speaks the older desktop
// voices and anything registered only there, such as third-party SAPI voices. A voice name picks
// its engine; the default (and any unknown name) is WinRT's, i.e. the one chosen in Windows
// Settings. If WinRT cannot load, SAPI does everything.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$rt = $null
$rtVoices = @{}
$rtNames = @()
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
  $asTask = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  foreach ($v in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) { $rtVoices[$v.DisplayName] = $v; $rtNames += $v.DisplayName }
  $rt = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  $rtDefault = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::DefaultVoice
} catch {
  $rt = $null
  $rtVoices = @{}
  $rtNames = @()
}
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$sapiNames = @($s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name } | Where-Object { -not $rtVoices.ContainsKey($_) })
$names = @($rtNames) + @($sapiNames)
[Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ type = 'voices'; voices = $names }))
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $id = 0
  try {
    $req = ConvertFrom-Json $line
    $id = [int]$req.id
    $voice = [string]$req.voice
    if ($rt -and -not ($sapiNames -contains $voice)) {
      # An unknown name (a voice since uninstalled) gets the default too.
      if ($rtVoices.ContainsKey($voice)) { $rt.Voice = $rtVoices[$voice] } else { $rt.Voice = $rtDefault }
      $rt.Options.SpeakingRate = [double]$req.rate
      $stream = $asTask.Invoke($null, @($rt.SynthesizeTextToStreamAsync([string]$req.text))).GetAwaiter().GetResult()
      $in = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
      $ms = New-Object System.IO.MemoryStream
      $in.CopyTo($ms)
      $in.Dispose()
      $stream.Dispose()
    } else {
      if ($voice) { try { $s.SelectVoice($voice) } catch {} }
      # SAPI's rate runs -10..10; the UI's 0.5..2 maps onto it.
      $s.Rate = [Math]::Max(-10, [Math]::Min(10, [int][Math]::Round(([double]$req.rate - 1) * 10)))
      $ms = New-Object System.IO.MemoryStream
      $s.SetOutputToWaveStream($ms)
      $s.Speak([string]$req.text)
      $s.SetOutputToNull()
    }
    [Console]::Out.WriteLine('{"type":"wav","id":' + $id + ',"data":"' + [Convert]::ToBase64String($ms.ToArray()) + '"}')
  } catch {
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ type = 'error'; id = $id; message = $_.Exception.Message }))
  }
  [Console]::Out.Flush()
}
`

interface Waiter {
  resolve: (wav: Buffer) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/** A phrase that takes longer than this to render means the engine has hung; it is restarted. */
const REQUEST_TIMEOUT_MS = 10_000

export class SpeechWorker {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private seq = 0
  private readonly waiting = new Map<number, Waiter>()
  private readonly cache = new Map<string, Buffer>()
  voices: string[] = []
  failed = ''
  private ready: Promise<void> | null = null

  start(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise((resolve) => {
      const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
      const proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        windowsHide: true
      })
      this.proc = proc
      this.buffer = ''
      yieldPriority(proc.pid)
      const timeout = setTimeout(() => {
        this.failed = 'Speech engine did not start'
        log.warn(this.failed)
        resolve()
      }, 15000)
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
        if (this.proc !== proc) return
        this.buffer += chunk
        let nl: number
        while ((nl = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, nl).trim()
          this.buffer = this.buffer.slice(nl + 1)
          if (!line) continue
          let msg: { type: string; id?: number; data?: string; message?: string; voices?: string[] | string }
          try {
            msg = JSON.parse(line)
          } catch {
            continue
          }
          if (msg.type === 'voices') {
            this.voices = Array.isArray(msg.voices) ? msg.voices : msg.voices ? [msg.voices] : []
            this.failed = ''
            clearTimeout(timeout)
            resolve()
          } else if (msg.id !== undefined) {
            const w = this.waiting.get(msg.id)
            if (!w) continue
            this.waiting.delete(msg.id)
            clearTimeout(w.timer)
            if (msg.type === 'wav' && msg.data) w.resolve(Buffer.from(msg.data, 'base64'))
            else {
              log.warn('Speech failed:', msg.message ?? 'no reason given')
              w.reject(new Error(msg.message ?? 'speech failed'))
            }
          }
        }
      })
      proc.stderr.setEncoding('utf8')
      // Read so the pipe never fills; PowerShell's progress records (CLIXML) are noise.
      proc.stderr.on('data', (d: string) => {
        const text = d.trim()
        if (text && !text.startsWith('#< CLIXML') && !text.startsWith('<Objs')) log.warn('Speech engine:', text.slice(0, 500))
      })
      // Writing to a process that has just died fails here rather than as an uncaught exception.
      proc.stdin.on('error', (e) => {
        log.warn('Speech engine input closed:', e)
        if (this.proc === proc) this.failAll(e.message)
        proc.kill()
      })
      proc.on('exit', (code) => {
        clearTimeout(timeout)
        resolve()
        if (this.proc !== proc) return
        this.failed = this.failed || 'Speech engine exited'
        log.warn(`Speech engine exited (code ${code})`)
        this.failAll(this.failed)
        this.proc = null
        this.ready = null
      })
      proc.on('error', (e) => {
        this.failed = e.message
        log.error('Speech engine could not run:', e)
        clearTimeout(timeout)
        resolve()
        if (this.proc !== proc) return
        this.failAll(e.message)
        this.proc = null
        this.ready = null
      })
    })
    return this.ready
  }

  /** Renders `text` to WAV. Phrases repeat constantly, so results are cached. */
  async synthesize(text: string, voice: string, rate: number): Promise<Buffer> {
    const key = `${voice}|${rate}|${text}`
    const hit = this.cache.get(key)
    if (hit) return hit
    await this.start()
    const proc = this.proc
    if (!proc) throw new Error(this.failed || 'Speech engine unavailable')
    const id = ++this.seq
    const wav = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.waiting.delete(id)) return
        log.warn(`Speech took over ${REQUEST_TIMEOUT_MS / 1000}s; restarting the engine`)
        reject(new Error('Speech engine did not answer'))
        // The next request starts a fresh one.
        this.restart(proc)
      }, REQUEST_TIMEOUT_MS)
      this.waiting.set(id, { resolve, reject, timer })
      proc.stdin.write(JSON.stringify({ id, text, voice, rate }) + '\n')
    })
    if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, wav)
    return wav
  }

  stop(): void {
    const proc = this.proc
    this.proc = null
    this.ready = null
    this.failAll('Speech engine stopped')
    proc?.kill()
  }

  /** Drops a hung process; the next request starts another. */
  private restart(proc: ChildProcessWithoutNullStreams): void {
    if (this.proc !== proc) return
    this.proc = null
    this.ready = null
    this.failAll('Speech engine restarted')
    proc.kill()
  }

  private failAll(reason: string): void {
    for (const w of this.waiting.values()) {
      clearTimeout(w.timer)
      w.reject(new Error(reason))
    }
    this.waiting.clear()
  }
}
