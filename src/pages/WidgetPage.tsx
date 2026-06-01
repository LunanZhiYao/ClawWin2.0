import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { ElectronAPI } from '../types/electron'
import logoUrl from '../../assets/logo.png'

declare const window: Window & { electronAPI: ElectronAPI }

export const WidgetPage: React.FC = () => {
  const [isHovering, setIsHovering] = useState(false)
  const [isTaskRunning, setIsTaskRunning] = useState(false)
  const [taskResult, setTaskResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showSpeechBubble, setShowSpeechBubble] = useState(false)
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [inputValue, setInputValue] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const ignoreMouseRef = useRef(true)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ screenX: 0, screenY: 0 })
  const speechBubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputFocusedRef = useRef(false)
  const inputPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.body.classList.add('widget-page')
    document.documentElement.style.background = 'transparent'
    const root = document.getElementById('root')
    if (root) root.style.background = 'transparent'
    return () => {
      document.body.classList.remove('widget-page')
      document.documentElement.style.background = ''
      if (root) root.style.background = ''
    }
  }, [])

  const setIgnore = useCallback((ignore: boolean) => {
    if (ignoreMouseRef.current !== ignore) {
      ignoreMouseRef.current = ignore
      window.electronAPI.widget.setIgnoreMouseEvents(ignore)
    }
  }, [])

  useEffect(() => {
    const unsubTask = window.electronAPI.widget.onTaskComplete((result) => {
      setIsTaskRunning(false)
      setTaskResult(result)
      setShowSpeechBubble(true)
      setIgnore(false)
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current)
        leaveTimeoutRef.current = null
      }
      if (speechBubbleTimerRef.current) clearTimeout(speechBubbleTimerRef.current)
      speechBubbleTimerRef.current = setTimeout(() => {
        setShowSpeechBubble(false)
        setTaskResult(null)
      }, 5000)
    })

    return () => {
      unsubTask()
      if (speechBubbleTimerRef.current) clearTimeout(speechBubbleTimerRef.current)
    }
  }, [setIgnore])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) return

      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current)
        leaveTimeoutRef.current = null
      }

      const target = document.elementFromPoint(e.clientX, e.clientY)
      const isOverInteractive = !!target?.closest('.widget-interactive')

      if (isOverInteractive) {
        setIgnore(false)
        if (!isHovering) setIsHovering(true)
      } else {
        if (inputFocusedRef.current && inputRef.current) {
          inputRef.current.blur()
        }
        if (!showContextMenu && !showSpeechBubble) {
          leaveTimeoutRef.current = setTimeout(() => {
            setIgnore(true)
            setIsHovering(false)
            leaveTimeoutRef.current = null
          }, 200)
        }
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      if (leaveTimeoutRef.current) { clearTimeout(leaveTimeoutRef.current); leaveTimeoutRef.current = null }
    }
  }, [isHovering, showContextMenu, showSpeechBubble, setIgnore])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setShowContextMenu(true)
    const menuHeight = 100
    const menuWidth = 160
    setContextMenuPos({
      x: Math.max(0, Math.min(e.clientX, 300 - menuWidth)),
      y: Math.max(0, Math.min(e.clientY, 400 - menuHeight)),
    })
    setIgnore(false)
  }, [setIgnore])

  const handleOpenMainWindow = useCallback(() => {
    setShowContextMenu(false)
    setIgnore(true)
    window.electronAPI.widget.openMainWindow()
  }, [setIgnore])

  const handleClose = useCallback(() => {
    setShowContextMenu(false)
    window.electronAPI.widget.close()
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim() && !isTaskRunning) {
      const message = inputValue.trim()
      setInputValue('')
      setIsTaskRunning(true)
      void window.electronAPI.widget.sendMessage(message)
    }
  }, [inputValue, isTaskRunning])

  const handleInputFocus = useCallback(() => {
    inputFocusedRef.current = true
    setIgnore(false)
  }, [setIgnore])

  const handleInputBlur = useCallback(() => {
    inputFocusedRef.current = false
    setTimeout(() => {
      if (!showContextMenu && !isDraggingRef.current && !showSpeechBubble) {
        setIgnore(true)
      }
    }, 150)
  }, [showContextMenu, setIgnore, showSpeechBubble])

  const handleInputPanelMouseLeave = useCallback(() => {
    if (inputFocusedRef.current || showSpeechBubble) return
    setIsHovering(false)
    setTimeout(() => {
      if (!inputFocusedRef.current && !showSpeechBubble && !isDraggingRef.current) {
        setIgnore(true)
      }
    }, 150)
  }, [setIgnore, showSpeechBubble])

  useEffect(() => {
    if (!showContextMenu) return
    const handleClick = () => {
      setShowContextMenu(false)
      setTimeout(() => {
        if (!inputFocusedRef.current && !isDraggingRef.current && !showSpeechBubble) {
          setIgnore(true)
        }
      }, 100)
    }
    const handleResize = () => setShowContextMenu(false)
    setTimeout(() => {
      document.addEventListener('click', handleClick)
      window.addEventListener('resize', handleResize)
    }, 10)
    return () => {
      document.removeEventListener('click', handleClick)
      window.removeEventListener('resize', handleResize)
    }
  }, [showContextMenu, setIgnore, showSpeechBubble])

  const handleIconMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    isDraggingRef.current = true
    dragStartRef.current = { screenX: e.screenX, screenY: e.screenY }
    setIgnore(false)

    const handleMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return
      const dx = ev.screenX - dragStartRef.current.screenX
      const dy = ev.screenY - dragStartRef.current.screenY
      if (dx !== 0 || dy !== 0) {
        dragStartRef.current = { screenX: ev.screenX, screenY: ev.screenY }
        window.electronAPI.widget.moveBy(dx, dy)
      }
    }

    const handleUp = () => {
      isDraggingRef.current = false
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      setTimeout(() => {
        if (!inputFocusedRef.current && !showContextMenu && !showSpeechBubble) {
          setIgnore(true)
        }
      }, 100)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [setIgnore, showContextMenu, showSpeechBubble])

  const handleIconDoubleClick = useCallback(() => {
    window.electronAPI.widget.openMainWindow()
  }, [])

  const dismissSpeechBubble = useCallback(() => {
    setShowSpeechBubble(false)
    setTaskResult(null)
  }, [])

  const inputPanelOffset = inputPanelRef.current?.offsetHeight ?? 0
  const bubbleStyle: React.CSSProperties = isHovering ? {
    position: 'absolute',
    bottom: 96 + inputPanelOffset + 8,
    left: 16,
    right: 16,
    animation: 'widgetBubbleAppear 0.5s cubic-bezier(0.34,1.56,0.64,1)',
    zIndex: 20,
  } : {
    position: 'absolute',
    bottom: 96,
    left: 16,
    right: 16,
    animation: 'widgetBubbleAppear 0.5s cubic-bezier(0.34,1.56,0.64,1)',
    zIndex: 20,
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      position: 'relative',
      background: 'transparent',
    }}>
      {showSpeechBubble && taskResult && (
        <div className="widget-interactive" style={bubbleStyle}>
          <div style={{
            background: taskResult.success
              ? 'linear-gradient(135deg, rgba(236,253,245,0.97) 0%, rgba(209,250,229,0.97) 100%)'
              : 'linear-gradient(135deg, rgba(254,242,242,0.97) 0%, rgba(254,226,226,0.97) 100%)',
            backdropFilter: 'blur(12px)',
            borderRadius: 18,
            padding: '14px 16px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
            border: `1.5px solid ${taskResult.success ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
            position: 'relative',
            maxHeight: 200,
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: 8, right: 8,
              width: 20, height: 20, borderRadius: '50%',
              background: 'rgba(0,0,0,0.05)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
            onClick={dismissSpeechBubble}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.05)'}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>{taskResult.success ? '✨' : '💫'}</span>
              <span style={{
                fontSize: 13, fontWeight: 700,
                color: taskResult.success ? '#059669' : '#dc2626',
              }}>
                {taskResult.success ? '任务完成啦~' : '任务遇到了问题'}
              </span>
            </div>
            <div style={{
              fontSize: 13, color: '#374151', lineHeight: 1.6,
              wordBreak: 'break-word', paddingRight: 20,
              maxHeight: 130,
              overflowY: 'auto',
              overflowX: 'hidden',
            }}>
              {taskResult.message}
            </div>
          </div>
          <div style={{
            width: 0, height: 0,
            borderLeft: '10px solid transparent', borderRight: '10px solid transparent',
            borderTop: `10px solid ${taskResult.success ? 'rgba(209,250,229,0.97)' : 'rgba(254,226,226,0.97)'}`,
            marginLeft: 110,
          }} />
        </div>
      )}

      {isHovering && (
        <div
          ref={inputPanelRef}
          className="widget-interactive"
          onMouseLeave={handleInputPanelMouseLeave}
          style={{
            position: 'absolute',
            bottom: 96,
            left: 16,
            right: 16,
            animation: 'widgetFadeInUp 0.3s cubic-bezier(0.34,1.56,0.64,1)',
            zIndex: 15,
          }}
        >
          <div style={{
            background: 'rgba(255,255,255,0.96)',
            backdropFilter: 'blur(12px)',
            borderRadius: 16,
            padding: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.04)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #f0f0f0',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>快捷指令</span>
              {isTaskRunning && (
                <span style={{
                  fontSize: 11, color: '#3b82f6',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{
                    display: 'inline-block', width: 6, height: 6,
                    borderRadius: '50%', background: '#3b82f6',
                    animation: 'widgetPulse 1s ease-in-out infinite',
                  }} />
                  执行中
                </span>
              )}
            </div>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              disabled={isTaskRunning}
              placeholder="输入指令，按回车发送..."
              style={{
                width: '100%', padding: '10px 12px',
                border: '1.5px solid #e5e7eb', borderRadius: 10,
                fontSize: 13, color: '#1a1a1a', background: '#fafafa',
                outline: 'none', boxSizing: 'border-box',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div style={{
            width: 0, height: 0,
            borderLeft: '10px solid transparent', borderRight: '10px solid transparent',
            borderTop: '10px solid rgba(255,255,255,0.96)',
            marginLeft: 110,
          }} />
        </div>
      )}

      <div
        className="widget-interactive"
        onMouseDown={handleIconMouseDown}
        onDoubleClick={handleIconDoubleClick}
        onContextMenu={handleContextMenu}
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 64,
          height: 64,
          cursor: 'grab',
          userSelect: 'none',
          zIndex: 10,
        }}
      >
        <img
          src={logoUrl}
          alt=""
          draggable={false}
          style={{
            width: '100%', height: '100%',
            objectFit: 'contain',
            animation: 'widgetBreathe 3s ease-in-out infinite, widgetFloat 4s ease-in-out infinite',
            filter: isTaskRunning
              ? 'drop-shadow(0 0 10px rgba(59,130,246,0.7)) drop-shadow(0 0 20px rgba(59,130,246,0.3))'
              : 'drop-shadow(0 2px 8px rgba(0,0,0,0.15))',
            transition: 'filter 0.5s ease',
            pointerEvents: 'none',
          }}
        />

        <>
          <div style={{
            position: 'absolute', top: -8, left: -8, right: -8, bottom: -8,
            border: '2.5px solid transparent', borderTopColor: '#3b82f6', borderRightColor: '#60a5fa',
            borderRadius: '50%', animation: isTaskRunning ? 'widgetSpin 1s linear infinite' : 'none',
            pointerEvents: 'none',
            opacity: isTaskRunning ? 1 : 0,
            transition: 'opacity 0.3s ease',
          }} />
          <div style={{
            position: 'absolute', top: -14, left: -14, right: -14, bottom: -14,
            border: '1.5px solid transparent', borderBottomColor: 'rgba(59,130,246,0.4)',
            borderRadius: '50%', animation: isTaskRunning ? 'widgetSpin 1.8s linear infinite reverse' : 'none',
            pointerEvents: 'none',
            opacity: isTaskRunning ? 1 : 0,
            transition: 'opacity 0.3s ease',
          }} />
          <div style={{
            position: 'absolute', top: -4, right: -4, width: 12, height: 12,
            borderRadius: '50%', background: '#3b82f6',
            animation: isTaskRunning ? 'widgetPulse 1.2s ease-in-out infinite' : 'none',
            boxShadow: '0 0 8px rgba(59,130,246,0.6)',
            pointerEvents: 'none',
            opacity: isTaskRunning ? 1 : 0,
            transition: 'opacity 0.3s ease',
          }} />
        </>
      </div>

      {showContextMenu && (
        <div
          className="widget-interactive"
          style={{
            position: 'absolute',
            left: contextMenuPos.x,
            top: contextMenuPos.y,
            background: 'rgba(255,255,255,0.98)',
            backdropFilter: 'blur(12px)',
            borderRadius: 10,
            padding: '4px 0',
            boxShadow: '0 8px 30px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)',
            minWidth: 160,
            animation: 'widgetFadeIn 0.12s ease-out',
            zIndex: 30,
            overflow: 'visible',
          }}
        >
          <div
            onClick={handleOpenMainWindow}
            style={{
              padding: '9px 16px', fontSize: 13, color: '#1a1a1a',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
            打开主页面
          </div>
          <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0' }} />
          <div
            onClick={handleClose}
            style={{
              padding: '9px 16px', fontSize: 13, color: '#ef4444',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#fef2f2'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            关闭小工具
          </div>
        </div>
      )}

      <style>{`
        html, body, #root {
          background: transparent !important;
        }
        @keyframes widgetBreathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        @keyframes widgetFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes widgetSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes widgetPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(0.7); opacity: 0.5; }
        }
        @keyframes widgetFadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes widgetFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes widgetBubbleAppear {
          0% { opacity: 0; transform: scale(0.6) translateY(15px); }
          60% { transform: scale(1.05) translateY(-2px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  )
}
