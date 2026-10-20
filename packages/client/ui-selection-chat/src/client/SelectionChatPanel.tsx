/** Session-scoped transcript and composer for one selection side chat. */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type {
  ChatNode, ChatSnapshot,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  Button, IconChevronDownOutlineRegular, IconStopFillRegular, MarkdownText,
  type MarkdownLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SelectionChatPromptResult } from './controller.ts'
import { NS } from './locales.ts'
import css from './SelectionChatPanel.module.css'

/** Owner props supplied by the overlay for one mounted side chat. */
export interface SelectionChatPanelOwnerProps {
  /** Inclusive source seq inherited by the fork; side-chat nodes are above it. */
  readonly boundarySeq: number
  /** Send one follow-up into the side session. */
  readonly onSend: (text: string) => Promise<SelectionChatPromptResult>
  /** Stop the side session's running turn. */
  readonly onStop: () => Promise<void>
  /** Close and archive the side session. */
  readonly onClose: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Session-scoped transcript and composer for one selection side chat. */
    'selection.chat.panel': {
      kind: 'single'
      scope: 'session'
      owner: SelectionChatPanelOwnerProps
    }
  }
}

/** Full props for the session-scoped side-chat panel. */
export type SelectionChatPanelProps =
  PropsRuntime<'selection.chat.panel'>
  & PropsLocale<typeof NS>

interface UserRow {
  readonly kind: 'user'
  readonly key: string
  readonly text: string
}

interface AssistantRow {
  readonly kind: 'assistant'
  readonly key: string
  readonly text: string
  readonly status: 'running' | 'settled' | 'interrupted'
  readonly tools: readonly string[]
}

interface ErrorRow {
  readonly kind: 'error'
  readonly key: string
  readonly message: string
  readonly code: string | undefined
}

type Row = UserRow | AssistantRow | ErrorRow

