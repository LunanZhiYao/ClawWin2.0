import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { ChatMessage, ChatToolCall, TaskStatus } from '../../types'
import logoSrc from '../../../assets/logo.png'

function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp)
  const y = date.getFullYear()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  const h = date.getHours().toString().padStart(2, '0')
  const min = date.getMinutes().toString().padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}`
}

function isImageFile(mimeType?: string, fileName?: string): boolean {
  if (mimeType && mimeType.startsWith('image/')) return true
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)
  }
  return false
}

function filePathToUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const encoded = normalized.split('/').map((seg) => encodeURIComponent(seg)).join('/')
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encoded.replace('%3A', ':')}`
  }
  return `file://${encoded}`
}

function stripLegacyTag(line: string): string {
  return line.replace(/^\[(THINK|TOOL|CTX|OK|ERROR)\]\s*/i, '').trim()
}

function normalizeThinkingText(thinking?: string, keepLegacyToolLines = false): string {
  if (!thinking) return ''
  return thinking
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => keepLegacyToolLines || !/^\[(TOOL|OK|ERROR)\]/i.test(line))
    .map(stripLegacyTag)
    .join('\n')
    .trim()
}

function parseLegacyThinking(thinking?: string): { reasoning: string; toolCalls: ChatToolCall[] } {
  if (!thinking) return { reasoning: '', toolCalls: [] }

  const reasoningLines: string[] = []
  const toolCalls: ChatToolCall[] = []
  let pendingTool: ChatToolCall | null = null

  for (const [index, rawLine] of thinking.split('\n').entries()) {
    const line = rawLine.trim()
    if (!line) continue

    if (/^\[TOOL\]/i.test(line)) {
      const cleanLine = stripLegacyTag(line)
      const match = cleanLine.match(/(?:调用工具|tool)\s+([^\s(:：]+)/i)
      pendingTool = {
        id: `legacy-tool-${index}`,
        name: match?.[1] || '工具',
        status: 'running',
        summary: cleanLine,
        kind: /bash|shell|powershell|terminal|cmd/i.test(match?.[1] || '') ? 'terminal' : 'default',
      }
      toolCalls.push(pendingTool)
      continue
    }

    if (/^\[(OK|ERROR)\]/i.test(line) && /工具|tool/i.test(line)) {
      const cleanLine = stripLegacyTag(line)
      const target = pendingTool || toolCalls[toolCalls.length - 1]
      if (target) {
        const isError = /^\[ERROR\]/i.test(line)
        target.status = isError ? 'error' : 'done'
        target.isError = isError
        target.output = cleanLine
      }
      pendingTool = null
      continue
    }

    reasoningLines.push(stripLegacyTag(line))
  }

  return {
    reasoning: reasoningLines.join('\n').trim(),
    toolCalls,
  }
}

interface ContentSegment {
  type: 'text' | 'image'
  value: string
}

function parseContentWithImages(content: string): ContentSegment[] {
  const imgExts = 'jpg|jpeg|png|gif|webp|bmp'
  const pattern = new RegExp(
    '\\[screenshot:\\s*([^\\]]+\\.(?:' + imgExts + '))\\s*\\]'
    + '|`([A-Za-z]:\\\\[^`]+\\.(?:' + imgExts + '))`'
    + '|`(/[^`]+\\.(?:' + imgExts + '))`'
    + '|(?<![`\\w])([A-Za-z]:\\\\[^\\s"\'<>]+\\.(?:' + imgExts + '))(?![`\\w])',
    'gi'
  )

  const segments: ContentSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    const filePath = (match[1] || match[2] || match[3] || match[4]).trim()
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'image', value: filePath })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) })
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', value: content })
  }

  return segments
}

function CodeBlock({ className, children }: { className?: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const lang = className?.replace('hljs language-', '')?.replace('language-', '') || ''
  const code = String(children).replace(/\n$/, '')

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [code])

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        {lang && <span className="code-block-lang">{lang}</span>}
        <button className="code-block-copy" onClick={handleCopy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre><code className={className}>{children}</code></pre>
    </div>
  )
}

