// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { NumberInput as NumberInputType } from '../../src/renderer/src/components/ui'

// A number field saves what is typed when the typing is done: on a pause, Enter or leaving the field,
// clamped then, never a keystroke at a time (LT-507: typing 20 over 15 once saved 2, then 60).

let NumberInput: typeof NumberInputType
beforeAll(async () => {
  Object.assign(window, {
    eql: { invoke: () => new Promise(() => {}), send: vi.fn(), on: vi.fn(() => () => {}) },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  ;({ NumberInput } = await import('../../src/renderer/src/components/ui'))
})

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

async function mount(props: { value: number | undefined; min?: number; max?: number }) {
  const onChange = vi.fn()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(<NumberInput {...props} onChange={onChange} label="n" />))
  const input = host.querySelector<HTMLInputElement>('input')!
  const type = (text: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  return { input, onChange, type }
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 500)))

it('saves after a pause in typing, the whole number, not each keystroke', async () => {
  const { input, onChange, type } = await mount({ value: 15, min: 9, max: 72 })
  await type('2')
  await type('20')
  expect(onChange).not.toHaveBeenCalled()
  expect(input.value).toBe('20')
  await settle()
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith(20)
})

it('clamps to the least and most allowed when it saves, on Enter or on leaving the field', async () => {
  const { input, onChange, type } = await mount({ value: 15, min: 9, max: 72 })
  await type('5')
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(onChange).toHaveBeenLastCalledWith(9)
  await type('520')
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(onChange).toHaveBeenLastCalledWith(72)
})

it('saves nothing for an emptied field until it is left, then the default', async () => {
  const { input, onChange, type } = await mount({ value: 25, min: 5 })
  await type('')
  await settle()
  expect(onChange).not.toHaveBeenCalled()
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(onChange).toHaveBeenCalledWith(undefined)
})
