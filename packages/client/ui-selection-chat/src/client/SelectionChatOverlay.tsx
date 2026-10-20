/** Frame-wide selection action and floating side-chat popover. */

import {
  useEffect, useRef, useState, type CSSProperties, type KeyboardEvent,
} from 'react'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, IconCloseOutlineRegular, IconSparkleRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SelectionChatOpenRequest, SelectionChatOpenResult, SelectionChatPromptResult,
} from './controller.ts'
import { SelectionChatOpenError } from './controller.ts'
import {
  isOwnEvent, readSelection, type SelectionCapture, type SelectionRect,
} from './selection.ts'
// Type-only: loads the shell.overlay SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: loads the selection.chat.panel SlotMap declaration.
import type {} from './SelectionChatPanel.tsx'
import { NS } from './locales.ts'
import css from './SelectionChatOverlay.module.css'

/** Business face injected into the overlay component. */
export interface SelectionChatOverlayInjected {
  /** Fork the source Session and send the first question. */
  readonly open: (request: SelectionChatOpenRequest, signal: AbortSignal) => Promise<SelectionChatOpenResult>
  /** Send one follow-up into the active side chat. */
  readonly send: (text: string) => Promise<SelectionChatPromptResult>
  /** Stop the active side chat's running turn. */
  readonly stop: () => Promise<void>
  /** Stop and archive the active side chat. */
  readonly close: (options?: { force?: boolean }) => Promise<void>
}

/** Full props for the frame-wide selection overlay. */
export type SelectionChatOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsRenderSlots<'selection.chat.panel'>
  & PropsLocale<typeof NS>
  & InjectFace<SelectionChatOverlayInjected>

type OverlayState =
  | { readonly phase: 'idle' }
  | {
    readonly phase: 'editing'
    readonly capture: SelectionCapture
    readonly question: string
    readonly error: string | null
  }
  | {
    readonly phase: 'starting'
    readonly capture: SelectionCapture
    readonly question: string
  }
  | {
    readonly phase: 'chat'
    readonly childId: SessionId
    readonly reference: SessionReference
    readonly boundarySeq: number
    readonly closeError: string | null
  }

const VIEWPORT_MARGIN = 8
const POPOVER_WIDTH = 400
const POPOVER_ESTIMATED_HEIGHT = 420
const ACTION_ESTIMATED_WIDTH = 220

function dialogStyle(rect: SelectionRect): CSSProperties {
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
  const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN))
  const top = rect.top > window.innerHeight / 2
    ? Math.max(VIEWPORT_MARGIN, rect.top - POPOVER_ESTIMATED_HEIGHT - VIEWPORT_MARGIN)
    : Math.min(
      rect.bottom + VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, window.innerHeight - POPOVER_ESTIMATED_HEIGHT - VIEWPORT_MARGIN),
    )
  return { left, top, width }
}

function actionStyle(rect: SelectionRect): CSSProperties {
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(rect.left, window.innerWidth - ACTION_ESTIMATED_WIDTH - VIEWPORT_MARGIN),
  )
  const top = rect.bottom + VIEWPORT_MARGIN > window.innerHeight - 48
    ? Math.max(VIEWPORT_MARGIN, rect.top - 40)
    : rect.bottom + VIEWPORT_MARGIN
  return { left, top }
}

function messageOf(error: unknown, t: SelectionChatOverlayProps['t']): string {
  if (error instanceof SelectionChatOpenError && error.code === 'no-events') return error.message
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'request-failed'
    return t('dialog.error', { message: error.message, code })
  }
  return t('dialog.error', { message: String(error), code: 'request-failed' })
}

/**
 * Watch assistant-output selections, show the floating action, and host the
 * side-chat popover for the one active side session.
 * @param props - frame overlay owner props, the session-scoped panel renderer, and injected actions.
 */
