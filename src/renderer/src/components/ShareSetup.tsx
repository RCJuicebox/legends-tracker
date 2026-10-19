import { useState } from 'react'
import { act, showToast, showUndo } from '../toast'
import type { SetupPreview } from '../../../shared/ipc'

/**
 * Share my setup (FEAT-028), on Settings › General: triggers, spell rules, overlays, voice and Spell
 * Timers defaults in one file, for a friend or another PC. A file opened is listed first, each section
 * ticked or not, and applying it can be undone.
 */
export function ShareSetup() {
  const [opened, setOpened] = useState<SetupPreview | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const open = async () => {
    const p = await act('setup:open')
    if (!p) return
    setOpened(p)
    setPicked(p.sections.map((s) => s.id))
  }
  const apply = async () => {
    if (!(await act('setup:apply', picked))) return
    setOpened(null)
    showUndo(`${opened?.file ?? 'The setup'} applied.`, () => void act('setup:undo').then((done) => done && showToast('Your setup is back as it was.')))
  }
  return (
    <div className="card stack gap-12">
      <h2>Share my setup</h2>
      <p className="hint">
        Your triggers, spell rules, overlays (places, sizes and text), voice and volumes, and Spell Timers defaults in one file, to give a friend or take to another PC. Your
        settings folder, characters and audio device stay here.
      </p>
      <div className="row">
        <button className="btn" onClick={() => void act('setup:export')}>
          Save my setup…
        </button>
        <button className="btn" onClick={() => void open()}>
          Use a setup file…
        </button>
      </div>
      {opened && (
        <div className="stack gap-8">
          <b>
            {opened.file}
            {opened.version ? <span className="faint small"> · from Legends Tracker {opened.version}</span> : null}
          </b>
          {opened.sections.length === 0 && <span className="muted small">Nothing in it this version can use.</span>}
          {opened.sections.map((s) => (
            <label key={s.id} className="row">
              <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
              {s.label}
              <span className="faint small">{s.detail}</span>
            </label>
          ))}
          {opened.newer.length > 0 && <span className="muted small">Left out, written by a newer version: {opened.newer.join(', ')}.</span>}
          <div className="row">
            <button className="btn primary" disabled={!picked.length} onClick={() => void apply()}>
              Apply what is ticked
            </button>
            <button className="btn ghost" onClick={() => setOpened(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
