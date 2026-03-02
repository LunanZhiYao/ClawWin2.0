import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { ChatMessage } from '../../types'

function isImageFile(mimeType?: string, fileName?: string): boolean {
  if (mimeType && mimeType.startsWith('image/')) return true
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)
  }
  return false
}

/** Convert a local file path to a file:// URL (handles Windows backslashes, CJK, spaces, special chars) */
function filePathToUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  // Encode each path segment to handle spaces, CJK, #, % etc.
  const encoded = normalized.split('/').map((seg) => encodeURIComponent(seg)).join('/')
  // Ensure triple-slash for absolute paths: file:///C%3A/...  →  need colon unescaped for drive letter
  if (/^[a-zA-Z]:\//.test(normalized)) {
    // Re-insert the colon for the drive letter (encodeURIComponent escapes it to %3A)
    return `file:///${encoded.replace('%3A', ':')}`
  }
  return `file://${encoded}`
}

interface ContentSegment {
  type: 'text' | 'image'
  value: string
}

/**
 * Parse message content for embedded screenshot/image references.
 * Detects multiple formats:
 *   1. [screenshot: C:\path\to\file.jpg]
 *   2. `C:\path\to\file.png` (backtick-wrapped)
 *   3. Bare Windows paths like C:\...\file.jpg
 *   4. Bare Unix paths like /tmp/.../file.png
 */
function parseContentWithImages(content: string): ContentSegment[] {
  const imgExts = 'jpg|jpeg|png|gif|webp|bmp'
  // Match: [screenshot: path], `path`, or bare Windows/Unix image paths
  const pattern = new RegExp(
    '\\[screenshot:\\s*([^\\]]+\\.(?:' + imgExts + '))\\s*\\]' +
    '|`([A-Za-z]:\\\\[^`]+\\.(?:' + imgExts + '))`' +
    '|`(/[^`]+\\.(?:' + imgExts + '))`' +
    '|(?<![`\\w])([A-Za-z]:\\\\[^\\s"\'<>]+\\.(?:' + imgExts + '))(?![`\\w])',
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

/** Code block with copy button and language label */
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

/** Markdown components override */
const markdownComponents = {
  // Code: distinguish inline vs block
  code({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) {
    const isBlock = className?.includes('language-') || className?.includes('hljs')
    if (isBlock) {
      return <CodeBlock className={className}>{children}</CodeBlock>
    }
    return <code className="inline-code" {...props}>{children}</code>
  },
  // Wrap pre to avoid double-nesting when CodeBlock already renders <pre>
  pre({ children }: React.ComponentPropsWithoutRef<'pre'>) {
    // If child is already a CodeBlock (has code-block-wrapper), pass through
    const child = React.Children.only(children) as React.ReactElement<{ className?: string }>
    if (child?.props?.className?.includes('language-') || child?.props?.className?.includes('hljs')) {
      // CodeBlock handles its own <pre>, just return children
      return <>{children}</>
    }
    return <pre>{children}</pre>
  },
  // Links open externally
  a({ href, children }: React.ComponentPropsWithoutRef<'a'>) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault()
          if (href) window.electronAPI?.shell?.openExternal?.(href)
        }}
        className="chat-link"
      >
        {children}
      </a>
    )
  },
}

interface MessageBubbleProps {
  message: ChatMessage
  onCopy?: () => void
  onRetry?: () => void
}

