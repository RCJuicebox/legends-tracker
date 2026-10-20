import { useState, type ReactNode } from 'react'
import { act, showUndo } from '../toast'
import { ConfirmButton } from './ui'
import { KIND_TEXT } from './MeterBars'

// The group as the tracker knows it: one roster (combatRoster.ts, by the log's join and leave lines
// and what the player adds), behind the Damage Meter's Group scope and Buffs' Your group, and
// editable in both places.

/** What a page knows of a member: beside their name, and under it (Buffs: their classes, then the buffs they could cast). */
export interface MemberDetail {
  head?: ReactNode
  body?: ReactNode
}

const LEARNED: Record<'log' | 'you', string> = { log: 'Seen joining in the log', you: 'Added by you' }

const EMPTY = 'Nobody seen joining yet: the log names who joins after you; add anyone already there.'

/**
 * The members, with × to take one off, a name to add one, and Reset group to forget everyone.
 * `compact` draws them as chips in a row (the meter); otherwise each has a line, with what `detail`
 * knows of them. `children` follow the members (the meter's group-mates' pets). `onChanged` runs
 * after an edit has landed, for a page that reads the group through a view of its own.
 */
export function GroupRoster({
  members,
  compact = false,
  detail,
  empty = EMPTY,
  children,
  onChanged
}: {
  members: readonly { name: string; from?: 'log' | 'you' }[]
  compact?: boolean
  detail?: (name: string) => MemberDetail
  empty?: ReactNode
  children?: ReactNode
  onChanged?: () => void
}) {
  const [name, setName] = useState('')
  // act() says what went wrong itself; an edit that landed is told to the page.
  const landed = (r: unknown) => r && onChanged?.()
  const addMember = (who: string) => act('combat:addMember', who).then(landed)
  const add = () => {
    if (!name.trim()) return
    void addMember(name.trim())
    setName('')
  }
  const remove = (who: string) => {
    void act('combat:removeMember', who).then(landed)
    showUndo(`${who} taken off the group.`, () => void addMember(who))
  }
  const controls = (
    <>
      <input
        value={name}
        placeholder="Add a name"
        aria-label="Add a group member by name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        style={{ width: 130 }}
      />
      <button className="btn small" onClick={add} disabled={!name.trim()}>
        Add
      </button>
      {members.length > 0 && (
        <ConfirmButton
          className="btn ghost small"
          question="Forget everyone in the group?"
          title="Forget everyone in the group; the log fills it again as people join, or add them by name"
          onConfirm={() => void act('combat:clearGroup').then(landed)}
        >
          Reset group
        </ConfirmButton>
      )}
    </>
  )
  const removeButton = (who: string) => (
    <button className="btn ghost small x-btn" aria-label={`Remove ${who}`} onClick={() => remove(who)}>
      ×
    </button>
  )
  if (compact)
    return (
      <div className="dm-roster">
        <span className="faint small">Group:</span>
        {!members.length && <span className="faint small">{empty}</span>}
        {members.map((m) => (
          <span key={m.name} className="chip" style={{ color: KIND_TEXT.group }} title={m.from && LEARNED[m.from]}>
            {m.name}
            {removeButton(m.name)}
          </span>
        ))}
        {children}
        {controls}
      </div>
    )
  return (
    <div className="stack gap-8">
      {!members.length ? (
        <p className="muted m-0">{empty}</p>
      ) : (
        members.map((m) => {
          const d = detail?.(m.name)
          return (
            <div key={m.name} className="stack gap-2">
              <div className="row gap-8">
                <b title={m.from && LEARNED[m.from]}>{m.name}</b>
                {d?.head}
                {removeButton(m.name)}
              </div>
              {d?.body && <div className="small">{d.body}</div>}
            </div>
          )
        })
      )}
      {children}
      <div className="row">{controls}</div>
    </div>
  )
}
