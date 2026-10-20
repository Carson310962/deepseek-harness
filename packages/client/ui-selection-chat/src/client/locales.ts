/** `selectionChat` dictionaries for the selection-triggered side chat. */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'selectionChat'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.label': '针对选中内容提问',
  'dialog.title': '选区对话',
  'dialog.close': '关闭',
  'dialog.quoteLabel': '选中的内容',
  'dialog.placeholder': '针对选中的内容提问…',
  'dialog.send': '发送',
  'dialog.stop': '停止',
  'dialog.thinking': '思考中…',
  'dialog.usingTools': '正在使用工具：{tools}',
  'dialog.usedTools': '使用了工具：{tools}',
  'dialog.stopped': '已停止',
  'dialog.noText': '没有可显示的文本回复。',
  'dialog.starting': '正在创建旁路对话…',
  'dialog.noEvents': '当前会话还没有可继承的内容。',
  'dialog.error': '请求失败：{message}（{code}）',
  'dialog.closeFailed': '旁路会话归档失败：{message}',
  'dialog.retry': '重试',
  'dialog.retryClose': '重试关闭',
  'dialog.closeAnyway': '仍然关闭',
  'dialog.scrollToBottom': '回到底部',
  'title': '选区提问：{preview}',
  'markdown.copy': '复制',
  'markdown.copied': '已复制',
  'markdown.code': '代码',
  'markdown.wrap': '自动换行',
  'markdown.unwrap': '取消自动换行',
  'markdown.footnotes': '脚注',
} satisfies Record<string, string>

/** The selectionChat namespace key union. */
export type SelectionChatKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Selection side-chat surface copy. */
    selectionChat: SelectionChatKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.label': 'Ask about selection',
  'dialog.title': 'Selection chat',
  'dialog.close': 'Close',
  'dialog.quoteLabel': 'Selected text',
  'dialog.placeholder': 'Ask about the selected text…',
  'dialog.send': 'Send',
  'dialog.stop': 'Stop',
  'dialog.thinking': 'Thinking…',
  'dialog.usingTools': 'Using tools: {tools}',
  'dialog.usedTools': 'Used tools: {tools}',
  'dialog.stopped': 'Stopped',
  'dialog.noText': 'No text response to show.',
  'dialog.starting': 'Starting side chat…',
  'dialog.noEvents': 'This session has no content to inherit yet.',
  'dialog.error': 'Request failed: {message} ({code})',
  'dialog.closeFailed': 'Could not archive the side chat: {message}',
  'dialog.retry': 'Retry',
  'dialog.retryClose': 'Retry close',
  'dialog.closeAnyway': 'Close anyway',
  'dialog.scrollToBottom': 'Back to bottom',
  'title': 'Selection: {preview}',
  'markdown.copy': 'Copy',
  'markdown.copied': 'Copied',
  'markdown.code': 'Code',
  'markdown.wrap': 'Wrap lines',
  'markdown.unwrap': 'Do not wrap lines',
  'markdown.footnotes': 'Footnotes',
} satisfies Record<SelectionChatKey, string>
