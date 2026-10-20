import { useEffect, useState } from 'react'
import { useActions, useSettled } from '../state'
import { useInvoke } from '../hooks'
import { act } from '../toast'
import { api } from '../api'
import { ErrorText, Field, LoadError, Progress, Switch } from '../components/ui'
import { KOKORO_MODEL, KOKORO_PREFIX, KOKORO_VOICES, kokoroLabel } from '../../../core/kokoro'
import type { AudioSettings } from '../../../shared/types'
import type { KokoroStatus } from '../../../shared/runtime'

const KOKORO_MB = Math.round(KOKORO_MODEL.size / 1e6)

/** Where the Kokoro voices' download stands, under the voice picker while a Kokoro voice is chosen. */
function KokoroState({ status }: { status: KokoroStatus }) {
  if (status.state === 'downloading')
    return <Progress small done={Math.round((status.fraction ?? 0) * KOKORO_MB)} total={KOKORO_MB} unit="MB" label="Downloading the Kokoro voices" />
  if (status.state === 'ready') return status.error ? <ErrorText block>The Kokoro voices failed ({status.error}); the Windows voice speaks meanwhile.</ErrorText> : null
  return (
    <div className="row">
      {status.state === 'failed' ? (
        <ErrorText>The download failed ({status.error}); the Windows voice speaks meanwhile.</ErrorText>
      ) : (
        <span className="small muted">The Kokoro voices are not downloaded yet; the Windows voice speaks meanwhile.</span>
      )}
      <button className="btn small" onClick={() => void act('audio:kokoro')}>
        {status.state === 'failed' ? 'Try again' : `Download (${KOKORO_MB} MB)`}
      </button>
    </div>
  )
}

/** The name the audio window gives a device Windows reports without one. */
const UNNAMED = 'Output device'

/** A slider saves once it stops moving for this long; it moves on screen at once. */
const SLIDER_SAVE_MS = 150

export function Audio() {
  const { patchSettings } = useActions()
  const audio = useSettled((s) => s.settings.audio)
  const speechError = useSettled((s) => s.speechError)
  const devices = useSettled((s) => s.devices)
  const voices = useSettled((s) => s.voices)
  const a = audio
  const [text, setText] = useState('Spirit of the Puma fading')
  const soundsQ = useInvoke('audio:sounds')
  // Starts the Windows speech engine if it is not running; the list arrives as state:voices.
  useInvoke('audio:voices')
  const sounds = soundsQ.data ?? []
  const kokoro = useSettled((s) => s.kokoro)
  const isKokoro = a.voice.startsWith(KOKORO_PREFIX)
  const set = (patch: Partial<AudioSettings>) => patchSettings((s) => ({ ...s, audio: { ...s.audio, ...patch } }))
  // A Kokoro voice chosen for the first time starts the model's download.
  const pickVoice = (voice: string) => {
    void set({ voice })
    if (voice.startsWith(KOKORO_PREFIX) && kokoro.state !== 'ready') void act('audio:kokoro')
  }
  const slide = (patch: Partial<AudioSettings>) => patchSettings((s) => ({ ...s, audio: { ...s.audio, ...patch } }), { debounceMs: SLIDER_SAVE_MS })
  const pct = (v: number) => `${Math.round(v * 100)}%`
  // The output devices are listed only while this page is open (LT-447).
  useEffect(() => {
    void api.invoke('audio:watchDevices', true).catch(() => undefined)
    return () => void api.invoke('audio:watchDevices', false).catch(() => undefined)
  }, [])

  return (
    <>
      <div className="page-head">
        <div>
          <p>
            Speech and sounds share one output, so they follow the device you choose here rather than the system default. Speech plays one phrase at a time; a long backlog is
            dropped rather than read out after the fight.
          </p>
        </div>
        <div className="actions">
          <label className="row tight">
            <Switch on={a.muted} label="Mute all sound" onChange={(v) => set({ muted: v })} /> Mute all sound
          </label>
        </div>
      </div>

      {speechError && (
        <div className="notice bad mb-16">The Windows speech engine did not start ({speechError}). Speech falls back to the browser voice on the default device.</div>
      )}

      <div className="grid two" style={{ alignItems: 'start' }}>
        <div className="card stack gap-16">
          <h2>Output</h2>
          <Field
            label="Output device"
            hint={
              devices.some((d) => d.label === UNNAMED)
                ? 'If this device is unplugged, audio falls back to the default instead of going silent. Windows gave some devices no name (it can, for a device still starting up or one a driver hides); unplugging and plugging it back in, or restarting the app, usually brings the name back.'
                : 'If this device is unplugged, audio falls back to the default instead of going silent.'
            }
          >
            <select value={a.deviceId} onChange={(e) => set({ deviceId: e.target.value })}>
              <option value="default">System default</option>
              {devices
                .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
                .map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={`Master volume ${pct(a.masterVolume)}`}>
            <input type="range" min={0} max={1} step={0.01} value={a.masterVolume} onChange={(e) => slide({ masterVolume: Number(e.target.value) })} />
          </Field>
          <Field label={`Speech ${pct(a.speechVolume)}`}>
            <input type="range" min={0} max={1} step={0.01} value={a.speechVolume} onChange={(e) => slide({ speechVolume: Number(e.target.value) })} />
          </Field>
          <Field label={`Sounds ${pct(a.soundVolume)}`}>
            <input type="range" min={0} max={1} step={0.01} value={a.soundVolume} onChange={(e) => slide({ soundVolume: Number(e.target.value) })} />
          </Field>
        </div>

        <div className="card stack gap-16">
          <h2>Voice</h2>
          <Field
            label="Voice"
            hint={
              isKokoro
                ? 'Kokoro voices sound natural and are made on this PC: a new phrase takes about a second, then it is kept. Until the voices are downloaded, and if they ever fail, the Windows default speaks.'
                : 'More Windows voices: Settings → Time & language → Speech → Manage voices, then restart. The Kokoro voices sound more natural.'
            }
          >
            <select value={a.voice} onChange={(e) => pickVoice(e.target.value)}>
              <option value="">Windows default</option>
              <optgroup label="Windows">
                {voices.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </optgroup>
              <optgroup label={`Kokoro (natural; ${KOKORO_MB} MB download, once)`}>
                {KOKORO_VOICES.map((v) => (
                  <option key={v.id} value={KOKORO_PREFIX + v.id}>
                    {kokoroLabel(v)}
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>
          {isKokoro && <KokoroState status={kokoro} />}
          <Field label={`Speed ${a.rate.toFixed(1)}×`}>
            <input type="range" min={0.5} max={2} step={0.1} value={a.rate} onChange={(e) => slide({ rate: Number(e.target.value) })} />
          </Field>
          <Field label="Try the voice">
            <div className="row">
              <input className="grow" value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn primary" onClick={() => void act('audio:test', text)}>
                Speak
              </button>
            </div>
          </Field>
        </div>

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>
            Sound library <span className="chip">{sounds.length}</span>
          </h2>
          {soundsQ.error && <LoadError what="the sound library" error={soundsQ.error} retry={soundsQ.reload} />}
          <p className="muted small mt-0">
            Read from the game's own <code>AudioTriggers</code> folders and this app's <code>sounds</code> folder. Drop .wav or .mp3 files into either to use them in triggers.
          </p>
          <div className="row">
            {sounds.map((s) => (
              <button key={s} className="btn small as-is" onClick={() => void act('audio:sound', s)}>
                ▶ {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
