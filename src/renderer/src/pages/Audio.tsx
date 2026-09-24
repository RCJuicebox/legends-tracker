import { useEffect, useState } from 'react'
import { useApp } from '../state'
import { api } from '../api'
import { Field, Switch } from '../components/ui'
import type { AudioSettings } from '../../../shared/types'

export function Audio() {
  const { state, patchSettings } = useApp()
  const a = state.settings.audio
  const [text, setText] = useState('Spirit of the Puma fading')
  const [sounds, setSounds] = useState<string[]>([])
  useEffect(() => void api.invoke<string[]>('audio:sounds').then(setSounds), [])
  const set = (patch: Partial<AudioSettings>) => patchSettings((s) => ({ ...s, audio: { ...s.audio, ...patch } }))
  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audio</h1>
          <p>
            Speech and sounds share one output, so they follow the device you choose here rather than the system default.
            Speech plays one phrase at a time; a long backlog is dropped rather than read out after the fight.
          </p>
        </div>
        <div className="actions">
          <span className="row tight">
            <Switch on={!a.muted} onChange={(v) => set({ muted: !v })} /> {a.muted ? 'Muted' : 'Sound on'}
          </span>
        </div>
      </div>

      {state.speechError && (
        <div className="notice bad" style={{ marginBottom: 16 }}>
          The Windows speech engine did not start ({state.speechError}). Speech falls back to the browser voice on the default
          device.
        </div>
      )}

      <div className="grid two" style={{ alignItems: 'start' }}>
        <div className="card stack" style={{ gap: 14 }}>
          <h2>Output</h2>
          <Field label="Output device" hint="If this device is unplugged, audio falls back to the default instead of going silent.">
            <select value={a.deviceId} onChange={(e) => set({ deviceId: e.target.value })}>
              <option value="default">System default</option>
              {state.devices.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Master volume ${pct(a.masterVolume)}`}>
            <input type="range" min={0} max={1} step={0.01} value={a.masterVolume} onChange={(e) => set({ masterVolume: Number(e.target.value) })} />
          </Field>
          <Field label={`Speech ${pct(a.speechVolume)}`}>
            <input type="range" min={0} max={1} step={0.01} value={a.speechVolume} onChange={(e) => set({ speechVolume: Number(e.target.value) })} />
          </Field>
          <Field label={`Sounds ${pct(a.soundVolume)}`}>
            <input type="range" min={0} max={1} step={0.01} value={a.soundVolume} onChange={(e) => set({ soundVolume: Number(e.target.value) })} />
          </Field>
        </div>

        <div className="card stack" style={{ gap: 14 }}>
          <h2>Voice</h2>
          <Field label="Voice">
            <select value={a.voice} onChange={(e) => set({ voice: e.target.value })}>
              <option value="">Windows default</option>
              {state.voices.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label={`Speed ${a.rate.toFixed(1)}×`}>
            <input type="range" min={0.5} max={2} step={0.1} value={a.rate} onChange={(e) => set({ rate: Number(e.target.value) })} />
          </Field>
          <Field label="Try it">
            <div className="row">
              <input className="grow" value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn primary" onClick={() => api.invoke('audio:test', text)}>
                Speak
              </button>
            </div>
          </Field>
        </div>

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>
            Sound library <span className="chip">{sounds.length}</span>
          </h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Read from the game's own <code>AudioTriggers</code> folders and this app's <code>sounds</code> folder. Drop .wav or
            .mp3 files into either to use them in triggers.
          </p>
          <div className="row">
            {sounds.map((s) => (
              <button key={s} className="btn small" onClick={() => api.invoke('audio:sound', s)}>
                ▶ {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
