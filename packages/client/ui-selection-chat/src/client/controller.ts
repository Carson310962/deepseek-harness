/** Fork/retain/prompt/archive orchestration for the selection side chat. */

import type {
  ISessions, SessionFace, SessionReference,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SelectionChatKey } from './locales.ts'

/** Narrow host surface owned by the controller; the plugin supplies the live services. */
export interface SelectionChatHost {
  readonly sessions: Pick<ISessions, 'retain' | 'fork'>
  readonly workspaces: Pick<IWorkspaces, 'archiveSession'>
  readonly t: (key: SelectionChatKey, params?: Record<string, unknown>) => string
}

/** One request to open a side chat over a selected transcript range. */
export interface SelectionChatOpenRequest {
  readonly sourceSessionId: SessionId
  /** Normalized and truncated selection text. */
  readonly selection: string
  /** The user's question for the side chat. */
  readonly question: string
}

/** Structured failure returned to the popover. */
export interface SelectionChatFailure {
  readonly code: string
  readonly message: string
}

/** A forked side session ready for rendering. */
export interface SelectionChatOpenResult {
  readonly childId: SessionId
  readonly reference: SessionReference
  /** Inclusive source seq inherited by the fork; new side-chat nodes are above it. */
  readonly boundarySeq: number
  /** Present when the fork succeeded but the first prompt was rejected. */
  readonly promptError: SelectionChatFailure | null
}

/** Result of one prompt call, derived from the Session face without importing its wire package. */
export type SelectionChatPromptResult = Awaited<ReturnType<SessionFace['prompt']>>

/** Structured open failure shown in the editing state. */
export class SelectionChatOpenError extends Error {
  override readonly name = 'SelectionChatOpenError'

  /**
   * @param code - stable failure class for localized copy.
   * @param message - host or transport message.
   * @param failure - optional business code/message pair.
   */
  constructor(
    readonly code: 'no-events' | 'fork-failed' | 'open-failed',
    message: string,
    readonly failure?: SelectionChatFailure,
  ) {
    super(message)
  }
}

/** Structured close failure that keeps the popover open for retry. */
export class SelectionChatCloseError extends Error {
  override readonly name = 'SelectionChatCloseError'

  /**
   * @param failure - archive failure code/message.
   */
  constructor(readonly failure: SelectionChatFailure) {
    super(failure.message)
  }
}

interface ActiveSideChat {
  readonly childId: SessionId
  readonly reference: SessionReference
}

function failureOf(error: unknown): SelectionChatFailure | undefined {
  if (typeof error === 'object' && error !== null && 'rpcError' in error) {
    const rpc = error.rpcError
    if (typeof rpc === 'object' && rpc !== null && 'code' in rpc && 'message' in rpc) {
      if (typeof rpc.code === 'string' && typeof rpc.message === 'string') {
        return { code: rpc.code, message: rpc.message }
      }
    }
  }
  if (error instanceof Error) return { code: error.name, message: error.message }
  return undefined
}

/**
 * Build the first user message: the selected text as a Markdown blockquote
 * followed by the question. Both parts are plain text; the host records the
 * normal `user/message` event.
 * @param selection - normalized selection text.
 * @param question - user question.
 * @returns the complete prompt text.
 */
export function quotePrompt(selection: string, question: string): string {
  const quote = selection.split('\n').map(line => `> ${line}`).join('\n')
  return `${quote}\n\n${question.trim()}`
}

/**
 * Own the one live selection side chat for this plugin fiber.
 */
export class SelectionChatController {
  private active: ActiveSideChat | undefined

  /**
   * @param host - live Sessions/Workspaces services and locale copy.
   */
  constructor(private readonly host: SelectionChatHost) {}

  /**
   * Fork the source Session at its current durable tail and send the first question.
   * @param request - source Session, selection, and question.
   * @param signal - caller lifetime; aborting before the child is published discards it.
   * @returns the retained child and its inherited boundary.
   * @throws {SelectionChatOpenError} when the source has no events, the fork fails, or the child cannot open.
   */
  async open(request: SelectionChatOpenRequest, signal: AbortSignal): Promise<SelectionChatOpenResult> {
    if (this.active !== undefined) await this.close({ force: true })
    const source = this.host.sessions.retain(request.sourceSessionId, { source: 'selectionChat', signal })
    let boundarySeq: number | undefined
    try {
      await source.ready
      const entries = source.binding.eventSource.getSnapshot().entries
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (entry?.type === 'event') {
          boundarySeq = entry.event.seq
          break
        }
      }
    } finally {
      source.release()
    }
    if (boundarySeq === undefined) {
      throw new SelectionChatOpenError('no-events', this.host.t('dialog.noEvents'))
    }
    signal.throwIfAborted()