function contentText(content: readonly { readonly type: string }[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && 'text' in block && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function assistantText(blocks: readonly { readonly kind: string }[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.kind === 'text' && 'text' in block && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('')
}

function toolNames(blocks: readonly { readonly kind: string }[]): string[] {
  const names: string[] = []
  for (const block of blocks) {
    if (block.kind === 'tool-call' && 'name' in block && typeof block.name === 'string') names.push(block.name)
  }
  return names
}

/**
 * Project only the side chat's own nodes: inherited history stays below the
 * fork boundary. The Chat target has already folded streaming chunks into
 * assistant blocks, so this list updates as the model streams.
 * @param snapshot - Chat target snapshot for the side session.
 * @param boundarySeq - inclusive inherited cut.
 * @returns render rows in transcript order.
 */
export function selectionChatRows(snapshot: ChatSnapshot, boundarySeq: number): readonly Row[] {
  // Start at the side chat's own first user message. Inherited synthetic
  // closers (for example an interrupted Assistant prefix) can carry a
  // fractional seq above the durable fork boundary; the first user message is
  // the reliable cut for everything this window owns.
  let startSeq: number | undefined
  for (const key of snapshot.order) {
    const node = snapshot.nodes.get(key) as ChatNode | undefined
    if (node !== undefined && node.anchorSeq > boundarySeq
      && (node.kind === 'user' || node.kind === 'steering')) {
      startSeq = node.anchorSeq
      break
    }
  }
  if (startSeq === undefined) return []
  const rows: Row[] = []
  for (const key of snapshot.order) {
    const node = snapshot.nodes.get(key) as ChatNode | undefined
    if (node === undefined || node.anchorSeq < startSeq) continue
    switch (node.kind) {
      case 'user':
      case 'steering': {
        const text = contentText(node.data.content)
        if (text !== '') rows.push({ kind: 'user', key, text })
        break
      }
      case 'assistant-step': {
        rows.push({
          kind: 'assistant',
          key,
          text: assistantText(node.data.blocks),
          status: node.data.status,
          tools: toolNames(node.data.blocks),
        })
        break
      }
      case 'turn-error':
        rows.push({ kind: 'error', key, message: node.data.message, code: node.data.code })
        break
      default:
        break
    }
  }
  return rows
}

/**
 * Render one side chat: transcript plus a compact composer.
 * @param props - session standard hooks, owner callbacks, and locale copy.
 */
export function SelectionChatPanel({
  boundarySeq, onSend, onStop, onClose, useChat, useSession, t,
}: SelectionChatPanelProps) {
  const snapshot = useChat(value => value)
  const running = useSession(value => value.running)
  const promptError = useSession(value => value.promptError)
  const rows = useMemo(() => selectionChatRows(snapshot, boundarySeq), [snapshot, boundarySeq])
  const labels = useMemo<MarkdownLabels>(() => ({
    code: {
      copyLabel: t('markdown.copy'),
      copiedLabel: t('markdown.copied'),
      toolbarLabels: {
        codeLabel: t('markdown.code'),
        wrapLabel: t('markdown.wrap'),
        unwrapLabel: t('markdown.unwrap'),
      },
    },
    footnotes: t('markdown.footnotes'),
  }), [t])
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const list = listRef.current
    if (list === null || !stick.current) return
    list.scrollTop = list.scrollHeight
  }, [rows])

  const jumpToBottom = (): void => {
    const list = listRef.current
    if (list === null) return
    stick.current = true
    setShowJump(false)
    list.scrollTop = list.scrollHeight
  }

  const onScroll = (): void => {
    const list = listRef.current
    if (list === null) return
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24
    stick.current = nearBottom
    setShowJump(!nearBottom)
  }

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || sending) return
    setSending(true)
    setSendError(null)
    try {
      const result = await onSend(text)
      if (result.ok) {
        setDraft('')
        stick.current = true
      } else {
        setSendError(t('dialog.error', { message: result.error.message, code: result.error.code }))
      }
    } catch (error) {
      setSendError(t('dialog.error', {
        message: error instanceof Error ? error.message : String(error),
        code: 'request-failed',
      }))
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div className={css.panel} data-selection-chat-panel="">
      <div ref={listRef} className={css.transcript} onScroll={onScroll} aria-live="polite">
        {rows.map(row => <RowView key={row.key} row={row} labels={labels} t={t} />)}
        {promptError !== null && (
          <div className={css.error} role="alert">
            {t('dialog.error', {
              message: promptError.error.message,
              code: promptError.error.code,
            })}
          </div>
        )}
      </div>
      {showJump && (
        <button type="button" className={css.jump} onClick={jumpToBottom}>
          <IconChevronDownOutlineRegular size={14} />
          {t('dialog.scrollToBottom')}
        </button>
      )}
      <div className={css.composer}>
        <textarea
          ref={inputRef}
          className={css.input}
          value={draft}
          rows={2}
          placeholder={t('dialog.placeholder')}
          onChange={(event) => { setDraft(event.target.value) }}
          onKeyDown={onKeyDown}
        />
        {sendError !== null && <div className={css.error} role="alert">{sendError}</div>}
        <div className={css.actions}>
          {running && (
            <Button
              size="sm"
              variant="outline"
              icon={<IconStopFillRegular size={14} />}
              onClick={() => { void onStop() }}
            >
              {t('dialog.stop')}
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={draft.trim() === '' || sending}
            onClick={() => { void submit() }}
          >
            {t('dialog.send')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('dialog.close')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function RowView({
  row, labels, t,
}: {
  readonly row: Row
  readonly labels: MarkdownLabels
  readonly t: SelectionChatPanelProps['t']
}) {
  if (row.kind === 'user') {
    return (
      <div className={css.user}>
        <MarkdownText text={row.text} labels={labels} />
      </div>
    )
  }
  if (row.kind === 'error') {
    return (
      <div className={css.error} role="alert">
        {t('dialog.error', { message: row.message === '' ? t('dialog.noText') : row.message, code: row.code ?? 'turn-error' })}
      </div>
    )
  }
  const toolText = row.tools.join(', ')
  return (
    <div className={css.assistant}>
      {row.text !== ''
        ? <MarkdownText text={row.text} streaming={row.status === 'running'} labels={labels} />
        : (
          <div className={css.hint}>
            {row.status === 'running'
              ? toolText === '' ? t('dialog.thinking') : t('dialog.usingTools', { tools: toolText })
              : row.status === 'interrupted'
                ? t('dialog.stopped')
                : toolText === '' ? t('dialog.noText') : t('dialog.usedTools', { tools: toolText })}
          </div>
        )}
      {row.status === 'interrupted' && row.text !== '' && (
        <div className={css.hint}>{t('dialog.stopped')}</div>
      )}
    </div>
  )
}
