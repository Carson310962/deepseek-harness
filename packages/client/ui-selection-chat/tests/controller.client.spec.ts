// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ISessions, SessionEventLikeEntry, SessionFace, SessionReference,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'
import {
  SelectionChatCloseError, SelectionChatController, quotePrompt,
} from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'

const SOURCE = 'source' as SessionId
const CHILD = 'child' as SessionId

type Prompt = SessionFace['prompt']
type Cancel = SessionFace['cancel']
type Rename = SessionFace['rename']

const disposers: (() => void | Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})

async function bench(options: {
  events?: readonly SessionEventLikeEntry[]
  prompt?: Prompt
  cancel?: Cancel
  rename?: Rename
  fork?: (opts: Parameters<ISessions['fork']>[0]) => Promise<SessionId>
} = {}) {
  const created = await SlotTestRuntime.create()
  disposers.push(() => created.dispose())
  const prompt = options.prompt ?? vi.fn<Prompt>(async () => ({ ok: true, value: { accepted: true } }))
  const cancel = options.cancel ?? vi.fn<Cancel>(async () => ({ ok: true, value: { accepted: true } }))
  const rename = options.rename ?? vi.fn<Rename>(async (title: string) => ({
    ok: true,
    value: { title, seq: SessionSeq(8) },
  }))
  await created.sessions.add({
    id: SOURCE,
    events: options.events ?? [
      { type: 'event', event: { type: 'turn/start', seq: SessionSeq(7), time: 1, data: { turn: 1 } } },
    ],
  })
  await created.sessions.add({
    id: CHILD,
    events: [],
    session: { prompt, cancel, rename },
  })
  const archiveSession = vi.fn(async (_sessionId: SessionId, _options?: { stopActivity?: boolean }) => {})
  const fork = vi.spyOn(created.sessions, 'fork')
    .mockImplementation(options.fork ?? (async () => CHILD))
  const retained: SessionReference[] = []
  const originalRetain = created.sessions.retain.bind(created.sessions)
  const retain = vi.spyOn(created.sessions, 'retain').mockImplementation((target, options) => {
    const reference = originalRetain(target, options)
    retained.push(reference)
    return reference
  })
  const controller = new SelectionChatController({
    sessions: created.sessions,
    workspaces: { archiveSession },
    t: makeTranslate(zh),
  })
  return {
    controller, sessions: created.sessions, prompt, cancel, rename, archiveSession, fork, retain, retained,
  }
}

describe('quotePrompt', () => {
  it('quotes every selection line and keeps the question after a blank line', () => {
    expect(quotePrompt('a\nb', 'why?')).toBe('> a\n> b\n\nwhy?')
  })
})

describe('SelectionChatController', () => {
  it('forks at the last durable seq, prompts with the quote, and renames the child', async () => {
    const { controller, sessions, prompt, rename, retain } = await bench()
    const signal = new AbortController().signal
    const result = await controller.open({ sourceSessionId: SOURCE, selection: 'a\nb', question: 'why?' }, signal)

    expect(result).toMatchObject({ childId: CHILD, boundarySeq: 7, promptError: null })
    expect(prompt).toHaveBeenCalledWith(
      [{ type: 'text', text: '> a\n> b\n\nwhy?' }],
      'queue',
      signal,
    )
    expect(rename).toHaveBeenCalledWith('选区提问：why?')
    expect(retain).toHaveBeenCalledTimes(2)
    expect(sessions.retainInfo(SOURCE).getSnapshot().referenceCount).toBe(0)
    expect(sessions.retainInfo(CHILD).getSnapshot().referenceCount).toBe(1)
  })

  it('rejects a source with no durable events without forking', async () => {
    const { controller, fork, retain } = await bench({ events: [] })
    await expect(controller.open(
      { sourceSessionId: SOURCE, selection: 'x', question: 'why?' },
      new AbortController().signal,
    )).rejects.toMatchObject({ name: 'SelectionChatOpenError', code: 'no-events' })
    expect(fork).not.toHaveBeenCalled()
    expect(retain).toHaveBeenCalledTimes(1)
  })

  it('maps a fork failure to the open error', async () => {
    const { controller, fork } = await bench()
    fork.mockRejectedValue(new Error('fork failed'))
    await expect(controller.open(
      { sourceSessionId: SOURCE, selection: 'x', question: 'why?' },
      new AbortController().signal,
    )).rejects.toMatchObject({ name: 'SelectionChatOpenError', code: 'fork-failed' })
  })

  it('keeps the child open when the first prompt is rejected', async () => {
    const prompt = vi.fn<Prompt>(async () => ({
      ok: false,
      error: new RemoteError('gateway/internal', 'rejected', {}),
    }))
    const { controller, archiveSession } = await bench({ prompt })
    const result = await controller.open(
      { sourceSessionId: SOURCE, selection: 'x', question: 'why?' },
      new AbortController().signal,
    )
    expect(result.promptError).toEqual({ code: 'gateway/internal', message: 'rejected' })
    await controller.close()
    expect(archiveSession).toHaveBeenCalledWith(CHILD, { stopActivity: true })
  })

  it('cancels, archives, and releases the child on close', async () => {
    const { controller, cancel, archiveSession, retained } = await bench()
    await controller.open(
      { sourceSessionId: SOURCE, selection: 'x', question: 'why?' },
      new AbortController().signal,
    )
    const childReference = retained[1]
    if (childReference === undefined) throw new Error('test: missing child reference')
    const release = vi.spyOn(childReference, 'release')
    await controller.close()
    expect(cancel).toHaveBeenCalledOnce()
    expect(archiveSession).toHaveBeenCalledWith(CHILD, { stopActivity: true })
    expect(release).toHaveBeenCalledOnce()
  })

  it('keeps the popover session when archive fails, then releases on force', async () => {
    const { controller, archiveSession, retained } = await bench()
    await controller.open(
      { sourceSessionId: SOURCE, selection: 'x', question: 'why?' },
      new AbortController().signal,
    )
    const childReference = retained[1]
    if (childReference === undefined) throw new Error('test: missing child reference')
    const release = vi.spyOn(childReference, 'release')
    archiveSession.mockRejectedValueOnce(new Error('archive failed'))

    await expect(controller.close()).rejects.toBeInstanceOf(SelectionChatCloseError)
    expect(release).not.toHaveBeenCalled()
    archiveSession.mockResolvedValueOnce(undefined)
    await controller.close({ force: true })
    expect(release).toHaveBeenCalledOnce()
  })

  it('archives a child published after the caller aborted', async () => {
    let resolveFork: ((id: SessionId) => void) | undefined
    let markForkStarted: (() => void) | undefined
    const forkStarted = new Promise<void>((resolve) => { markForkStarted = resolve })
    const deferred = new Promise<SessionId>((resolve) => { resolveFork = resolve })
    const { controller, archiveSession } = await bench({
      fork: () => {
        markForkStarted?.()
        return deferred
      },
    })
    const abort = new AbortController()
    const pending = controller.open(
      { sourceSessionId: SOURCE, selection: 'x', question: 'why?' },
      abort.signal,
    )
    await forkStarted
    abort.abort()
    resolveFork?.(CHILD)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(archiveSession).toHaveBeenCalledWith(CHILD, { stopActivity: true })
  })
})
