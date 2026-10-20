// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import { makeTranslate, workspaceSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  SelectionChatOverlay, type SelectionChatOverlayProps,
} from '../src/client/SelectionChatOverlay.tsx'
import { SelectionChatOpenError } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'

const SOURCE = 'source' as SessionId
const CHILD = 'child' as SessionId

const RECT = {
  left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20,
  x: 10, y: 20, toJSON: () => ({}),
} as DOMRect

function selectAnswer(): void {
  const answer = document.querySelector('#answer') as Element
  const range = document.createRange()
  range.selectNodeContents(answer)
  const selection = window.getSelection()
  if (selection === null) throw new Error('test: missing selection')
  selection.removeAllRanges()
  selection.addRange(range)
}

function props(overrides: {
  open?: SelectionChatOverlayProps['open']
  close?: SelectionChatOverlayProps['close']
} = {}): SelectionChatOverlayProps {
  const open = overrides.open ?? vi.fn(async () => ({
    childId: CHILD,
    reference: {} as SessionReference,
    boundarySeq: 7,
    promptError: null,
  }))
  const close = overrides.close ?? vi.fn(async () => {})
  return {
    open,
    send: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
    stop: vi.fn(async () => {}),
    close,
    renderSlot: vi.fn(() => <div data-testid="side-panel" />),
    SessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useSessions: selector => selector({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }),
    useSessionStatus: selector => selector(new Map()),
    useSessionRetainInfo: () => undefined,
    useSessionAccess: () => true,
    useWorkspaces: selector => selector(workspaceSnapshot()),
    useWorkspaceAccess: () => true,
    useRemoteAccess: () => true,
    usePanelInfo: selector => selector({ activePanelId: null }),
    useResource: (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource'],
    t: makeTranslate(zh),
  } as SelectionChatOverlayProps
}

beforeEach(() => {
  document.body.innerHTML = `
    <div data-conversation-session="source">
      <div data-chat-flow="">
        <div data-chat-flow-kind="assistant-step"><p id="answer">Selected answer</p></div>
      </div>
    </div>
  `
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: () => RECT,
  })
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
  vi.restoreAllMocks()
})

describe('SelectionChatOverlay', () => {
  it('opens the editor from an assistant selection and sends the question', async () => {
    const open = vi.fn(async () => ({
      childId: CHILD,
      reference: {} as SessionReference,
      boundarySeq: 7,
      promptError: null,
    }))
    render(<SelectionChatOverlay {...props({ open })} />)
    selectAnswer()
    fireEvent.pointerUp(document)
    const action = await screen.findByRole('button', { name: '针对选中内容提问' })
    fireEvent.click(action)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeDefined()
    expect(within(dialog).getByText('Selected answer')).toBeDefined()
    fireEvent.change(screen.getByPlaceholderText('针对选中的内容提问…'), { target: { value: 'Why?' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(
        { sourceSessionId: SOURCE, selection: 'Selected answer', question: 'Why?' },
        expect.any(AbortSignal),
      )
    })
    await screen.findByTestId('side-panel')
  })

  it('shows a localized no-events error and creates no session', async () => {
    const open = vi.fn(async () => {
      throw new SelectionChatOpenError('no-events', '当前会话还没有可继承的内容。')
    })
    render(<SelectionChatOverlay {...props({ open })} />)
    selectAnswer()
    fireEvent.pointerUp(document)
    fireEvent.click(await screen.findByRole('button', { name: '针对选中内容提问' }))
    fireEvent.change(screen.getByPlaceholderText('针对选中的内容提问…'), { target: { value: 'Why?' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await screen.findByText('当前会话还没有可继承的内容。')
    expect(screen.queryByTestId('side-panel')).toBeNull()
  })

  it('keeps the popover open when archive fails, then closes on retry', async () => {
    const close = vi.fn(async () => {})
    close.mockRejectedValueOnce(new Error('archive failed'))
    render(<SelectionChatOverlay {...props({ close })} />)
    selectAnswer()
    fireEvent.pointerUp(document)
    fireEvent.click(await screen.findByRole('button', { name: '针对选中内容提问' }))
    fireEvent.change(screen.getByPlaceholderText('针对选中的内容提问…'), { target: { value: 'Why?' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await screen.findByTestId('side-panel')

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await screen.findByText(/archive failed/)
    expect(screen.getByRole('dialog')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '重试关闭' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })
})