export function SelectionChatOverlay({
  open, send, stop, close, renderSlot, SessionProvider, t,
}: SelectionChatOverlayProps) {
  const [state, setState] = useState<OverlayState>({ phase: 'idle' })
  const [capture, setCapture] = useState<SelectionCapture | null>(null)
  const [anchor, setAnchor] = useState<SelectionRect | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (state.phase !== 'idle') {
      setCapture(null)
      return
    }
    const update = (event: Event): void => {
      if (isOwnEvent(event)) return
      setCapture(readSelection())
    }
    const onSelectionChange = (): void => {
      if (window.getSelection()?.isCollapsed !== false) setCapture(null)
    }
    const onPointerUp = (event: Event): void => { update(event) }
    const onKeyUp = (event: Event): void => { update(event) }
    const onViewportChange = (): void => { setCapture(null) }
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
    }
  }, [state.phase])

  useEffect(() => () => {
    abortRef.current?.abort()
    void closeRef.current({ force: true }).catch((_error: unknown) => {
      // The plugin is leaving; the archived Session remains recoverable.
    })
  }, [])

  const restoreFocus = (): void => {
    const previous = previousFocus.current
    previousFocus.current = null
    if (previous !== null && previous.isConnected) previous.focus()
  }

  const openEditor = (): void => {
    if (capture === null) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setAnchor(capture.rect)
    setState({ phase: 'editing', capture, question: '', error: null })
    setCapture(null)
  }

  const submit = async (): Promise<void> => {
    if (state.phase !== 'editing') return
    const question = state.question.trim()
    if (question === '') return
    const current = state
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setState({ phase: 'starting', capture: current.capture, question })
    try {
      const result = await open({
        sourceSessionId: current.capture.sourceSessionId,
        selection: current.capture.text,
        question,
      }, controller.signal)
      if (controller.signal.aborted) {
        void close({ force: true }).catch((_error: unknown) => {
          // The aborted open has no visible surface left to report to.
        })
        setState({ phase: 'idle' })
        return
      }
      setState({
        phase: 'chat',
        childId: result.childId,
        reference: result.reference,
        boundarySeq: result.boundarySeq,
        closeError: null,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        setState({ phase: 'idle' })
        return
      }
      setState({
        phase: 'editing',
        capture: current.capture,
        question,
        error: messageOf(error, t),
      })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const closeActive = async (force = false): Promise<void> => {
    abortRef.current?.abort()
    abortRef.current = null
    if (state.phase === 'chat') {
      setState({ ...state, closeError: null })
      try {
        await close({ force })
        setState({ phase: 'idle' })
        setAnchor(null)
        restoreFocus()
      } catch (error) {
        setState({ ...state, closeError: messageOf(error, t) })
      }
      return
    }
    setState({ phase: 'idle' })
    setAnchor(null)
    restoreFocus()
  }

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.stopPropagation()
      void closeActive()
    }
  }

  return (
    <>
      {state.phase === 'idle' && capture !== null && (
        <Button
          className={css.action}
          data-selection-chat=""
          style={actionStyle(capture.rect)}
          size="sm"
          variant="outline"
          icon={<IconSparkleRegular size={14} />}
          onPointerDown={(event) => { event.preventDefault() }}
          onClick={openEditor}
        >
          {t('action.label')}
        </Button>
      )}
      {state.phase !== 'idle' && anchor !== null && (
        <div
          className={css.dialog}
          data-selection-chat=""
          role="dialog"
          aria-label={t('dialog.title')}
          style={dialogStyle(anchor)}
          onKeyDown={onDialogKeyDown}
        >
          <header className={css.header}>
            <span className={css.title}>{t('dialog.title')}</span>
            <Button
              size="sm"
              variant="ghost"
              icon={<IconCloseOutlineRegular size={14} />}
              aria-label={t('dialog.close')}
              onClick={() => { void closeActive() }}
            />
          </header>
          {state.phase === 'editing' && (
            <div className={css.editor}>
              <div className={css.quoteLabel}>{t('dialog.quoteLabel')}</div>
              <div className={css.quoteText}>{state.capture.text}</div>
              <textarea
                autoFocus
                className={css.input}
                rows={3}
                value={state.question}
                placeholder={t('dialog.placeholder')}
                onChange={(event) => { setState({ ...state, question: event.target.value }) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void submit()
                  }
                }}
              />
              {state.error !== null && <div className={css.error} role="alert">{state.error}</div>}
              <div className={css.footer}>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={state.question.trim() === ''}
                  onClick={() => { void submit() }}
                >
                  {t('dialog.send')}
                </Button>
              </div>
            </div>
          )}
          {state.phase === 'starting' && (
            <div className={css.starting}>{t('dialog.starting')}</div>
          )}
          {state.phase === 'chat' && (
            <div className={css.chat}>
              {state.closeError !== null && (
                <div className={css.error} role="alert">
                  <div>{state.closeError}</div>
                  <div className={css.errorActions}>
                    <Button size="sm" onClick={() => { void closeActive() }}>{t('dialog.retryClose')}</Button>
                    <Button size="sm" variant="outline" onClick={() => { void closeActive(true) }}>
                      {t('dialog.closeAnyway')}
                    </Button>
                  </div>
                </div>
              )}
              <SessionProvider session={state.reference}>
                {renderSlot('selection.chat.panel', {
                  boundarySeq: state.boundarySeq,
                  onSend: send,
                  onStop: stop,
                  onClose: () => { void closeActive() },
                })}
              </SessionProvider>
            </div>
          )}
        </div>
      )}
    </>
  )
}
