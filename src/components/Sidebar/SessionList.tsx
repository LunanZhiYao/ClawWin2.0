import React, { useState, useRef, useEffect } from 'react'
import type { ChatSession, AgentInfo } from '../../types'
import type { ElectronAPI } from '../../types/electron'
import logoSrc from '../../../assets/logo.png'

declare const window: Window & { electronAPI: ElectronAPI }

interface SessionListProps {
  sessions: ChatSession[]
  activeSessionId: string | null
  agents: AgentInfo[]
  defaultAgentId: string
  userName?: string
  sidebarView: 'sessions' | 'workspace' | 'skills' | 'cron'
  unreadSessionIds: Set<string>
  onSelectSession: (id: string) => void
  onNewSession: (agentId?: string) => void
  onDeleteSession: (id: string) => void
  onRestartGateway: () => void
  onSetSidebarView: (view: 'sessions' | 'workspace' | 'skills' | 'cron') => void
  onOpenSettings?: () => void
  onRenameSession: (id: string, title: string) => void
}

function getAgentDisplayName(agent: AgentInfo): string {
  return agent.identity?.name || agent.name || agent.id
}

function getAgentEmoji(agent: AgentInfo): string | null {
  return agent.identity?.emoji || null
}

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  activeSessionId,
  agents,
  defaultAgentId: _defaultAgentId,
  userName,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRestartGateway,
  sidebarView,
  unreadSessionIds,
  onSetSidebarView,
  onOpenSettings,
  onRenameSession,
}) => {
  const [showPicker, setShowPicker] = useState(false)
  const [widgetVisible, setWidgetVisible] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.widget.isVisible().then(setWidgetVisible).catch(() => {})
  }, [])
  const [renameValue, setRenameValue] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  useEffect(() => {
    if (!sessionToDelete) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSessionToDelete(null)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [sessionToDelete])

  const customAgents = agents.filter(a => a.id !== 'main')

  const handleNewClick = () => {
    if (customAgents.length === 0) {
      onNewSession(undefined)
    } else {
      setShowPicker(true)
    }
  }

  const filteredSessions = searchQuery
    ? sessions.filter(s =>
        s.title?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sessions

  return (
    <>
      {/* Sidebar Header */}
      <div className="sidebar-header">
        <div className="app-title">鲁南千易</div>
      </div>

      {/* Search */}
      <div className="sidebar-search">
        <svg className="sidebar-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
        <input
          type="text"
          className="sidebar-search-input"
          placeholder="搜索..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div
          className={`nav-item ${sidebarView === 'sessions' ? 'active' : ''}`}
          onClick={() => {
            onSetSidebarView('sessions')
            handleNewClick()
          }}
        >
          <span className="nav-item-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </span>
          新建对话
        </div>
        <div
          className={`nav-item ${sidebarView === 'cron' ? 'active' : ''}`}
          onClick={() => {
            onSetSidebarView('cron')
          }}
        >
          <span className="nav-item-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20v-6M6 20V10M18 20V4"></path>
            </svg>
          </span>
          定时任务
        </div>
        <div
          className={`nav-item ${sidebarView === 'skills' ? 'active' : ''}`}
          onClick={() => {
            onSetSidebarView('skills')
          }}
        >
          <span className="nav-item-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
          </span>
          技能商店
        </div>
      </nav>

      {/* Workspace Section */}
      <div className="sidebar-section">工作空间</div>
      <div className="sidebar-group">
        <div 
          className={`nav-item ${sidebarView === 'workspace' ? 'active' : ''}`}
          onClick={() => {
            onSetSidebarView(sidebarView === 'workspace' ? 'sessions' : 'workspace')
          }}
        >
          <span className="nav-item-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </span>
          {sidebarView === 'workspace' ? '隐藏工作区' : '工作区'}
        </div>
        <div
          className={`nav-item ${widgetVisible ? 'active' : ''}`}
          onClick={() => {
            void window.electronAPI.widget.toggle().then(() => {
              window.electronAPI.widget.isVisible().then(setWidgetVisible).catch(() => {})
            })
          }}
          style={{ color: widgetVisible ? 'var(--primary)' : undefined }}
        >
          <span className="nav-item-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="12" cy="12" r="3" />
              <path d="M19.5 12c0 4.14-3.36 7.5-7.5 7.5S4.5 16.14 4.5 12" />
            </svg>
          </span>
          桌面小助手
        </div>
      </div>

      {/* Session List */}
      <div className="session-list" ref={pickerRef}>
        {/* Session List Header - Title */}
        <div style={{ 
          padding: '16px 12px 8px', 
          fontSize: '13px', 
          fontWeight: '600', 
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          对话列表<span style={{ fontWeight: '400', color: 'var(--text-muted)', textTransform: 'none', fontSize: '11px' }}>  [双击标题重命名]</span>
        </div>
        
        {showPicker && (
          <div className="session-agent-picker">
            <div className="session-agent-picker-title">选择 Agent</div>
            <div
              className="agent-picker-item"
              onClick={() => {
                setShowPicker(false)
                onNewSession('main')
              }}
            >
              <span className="agent-picker-emoji">●</span>
              <span className="agent-picker-name">默认</span>
            </div>
            {customAgents.map((agent) => (
              <div
                key={agent.id}
                className="agent-picker-item"
                onClick={() => {
                  setShowPicker(false)
                  onNewSession(agent.id)
                }}
              >
                <span className="agent-picker-emoji">
                  {getAgentEmoji(agent) || getAgentDisplayName(agent).slice(0, 1)}
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

        <div style={{ flex: 1, overflow: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }} className="hide-scrollbar">
          {filteredSessions.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '40px 20px', 
              color: 'var(--text-muted)',
              fontSize: '13px'
            }}>
              {searchQuery ? '未找到匹配的对话' : '暂无对话记录'}
            </div>
          ) : (
            filteredSessions.map((session) => {
              const lastMessage = session.messages?.[session.messages.length - 1]
              const isActive = session.id === activeSessionId
              const isUnread = unreadSessionIds.has(session.id)
              
              return (
                <div
                  key={session.id}
                  className={`session-item ${isActive ? 'active' : ''} ${isUnread ? 'session-unread' : ''}`}
                  onClick={() => {
                    onSetSidebarView('sessions')
                    onSelectSession(session.id)
                  }}
                  onMouseEnter={(e) => {
                    const deleteBtn = e.currentTarget.querySelector('.btn-delete-session')
                    if (deleteBtn) (deleteBtn as HTMLElement).style.opacity = '1'
                  }}
                  onMouseLeave={(e) => {
                    const deleteBtn = e.currentTarget.querySelector('.btn-delete-session')
                    if (deleteBtn) (deleteBtn as HTMLElement).style.opacity = '0'
                  }}
                >
                  <div className="session-item-row">
                    <div className={`session-item-avatar ${isActive ? 'avatar-visible' : ''}`}>
                      <img src={logoSrc} alt="" className="session-avatar-img" />
                    </div>
                    <div className="session-item-content">
                      <div className="session-item-title" onDoubleClick={(e) => {
                        e.stopPropagation()
                        setRenamingSessionId(session.id)
                        setRenameValue(session.title || '')
                      }}>
                        {renamingSessionId === session.id ? (
                          <input
                            className="session-rename-input"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const trimmed = renameValue.trim()
                                if (trimmed) onRenameSession(session.id, trimmed)
                                setRenamingSessionId(null)
                              } else if (e.key === 'Escape') {
                                setRenamingSessionId(null)
                              }
                            }}
                            onBlur={() => {
                              const trimmed = renameValue.trim()
                              if (trimmed) onRenameSession(session.id, trimmed)
                              setRenamingSessionId(null)
                            }}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                          />
                        ) : (
                          <>
                            {session.title || '新对话'}
                            {isUnread && <span className="session-unread-dot" />}
                          </>
                        )}
                      </div>
                      {isActive && lastMessage && (
                        <div className="session-item-preview">
                          {lastMessage.content?.slice(0, 80) || ''}
                          {lastMessage.content && lastMessage.content.length > 80 ? '...' : ''}
                        </div>
                      )}
                    </div>
                    <button
                      className="btn-delete-session"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSessionToDelete(session)
                      }}
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Sidebar Footer */}
      <div className="sidebar-footer">
        <div className="user-avatar">{userName ? userName.charAt(0).toUpperCase() : 'U'}</div>
        <div className="user-info">
          <div className="user-name">{userName || '用户'}</div>
          {/*<div className="user-status">在线</div>*/}
        </div>
        <button 
          className="footer-action-btn"
          title="设置"
          onClick={() => onOpenSettings?.()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"></path>
          </svg>
        </button>
      </div>

      {/* Delete Confirmation Dialog */}
      {sessionToDelete && (
        <div
          className="session-delete-confirm-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'fadeIn 0.2s ease'
          }}
        >
          <div
            className="settings-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '400px' }}
          >
            <div className="settings-header">
              <h2>确认删除</h2>
              <button
                className="settings-close"
                onClick={() => setSessionToDelete(null)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="settings-body">
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
                确定要删除对话 "{sessionToDelete.title || '新对话'}" 吗？此操作无法撤销。
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  className="btn-secondary"
                  onClick={() => setSessionToDelete(null)}
                >
                  取消
                </button>
                <button
                  className="btn-danger"
                  onClick={() => {
                    onDeleteSession(sessionToDelete.id)
                    setSessionToDelete(null)
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
