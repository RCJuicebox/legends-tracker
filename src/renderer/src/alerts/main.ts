import './alerts.css'
import { api } from '../api'
import type { OverlayConfig } from '../../../shared/types'

// The alerts overlay: a few lines of text that fade on their own. It is drawn with the DOM alone,
// without React or the meter, so this window loads a few kilobytes rather than the main bundle.

interface Alert {
  text: string
  color: string
  until: number
}

const KEEP = 6

let config: OverlayConfig | null = null
let arranging = false
let alerts: Alert[] = []
let sweep: ReturnType<typeof setInterval> | null = null

const root = document.getElementById('root')!

function line(text: string, color: string): HTMLDivElement {
  const div = document.createElement('div')
  div.className = 'alert-line'
  div.textContent = text
  div.style.color = color
  div.style.fontSize = `${config?.fontSize ?? 28}px`
  return div
}

function draw(): void {
  if (!config) return root.replaceChildren()
  const frame = document.createElement('div')
  frame.className = `overlay${arranging ? ' arranging' : ''}`
  const list = document.createElement('div')
  list.className = 'alerts'
  for (const a of alerts) list.append(line(a.text, a.color))
  if (arranging && !alerts.length) list.append(line('Alert text appears here', '#ffd84d'))
  frame.append(list)
  if (arranging) {
    const label = document.createElement('div')
    label.className = 'arrange-label'
    label.textContent = `${config.name} — drag to move, drag edges to resize`
    frame.append(label)
  }
  root.replaceChildren(frame)
}

/** Drops the alerts whose time is up; stops looking once none are left. */
function expire(): void {
  const now = Date.now()
  const left = alerts.filter((a) => a.until > now)
  if (left.length !== alerts.length) {
    alerts = left
    draw()
  }
  if (!alerts.length && sweep) {
    clearInterval(sweep)
    sweep = null
  }
}

api.on('overlay:config', (p: { config: OverlayConfig; arranging: boolean }) => {
  config = p.config
  arranging = p.arranging
  draw()
})

api.on('overlay:alert', (a: { text: string; color: string; durationSec: number }) => {
  alerts = [...alerts.slice(-(KEEP - 1)), { text: a.text, color: a.color || '#ffd84d', until: Date.now() + (a.durationSec || 5) * 1000 }]
  draw()
  sweep ??= setInterval(expire, 250)
})