    let childId: SessionId
    try {
      childId = await this.host.sessions.fork({ sessionId: request.sourceSessionId, atSeq: boundarySeq })
    } catch (error) {
      const failure = failureOf(error)
      throw new SelectionChatOpenError('fork-failed', failure?.message ?? String(error), failure)
    }

    let reference: SessionReference
    try {
      reference = this.host.sessions.retain(childId, { source: 'selectionChat', signal })
      await reference.ready
    } catch (error) {
      if (signal.aborted) {
        await this.discard(childId)
        throw error
      }
      const failure = failureOf(error)
      await this.discard(childId)
      throw new SelectionChatOpenError('open-failed', failure?.message ?? String(error), failure)
    }

    if (signal.aborted) {
      reference.release()
      await this.discard(childId)
      signal.throwIfAborted()
    }

    const prompt = quotePrompt(request.selection, request.question)
    let sent: SelectionChatPromptResult
    try {
      sent = await reference.binding.session.prompt([{ type: 'text', text: prompt }], 'queue', signal)
    } catch (error) {
      reference.release()
      await this.discard(childId)
      throw error
    }
    if (signal.aborted) {
      reference.release()
      await this.discard(childId)
      signal.throwIfAborted()
    }
    const promptError = sent.ok ? null : { code: sent.error.code, message: sent.error.message }
    this.active = { childId, reference }
    void reference.binding.session.rename(this.titleFor(request.question || request.selection)).catch((_error: unknown) => {
      // The side chat stays usable when a title rename is refused.
    })
    return { childId, reference, boundarySeq, promptError }
  }

  /**
   * Send one follow-up into the active side chat.
   * @param text - non-empty prompt text.
   * @returns the prompt result; failures are also mirrored into the Session snapshot.
   */
  async send(text: string): Promise<SelectionChatPromptResult> {
    const active = this.active
    if (active === undefined) throw new Error('selection-chat: no active side chat')
    return active.reference.binding.session.prompt([{ type: 'text', text }], 'queue')
  }

  /**
   * Stop the active side chat's running turn.
   */
  async stop(): Promise<void> {
    const active = this.active
    if (active === undefined) return
    await active.reference.binding.session.cancel()
  }

  /**
   * Stop and archive the active side chat, then release its reference.
   * @param options.force - release and close even when archive fails.
   * @throws {SelectionChatCloseError} when archive fails and `force` is not set.
   */
  async close(options: { force?: boolean } = {}): Promise<void> {
    const active = this.active
    if (active === undefined) return
    this.active = undefined
    try {
      await active.reference.binding.session.cancel()
    } catch (_error: unknown) {
      // Cancel is best-effort; archive's stopActivity settles running work.
    }
    try {
      await this.host.workspaces.archiveSession(active.childId, { stopActivity: true })
    } catch (error) {
      const failure = failureOf(error) ?? { code: 'workspace/archive-failed', message: String(error) }
      if (options.force !== true) {
        this.active = active
        throw new SelectionChatCloseError(failure)
      }
    }
    active.reference.release()
  }

  /**
   * Best-effort shutdown for plugin disposal.
   */
  dispose(): void {
    void this.close({ force: true }).catch((_error: unknown) => {
      // Disposal cannot surface a retry; the archived Session remains recoverable.
    })
  }

  private async discard(childId: SessionId): Promise<void> {
    try {
      await this.host.workspaces.archiveSession(childId, { stopActivity: true })
    } catch (_error: unknown) {
      // The child may already be gone or unsaved; there is nothing left to surface.
    }
  }

  private titleFor(value: string): string {
    const preview = value.replace(/\s+/gu, ' ').trim().slice(0, 40)
    return this.host.t('title', { preview: preview === '' ? '…' : preview })
  }
}
