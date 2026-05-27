import React, { useRef, useEffect, useCallback, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import { InputArea } from './InputArea'
import type { ChatMessage, ChatAttachment, AgentInfo, AvailableModel } from '../../types'

interface ChatAreaProps {
  messages: ChatMessage[]
  onSend: (content: string, attachments?: ChatAttachment[]) => void
  disabled?: boolean
  gatewayState: string
  backendStatus?: string
  isWaiting?: boolean
  isStreaming?: boolean
  onStop: () => void
  gatewayPort?: number
  agents: AgentInfo[]
  currentAgentId?: string
  defaultAgentId: string
  onChangeAgent: (agentId: string) => void
  onRestartGateway: () => void
  availableModels: AvailableModel[]
  currentModelKey: string
  onSwitchModel: (modelKey: string) => void
  contextUsageTotal: number
  contextWindow: number
}

function getAgentDisplayName(agent: AgentInfo): string {
  return agent.identity?.name || agent.name || agent.id
}

/** 顶栏展示：默认会话不显示 Main 字样 */
function getHeaderAgentLabel(agent: AgentInfo | undefined): string {
  if (!agent) return ''
  if (agent.id === 'main') return ''
  return getAgentDisplayName(agent)
}

/**
 * 将 token 数量格式化为更易读的展示：
 * - >= 1000 使用 k 单位（保留 1 位小数）
 * - < 1000 保持整数
 */
function formatTokensShort(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return String(Math.round(value))
  const inK = value / 1000
  return `${inK.toFixed(1)}k`
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  onSend,
  disabled = false,
  gatewayState,
  backendStatus,
  isWaiting = false,
  isStreaming = false,
  onStop,
  // gatewayPort = 18888,
  agents,
  currentAgentId,
  defaultAgentId,
  onChangeAgent,
  onRestartGateway,
  availableModels,
  currentModelKey,
  onSwitchModel,
  contextUsageTotal,
  contextWindow,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef(0)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const agentPickerRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)

  const [autoScroll, setAutoScroll] = useState(true)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [screenshotToast, setScreenshotToast] = useState<string | null>(null)
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)

  const isReady = gatewayState === 'ready'
  const selectedAgent = agents.find((agent) => agent.id === (currentAgentId || defaultAgentId))
  const hasStreamingMessage = messages.some((msg) => msg.status === 'streaming')
  const usageRate = contextWindow > 0 ? Math.max(0, Math.min(1, contextUsageTotal / contextWindow)) : 0
  // 显示口径与自动压缩阈值体验保持一致：不提前四舍五入进位。
  // 例如 49.6% 不应显示成 50%，否则用户会误以为“到 50% 还没触发自动压缩”。
  const usagePercent = Math.floor(usageRate * 100)
  const usageTotalLabel = formatTokensShort(contextUsageTotal)
  const contextWindowLabel = formatTokensShort(contextWindow)
  const ringRadius = 10
  const ringCircumference = 2 * Math.PI * ringRadius
  const ringOffset = ringCircumference * (1 - usageRate)

  useEffect(() => {
    if (!showAgentPicker) return
    const handleOutsideClick = (event: MouseEvent) => {
      if (agentPickerRef.current && !agentPickerRef.current.contains(event.target as Node)) {
        setShowAgentPicker(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [showAgentPicker])

  // 点击外部关闭 model 选择器
  useEffect(() => {
    if (!showModelPicker) return
    const handleOutsideClick = (event: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(event.target as Node)) {
        setShowModelPicker(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [showModelPicker])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      // 延迟一帧确保 DOM 布局完成（等待动画元素高度计算完毕）
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: isStreaming ? 'instant' : 'smooth',
        })
      })
    }
  }, [messages, autoScroll, isWaiting, isStreaming])

  // 清理 rAF 和 toast timer
  useEffect(() => () => {
    cancelAnimationFrame(scrollRafRef.current)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  // 监听截屏完成事件
  useEffect(() => {
    const unsubscribe = window.electronAPI.app.onScreenshotCaptured(() => {
      setScreenshotToast('已复制到剪贴板，Ctrl+V 粘贴到输入框')
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setScreenshotToast(null), 2500)
    })
    return unsubscribe
  }, [])

  // 监听 Ctrl+Alt+A 快捷键
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        void handleScreenshot()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // rAF 节流的滚动事件处理，带滞后区间防闪烁
  const handleScroll = useCallback(() => {
    cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      if (!scrollRef.current) return
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      setAutoScroll(distanceFromBottom < 100)
      setShowScrollTop(prev => scrollTop > 200 ? true : scrollTop < 120 ? false : prev)
      setShowScrollBottom(prev => distanceFromBottom > 200 ? true : distanceFromBottom < 120 ? false : prev)
    })
  }, [])

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
      setAutoScroll(true)
    }
  }, [])

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content).catch(console.error)
  }, [])

  // 区域截屏
  const handleScreenshot = useCallback(async () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    try {
      const ok = await window.electronAPI.app.startScreenshot()
      if (!ok) {
        setScreenshotToast('截屏启动失败')
        toastTimerRef.current = setTimeout(() => setScreenshotToast(null), 2000)
      }
    } catch {
      setScreenshotToast('截屏失败，请重试')
      toastTimerRef.current = setTimeout(() => setScreenshotToast(null), 2000)
    }
  }, [])

  const handleCompact = useCallback(() => {
    if (!isReady || isWaiting || messages.length === 0) return
    onSend('/compact')
  }, [isReady, isWaiting, messages.length, onSend])

  return (
    <div className="chat-area">
      <div className="chat-header">
        <div className="chat-header-left" ref={agentPickerRef}>
          {agents.filter(a => a.id !== 'main').length > 0 ? (
            <>
              <button
                className="chat-header-agent chat-header-agent-clickable"
                onClick={() => { setShowAgentPicker((v) => !v) }}
                title="选择 Agent"
              >
                {getHeaderAgentLabel(selectedAgent) || '默认'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginLeft: 4}}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {showAgentPicker && (
                <div className="agent-picker-dropdown">
                  <div
                    className={`agent-picker-item ${!currentAgentId || currentAgentId === 'main' ? 'active' : ''}`}
                    onClick={() => {
                      onChangeAgent('main')
                      setShowAgentPicker(false)
                    }}
                  >
                    <span className="agent-picker-emoji">●</span>
                    <span className="agent-picker-name">默认</span>
                  </div>
                  {agents.filter(a => a.id !== 'main').map((agent) => (
                    <div
                      key={agent.id}
                      className={`agent-picker-item ${agent.id === currentAgentId ? 'active' : ''}`}
                      onClick={() => {
                        onChangeAgent(agent.id)
                        setShowAgentPicker(false)
                      }}
                    >
                      <span className="agent-picker-emoji">
                        {agent.identity?.emoji || getAgentDisplayName(agent).slice(0, 1)}
                      </span>
                      <span className="agent-picker-name">{getAgentDisplayName(agent)}</span>
                      <span
                        className="agent-picker-delete"
                        title="删除 Agent"
                        onClick={async (e) => {
                          e.stopPropagation()
                          const res = await window.electronAPI.agents.delete({ agentId: agent.id })
                          if (res.ok) onRestartGateway()
                        }}
                      >×</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
        <div className="chat-header-right">
          {availableModels.length > 1 && (
            <div className="model-switcher" ref={modelPickerRef}>
              <button
                className="chat-header-badge"
                onClick={() => setShowModelPicker(v => !v)}
                title="切换模型"
              >
                {(availableModels.find(m => m.key === currentModelKey)?.modelName || currentModelKey.split('/').pop() || '默认').slice(0, 16)}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginLeft: 4}}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {showModelPicker && (
                <div className="model-picker-dropdown">
                  {availableModels.map(model => (
                    <div
                      key={model.key}
                      className={`model-picker-item ${model.key === currentModelKey ? 'active' : ''}`}
                      onClick={() => {
                        onSwitchModel(model.key)
                        setShowModelPicker(false)
                      }}
                    >
                      <span className="model-picker-name">{model.modelName}</span>
                      <span className={`model-picker-type model-picker-type-${model.providerType}`}>
                        {model.providerType === 'clawwin' ? 'ClawWin' : model.providerType === 'local' ? '本地' : '云端'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div
            className="chat-context-usage"
            title={`当前上下文使用率 ${usagePercent}%（${usageTotalLabel}/${contextWindowLabel}）`}
            aria-label={`当前上下文使用率 ${usagePercent}%，已用 ${usageTotalLabel}，总窗口 ${contextWindowLabel}`}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
              <circle className="chat-context-usage-track" cx="14" cy="14" r={ringRadius} />
              <circle
                className="chat-context-usage-progress"
                cx="14"
                cy="14"
                r={ringRadius}
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
              />
            </svg>
            <span className="chat-context-usage-label">{usagePercent}%</span>
          </div>
          <button
            className="chat-header-badge"
            onClick={handleCompact}
            title="压缩上下文，释放对话空间"
            disabled={!isReady || isWaiting || messages.length === 0}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            压缩
          </button>
          <button
            className="chat-header-badge"
            onClick={() => void handleScreenshot()}
            title="截屏 (Ctrl+Alt+A)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            截屏
          </button>
          {/* <button
            className="chat-header-badge"
            onClick={() => void window.electronAPI.shell.openExternal(`http://127.0.0.1:${gatewayPort}`)}
            title="打开 OpenClaw WebUI"
          >
            WebUI
          </button> */}
        </div>
      </div>

      <div className="chat-messages-wrapper">
        <div className="chat-messages" ref={scrollRef} onScroll={handleScroll}>
          {messages.length === 0 ? (
            <div className="welcome-screen">
              <div className="welcome-avatar">🤖</div>
              <div className="welcome-info">
                <div className="welcome-name">ClawWin</div>
                <div className="welcome-desc">👋 千易 为你24小时随时在线</div>
              </div>
              <div className="welcome-input-container">
                <div className="welcome-input-wrapper">
                  <textarea
                    className="welcome-input"
                    placeholder="请输入任务，交给我来帮你完成"
                    disabled={disabled || !isReady}
                    rows={3}
                  />
                  <div className="welcome-input-actions">
                    <div className="welcome-input-left">
                      <button className="attach-btn" title="选择文件">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                        </svg>
                        选择文件
                      </button>
                    </div>
                    <button 
                      className="welcome-send-btn"
                      disabled={disabled || !isReady}
                      onClick={() => {
                        const input = document.querySelector('.welcome-input') as HTMLTextAreaElement
                        if (input?.value) {
                          onSend(input.value)
                          input.value = ''
                        }
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {messages
                .filter((msg) => msg.content || msg.thinking || msg.toolCalls?.length || msg.status === 'streaming' || msg.status === 'queued' || msg.status === 'error' || msg.attachments?.length)
                .map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    onCopy={() => handleCopy(msg.content)}
                  />
                ))}
              {isWaiting && !isStreaming && !hasStreamingMessage && (
                <div className="message-bubble message-assistant message-bubble-waiting">
                  <div className="message-body">
                    <div className="message-content message-content-assistant">
                      <div className="typing-dots">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 滚动导航按钮 */}
        <div className="chat-scroll-buttons">
          <button
            className={`chat-scroll-btn ${showScrollTop ? 'visible' : 'hidden'}`}
            onClick={scrollToTop}
            title="回到顶部"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <button
            className={`chat-scroll-btn ${showScrollBottom ? 'visible' : 'hidden'}`}
            onClick={scrollToBottom}
            title="回到底部"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* 截屏提示 toast */}
      {screenshotToast && <div className="screenshot-toast">{screenshotToast}</div>}

      {!isReady && (
        <div className="chat-status-bar">
          {gatewayState === 'starting' && '正在启动网关服务...'}
          {gatewayState === 'error' && '网关连接错误，正在尝试重连...'}
          {gatewayState === 'stopped' && '网关服务已停止'}
          {gatewayState === 'restarting' && '正在应用新配置...'}
        </div>
      )}

      <div className={`chat-activity-bar ${isReady && backendStatus && (isStreaming || isWaiting) ? 'chat-activity-bar-visible' : 'chat-activity-bar-hidden'}`}>
        <span className="chat-activity-dot" />
        <span>{backendStatus}</span>
      </div>

      <InputArea
        onSend={onSend}
        disabled={disabled || !isReady}
        placeholder={!isReady ? '等待网关服务就绪...' : isWaiting ? 'AI 正在思考，可继续输入...' : isStreaming ? 'AI 正在回复，可继续输入...' : '输入消息...'}
        isWaiting={isWaiting}
        isStreaming={isStreaming}
        onStop={onStop}
      />
    </div>
  )
}