const markdownComponents = {
  code({ className, children }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) {
    const isBlock = className?.includes('language-') || className?.includes('hljs')
    if (isBlock) {
      return <CodeBlock className={className}>{children}</CodeBlock>
    }
    return <code className="inline-code">{children}</code>
  },
  a({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) {
    const isLocalFile = typeof href === 'string' && (/^[A-Za-z]:\\/.test(href) || href.startsWith('/'))
    if (isLocalFile) {
      return (
        <a
          href={href}
          {...props}
          onClick={(event) => {
            event.preventDefault()
            window.electronAPI?.shell?.openPath?.(href)
          }}
        >
          {children}
        </a>
      )
    }
    return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>
  },
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`message-chevron${open ? ' is-open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function ReasoningBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [isExpanded, setIsExpanded] = useState(isStreaming)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIsExpanded(isStreaming)
  }, [isStreaming])

  // 动态计算展开高度
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    if (isExpanded) {
      el.style.maxHeight = el.scrollHeight + 'px'
      el.style.opacity = '1'
    } else {
      el.style.maxHeight = '0'
      el.style.opacity = '0'
    }
  }, [isExpanded, content])

  if (!content.trim()) return null

  return (
    <div className="message-reasoning-card">
      <button className="message-reasoning-header" onClick={() => setIsExpanded((value) => !value)}>
        <div className="message-reasoning-title-wrap">
          <ChevronIcon open={isExpanded} />
          <span className="message-reasoning-title">思考过程</span>
          {isStreaming && <span className="message-reasoning-live-dot" />}
        </div>
      </button>
      <div ref={bodyRef} className={`message-reasoning-body${isExpanded ? ' is-expanded' : ''}`}>
        <div className="message-reasoning-content">{content}</div>
      </div>
    </div>
  )
}

function truncateText(text: string, maxLen = 80): string {
  if (!text) return ''
  const oneLine = text.replace(/\n/g, ' ').trim()
  return oneLine.length > maxLen ? oneLine.slice(0, maxLen) + '...' : oneLine
}

function ToolCallBlock({ toolCall }: { toolCall: ChatToolCall }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasOutput = Boolean(toolCall.output?.trim())
  const hasInput = Boolean(toolCall.input?.trim())
  const hasLongContent = (toolCall.input && toolCall.input.length > 80) || (toolCall.output && toolCall.output.length > 80)

  const statusText = toolCall.status === 'running' ? '运行中' : toolCall.status === 'error' ? '失败' : '完成'

  return (
    <div className={`message-tool-item status-${toolCall.status}`}>
      <div className="message-tool-header">
        <span className={`message-tool-dot status-${toolCall.status}`} />
        <span className="message-tool-name">{toolCall.name}</span>
        {toolCall.summary && <code className="message-tool-summary">{toolCall.summary}</code>}
        <span className="message-tool-status">{statusText}</span>
      </div>

      <div className="message-tool-subtree">
        <div className="message-tool-tree-line" />
        {hasInput && (
          <div className="message-tool-sub-item">
            <span className="message-tool-sub-label">·</span>
            <span className="message-tool-sub-value">输入: {truncateText(toolCall.input!)}</span>
            {toolCall.input!.length > 80 && (
              <span className="message-tool-detail-toggle" onClick={() => setIsExpanded(!isExpanded)}>
                {' >'}
              </span>
            )}
          </div>
        )}
        {hasOutput && (
          <div className="message-tool-sub-item">
            <span className="message-tool-sub-label">·</span>
            <span className="message-tool-sub-value">输出: {truncateText(toolCall.output!)}</span>
            {toolCall.output!.length > 80 && (
              <span className="message-tool-detail-toggle" onClick={() => setIsExpanded(!isExpanded)}>
                {' >'}
              </span>
            )}
          </div>
        )}
        {!hasOutput && toolCall.status === 'running' && (
          <div className="message-tool-sub-item">
            <span className="message-tool-sub-label">·</span>
            <span className="message-tool-sub-value">输出: 等待结果…</span>
          </div>
        )}
        {hasLongContent && !isExpanded && (
          <div className="message-tool-sub-item">
            <span className="message-tool-sub-label">·</span>
            <span className="message-tool-detail-toggle" onClick={() => setIsExpanded(true)}>
              详情 ▸
            </span>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="message-tool-body">
          {hasInput && (
            <div className="message-tool-section">
              <div className="message-tool-label">输入</div>
              <pre className="message-tool-pre">{toolCall.input}</pre>
            </div>
          )}
          {hasOutput && (
            <div className="message-tool-section">
              <div className="message-tool-label">输出</div>
              <pre className={`message-tool-pre${toolCall.isError ? ' is-error' : ''}`}>{toolCall.output}</pre>
            </div>
          )}
          {!hasOutput && toolCall.status === 'running' && (
            <div className="message-tool-section">
              <div className="message-tool-label">输出</div>
              <pre className="message-tool-pre">等待结果…</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 任务状态图标组件
const TaskStatusIcon: React.FC<{ status: TaskStatus }> = ({ status }) => {
  if (status === 'completed') {
    return (
      <svg className="task-status-icon task-status-icon-success" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    )
  }
  if (status === 'failed') {
    return (
      <svg className="task-status-icon task-status-icon-error" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    )
  }
  if (status === 'interrupted' || status === 'user_aborted') {
    return (
      <svg className="task-status-icon task-status-icon-warning" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    )
  }
  return null
}

// 任务状态提示组件
const TaskStatusHint: React.FC<{ taskStatus?: TaskStatus; showWithContent?: boolean }> = ({ taskStatus, showWithContent }) => {
  const statusTextMap: Record<TaskStatus, string> = {
    starting: '让我想想',
    calling_tool: '正在调用工具',
    executing: '执行指令中',
    using_skill: '让我来使用技能',
    waiting: '处理中，请稍候',
    waiting_input: '等待输入',
    running: '运行中',
    pending: '等待中',
    queued: '排队中',
    compacting: '正在压缩上下文',
    completed: '任务已完成',
    retrying: '遇到点小问题，正在重试',
    interrupted: '信息流异常，已暂停任务',
    failed: '执行失败了，要不要重试一下？',
    user_aborted: '任务已手动中断',
  }

  const finalStatuses: TaskStatus[] = ['completed', 'failed', 'interrupted', 'user_aborted']
  const isFinalStatus = taskStatus ? finalStatuses.includes(taskStatus) : false

  // 当 showWithContent 为 true 时，始终渲染（用于最终状态）
  // 否则仅在非最终状态时渲染
  if (!showWithContent && !isFinalStatus) {
    return (
      <div className="message-tool-waiting-hint hint-active">
        <span className="hint-text">{taskStatus ? statusTextMap[taskStatus] : '等待执行结果'}</span>
      </div>
    )
  }

  if (isFinalStatus && taskStatus) {
    return (
      <div className="message-tool-waiting-hint hint-final">
        <TaskStatusIcon status={taskStatus} />
        <span>{statusTextMap[taskStatus]}</span>
      </div>
    )
  }

  return null
}

const TaskStatusSummary: React.FC<{ toolCalls: ChatToolCall[]; taskStatus?: TaskStatus; onExpandedChange?: (expanded: boolean) => void; expanded?: boolean }> = ({ toolCalls, taskStatus, onExpandedChange, expanded }) => {
  const [internalExpanded, setInternalExpanded] = useState(false)
  const isExpanded = expanded !== undefined ? expanded : internalExpanded
  const setIsExpanded = onExpandedChange || setInternalExpanded

  if (toolCalls.length === 0 && !taskStatus) return null

  const latestToolCall = toolCalls[toolCalls.length - 1]
  const statusText = latestToolCall
    ? `${latestToolCall.name} ${latestToolCall.status === 'done' ? '已完成' : latestToolCall.status === 'running' ? '运行中' : latestToolCall.status === 'error' ? '执行失败' : '等待中'}`
    : taskStatus
      ? taskStatus === 'completed' ? '任务已完成'
        : taskStatus === 'running' ? '运行中'
        : taskStatus === 'failed' ? '执行失败'
        : taskStatus === 'compacting' ? '压缩上下文'
        : '处理中'
      : ''

  const statusClass = latestToolCall
    ? `status-${latestToolCall.status}`
    : taskStatus
      ? `status-${taskStatus}`
      : ''

  return (
    <button className={`task-status-summary-header ${statusClass}`} onClick={() => setIsExpanded(!isExpanded)}>
      <span className={`task-status-dot ${statusClass}`} />
      <span className="task-status-text">{statusText}</span>
      <ChevronIcon open={isExpanded} />
    </button>
  )
}

const TaskStatusExpanded: React.FC<{ toolCalls: ChatToolCall[] }> = ({ toolCalls }) => {
  if (toolCalls.length === 0) return null
  return (
    <div className="task-status-expanded">
      <div className="task-status-expanded-content">
        {toolCalls.map((toolCall) => (
          <ToolCallBlock
            key={toolCall.id}
            toolCall={toolCall}
          />
        ))}
      </div>
    </div>
  )
}

interface MessageBubbleProps {
  message: ChatMessage
  onCopy?: () => void
  onRetry?: () => void
  currentAgentId?: string
}

const GREEK_LETTERS = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω']
const SUB_AGENT_EMOJIS = ['🤖', '🔧', '🔍', '📊', '🎯', '💡', '🧪', '⚙️', '🛠️', '📡', '🔬', '📝', '🎪', '🏗️', '🧩', '🔑', '📈', '🧠', '💎', '🌟', '🚀', '🔮', '🎲', '⚡']

const subAgentIndexMap = new Map<string, number>()
let nextSubAgentIndex = 0

function getSubAgentInfo(agentId: string): { name: string; emoji: string } {
  let index = subAgentIndexMap.get(agentId)
  if (index === undefined) {
    index = nextSubAgentIndex++
    subAgentIndexMap.set(agentId, index)
  }
  const letter = GREEK_LETTERS[index % GREEK_LETTERS.length]
  const emoji = SUB_AGENT_EMOJIS[index % SUB_AGENT_EMOJIS.length]
  return { name: `子代理-${letter}`, emoji }
}

function isSubAgent(agentId: string | undefined, currentAgentId: string | undefined): boolean {
  if (!agentId) return false
  if (agentId === 'main') return false
  if (agentId === currentAgentId) return false
  return true
}

const MessageBubbleInner: React.FC<MessageBubbleProps> = ({ message, onCopy, onRetry, currentAgentId }) => {
  const isUser = message.role === 'user'
  const isQueued = message.status === 'queued'
  const isStreaming = message.status === 'streaming'
  const isError = message.status === 'error'
  const messageIsSubAgent = isSubAgent(message.agentId, currentAgentId)
  const subAgentInfo = messageIsSubAgent ? getSubAgentInfo(message.agentId!) : null

  const wasStreamingRef = useRef(false)
  const [justFinished, setJustFinished] = useState(false)
  const [taskStatusExpanded, setTaskStatusExpanded] = useState(false)

  // 流式结束时触发 markdown 淡入动画
  useEffect(() => {
    if (!isStreaming && wasStreamingRef.current && message.content) {
      setJustFinished(true)
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming, message.content])

  const handleFileClick = useCallback((filePath: string) => {
    window.electronAPI?.shell?.openPath?.(filePath)
  }, [])

  const attachments = message.attachments
  const hasAttachments = attachments && attachments.length > 0
  const legacySections = useMemo(() => parseLegacyThinking(message.thinking), [message.thinking])
  const reasoningText = !isUser
    ? (message.toolCalls?.length ? normalizeThinkingText(message.thinking) : (legacySections.reasoning || normalizeThinkingText(message.thinking, true)))
    : ''
  const toolCalls = !isUser
    ? (message.toolCalls?.length ? message.toolCalls : legacySections.toolCalls)
    : []
  const displayContent = message.content
  const hasInlineImages = !isUser && !isStreaming && displayContent
    ? parseContentWithImages(displayContent).some((segment) => segment.type === 'image')
    : false

  return (
    <div className={`message-row ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && (
        <div className={`message-avatar ${messageIsSubAgent ? 'sub-agent' : 'ai'}`}>
          {messageIsSubAgent ? (
            <span className="message-avatar-emoji">{subAgentInfo!.emoji}</span>
          ) : (
            <img src={logoSrc} alt="AI" className="message-avatar-img" />
          )}
        </div>
      )}
      <div className={`message-column${isUser ? ' user-message' : ''}`}>
        <div className="message-header">
          {!isUser && <span className="message-nickname">{messageIsSubAgent ? subAgentInfo!.name : '千易'}</span>}
          {!isUser && (toolCalls.length > 0 || message.taskStatus) && (
            <TaskStatusSummary
              toolCalls={toolCalls}
              taskStatus={message.taskStatus}
              expanded={taskStatusExpanded}
              onExpandedChange={setTaskStatusExpanded}
            />
          )}
        </div>
        {taskStatusExpanded && toolCalls.length > 0 && (
          <TaskStatusExpanded toolCalls={toolCalls} />
        )}
        <div className={`message-bubble ${isUser ? 'message-user' : 'message-assistant'} ${isStreaming ? 'message-bubble-streaming' : ''} ${isError ? 'message-error-bubble' : ''} ${isQueued ? 'message-queued' : ''}`}>
          <div className="message-body">
        {/* Phase 1: 思考块 — 独立卡片 (LobsterAI 风格) */}
        {!isUser && reasoningText && (
          <ReasoningBlock content={reasoningText} isStreaming={isStreaming} />
        )}

        {/* Phase 3: 文本内容 / 任务状态主内容展示 */}
        {!isUser && isStreaming && !displayContent && !reasoningText && (
          message.taskStatus && !['completed', 'failed', 'interrupted', 'user_aborted'].includes(message.taskStatus) ? (
            <div className="message-content message-content-assistant">
              <TaskStatusHint taskStatus={message.taskStatus} showWithContent={false} />
            </div>
          ) : !message.taskStatus ? (
            <div className="message-content message-content-assistant">
              <div className="typing-dots">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          ) : null
        )}
        {/* 最终状态：无论是否有内容都显示 */}
        {!isUser && ['completed', 'failed', 'interrupted', 'user_aborted'].includes(message.taskStatus || '') && (
          <TaskStatusHint taskStatus={message.taskStatus} showWithContent={true} />
        )}
        {(displayContent || hasAttachments) && (
          <div className={`message-content ${isError ? 'message-error-content' : ''}${hasAttachments ? ' has-attachments' : ''}${!isUser ? ' message-content-assistant' : ''}`}>
            {hasAttachments && (
              <div className={`message-attachments${attachments.length > 1 ? ' multi' : ''}`}>
                {attachments.filter((attachment) => attachment.filePath).map((attachment, index) => {
                  const image = isImageFile(attachment.mimeType, attachment.fileName)

                  if (image) {
                    const imgSrc = attachment.content && attachment.mimeType
                      ? `data:${attachment.mimeType};base64,${attachment.content}`
                      : attachment.content
                        ? `data:image/png;base64,${attachment.content}`
                        : filePathToUrl(attachment.filePath)
                    return (
                      <img
                        key={index}
                        src={imgSrc}
                        alt={attachment.fileName || 'image'}
                        className="message-attachment-img"
                        onClick={() => handleFileClick(attachment.filePath)}
                      />
                    )
                  }

                  return (
                    <div
                      key={index}
                      className="message-attachment-file"
                      onClick={() => handleFileClick(attachment.filePath)}
                      title={attachment.filePath}
                    >
                      <svg className="message-file-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span className="message-file-name">{attachment.fileName || attachment.filePath.split(/[\\/]/).pop()}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {displayContent && (
              <div className="message-text">
                {isUser ? (
                  <div className="message-user-text">{displayContent || ''}</div>
                ) : (
                  hasInlineImages && !isStreaming ? (
                    parseContentWithImages(displayContent).map((segment, index) => {
                      if (segment.type === 'image') {
                        return (
                          <img
                            key={`inline-img-${index}`}
                            src={filePathToUrl(segment.value)}
                            alt="screenshot"
                            className="message-inline-screenshot"
                            onClick={() => handleFileClick(segment.value)}
                          />
                        )
                      }
                      return (
                        <div key={`md-${index}`} className="chat-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
                            {segment.value}
                          </ReactMarkdown>
                        </div>
                      )
                    })
                  ) : (
                    <div className={`chat-markdown${justFinished ? ' markdown-fade-in' : ''}${isStreaming ? ' is-streaming' : ''}`} onAnimationEnd={() => setJustFinished(false)}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
                        {displayContent}
                      </ReactMarkdown>
                      {isStreaming && <span className="streaming-cursor" />}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {isQueued && <div className="message-queued-hint">排队中，等待当前回复结束</div>}
        {isError && (
          <div className="message-error">
            发送失败
            {onRetry && <button className="btn-retry" onClick={onRetry}>重试</button>}
          </div>
        )}
        <div className="message-hover-actions">
          <span className="message-time">{formatMessageTime(message.timestamp)}</span>
          {!isUser && message.status === 'done' && onCopy && (
            <button className="btn-action" onClick={onCopy} title="复制">
              复制
            </button>
          )}
          {isUser && onRetry && (
            <button className="btn-action" onClick={onRetry} title="重发">
              重发
            </button>
          )}
        </div>
      </div>
      </div>
      </div>
    </div>
  )
}

function toolCallsEqual(a?: ChatToolCall[], b?: ChatToolCall[]): boolean {
  if (a === b) return true
  if ((a?.length || 0) !== (b?.length || 0)) return false
  return (a || []).every((call, index) => {
    const other = b?.[index]
    return !!other
      && call.id === other.id
      && call.name === other.name
      && call.status === other.status
      && call.summary === other.summary
      && call.input === other.input
      && call.output === other.output
      && call.kind === other.kind
      && call.isError === other.isError
  })
}

export const MessageBubble = React.memo(MessageBubbleInner, (prev, next) =>
  prev.message.id === next.message.id
  && prev.message.content === next.message.content
  && prev.message.status === next.message.status
  && prev.message.thinking === next.message.thinking
  && prev.message.taskStatus === next.message.taskStatus
  && prev.onCopy === next.onCopy
  && prev.onRetry === next.onRetry
  && prev.message.agentId === next.message.agentId
  && prev.currentAgentId === next.currentAgentId
  && toolCallsEqual(prev.message.toolCalls, next.message.toolCalls)
)