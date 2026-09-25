import { useState } from 'react'
import { useApp } from '../state'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { act } from '../toast'
import { errorMessage, api } from '../api'
import { Field, Info, LoadError, Switch } from '../components/ui'
import type { AudioSettings, AzureStatus } from '../../../shared/types'

/** A voice setting naming one of Microsoft's neural voices through Azure (see azureSpeech.ts). */
const AZURE = 'azure:'
const AZURE_HELP =
  'In the Azure portal, create a Speech resource: the free F0 tier allows half a million characters a month, and each phrase is spoken ' +
  'from Azure once, then from this PC. Open the resource, then Keys and Endpoint: copy KEY 1 and the Location/Region. The key is kept ' +
  "encrypted on this PC, in the app's data folder, and is only ever sent to Azure."

/** A slider saves once it stops moving for this long; it moves on screen at once. */
const SLIDER_SAVE_MS = 150

export function Audio() {
  const { state, patchSettings } = useApp()
  const a = state.settings.audio
  const [text, setText] = useState('Spirit of the Puma fading')
  const soundsQ = useInvoke<string[]>('audio:sounds')
  const sounds = soundsQ.data ?? []
  const set = (patch: Partial<AudioSettings>) => patchSettings((s) => ({ ...s, audio: { ...s.audio, ...patch } }))
  const slide = (patch: Partial<AudioSettings>) => patchSettings((s) => ({ ...s, audio: { ...s.audio, ...patch } }), { debounceMs: SLIDER_SAVE_MS })
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const azureQ = useInvoke<AzureStatus>('audio:azure')
  const azure = azureQ.data
  const [allLanguages, setAllLanguages] = useRemembered<boolean>('audio.allLanguages', false)
  const azureVoices = (azure?.voices ?? []).filter((v) => allLanguages || v.locale.startsWith('en-') || `${AZURE}${v.name}` === a.voice)
  const usingAzure = a.voice.startsWith(AZURE)

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
            <Switch on={!a.muted} label="Sound on" onChange={(v) => set({ muted: !v })} /> {a.muted ? 'Muted' : 'Sound on'}
          </span>
        </div>
      </div>

      {state.speechError && (
        <div className="notice bad mb-16">
          The Windows speech engine did not start ({state.speechError}). Speech falls back to the browser voice on the default
          device.
        </div>
      )}

      <div className="grid two" style={{ alignItems: 'start' }}>
        <div className="card stack gap-14">
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
            <input type="range" min={0} max={1} step={0.01} value={a.masterVolume} onChange={(e) => slide({ masterVolume: Number(e.target.value) })} />
          </Field>
          <Field label={`Speech ${pct(a.speechVolume)}`}>
            <input type="range" min={0} max={1} step={0.01} value={a.speechVolume} onChange={(e) => slide({ speechVolume: Number(e.target.value) })} />
          </Field>
          <Field label={`Sounds ${pct(a.soundVolume)}`}>
            <input type="range" min={0} max={1} step={0.01} value={a.soundVolume} onChange={(e) => slide({ soundVolume: Number(e.target.value) })} />
          </Field>
        </div>

        <div className="card stack gap-14">
          <h2>Voice</h2>
          <Field
            label="Voice"
            hint={
              azure?.configured
                ? 'Microsoft neural voices come from Azure; if it cannot be reached, the Windows default speaks instead.'
                : 'Better voices: set up Microsoft voices below. More Windows voices: Settings → Time & language → Speech → Manage voices, then restart.'
            }
          >
            <select value={a.voice} onChange={(e) => set({ voice: e.target.value })}>
              <option value="">Windows default</option>
              <optgroup label="Windows">
                {state.voices.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </optgroup>
              {azure?.configured && (
                <optgroup label="Microsoft neural (Azure)">
                  {azureVoices.map((v) => (
                    <option key={v.name} value={`${AZURE}${v.name}`}>
                      {v.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {usingAzure && !azure?.configured && <option value={a.voice}>{a.voice.slice(AZURE.length)} (no Azure key set)</option>}
            </select>
          </Field>
          {azure?.configured && (
            <label className="row small" style={{ gap: 8 }}>
              <Switch on={allLanguages} onChange={setAllLanguages} label="Show every language" />
              Every language, not only English
            </label>
          )}
          <Field label={`Speed ${a.rate.toFixed(1)}×`}>
            <input type="range" min={0.5} max={2} step={0.1} value={a.rate} onChange={(e) => slide({ rate: Number(e.target.value) })} />
          </Field>
          <Field label="Try it">
            <div className="row">
              <input className="grow" value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn primary" onClick={() => void act('audio:test', text)}>
                Speak
              </button>
            </div>
          </Field>
        </div>

        <AzureCard status={azure} error={azureQ.error} onSaved={azureQ.setData} />

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>
            Sound library <span className="chip">{sounds.length}</span>
          </h2>
          {soundsQ.error && <LoadError what="the sound library" error={soundsQ.error} retry={soundsQ.reload} />}
          <p className="muted small mt-0">
            Read from the game's own <code>AudioTriggers</code> folders and this app's <code>sounds</code> folder. Drop .wav or
            .mp3 files into either to use them in triggers.
          </p>
          <div className="row">
            {sounds.map((s) => (
              <button key={s} className="btn small" onClick={() => void act('audio:sound', s)}>
                ▶ {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

/** The region and key for Microsoft's neural voices. The key goes in and is never shown again. */
function AzureCard({ status, error, onSaved }: { status: AzureStatus | null; error: string; onSaved: (s: AzureStatus) => void }) {
  const [region, setRegion] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const save = async (r: string, k: string) => {
    setBusy(true)
    setProblem('')
    try {
      onSaved(await api.invoke<AzureStatus>('audio:setAzure', r, k))
      setKey('')
    } catch (e) {
      setProblem(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card stack gap-10" style={{ gridColumn: '1 / -1' }}>
      <h2 style={{ margin: 0 }}>
        Microsoft voices <Info label="How to get a key" text={AZURE_HELP} />
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        Microsoft's neural voices (Jenny, Aria, Guy and hundreds more) through your own Azure Speech key.{' '}
        <a href="https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices" target="_blank" rel="noreferrer">
          Create a Speech resource
        </a>{' '}
        (free tier), then paste its key and region here.
      </p>
      {error && <LoadError what="the Azure settings" error={error} />}
      {status?.configured ? (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="lt-chip good">Connected</span>
          <span className="small">
            Region <b>{status.region}</b>, {status.voices.length} voices. Pick one in the Voice list above.
          </span>
          {status.error && <span className="small" style={{ color: 'var(--red)' }}>Last phrase: {status.error}</span>}
          <span className="spacer" />
          <button className="btn small" disabled={busy} onClick={() => void save('', '')}>
            Remove the key
          </button>
        </div>
      ) : null}
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Region">
          <input value={region} placeholder={status?.region || 'eastus'} onChange={(e) => setRegion(e.target.value)} style={{ width: 150 }} />
        </Field>
        <Field label={status?.configured ? 'New key' : 'Key'}>
          <input type="password" value={key} autoComplete="off" onChange={(e) => setKey(e.target.value)} style={{ width: 320 }} />
        </Field>
        <button className="btn primary" disabled={busy || !key.trim() || !(region.trim() || status?.region)} onClick={() => void save(region.trim() || status?.region || '', key)}>
          {busy ? 'Checking…' : 'Save and check'}
        </button>
      </div>
      {problem && <div className="notice bad">{problem}</div>}
    </div>
  )
}
