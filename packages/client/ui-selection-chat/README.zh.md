---
description: "Web 对话的选区旁路对话：在 assistant 输出旁提供浮动入口、紧凑的旁路记录，以及关闭时自动归档的 fork 会话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-selection-chat

[English](README.md) | 中文

## 摘要

`dsh-client-ui-selection-chat` 让用户在 assistant 输出中选中文字后打开一个针对该内容的小窗口。发送时通过普通的 Session fork 继承源会话截至当时的历史，随后独立运行。小窗口只显示旁路对话，不显示继承的历史；关闭时停止并归档子会话，源会话完全不受影响。

## 目录

- [使用这个包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
<a id="use-this-package"></a>
## 使用这个包

在 assistant 消息中选中文字。当选区两端都在 Chat flow 内，且至少一端属于 assistant step 时，选区旁会出现浮动入口。输入框、按钮和旁路窗口自身不会触发该入口。

点击入口后打开一个紧凑的编辑窗口，显示引用文字和问题输入框。发送之前不会创建任何会话：插件在源会话当前 durable 末尾 fork 子会话，保留子会话，发送一条包含引用块和问题的普通用户消息，然后切换到旁路记录。后续消息进入同一个子会话；Stop 取消正在运行的 turn。

旁路记录只渲染 `anchorSeq` 大于 fork 边界的 Chat 节点。assistant 文本通过 Chat target 已有的 block 汇总流式更新，不需要第二套 stream 解析。工具调用只显示工具名/状态，不渲染完整工具卡片；失败的 turn 显示错误行，不会静默结束。

关闭窗口时取消运行中的 turn，使用 `stopActivity` 归档子会话，并释放 Client 引用。归档的会话可以从“已归档”列表找回；源会话不会收到任何事件、标题修改、取消或模型变更。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

这是一个双面包。Host 半边是空的 `apply()`，让包出现在 Loader 中；浏览器半边通过 `dsh.client` 和 `exports["./client"]` 被发现。

浮层注册一个 `shell.overlay` 列表条目，并声明一个 session-scoped 子 slot。条目组件监听 `selectionchange`、`pointerup` 和 `keyup`，捕获选区的文字与视口坐标，并从现有的 `[data-conversation-session]` 属性读取所属 Session id。弹窗通过 `SessionProvider` 绑定 fork 出的子会话并渲染子 slot；因此面板通过标准 Session props 获得 `useChat`、`useSession` 和 `sessionId`，不需要在运行时导入其他 feature 包的值。

`SelectionChatController` 持有唯一的活动旁路对话。它短暂保留源会话以读取最后一个 durable 事件 seq，调用 `ctx.sessions.fork({ atSeq })`，保留子会话，发送第一条 prompt，并为归档列表重命名子会话。关闭时浮层会中止进行中的 open；中止后才发布的子会话会被归档并释放。插件卸载时的关闭是 best-effort。

| 文件 | 作用 |
|---|---|
| [`src/client/SelectionChatOverlay.tsx`](src/client/SelectionChatOverlay.tsx) | 浮动入口、编辑状态机、弹窗外壳 |
| [`src/client/SelectionChatPanel.tsx`](src/client/SelectionChatPanel.tsx) | 按边界过滤的记录与输入区 |
| [`src/client/controller.ts`](src/client/controller.ts) | fork、retain、prompt、cancel、archive |
| [`src/client/selection.ts`](src/client/selection.ts) | assistant 选区捕获与规范化 |
| [`src/client/index.ts`](src/client/index.ts) | locale、浮层注册、子 slot 注册 |

</details>

-----

<a id="further-exploration"></a>
<a id="further-exploration"></a>
## 进一步探索

- [`dsh-api-session-controller`](../../api/session-controller/README.zh.md) — `ctx.sessions`、fork Remote，以及控制器使用的 Client Session face。
- [`dsh-api-workspace-controller`](../../api/workspace-controller/README.zh.md) — 把旁路会话从默认 Workspace 界面隐藏的归档命令。
- [`dsh-client-ui-chat`](../ui-chat/README.zh.md) — 为小窗口记录提供 `AssistantChatData` 的 Chat target。
- [`dsh-client-ui-conversation`](../ui-conversation/README.zh.md) — 选区所在的会话外壳、Session scope 与 `SessionProvider`。
- [`dsh-client-ui-primitives`](../ui-primitives/README.zh.md) — 弹窗使用的 `MarkdownText`、按钮和图标。

-----

<a id="model-experience"></a>
<a id="model-experience"></a>
## 模型体验

### 选区旁路对话的 prompt

#### 模型看到什么

旁路对话的第一条消息是子会话中的普通 `user/message`：选区的 Markdown 引用块加问题。后续消息也是同一子会话中的普通用户消息。模型通过 fork seed 看到继承的历史，但看不到源会话在 fork 之后新增的消息。

#### Token 影响

追加式：引用和问题为子会话的第一次请求增加 token；继承的历史贡献与它在源会话中相同的 prompt token。

#### KV Cache 影响

在子会话内是追加式的。源会话的请求历史和缓存不受影响。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

这些限制描述当前包的行为，不是任务清单。

- **fork 是快照** — fork 之后源会话新增的消息对旁路对话不可见。
- **模型可能不同** — Host 的 fork 使用当前默认模型，不一定等于源会话最后使用的模型。
- **工具只做摘要** — 小窗口显示工具名和运行状态，不显示完整工具结果卡片。
- **归档不是删除** — 子会话仍会出现在已归档列表和磁盘上，符合 append-only 的会话格式。

<a id="dev-note"></a>
<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

None.

</details>
