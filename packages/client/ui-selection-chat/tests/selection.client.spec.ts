// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_SELECTION_CHARS, normalizeSelection, readSelection, truncateSelection,
} from '../src/client/selection.ts'

const RECT = {
  left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20,
  x: 10, y: 20, toJSON: () => ({}),
} as DOMRect

function select(element: Element): Range {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  if (selection === null) throw new Error('test: missing selection')
  selection.removeAllRanges()
  selection.addRange(range)
  return range
}

beforeEach(() => {
  document.body.innerHTML = `
    <div data-conversation-session="session-1">
      <div data-chat-flow="">
        <div data-chat-flow-kind="assistant-step"><p id="answer">Selected answer text</p></div>
        <div data-chat-flow-kind="user"><p id="user">User text</p></div>
      </div>
      <div data-composer-seat=""><textarea id="composer">draft</textarea></div>
    </div>
    <div id="outside"><p id="foreign">Outside</p></div>
  `
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: () => RECT,
  })
})

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
  Reflect.deleteProperty(Range.prototype, 'getClientRects')
  vi.restoreAllMocks()
})

describe('readSelection', () => {
  it('captures assistant output, its session, and the viewport bounds', () => {
    select(document.querySelector('#answer') as Element)
    expect(readSelection()).toEqual({
      sourceSessionId: 'session-1',
      text: 'Selected answer text',
      rect: { left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 },
    })
  })

  it('rejects a user-message selection', () => {
    select(document.querySelector('#user') as Element)
    expect(readSelection()).toBeNull()
  })

  it('rejects a composer selection', () => {
    select(document.querySelector('#composer') as Element)
    expect(readSelection()).toBeNull()
  })

  it('rejects a collapsed selection', () => {
    const answer = document.querySelector('#answer') as Element
    const range = document.createRange()
    range.setStart(answer.firstChild as Node, 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    expect(readSelection()).toBeNull()
  })

  it('rejects a selection outside the chat flow', () => {
    select(document.querySelector('#foreign') as Element)
    expect(readSelection()).toBeNull()
  })

  it('rejects a transcript selection without a session identity', () => {
    document.querySelector('[data-conversation-session]')?.removeAttribute('data-conversation-session')
    select(document.querySelector('#answer') as Element)
    expect(readSelection()).toBeNull()
  })

  it('falls back to a client rect when the bounding rect is empty', () => {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      writable: true,
      value: () => ({
        left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
      }),
    })
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      writable: true,
      value: () => [RECT],
    })
    select(document.querySelector('#answer') as Element)
    expect(readSelection()?.rect).toEqual({
      left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20,
    })
  })
})

describe('selection text', () => {
  it('collapses inline whitespace while preserving paragraph breaks', () => {
    expect(normalizeSelection('  a \t b \n\n\n  c  ')).toBe('a b\n\nc')
  })

  it('truncates above the prompt budget', () => {
    const value = 'x'.repeat(MAX_SELECTION_CHARS + 10)
    const truncated = truncateSelection(value)
    expect(truncated).toHaveLength(MAX_SELECTION_CHARS + 1)
    expect(truncated.endsWith('…')).toBe(true)
  })

  it('leaves a within-budget value untouched', () => {
    expect(truncateSelection('short')).toBe('short')
  })
})