const MessageBubbleInner: React.FC<MessageBubbleProps> = ({ message, onCopy, onRetry }) => {
  const isUser = message.role === 'user'
  const isQueued = message.status === 'queued'
  const isStreaming = message.status === 'streaming'
  const isError = message.status === 'error'

  // 流式打字机效果：单次 rAF 循环 + 直接 DOM 操作，匀速逐字显示
  const previewRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef('')
  const visibleLenRef = useRef(0)
  const rafRef = useRef(0)
  const wasStreamingRef = useRef(false)
  const [justFinished, setJustFinished] = useState(false)

  // 每次 render 同步最新内容到 ref，不触发 effect
  targetRef.current = isStreaming ? (message.content || '') : ''

  useEffect(() => {
    if (!isStreaming) {
      cancelAnimationFrame(rafRef.current)
      // 清除直接写入 DOM 的文本，防止 React 复用节点时残留
      if (previewRef.current) previewRef.current.textContent = ''
      // streaming → done 时标记，触发淡入动画
      if (wasStreamingRef.current && message.content) {
        setJustFinished(true)
      }
      visibleLenRef.current = 0
      wasStreamingRef.current = false
      return
    }
    wasStreamingRef.current = true
    const step = () => {
      const target = targetRef.current
      if (visibleLenRef.current < target.length) {
        visibleLenRef.current += 1
        if (previewRef.current) {
          previewRef.current.textContent = target.slice(0, visibleLenRef.current)
          previewRef.current.scrollTop = previewRef.current.scrollHeight
        }
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isStreaming])

  const handleFileClick = useCallback((filePath: string) => {
    // Open file with system default application via Electron shell
    window.electronAPI?.shell?.openPath?.(filePath)
  }, [])

  const attachments = message.attachments
  const hasAttachments = attachments && attachments.length > 0
  const isSingleAttachment = hasAttachments && attachments.length === 1

  const displayContent = message.content

  const rehypePlugins = [rehypeHighlight]

  // Check if content has inline images (only for assistant messages, non-streaming)
  const hasInlineImages = !isUser && !isStreaming && displayContent
    ? parseContentWithImages(displayContent).some((s) => s.type === 'image')
    : false

  return (
    <div className={`message-bubble ${isUser ? 'message-user' : 'message-assistant'} ${isStreaming ? 'message-bubble-streaming' : ''} ${isError ? 'message-error-bubble' : ''} ${isQueued ? 'message-queued' : ''}`}>
      <div className="message-body">
        {isStreaming && <div className="streaming-top-bar" />}
        {isStreaming && message.thinking && !message.content && (
          <div className="thinking-line">
            <span className="thinking-line-dot" />
            <span className="thinking-line-text">
              {(() => {
                const t = message.thinking.replace(/\s+/g, ' ').trim()
                return t.length > 80 ? '...' + t.slice(-80) : t
              })()}
            </span>
          </div>
        )}
        <div className={`message-content ${isError ? 'message-error-content' : ''}${hasAttachments ? ' has-attachments' : ''}`}>
          {hasAttachments && (
            <div className={`message-attachments${isSingleAttachment ? ' single' : ''}`}>
              {attachments.filter((a) => a.filePath).map((att, index) => {
                const isImage = isImageFile(att.mimeType, att.fileName)

                if (isImage) {
                  const imgSrc = att.content && att.mimeType
                    ? `data:${att.mimeType};base64,${att.content}`
                    : att.content
                      ? `data:image/png;base64,${att.content}`
                      : filePathToUrl(att.filePath)
                  return (
                    <img
                      key={index}
                      src={imgSrc}
                      alt={att.fileName || 'image'}
                      className="message-attachment-img"
                      onClick={() => handleFileClick(att.filePath)}
                    />
                  )
                }

                // Non-image file: show file name with icon
                return (
                  <div
                    key={index}
                    className="message-attachment-file"
                    onClick={() => handleFileClick(att.filePath)}
                    title={att.filePath}
                  >
                    <svg className="message-file-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="message-file-name">{att.fileName || att.filePath.split(/[\\/]/).pop()}</span>
                  </div>
                )
              })}
            </div>
          )}
          {(displayContent || isStreaming) && (
            <div className="message-text">
              {isUser ? (
                // User messages: plain text
                displayContent || ''
              ) : isStreaming ? (
                // 流式阶段: rAF 逐字写入 DOM，此处只挂载空容器
                <div key="streaming" className="streaming-preview" ref={previewRef} />
              ) : displayContent ? (
                hasInlineImages ? (
                  // Assistant with inline images: mixed rendering
                  parseContentWithImages(displayContent).map((segment, idx) => {
                    if (segment.type === 'image') {
                      return (
                        <img
                          key={`inline-img-${idx}`}
                          src={filePathToUrl(segment.value)}
                          alt="screenshot"
                          className="message-inline-screenshot"
                          onClick={() => handleFileClick(segment.value)}
                        />
                      )
                    }
                    return (
                      <div key={`md-${idx}`} className="chat-markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={rehypePlugins}
                          components={markdownComponents}
                        >
                          {segment.value}
                        </ReactMarkdown>
                      </div>
                    )
                  })
                ) : (
                  // Assistant: always render with ReactMarkdown (streaming + done)
                  <div key="markdown" className={`chat-markdown${justFinished ? ' markdown-fade-in' : ''}`} onAnimationEnd={() => setJustFinished(false)}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={rehypePlugins}
                      components={markdownComponents}
                    >
                      {displayContent}
                    </ReactMarkdown>
                  </div>
                )
              ) : (
                isStreaming ? '...' : null
              )}
            </div>
          )}
        </div>
        {isStreaming && (
          <div className="message-streaming-status">
            <span className="streaming-pulse-dot" />
            正在输入...
          </div>
        )}
        {isQueued && (
          <div className="message-queued-hint">排队中，等待当前回复结束</div>
        )}
        {isError && (
          <div className="message-error">
            发送失败
            {onRetry && (
              <button className="btn-retry" onClick={onRetry}>重试</button>
            )}
          </div>
        )}
        <div className="message-actions">
          {!isUser && message.status === 'done' && onCopy && (
            <button className="btn-action" onClick={onCopy} title="复制">
              复制
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Memoized: 按字段值比较, 避免引用不同但内容相同时的无意义重渲染 */
export const MessageBubble = React.memo(MessageBubbleInner, (prev, next) =>
  prev.message.id === next.message.id &&
  prev.message.content === next.message.content &&
  prev.message.status === next.message.status &&
  prev.message.thinking === next.message.thinking
)