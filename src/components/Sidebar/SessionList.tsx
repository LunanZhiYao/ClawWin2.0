import React, { useState, useRef, useEffect, useCallback } from 'react'
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
  const [showCreate, setShowCreate] = useState(false)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!showPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
        setShowCreate(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  const handleCreate = useCallback(async () => {
    const id = newId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    const name = newName.trim()
    if (!id) { setCreateError('请输入 Agent ID'); return }
    if (!name) { setCreateError('请输入名称'); return }
    setCreating(true)
    setCreateError('')
    try {
      const res = await window.electronAPI.agents.create({ agentId: id, name })
      if (!res.ok) { setCreateError(res.error || '创建失败'); setCreating(false); return }
      setShowCreate(false)
      setShowPicker(false)
      setNewId('')
      setNewName('')
      onRestartGateway()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }, [newId, newName, onRestartGateway])

  const customAgents = agents.filter(a => a.id !== 'main')

  const handleNewClick = () => {
    if (customAgents.length === 0) {
      // 没有自定义 agent，直接用隐式 main
      onNewSession(undefined)
    } else {
      // 有自定义 agent 时，显示选择器（包含 Main）
      setShowPicker(true)
      setShowCreate(false)
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
              <span className="agent-picker-emoji">M</span>
              <span className="agent-picker-name">Main</span>
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
            <div className="agent-picker-divider" />
            {!showCreate ? (
              <div
                className="agent-picker-item agent-create-btn"
                onClick={() => { setShowCreate(true); setCreateError('') }}
              >
                <span className="agent-picker-emoji" style={{fontSize: 16, fontWeight: 700, color: '#00A2E0'}}>+</span>
                <span className="agent-picker-name">新建 Agent</span>
              </div>
            ) : (
              <div className="agent-create-form">
                <input
                  className="agent-create-input agent-create-input-dark"
                  placeholder="Agent ID (小写字母/数字)"
                  value={newId}
                  onChange={(e) => setNewId(e.target.value.replace(/[^a-z0-9-]/g, ''))}
                  autoFocus
                />
                <input
                  className="agent-create-input agent-create-input-dark"
                  placeholder="显示名称"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                />
                {createError && <div className="agent-create-error">{createError}</div>}
                <div className="agent-create-actions">
                  <button className="agent-create-cancel" onClick={() => setShowCreate(false)}>取消</button>
                  <button className="agent-create-confirm" onClick={handleCreate} disabled={creating}>
                    {creating ? '创建中...' : '创建'}
                  </button>
                </div>
              </div>
            )}
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
                    {agent && <span className="session-agent-tag">{getAgentDisplayName(agent)}</span>}
                    {session.messages?.length || 0} 条消息
                  </div>
                </div>
                <button
                  className="btn-delete-session"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteSession(session.id)
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
    </div>
  )
}
