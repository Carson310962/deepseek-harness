// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ChatNode, ChatSnapshot,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { EMPTY_CHAT_SNAPSHOT } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate, sessionSnapshot, workspaceSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  SelectionChatPanel, type SelectionChatPanelProps,
} from '../src/client/SelectionChatPanel.tsx'
import { zh } from '../src/client/locales.ts'

const SESSION = 'session' as SessionId

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function snapshotOf(nodes: readonly ChatNode[]): ChatSnapshot {
  const map = new Map(nodes.map(node => [node.key, node]))
  return {
    ...EMPTY_CHAT_SNAPSHOT,
    order: nodes.map(node => node.key),
    nodes: {
      ...EMPTY_CHAT_SNAPSHOT.nodes,
      get: key => map.get(key),
    },
  }
}

function userNode(key: string, anchorSeq: number, text: string): ChatNode {
  return {
    key,
    kind: 'user',
    anchorSeq,
    data: { content: [{ type: 'text', text }] },
  } as ChatNode
}

function assistantNode(
  key: string,
  anchorSeq: number,
  data: {
    status: 'running' | 'settled' | 'interrupted'
    blocks: readonly { kind: string; text?: string; name?: string }[]
  },
): ChatNode {
  return {
    key,
    kind: 'assistant-step',
    anchorSeq,
    data: { turn: 1, step: 1, time: 1, ...data },
  } as ChatNode
}

function errorNode(key: string, anchorSeq: number, message: string): ChatNode {
  return {
    key,
    kind: 'turn-error',
    anchorSeq,
    data: { message, code: 'ERR' },
  } as ChatNode
}

function props(overrides: {
  nodes?: readonly ChatNode[]
  boundarySeq?: number
  running?: boolean
  onSend?: SelectionChatPanelProps['onSend']
  onStop?: SelectionChatPanelProps['onStop']
  onClose?: SelectionChatPanelProps['onClose']
} = {}): SelectionChatPanelProps {
  const snapshot = snapshotOf(overrides.nodes ?? [])
  const session = { ...sessionSnapshot(SESSION), running: overrides.running ?? false }
  const useChat = <T,>(select: (value: ChatSnapshot) => T): T => select(snapshot)
  const useSession = <T,>(select: (value: SessionSnapshot) => T): T => select(session)
  return {
    boundarySeq: overrides.boundarySeq ?? 5,
    onSend: overrides.onSend ?? vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
    onStop: overrides.onStop ?? vi.fn(async () => {}),
    onClose: overrides.onClose ?? vi.fn(),
    useChat,
    useSession,
    useProjection: () => undefined,
    useAccess: () => true,
    sessionId: SESSION,
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
  } as SelectionChatPanelProps
}

describe('SelectionChatPanel', () => {
  it('renders only nodes above the fork boundary', () => {
    render(<SelectionChatPanel {...props({
      nodes: [
        userNode('old', 4, 'old inherited'),
        userNode('question', 6, 'selected question'),
        assistantNode('answer', 7, {
          status: 'settled',
          blocks: [{ kind: 'text', text: 'answer **body**' }],
        }),
      ],
    })} />)
    expect(screen.getByText('selected question')).toBeDefined()
    expect(screen.queryByText('old inherited')).toBeNull()
    expect(screen.getByText(/answer/)).toBeDefined()
    expect(screen.getByText('body')).toBeDefined()
  })

  it('ignores an inherited synthetic assistant prefix above the boundary', () => {
    render(<SelectionChatPanel {...props({
      nodes: [
        assistantNode('inherited-interrupted', 5.1, { status: 'interrupted', blocks: [] }),
        userNode('question', 6, 'why?'),
        assistantNode('answer', 7, { status: 'settled', blocks: [{ kind: 'text', text: 'fresh' }] }),
      ],
    })} />)
    expect(screen.queryByText('已停止')).toBeNull()
    expect(screen.getByText('fresh')).toBeDefined()
  })

  it('shows a running hint before any assistant text arrives', () => {
    render(<SelectionChatPanel {...props({
      nodes: [
        userNode('question', 6, 'why?'),
        assistantNode('answer', 7, {
          status: 'running',
          blocks: [{ kind: 'tool-call', name: 'bash' }],
        }),
      ],
    })} />)
    expect(screen.getByText('正在使用工具：bash')).toBeDefined()
  })

  it('marks an interrupted assistant prefix', () => {
    render(<SelectionChatPanel {...props({
      nodes: [
        userNode('question', 6, 'why?'),
        assistantNode('answer', 7, { status: 'interrupted', blocks: [] }),
      ],
    })} />)
    expect(screen.getByText('已停止')).toBeDefined()
  })

  it('renders a turn error instead of ending silently', () => {
    render(<SelectionChatPanel {...props({
      nodes: [
        userNode('question', 6, 'why?'),
        errorNode('error', 7, 'provider exploded'),
      ],
    })} />)
    expect(screen.getByText(/provider exploded/)).toBeDefined()
    expect(screen.getByText(/ERR/)).toBeDefined()
  })

  it('sends on Enter and clears the draft after acceptance', async () => {
    const onSend = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
    render(<SelectionChatPanel {...props({ onSend })} />)
    const input = screen.getByPlaceholderText('针对选中的内容提问…')
    fireEvent.change(input, { target: { value: 'follow up' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(onSend).toHaveBeenCalledWith('follow up') })
    await waitFor(() => { expect((input as HTMLTextAreaElement).value).toBe('') })
  })

  it('keeps the draft and shows the failure when send is rejected', async () => {
    const onSend = vi.fn<SelectionChatPanelProps['onSend']>(async () => ({
      ok: false,
      error: new RemoteError('gateway/internal', 'rejected', {}),
    }))
    render(<SelectionChatPanel {...props({ onSend })} />)
    const input = screen.getByPlaceholderText('针对选中的内容提问…')
    fireEvent.change(input, { target: { value: 'follow up' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(screen.getByText(/rejected/)).toBeDefined() })
    expect((input as HTMLTextAreaElement).value).toBe('follow up')
  })

  it('offers Stop while running and Close at all times', () => {
    const onStop = vi.fn(async () => {})
    const onClose = vi.fn()
    render(<SelectionChatPanel {...props({ running: true, onStop, onClose })} />)
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(onStop).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
