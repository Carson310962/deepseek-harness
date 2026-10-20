---
description: "Selection-triggered side chat for the Web conversation: a floating action over assistant output, a compact side transcript, and a forked Session that is archived when the window closes."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-selection-chat

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-selection-chat` lets a reader select assistant output text and open a small side chat about it. The side chat inherits the source Session's history up to the moment of sending through an ordinary Session fork, then runs independently. The window shows only the side exchange; the inherited transcript stays out of view. Closing the window stops and archives the child Session, leaving the source Session untouched.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Select text inside an assistant message. A floating action appears beside the selection when both ends of the range sit in the Chat flow and at least one endpoint belongs to an assistant step. Controls, the composer, and the side-chat surface itself never offer the action.

Clicking the action opens a compact editor with the quoted selection and a question field. Nothing is created until Send: the plugin forks the source Session at its current durable tail, retains the child, sends one ordinary user message containing the quote and the question, and switches the window to the side transcript. Follow-up messages queue into the same child; Stop cancels its running turn.

The transcript renders only Chat nodes whose `anchorSeq` is above the fork boundary. Assistant text streams through the Chat target's existing block assembly, so the window needs no second stream parser. Tool calls appear as a compact tool-name line rather than full tool cards. A failed turn renders its error row instead of ending silently.

Closing the window cancels any running turn, archives the child Session with `stopActivity`, and releases the Client reference. The archived Session remains recoverable from the archived list; the source Session receives no event, title change, cancellation, or model change.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is a dual-face package. The Host half is an empty `apply()` so the package appears in the Loader; the browser half is discovered through `dsh.client` and `exports["./client"]`.

The overlay registers one `shell.overlay` list entry and declares a session-scoped child slot. The entry's component watches `selectionchange`, `pointerup`, and `keyup`, captures the range's text and viewport bounds, and reads the owning Session id from the existing `[data-conversation-session]` attribute. The popover binds the forked child through `SessionProvider` and renders the child slot; the panel therefore receives `useChat`, `useSession`, and `sessionId` as standard Session props without importing another feature package's values at runtime.

`SelectionChatController` owns the only live side chat. It briefly retains the source Session to read the last durable event seq, calls `ctx.sessions.fork({ atSeq })`, retains the child, sends the first prompt, and renames the child for the archived list. The overlay aborts an in-flight open on close; a child published after the abort is archived and released. Closing on plugin disposal is best-effort.

| File | Role |
|---|---|
| [`src/client/SelectionChatOverlay.tsx`](src/client/SelectionChatOverlay.tsx) | Frame action, editor state machine, popover chrome |
| [`src/client/SelectionChatPanel.tsx`](src/client/SelectionChatPanel.tsx) | Boundary-filtered transcript and composer |
| [`src/client/controller.ts`](src/client/controller.ts) | Fork, retain, prompt, cancel, archive |
| [`src/client/selection.ts`](src/client/selection.ts) | Assistant-selection capture and normalization |
| [`src/client/index.ts`](src/client/index.ts) | Locale, overlay registration, child slot registration |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-api-session-controller`](../../api/session-controller/README.md) — `ctx.sessions`, the fork Remote, and the Client Session faces used by the controller.
- [`dsh-api-workspace-controller`](../../api/workspace-controller/README.md) — the archive command that hides the side Session from default Workspace surfaces.
- [`dsh-client-ui-chat`](../ui-chat/README.md) — the Chat target whose assembled `AssistantChatData` backs the mini transcript.
- [`dsh-client-ui-conversation`](../ui-conversation/README.md) — the Session scope, `SessionProvider`, and the conversation shell the selection lives in.
- [`dsh-client-ui-primitives`](../ui-primitives/README.md) — `MarkdownText`, buttons, and icons used by the popover.

-----

<a id="model-experience"></a>
## Model Experience

### Selection side-chat prompt

#### What the model sees

The side chat's first message is an ordinary `user/message` in the child Session: a Markdown blockquote of the selection followed by the question. Follow-ups are ordinary user messages in the same child. The model sees the inherited history through the fork seed and never sees the source Session's later messages.

#### Token effect

Additive: the quote and question add tokens to the child Session's first request; inherited history contributes the same prompt tokens it contributed in the source Session.

#### KV Cache effect

Append-only within the child Session. The source Session's request history and cache are unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define current package behavior, not a task backlog.

- **The fork is a snapshot** — messages added to the source Session after the fork are not visible to the side chat.
- **The model may differ from the source** — the Host fork selects the current default model, not necessarily the model last used by the source Session.
- **Tools are summarized** — the window shows tool names and running state, not full tool result cards.
- **Archive is not deletion** — the child Session remains in the archived list and on disk, consistent with the append-only Session format.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
