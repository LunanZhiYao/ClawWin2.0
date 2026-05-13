import React, { useState, useRef, useEffect } from 'react'
import type { ChatSession, AgentInfo } from '../../types'

interface SessionListProps {
  sessions: ChatSession[]
  activeSessionId: string | null
  agents: AgentInfo[]
  defaultAgentId: string
  onSelectSession: (id: string) => void
  onNewSession: (agentId?: string) => void
  onDeleteSession: (id: string) => void
  onRestartGateway: () => void
}

const SESSION_COLORS = ['#E60012', '#00A2E0', '#FFCC00', '#4CAF50']
function getSessionColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return SESSION_COLORS[Math.abs(hash) % SESSION_COLORS.length]
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
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRestartGateway,
}) => {
  const [showPicker, setShowPicker] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
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

  const findAgent = (agentId?: string): AgentInfo | undefined => {
    if (!agentId) return undefined
    return agents.find((a) => a.id === agentId)
  }

  return (
    <div className="session-list">
      <div className="session-list-header" ref={pickerRef}>
        <button className="btn-new-session" onClick={handleNewClick} title="新对话">
          <span style={{fontSize: '18px'}}>+</span>
          <span>新对话</span>
        </button>
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
      </div>
      <div className="session-list-items">
        {sessions.length === 0 ? (
          <div className="session-empty">暂无对话记录</div>
        ) : (
          sessions.map((session) => {
            const agent = findAgent(session.agentId)
            const agentEmoji = agent ? getAgentEmoji(agent) : null
            return (
              <div
                key={session.id}
                className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                onClick={() => onSelectSession(session.id)}
              >
                <div className="session-active-indicator" />

                <span
                  className="session-avatar"
                  style={{ backgroundColor: getSessionColor(session.id) }}
                >
                  {agentEmoji || (session.title || '新对话').slice(0, 2)}
                </span>
                <div className="session-info">
                  <div className="session-title">{session.title || '新对话'}</div>
                  <div className="session-meta">
                    {agent && agent.id !== 'main' && (
                      <span className="session-agent-tag">{getAgentDisplayName(agent)}</span>
                    )}
                    {session.messages?.length || 0} 条消息
                  </div>
                </div>
                <button
                  className="btn-delete-session"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSessionToDelete(session)
                  }}
                  title="删除"
                >
                  &times;
                </button>
              </div>
            )
          })
        )}
      </div>
      {sessionToDelete && (
        <div
          className="session-delete-confirm-overlay"
        >
          <div
            className="session-delete-confirm-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="session-delete-confirm-title">关闭这个对话？</div>
            <div className="session-delete-confirm-desc">
              {`"${sessionToDelete.title || '新对话'}" 将从列表中移除。`}
            </div>
            <div className="session-delete-confirm-actions">
              <button
                className="session-delete-cancel-btn"
                onClick={() => setSessionToDelete(null)}
              >
                取消
              </button>
              <button
                className="session-delete-confirm-btn"
                onClick={() => {
                  onDeleteSession(sessionToDelete.id)
                  setSessionToDelete(null)
                }}
              >
                确认关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
