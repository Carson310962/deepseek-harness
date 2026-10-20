/**
 * Selection side chat, browser half: one frame-overlay entry hosts the
 * floating action and popover, and one session-scoped child entry renders the
 * side transcript. The side session is an ordinary Session fork; this plugin
 * never mutates the source Session.
 *
 * @module @deepseek-ai/dsh-client-ui-selection-chat/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ctx.locale and the LocaleNamespaceMap merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ctx.sessions and SessionReferenceSourceMap.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls ctx.workspaces.
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls ctx.slots and the SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: contributes shell.overlay and the frame slot declarations.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: contributes useChat to SessionStandardProps.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: contributes useSession/useProjection and SessionProvider.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { SelectionChatController } from './controller.ts'
import { SelectionChatOverlay, type SelectionChatOverlayInjected } from './SelectionChatOverlay.tsx'
import { SelectionChatPanel } from './SelectionChatPanel.tsx'
import { en, NS, zh } from './locales.ts'

export type { SelectionChatOpenRequest, SelectionChatOpenResult } from './controller.ts'
export type { SelectionChatOverlayInjected } from './SelectionChatOverlay.tsx'
export type { SelectionChatPanelOwnerProps } from './SelectionChatPanel.tsx'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** The active selection side chat's retained child generation. */
    selectionChat: unknown
  }
}

/** Required services: locale copy, the slot registry, and the two Session-backed domains. */
export const inject = ['locale', 'slots', 'sessions', 'workspaces']

/**
 * Register the dictionaries, the frame overlay, and its session-scoped panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-selection-chat: dictionaries')
  const controller = new SelectionChatController({
    sessions: ctx.sessions,
    workspaces: ctx.workspaces,
    t: (key, params) => ctx.locale.bind(NS)(key, params),
  })
  ctx.effect(() => () => { controller.dispose() }, 'ui-selection-chat: active side chat')

  ctx.slots.inject('shell.overlay', function* () {
    yield ctx.slots.register({
      name: 'shell.overlay',
      id: 'selection-chat',
      order: 200,
      locale: NS,
      children: {
        'selection.chat.panel': { kind: 'single', scope: 'session' },
      },
      inject: (): SelectionChatOverlayInjected => ({
        open: (request, signal) => controller.open(request, signal),
        send: text => controller.send(text),
        stop: () => controller.stop(),
        close: options => controller.close(options),
      }),
    }, SelectionChatOverlay)
    yield ctx.slots.register({
      name: 'selection.chat.panel',
      locale: NS,
    }, SelectionChatPanel)
  })
}
