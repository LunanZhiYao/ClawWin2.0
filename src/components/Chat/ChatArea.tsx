import React, { useRef, useEffect, useCallback, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import type { ChatMessage, ChatAttachment, AgentInfo, AvailableModel, SkillInfo } from '../../types'
import { type WelcomeTab } from '../../api/welcome'
import logoSrc from '../../../assets/logo.png'
import { SKILL_CN } from '../../constants/skillCn'

// 完整版底部输入框组件 - 整合所有功能
interface BottomInputProps {
  onSend: (content: string, attachments?: ChatAttachment[]) => void
  disabled?: boolean
  placeholder?: string
  isWaiting?: boolean
  isStreaming?: boolean
  onStop?: () => void
  workspaceOpen?: boolean  // 工作区是否展开
  externalInput?: string  // 外部注入的输入内容（如重发）
  onExternalInputConsumed?: () => void  // 外部输入被消费后的回调
  containerRef?: React.RefObject<HTMLDivElement>  // 容器 ref，用于 ResizeObserver
  activityStatus?: string  // 活动状态文字，为空则不显示
  externalAttachment?: AttachmentWithPreview | null  // 外部注入的附件（如引用文件）
  onExternalAttachmentConsumed?: () => void  // 外部附件被消费后的回调
}

const MAX_ATTACHMENTS = 5

interface AttachmentWithPreview {
  type: 'image' | 'file' | 'folder'
  fileName: string
  filePath: string
  mimeType?: string
  content?: string
  previewUrl?: string
  size: number
}

const BottomInput: React.FC<BottomInputProps> = ({
  onSend,
  disabled = false,
  placeholder = '请输入任务，交给我来帮你完成',
  isWaiting = false,
  isStreaming = false,
  onStop,
  workspaceOpen = false,  // 工作区是否展开
  externalInput,
  onExternalInputConsumed,
  containerRef,
  activityStatus = '',
  externalAttachment,
  onExternalAttachmentConsumed,
}) => {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AttachmentWithPreview[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isStopping, setIsStopping] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Skill quote state
  const [quotedSkills, setQuotedSkills] = useState<string[]>([])
  const [showSkillPicker, setShowSkillPicker] = useState(false)
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const skillPickerRef = useRef<HTMLDivElement>(null)

  // 接收外部注入的输入内容（如重发）
  useEffect(() => {
    if (externalInput) {
      setInput(externalInput)
      onExternalInputConsumed?.()
      setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }, [externalInput, onExternalInputConsumed])

  // 接收外部注入的附件（如引用文件）
  useEffect(() => {
    if (externalAttachment) {
      setAttachments((prev) => {
        if (prev.length >= MAX_ATTACHMENTS) return prev
        // 检查是否已存在相同路径的附件
        if (prev.some(a => a.filePath === externalAttachment.filePath)) return prev
        return [...prev, externalAttachment]
      })
      onExternalAttachmentConsumed?.()
      setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }, [externalAttachment, onExternalAttachmentConsumed])

  // 错误提示
  const showError = useCallback((msg: string) => {
    setError(msg)
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => setError(null), 3000)
  }, [])

  const handleRemoveQuotedSkill = useCallback((name: string) => {
    setQuotedSkills(prev => prev.filter(s => s !== name))
  }, [])

  // Load available skills when picker opens
  useEffect(() => {
    if (showSkillPicker) {
      setSkillsLoading(true)
      window.electronAPI.skills.list().then((list: SkillInfo[]) => {
        // Filter to only show enabled and ready skills
        const available = list.filter(s => s.enabled && s.status === 'ready')
        setAvailableSkills(available)
        setSkillsLoading(false)
      }).catch(() => {
        setSkillsLoading(false)
      })
    }
  }, [showSkillPicker])

  // Close picker when clicking outside
  useEffect(() => {
    if (!showSkillPicker) return
    const handleClickOutside = (e: MouseEvent) => {
      if (skillPickerRef.current && !skillPickerRef.current.contains(e.target as Node)) {
        setShowSkillPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSkillPicker])

  const handleSelectSkill = useCallback((skillName: string) => {
    if (!quotedSkills.includes(skillName)) {
      setQuotedSkills(prev => [...prev, skillName])
    }
    setShowSkillPicker(false)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [quotedSkills])

  // 文件处理
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  const processFiles = useCallback((files: FileList | File[]) => {
    const filesToProcess = Array.from(files).slice(0, MAX_ATTACHMENTS - attachments.length)
    if (filesToProcess.length === 0) return

    const processOne = async (file: File): Promise<AttachmentWithPreview | null> => {
      let filePath = ''
      try {
        filePath = window.electronAPI.file.getPath(file)
      } catch {
        // fallback: clipboard paste files have no backing path
      }
      if (!filePath) {
        showError(`无法获取文件路径: ${file.name}，请使用拖放或文件选择`)
        return null
      }

      const isImage = file.type.startsWith('image/')
      let previewUrl: string | undefined
      let content: string | undefined

      if (isImage) {
        previewUrl = URL.createObjectURL(file)
        content = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })
      }

      return {
        type: isImage ? 'image' as const : 'file' as const,
        fileName: file.name,
        filePath,
        mimeType: file.type || undefined,
        content,
        previewUrl,
        size: file.size,
      }
    }

    Promise.all(filesToProcess.map(processOne)).then((results) => {
      const validAttachments = results.filter((a): a is AttachmentWithPreview => a !== null)
      if (validAttachments.length > 0) {
        setAttachments(prev => [...prev, ...validAttachments])
      }
    })
  }, [attachments.length, showError])

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => {
      const removed = prev[index]
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl)
      }
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  // 发送消息
  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    const hasText = trimmed.length > 0
    const hasAtt = attachments.length > 0

    if ((!hasText && !hasAtt) || disabled) return

    // Copy files to workspace
    const resolvedAttachments = hasAtt
      ? await Promise.all(
          attachments.map(async (a) => {
            if (a.type === 'folder') return a
            const result = await window.electronAPI.file.copyToWorkspace(a.filePath || a.previewUrl || '')
            return { ...a, filePath: result.ok && result.destPath ? result.destPath : a.filePath }
          })
        )
      : []

    // Build content with workspace paths appended
    let content = trimmed
    if (resolvedAttachments.length > 0) {
      const paths = resolvedAttachments.map((a) => a.filePath).join('\n')
      content = content ? `${content}\n${paths}` : paths
    }

    // Prepend quoted skill names
    if (quotedSkills.length > 0) {
      const prefix = quotedSkills.map(s => `@${s}`).join(' ')
      content = content ? `${prefix} ${content}` : prefix
    }

    // Build ChatAttachment[]
    const chatAttachments: ChatAttachment[] | undefined = resolvedAttachments.length > 0
      ? resolvedAttachments.map(({ type, fileName, filePath, mimeType, content: base64 }) => ({
          type,
          fileName,
          filePath,
          mimeType,
          content: base64,
        }))
      : undefined

    onSend(content, chatAttachments)
    setInput('')
    setQuotedSkills([])
    for (const att of attachments) {
      if (att.previewUrl) URL.revokeObjectURL(att.previewUrl)
    }
    setAttachments([])
  }, [input, attachments, disabled, onSend, quotedSkills])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isStreaming && onStop && !isStopping) {
        setIsStopping(true)
        Promise.resolve(onStop()).finally(() => setIsStopping(false))
      } else {
        handleSend()
      }
    }
  }, [handleSend, isStreaming, onStop, isStopping])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files)
    }
    e.target.value = ''
  }, [processFiles])

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFolderClick = useCallback(async () => {
    if (disabled || attachments.length >= MAX_ATTACHMENTS) return
    const folderPath = await window.electronAPI.dialog.selectFolder()
    if (!folderPath) return
    const folderName = folderPath.split(/[\\/]/).pop() || folderPath
    setAttachments(prev => [
      ...prev,
      { type: 'folder', fileName: folderName, filePath: folderPath, size: 0 },
    ])
  }, [disabled, attachments.length])

  // Drag and drop
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current += 1
    if (dragCounterRef.current === 1) {
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files)
    }
  }, [processFiles])

  const canSend = !disabled && (input.trim().length > 0 || attachments.length > 0 || quotedSkills.length > 0)

  return (
    <div
      ref={containerRef}
      className={`bottom-input-container${isDragging ? ' dragging' : ''}${workspaceOpen ? ' workspace-open' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 活动状态指示条 */}
      <div className={`chat-activity-bar ${activityStatus ? 'chat-activity-bar-visible' : 'chat-activity-bar-hidden'}`}>
        <span className="chat-activity-dot" />
        <span>{activityStatus}</span>
      </div>

      {/* Drag overlay */}
      {isDragging && (
        <div className="input-drag-overlay">
          拖放文件到此处
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="input-error-toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {/* Input container - 与欢迎页一致 */}
      <div className="welcome-input-container" style={{ width: '100%', maxWidth: '1000px', margin: '0 auto' }}>
        {/* Hidden file input */}
        <input ref={fileInputRef} type="file" accept="*/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />
        
        {/* Quoted skills strip */}
        {quotedSkills.length > 0 && (
          <div className="skill-tags-strip">
            {quotedSkills.map(name => (
              <span key={name} className="skill-tag-chip">
                @{name}
                <span className="skill-tag-remove" onClick={() => handleRemoveQuotedSkill(name)}>&times;</span>
              </span>
            ))}
          </div>
        )}

        {/* Preview strip */}
        {attachments.length > 0 && (
          <div className="input-preview-strip">
            {attachments.map((att, index) => (
              <div key={index} className="input-preview-item">
                {att.previewUrl ? (
                  <img src={att.previewUrl} alt={att.fileName} className="input-preview-thumb" />
                ) : att.type === 'folder' ? (
                  <div className="input-preview-file-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                    </svg>
                  </div>
                ) : (
                  <div className="input-preview-file-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                )}
                <div className="input-preview-info">
                  <span className="input-preview-name" title={att.type === 'folder' ? att.filePath : att.fileName}>
                    {att.fileName.length > 12 ? att.fileName.slice(0, 9) + '...' : att.fileName}
                  </span>
                  <span className="input-preview-size">{att.type === 'folder' ? '文件夹' : formatFileSize(att.size)}</span>
                </div>
                <button className="input-preview-remove" onClick={() => removeAttachment(index)} title="移除文件">&times;</button>
              </div>
            ))}
          </div>
        )}
        
        <div className="welcome-input-wrapper">
          <textarea
            ref={textareaRef}
            className="welcome-input"
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={3}
          />
          <div className="welcome-input-actions">
            <div className="welcome-input-left">
              <button
                className="attach-btn"
                title="选择文件"
                onClick={handleAttachClick}
                disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path>
                </svg>
              </button>
              <button
                className="attach-btn"
                title="挂载文件夹"
                onClick={handleFolderClick}
                disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"></path>
                </svg>
              </button>
              {/*todo 技能引用*/}
              {/*<button*/}
              {/*  className="attach-btn"*/}
              {/*  title="引用技能"*/}
              {/*  onClick={() => setShowSkillPicker(v => !v)}*/}
              {/*  disabled={disabled}*/}
              {/*>*/}
              {/*  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">*/}
              {/*    <circle cx="12" cy="12" r="4"></circle>*/}
              {/*    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"></path>*/}
              {/*  </svg>*/}
              {/*</button>*/}
              {showSkillPicker && (
                <div ref={skillPickerRef} className="skill-picker-dropdown">
                  {skillsLoading ? (
                    <div className="skill-picker-loading">加载中...</div>
                  ) : availableSkills.length === 0 ? (
                    <div className="skill-picker-empty">暂无可用技能</div>
                  ) : (
                    availableSkills.map(skill => (
                      <div
                        key={skill.name}
                        className={`skill-picker-item ${quotedSkills.includes(skill.name) ? 'active' : ''}`}
                        onClick={() => handleSelectSkill(skill.name)}
                      >
                        <span className="skill-picker-icon">{skill.emoji || '🔧'}</span>
                        <div className="skill-picker-info">
                          <span className="skill-picker-name">{skill.name}</span>
                          <span className="skill-picker-desc">{SKILL_CN[skill.name] || skill.description || '暂无描述'}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            {(isStreaming || isWaiting) ? (
              <button className="btn-stop" onClick={async () => { if (isStopping || !onStop) return; setIsStopping(true); try { await onStop() } catch (err) { console.error('stop error:', err) } finally { setIsStopping(false) } }} disabled={isStopping} title={isStopping ? '正在停止...' : '停止回复'}>
                <span style={{ display: 'block', width: 16, height: 16, backgroundColor: 'white', borderRadius: 2 }} />
              </button>
            ) : (
              <button className="welcome-send-btn" onClick={handleSend} disabled={!canSend} title="发送消息">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

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
  sidebarView: string
  sessionTitle?: string
  welcomeTabs?: WelcomeTab[]
  externalAttachment?: AttachmentWithPreview | null
  onExternalAttachmentConsumed?: () => void
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
  sidebarView,
  sessionTitle,
  welcomeTabs: propWelcomeTabs,
  externalAttachment,
  onExternalAttachmentConsumed,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef(0)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const agentPickerRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)

  const [autoScroll, setAutoScroll] = useState(true)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [screenshotToast, setScreenshotToast] = useState<string | null>(null)
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [retryInput, setRetryInput] = useState<string | null>(null)
  const [activeTabIndex, setActiveTabIndex] = useState(0)
  const [showCards, setShowCards] = useState(false)
  const [welcomeInput, setWelcomeInput] = useState('')
  const [welcomeAttachments, setWelcomeAttachments] = useState<AttachmentWithPreview[]>([])
  const welcomeTextareaRef = useRef<HTMLTextAreaElement>(null)
  const welcomeFileInputRef = useRef<HTMLInputElement>(null)
  const [welcomeQuotedSkills, setWelcomeQuotedSkills] = useState<string[]>([])
  const [showWelcomeSkillPicker, setShowWelcomeSkillPicker] = useState(false)
  const [welcomeAvailableSkills, setWelcomeAvailableSkills] = useState<SkillInfo[]>([])
  const [welcomeSkillsLoading, setWelcomeSkillsLoading] = useState(false)
  const welcomeSkillPickerRef = useRef<HTMLDivElement>(null)

  const isReady = gatewayState === 'ready'
  const selectedAgent = agents.find((agent) => agent.id === (currentAgentId || defaultAgentId))
  const hasStreamingMessage = messages.some((msg) => msg.status === 'streaming')
  // 上下文使用率计算，对齐官方 UI context-notice.ts 的逻辑：
  // - used / limit 得到比率
  // - 使用 Math.round 而非 Math.floor，与官方一致
  const usageRate = contextWindow > 0 ? Math.max(0, Math.min(1, contextUsageTotal / contextWindow)) : 0
  const usagePercent = Math.min(Math.round(usageRate * 100), 100)
  const usageTotalLabel = formatTokensShort(contextUsageTotal)
  const contextWindowLabel = formatTokensShort(contextWindow)
  const ringRadius = 10
  const ringCircumference = 2 * Math.PI * ringRadius
  const ringOffset = ringCircumference * (1 - usageRate)

  const showErrorWelcome = useCallback((msg: string) => {
    console.warn('[WelcomeInput]', msg)
  }, [])

  const processWelcomeFiles = useCallback((files: FileList | File[]) => {
    const filesToProcess = Array.from(files).slice(0, MAX_ATTACHMENTS - welcomeAttachments.length)
    if (filesToProcess.length === 0) return

    const processOne = async (file: File): Promise<AttachmentWithPreview | null> => {
      let filePath = ''
      try {
        filePath = window.electronAPI.file.getPath(file)
      } catch {
        // fallback
      }
      if (!filePath) {
        showErrorWelcome(`无法获取文件路径: ${file.name}`)
        return null
      }

      const isImage = file.type.startsWith('image/')
      let previewUrl: string | undefined
      let content: string | undefined

      if (isImage) {
        previewUrl = URL.createObjectURL(file)
        content = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })
      }

      return {
        type: isImage ? 'image' as const : 'file' as const,
        fileName: file.name,
        filePath,
        mimeType: file.type || undefined,
        content,
        previewUrl,
        size: file.size,
      }
    }

    Promise.all(filesToProcess.map(processOne)).then((results) => {
      const validAttachments = results.filter((a): a is AttachmentWithPreview => a !== null)
      if (validAttachments.length > 0) {
        setWelcomeAttachments(prev => [...prev, ...validAttachments])
      }
    })
  }, [welcomeAttachments.length, showErrorWelcome])

  const removeWelcomeAttachment = useCallback((index: number) => {
    setWelcomeAttachments(prev => {
      const removed = prev[index]
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl)
      }
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleWelcomeSend = useCallback(async () => {
    const trimmed = welcomeInput.trim()
    const hasText = trimmed.length > 0
    const hasAtt = welcomeAttachments.length > 0

    if ((!hasText && !hasAtt && welcomeQuotedSkills.length === 0) || disabled || !isReady) return

    const resolvedAttachments = hasAtt
      ? await Promise.all(
          welcomeAttachments.map(async (a) => {
            if (a.type === 'folder') return a
            const result = await window.electronAPI.file.copyToWorkspace(a.filePath)
            return { ...a, filePath: result.ok && result.destPath ? result.destPath : a.filePath }
          })
        )
      : []

    let content = trimmed
    if (resolvedAttachments.length > 0) {
      const paths = resolvedAttachments.map((a) => a.filePath).join('\n')
      content = content ? `${content}\n${paths}` : paths
    }

    // Prepend quoted skill names
    if (welcomeQuotedSkills.length > 0) {
      const prefix = welcomeQuotedSkills.map(s => `@${s}`).join(' ')
      content = content ? `${prefix} ${content}` : prefix
    }

    const chatAttachments: ChatAttachment[] | undefined = resolvedAttachments.length > 0
      ? resolvedAttachments.map(({ type, fileName, filePath, mimeType, content: base64 }) => ({
          type,
          fileName,
          filePath,
          mimeType,
          content: base64,
        }))
      : undefined

    onSend(content, chatAttachments)
    setWelcomeInput('')
    setWelcomeQuotedSkills([])
    for (const att of welcomeAttachments) {
      if (att.previewUrl) URL.revokeObjectURL(att.previewUrl)
    }
    setWelcomeAttachments([])
  }, [welcomeInput, welcomeAttachments, disabled, isReady, onSend, welcomeQuotedSkills])

  const handleWelcomeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleWelcomeSend()
    }
  }, [handleWelcomeSend])

  const handleWelcomeFolderClick = useCallback(async () => {
    if (disabled || !isReady || welcomeAttachments.length >= MAX_ATTACHMENTS) return
    const folderPath = await window.electronAPI.dialog.selectFolder()
    if (!folderPath) return
    const folderName = folderPath.split(/[\\/]/).pop() || folderPath
    setWelcomeAttachments(prev => [
      ...prev,
      { type: 'folder', fileName: folderName, filePath: folderPath, size: 0 },
    ])
  }, [disabled, isReady, welcomeAttachments.length])

  const handleRemoveWelcomeQuotedSkill = useCallback((name: string) => {
    setWelcomeQuotedSkills(prev => prev.filter(s => s !== name))
  }, [])

  // Load available skills for welcome page when picker opens
  useEffect(() => {
    if (showWelcomeSkillPicker) {
      setWelcomeSkillsLoading(true)
      window.electronAPI.skills.list().then((list: SkillInfo[]) => {
        const available = list.filter(s => s.enabled && s.status === 'ready')
        setWelcomeAvailableSkills(available)
        setWelcomeSkillsLoading(false)
      }).catch(() => {
        setWelcomeSkillsLoading(false)
      })
    }
  }, [showWelcomeSkillPicker])

  // Close welcome skill picker when clicking outside
  useEffect(() => {
    if (!showWelcomeSkillPicker) return
    const handleClickOutside = (e: MouseEvent) => {
      if (welcomeSkillPickerRef.current && !welcomeSkillPickerRef.current.contains(e.target as Node)) {
        setShowWelcomeSkillPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showWelcomeSkillPicker])

  const handleSelectWelcomeSkill = useCallback((skillName: string) => {
    if (!welcomeQuotedSkills.includes(skillName)) {
      setWelcomeQuotedSkills(prev => [...prev, skillName])
    }
    setShowWelcomeSkillPicker(false)
    setTimeout(() => welcomeTextareaRef.current?.focus(), 0)
  }, [welcomeQuotedSkills])

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  // 根据props初始化欢迎页配置
  useEffect(() => {
    if (propWelcomeTabs && propWelcomeTabs.length > 0) {
      setShowCards(true)
    }
  }, [propWelcomeTabs])

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
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      const currentCount = messages.length
      const isSessionSwitch = Math.abs(currentCount - prevMsgCountRef.current) > 2
      prevMsgCountRef.current = currentCount

      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: isSessionSwitch || isStreaming ? 'instant' : 'smooth',
        })
      })
    }
  }, [messages, autoScroll, isWaiting, isStreaming])

  // 清理 rAF 和 toast timer
  useEffect(() => () => {
    cancelAnimationFrame(scrollRafRef.current)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  // // todo 临时取消监听底部输入框高度变化，动态调整消息区域 padding-bottom
  // useEffect(() => {
  //   const inputEl = inputContainerRef.current
  //   if (!inputEl || !scrollRef.current) return
  //   const observer = new ResizeObserver((entries) => {
  //     for (const entry of entries) {
  //       const height = entry.contentRect.height + 32 // 16px padding * 2
  //       if (scrollRef.current) {
  //         scrollRef.current.style.paddingBottom = `${height + 8}px`
  //       }
  //     }
  //   })
  //   observer.observe(inputEl)
  //   return () => observer.disconnect()
  // }, [messages.length > 0])

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
        <div className="chat-header-left">
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

        <div className="chat-header-title">
          {(sessionTitle && sessionTitle !== '新对话') ? sessionTitle : '\u00A0'}
        </div>

        <div className="chat-header-actions">
          {availableModels.length > 1 && (
            <div className="model-switcher" ref={modelPickerRef}>
              <button
                className="chat-action-btn"
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
            style={{ display: messages.length === 0 ? 'none' : 'flex' }}
          >
            <svg width="24" height="24" viewBox="0 0 28 28" aria-hidden="true">
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
            <span className="chat-context-label">{usagePercent}%</span>
          </div>
          <button
            className="chat-action-btn"
            onClick={handleCompact}
            title="压缩上下文，释放对话空间"
            disabled={!isReady || isWaiting || messages.length === 0}
            style={{ display: messages.length === 0 ? 'none' : 'flex' }}
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
            className="chat-action-btn"
            onClick={() => void handleScreenshot()}
            title="截屏 (Ctrl+Alt+A)"
            style={{ display: messages.length === 0 ? 'none' : 'flex' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            截屏
          </button>
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="welcome-screen">
          <div className="welcome-content">
            <img src={logoSrc} alt="鲁南千易" className="welcome-avatar" />
            <div className="welcome-info">
              <div className="welcome-name">鲁南千易</div>
              <div className="welcome-desc">👋 千易 为你24小时随时在线</div>
            </div>
          </div>
          <div className="welcome-input-container">
            <input
              ref={welcomeFileInputRef}
              type="file"
              accept="*/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  processWelcomeFiles(e.target.files)
                }
                e.target.value = ''
              }}
            />
            {welcomeQuotedSkills.length > 0 && (
              <div className="skill-tags-strip">
                {welcomeQuotedSkills.map(name => (
                  <span key={name} className="skill-tag-chip">
                    @{name}
                    <span className="skill-tag-remove" onClick={() => handleRemoveWelcomeQuotedSkill(name)}>&times;</span>
                  </span>
                ))}
              </div>
            )}
            {welcomeAttachments.length > 0 && (
              <div className="input-preview-strip">
                {welcomeAttachments.map((att, index) => (
                  <div key={index} className="input-preview-item">
                    {att.previewUrl ? (
                      <img src={att.previewUrl} alt={att.fileName} className="input-preview-thumb" />
                    ) : att.type === 'folder' ? (
                      <div className="input-preview-file-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                        </svg>
                      </div>
                    ) : (
                      <div className="input-preview-file-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </div>
                    )}
                    <div className="input-preview-info">
                      <span className="input-preview-name" title={att.type === 'folder' ? att.filePath : att.fileName}>
                        {att.fileName.length > 12 ? att.fileName.slice(0, 9) + '...' : att.fileName}
                      </span>
                      <span className="input-preview-size">{att.type === 'folder' ? '文件夹' : formatFileSize(att.size)}</span>
                    </div>
                    <button className="input-preview-remove" onClick={() => removeWelcomeAttachment(index)} title="移除文件">&times;</button>
                  </div>
                ))}
              </div>
            )}
            <div className="welcome-input-wrapper">
              <textarea
                ref={welcomeTextareaRef}
                className="welcome-input"
                value={welcomeInput}
                onChange={(e) => setWelcomeInput(e.target.value)}
                onKeyDown={handleWelcomeKeyDown}
                placeholder="请输入任务，交给我来帮你完成"
                disabled={disabled || !isReady}
              />
              <div className="welcome-input-actions">
                <div className="welcome-input-left">
                  <button
                    className="attach-btn"
                    title="选择文件"
                    onClick={() => welcomeFileInputRef.current?.click()}
                    disabled={disabled || !isReady || welcomeAttachments.length >= MAX_ATTACHMENTS}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                    </svg>
                  </button>
                  <button
                    className="attach-btn"
                    title="挂载文件夹"
                    onClick={handleWelcomeFolderClick}
                    disabled={disabled || !isReady || welcomeAttachments.length >= MAX_ATTACHMENTS}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"></path>
                    </svg>
                  </button>
                   {/*todo 技能引用*/}
                  {/*<button*/}
                  {/*  className="attach-btn"*/}
                  {/*  title="引用技能"*/}
                  {/*  onClick={() => setShowWelcomeSkillPicker(v => !v)}*/}
                  {/*>*/}
                  {/*  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">*/}
                  {/*    <circle cx="12" cy="12" r="4"></circle>*/}
                  {/*    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"></path>*/}
                  {/*  </svg>*/}
                  {/*</button>*/}
                  {showWelcomeSkillPicker && (
                    <div ref={welcomeSkillPickerRef} className="skill-picker-dropdown skill-picker-dropdown-below">
                      {welcomeSkillsLoading ? (
                        <div className="skill-picker-loading">加载中...</div>
                      ) : welcomeAvailableSkills.length === 0 ? (
                        <div className="skill-picker-empty">暂无可用技能</div>
                      ) : (
                        welcomeAvailableSkills.map(skill => (
                          <div
                            key={skill.name}
                            className={`skill-picker-item ${welcomeQuotedSkills.includes(skill.name) ? 'active' : ''}`}
                            onClick={() => handleSelectWelcomeSkill(skill.name)}
                          >
                            <span className="skill-picker-icon">{skill.emoji || '🔧'}</span>
                            <div className="skill-picker-info">
                              <span className="skill-picker-name">{skill.name}</span>
                              <span className="skill-picker-desc">{SKILL_CN[skill.name] || skill.description || '暂无描述'}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <button
                  className="welcome-send-btn"
                  disabled={disabled || !isReady || (!welcomeInput.trim() && welcomeAttachments.length === 0 && welcomeQuotedSkills.length === 0)}
                  onClick={handleWelcomeSend}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          {showCards && propWelcomeTabs && propWelcomeTabs.length > 0 && (
            <div className="welcome-cards-section">
              <div className="recommend-tabs">
                {propWelcomeTabs.map((tab, index) => (
                  <button
                    key={tab.id}
                    className={`recommend-tab ${index === activeTabIndex ? 'active' : ''}`}
                    onClick={() => setActiveTabIndex(index)}
                  >
                    {tab.tab_name}
                  </button>
                ))}
              </div>
              <div className="recommend-grid">
                {propWelcomeTabs[activeTabIndex]?.cards.slice(0, 6).map((card) => (
                  <div
                    key={card.id}
                    className="recommend-card"
                    onClick={() => {
                      if (card.prompt) {
                        setWelcomeInput(card.prompt)
                        setTimeout(() => welcomeTextareaRef.current?.focus(), 0)
                      }
                    }}
                  >
                    <div className="recommend-card-header">
                      <div className="recommend-card-icon">💡</div>
                      <div className="recommend-card-title">{card.title}</div>
                    </div>
                    {card.content && (
                      <div className="recommend-card-desc">{card.content}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="chat-messages-wrapper">
          <div className="chat-messages" ref={scrollRef} onScroll={handleScroll}>
            {messages
              .filter((msg) => msg.content || msg.thinking || msg.toolCalls?.length || msg.status === 'streaming' || msg.status === 'queued' || msg.status === 'error' || msg.attachments?.length)
              .map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onCopy={() => handleCopy(msg.content)}
                  onRetry={msg.role === 'user' ? () => setRetryInput(msg.content) : undefined}
                  currentAgentId={currentAgentId}
                />
              ))}
            {isWaiting && !isStreaming && !hasStreamingMessage && (
              <div className="message-row assistant">
                <div className="message-avatar ai">
                  <img src={logoSrc} alt="AI" className="message-avatar-img" />
                </div>
                <div className="message-column">
                  <div className="message-header">
                    <span className="message-nickname">千易</span>
                  </div>
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
                </div>
              </div>
            )}
          </div>

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
      )}

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

      {/* 只在有消息时显示底部输入框，无消息时不显示（欢迎页已有输入框） */}
      {messages.length > 0 && (
        <BottomInput
          onSend={onSend}
          disabled={disabled || !isReady}
          placeholder={!isReady ? '等待网关服务就绪...' : isWaiting ? 'AI 正在思考，可继续输入...' : isStreaming ? 'AI 正在回复，可继续输入...' : '输入消息...'}
          isWaiting={isWaiting}
          isStreaming={isStreaming}
          onStop={onStop}
          workspaceOpen={sidebarView === 'workspace'}
          externalInput={retryInput ?? undefined}
          onExternalInputConsumed={() => setRetryInput(null)}
          containerRef={inputContainerRef}
          activityStatus={isReady && backendStatus && (isStreaming || isWaiting) ? backendStatus : ''}
          externalAttachment={externalAttachment}
          onExternalAttachmentConsumed={onExternalAttachmentConsumed}
        />
      )}
    </div>
  )
}
