import { useEffect, useState } from 'react'
import type { SpellCategory } from '../../../../shared/types'
import { ICON_PATHS, type IconName } from '../../../../shared/icons'
import { CATEGORY_LABELS } from '../../../../shared/types'
import { iconUrl } from '../../api'
import { showToast } from '../../toast'

// Icons, and the game's own words: a spell's category and icon, a command to type.

export function CategoryChip({ category }: { category: SpellCategory }) {
  return <span className={`chip ${category}`}>{CATEGORY_LABELS[category]}</span>
}

export function SpellIcon({ icon, large }: { icon?: number; large?: boolean }) {
  const [ok, setOk] = useState(true)
  if (icon === undefined || !ok) return <div className={`spell-icon${large ? ' lg' : ''}`} />
  return <img className={`spell-icon${large ? ' lg' : ''}`} src={iconUrl(icon)} alt="" onError={() => setOk(false)} />
}

export type { IconName }

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="16" height="16">
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}

/**
 * A command to type in game, such as /outputfile inventory, with a button beside it that copies it,
 * to paste into the chat box instead of typing it.
 */
export function GameCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  const copy = (e: React.MouseEvent) => {
    // It sits inside clickable rows and labels too: the copy is all the click does.
    e.stopPropagation()
    e.preventDefault()
    navigator.clipboard.writeText(cmd).then(
      () => {
        setCopied(true)
        showToast(`Copied ${cmd}: paste it into the game's chat box`)
      },
      () => showToast('Could not copy', { tone: 'bad' })
    )
  }
  return (
    <span className="game-cmd">
      <span className="mono">{cmd}</span>
      <button type="button" className={`game-cmd-copy${copied ? ' done' : ''}`} onClick={copy} title={`Copy ${cmd}`} aria-label={`Copy ${cmd} to the clipboard`}>
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
    </span>
  )
}

export const GAME_COMMAND = /(\/outputfile [a-z]+)/i

/** Text with each /outputfile command in it shown as a GameCommand, for messages written as plain strings. */
export function WithCommands({ text }: { text: string }) {
  const parts = text.split(GAME_COMMAND)
  if (parts.length === 1) return <>{text}</>
  return <>{parts.map((p, i) => (i % 2 ? <GameCommand key={i} cmd={p} /> : p))}</>
}
