import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { yieldPriority } from './priority'

// A resident PowerShell process driving Windows' System.Speech. Speech is rendered to WAV and
// handed to the audio window, which mixes it with alert sounds on the chosen output device.
// (Chromium's built-in speechSynthesis always plays on the system default device.)
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$names = @($s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name })
[Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ type = 'voices'; voices = $names }))
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $id = 0
  try {
    $req = ConvertFrom-Json $line
    $id = [int]$req.id
    if ($req.voice) { try { $s.SelectVoice([string]$req.voice) } catch {} }
    $s.Rate = [int]$req.rate
    $ms = New-Object System.IO.MemoryStream
    $s.SetOutputToWaveStream($ms)
    $s.Speak([string]$req.text)
    $s.SetOutputToNull()
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
}

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
      yieldPriority(proc.pid)
      const timeout = setTimeout(() => {
        this.failed = 'Speech engine did not start'
        resolve()
      }, 15000)
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
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
            clearTimeout(timeout)
            resolve()
          } else if (msg.id !== undefined) {
            const w = this.waiting.get(msg.id)
            this.waiting.delete(msg.id)
            if (msg.type === 'wav' && msg.data) w?.resolve(Buffer.from(msg.data, 'base64'))
            else w?.reject(new Error(msg.message ?? 'speech failed'))
          }
        }
      })
      proc.on('exit', () => {
        this.failed = this.failed || 'Speech engine exited'
        for (const w of this.waiting.values()) w.reject(new Error(this.failed))
        this.waiting.clear()
        this.proc = null
        this.ready = null
        clearTimeout(timeout)
        resolve()
      })
      proc.on('error', (e) => {
        this.failed = e.message
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
    if (!this.proc) throw new Error(this.failed || 'Speech engine unavailable')
    const id = ++this.seq
    const wav = await new Promise<Buffer>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      // SAPI's rate runs -10..10; the UI's 0.5..2 maps onto it.
      const sapiRate = Math.max(-10, Math.min(10, Math.round((rate - 1) * 10)))
      this.proc!.stdin.write(JSON.stringify({ id, text, voice, rate: sapiRate }) + '\n')
    })
    if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, wav)
    return wav
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
  }
}
