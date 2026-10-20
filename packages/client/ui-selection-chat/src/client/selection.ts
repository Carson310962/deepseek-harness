/** DOM selection capture for the Chat transcript side-chat action. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Maximum selected characters forwarded to the side chat. */
export const MAX_SELECTION_CHARS = 8000

/** Viewport-space geometry of the captured selection. */
export interface SelectionRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

/** One assistant-output selection eligible for a side chat. */
export interface SelectionCapture {
  /** Session whose transcript owns the selection. */
  readonly sourceSessionId: SessionId
  /** Normalized selected text, truncated to {@link MAX_SELECTION_CHARS}. */
  readonly text: string
  /** Viewport-space bounds used to anchor the action and the popover. */
  readonly rect: SelectionRect
}

const CONTROL_SELECTOR = 'button, a, input, textarea, select, option, [contenteditable="true"]'
const EXCLUDED_SELECTOR = '[data-composer-seat], [data-selection-chat]'
const FLOW_SELECTOR = '[data-chat-flow]'
const ASSISTANT_SELECTOR = '[data-chat-flow-kind="assistant-step"]'
const SESSION_SELECTOR = '[data-conversation-session]'

function elementOf(node: Node | null): HTMLElement | null {
  if (node === null) return null
  if (node instanceof HTMLElement) return node
  return node.parentElement
}

function rejected(element: HTMLElement): boolean {
  return element.closest(CONTROL_SELECTOR) !== null || element.closest(EXCLUDED_SELECTOR) !== null
}

function rectOf(range: Range): SelectionRect | null {
  const bounding = range.getBoundingClientRect()
  if (bounding.width > 0 && bounding.height > 0) return copyRect(bounding)
  const rects = range.getClientRects()
  for (let index = rects.length - 1; index >= 0; index -= 1) {
    const rect = rects[index]
    if (rect !== undefined && rect.width > 0 && rect.height > 0) return copyRect(rect)
  }
  return null
}

function copyRect(rect: DOMRect | DOMRectReadOnly): SelectionRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

/**
 * Normalize selected prose without destroying paragraph breaks.
 * @param value - raw `Selection.toString()`.
 * @returns trimmed text with collapsed inline whitespace.
 */
export function normalizeSelection(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(/\u00a0/gu, ' ')
    .split('\n')
    .map(line => line.replace(/[ \t]+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

/**
 * Truncate one selection to the prompt budget.
 * @param value - normalized selection text.
 * @returns the text, with a trailing ellipsis when anything was removed.
 */
export function truncateSelection(value: string): string {
  if (value.length <= MAX_SELECTION_CHARS) return value
  return `${value.slice(0, MAX_SELECTION_CHARS)}…`
}

/**
 * Read the current document selection when it covers assistant output.
 * @returns the captured selection, or null for a collapsed, foreign, or control selection.
 */
export function readSelection(): SelectionCapture | null {
  if (typeof window === 'undefined') return null
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const start = elementOf(range.startContainer)
  const end = elementOf(range.endContainer)
  if (start === null || end === null || rejected(start) || rejected(end)) return null
  if (start.closest(FLOW_SELECTOR) === null || end.closest(FLOW_SELECTOR) === null) return null
  if (start.closest(ASSISTANT_SELECTOR) === null && end.closest(ASSISTANT_SELECTOR) === null) return null
  const host = start.closest(SESSION_SELECTOR)
  if (host === null || host !== end.closest(SESSION_SELECTOR)) return null
  const sourceSessionId = host.getAttribute('data-conversation-session')
  if (sourceSessionId === null || sourceSessionId === '') return null
  const text = truncateSelection(normalizeSelection(selection.toString()))
  if (text === '') return null
  const rect = rectOf(range)
  if (rect === null) return null
  return { sourceSessionId: sourceSessionId as SessionId, text, rect }
}

/**
 * Whether a pointer/keyboard event belongs to this plugin's own surface.
 * @param event - document-level event target.
 * @returns true when the event starts inside the side-chat popover or action.
 */
export function isOwnEvent(event: Event): boolean {
  const target = event.target
  return target instanceof Element && target.closest('[data-selection-chat]') !== null
}
