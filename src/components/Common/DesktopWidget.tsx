import React, { useState, useRef, useEffect, useCallback } from 'react'

interface DesktopWidgetProps {
  onDoubleClick: () => void
  onSendMessage: (content: string) => void
  isTaskRunning: boolean
  taskResult: { success: boolean; message: string } | null
  onCloseResult: () => void
}

export const DesktopWidget: React.FC<DesktopWidgetProps> = ({
  onDoubleClick,
  onSendMessage,
  isTaskRunning,
  taskResult,
  onCloseResult,
}) => {
  const [isHovering, setIsHovering] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isHidden, setIsHidden] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [position, setPosition] = useState({ x: 100, y: 100 })
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [showResult, setShowResult] = useState(false)

  const widgetRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (taskResult) {
      setShowResult(true)
      setTimeout(() => {
        setShowResult(false)
        onCloseResult()
      }, 3000)
    }
  }, [taskResult, onCloseResult])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.widget-bubble')) return
    setIsDragging(true)
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    })
  }, [position])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    
    const newX = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dragOffset.x))
    const newY = Math.max(0, Math.min(window.innerHeight - 80, e.clientY - dragOffset.y))
    
    setPosition({ x: newX, y: newY })
    
    const edgeThreshold = 50
    if (newX < edgeThreshold || newX > window.innerWidth - 80 - edgeThreshold ||
        newY < edgeThreshold || newY > window.innerHeight - 80 - edgeThreshold) {
      setIsHidden(true)
    } else {
      setIsHidden(false)
    }
  }, [isDragging, dragOffset])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const handleMouseEnter = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }
    setIsHovering(true)
    setIsHidden(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setIsHovering(false)
    }, 300)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim() && !isTaskRunning) {
      onSendMessage(inputValue.trim())
      setInputValue('')
    }
  }, [inputValue, isTaskRunning, onSendMessage])

  const handleBubbleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  return (
    <>
      <div
        ref={widgetRef}
        className={`desktop-widget ${isHidden ? 'hidden' : ''} ${isDragging ? 'dragging' : ''}`}
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onDoubleClick={onDoubleClick}
      >
        <div className="widget-avatar">
          <div className="widget-avatar-inner">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="2" />
              <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="2" />
            </svg>
          </div>
          {isTaskRunning && (
            <div className="widget-loading-indicator">
              <div className="widget-loading-dot"></div>
            </div>
          )}
        </div>

        {isHovering && !isHidden && (
          <div className="widget-bubble" onClick={handleBubbleClick}>
            <div className="widget-bubble-header">
              <span className="widget-bubble-title">快捷命令</span>
            </div>
            <div className="widget-bubble-body">
              <input
                ref={inputRef}
                type="text"
                className="widget-input"
                placeholder="输入命令，按回车发送..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isTaskRunning}
              />
            </div>
            {isTaskRunning && (
              <div className="widget-bubble-hint">正在执行任务，请稍候...</div>
            )}
          </div>
        )}
      </div>

      {showResult && taskResult && (
        <div className="widget-result-overlay" onClick={() => setShowResult(false)}>
          <div className={`widget-result-dialog ${taskResult.success ? 'success' : 'error'}`} onClick={(e) => e.stopPropagation()}>
            <div className="widget-result-icon">
              {taskResult.success ? (
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              ) : (
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              )}
            </div>
            <div className="widget-result-message">{taskResult.message}</div>
          </div>
        </div>
      )}
    </>
  )
}
