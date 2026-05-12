import React from 'react'
import type { WorkspaceEntry } from '../../types'

interface WorkspaceListProps {
  currentAgentId: string
  workspacePath: string
  entries: WorkspaceEntry[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onOpenEntry: (entry: WorkspaceEntry) => void
  onOpenWorkspace: () => void
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 从文件名取后缀（不含点），小写 */
function fileExtension(name: string): string {
  const m = name.trim().match(/\.([^.\\/]+)$/)
  return m ? m[1].toLowerCase() : ''
}

/**
 * 列表侧标识：按后缀展示，便于区分类型。
 * category 用于样式分组（不必与后缀一一对应）。
 */
function extBadge(entry: WorkspaceEntry): { label: string; category: string } {
  if (entry.kind === 'dir') return { label: '目录', category: 'dir' }
  const ext = fileExtension(entry.name)
  if (!ext) return { label: '无后缀', category: 'none' }
  const label = ext.length <= 6 ? ext.toUpperCase() : `${ext.slice(0, 5).toUpperCase()}…`

  const pdf = new Set(['pdf'])
  const doc = new Set(['doc', 'docx', 'odt', 'rtf'])
  const sheet = new Set(['xls', 'xlsx', 'csv', 'ods'])
  const slide = new Set(['ppt', 'pptx', 'odp'])
  const image = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'heic'])
  const archive = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2'])
  const code = new Set(['json', 'xml', 'html', 'htm', 'yaml', 'yml', 'toml', 'ini', 'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'cs', 'sql'])
  const text = new Set(['md', 'txt', 'log', 'markdown'])

  let category = 'other'
  if (pdf.has(ext)) category = 'pdf'
  else if (doc.has(ext)) category = 'doc'
  else if (sheet.has(ext)) category = 'sheet'
  else if (slide.has(ext)) category = 'slide'
  else if (image.has(ext)) category = 'image'
  else if (archive.has(ext)) category = 'archive'
  else if (code.has(ext)) category = 'code'
  else if (text.has(ext)) category = 'text'

  return { label, category }
}

export const WorkspaceList: React.FC<WorkspaceListProps> = ({
  currentAgentId,
  workspacePath,
  entries,
  loading,
  error,
  onRefresh,
  onOpenEntry,
  onOpenWorkspace,
}) => {
  return (
    <div className="workspace-list">
      <div className="workspace-list-header">
        <button className="btn-new-session" onClick={onOpenWorkspace} title={workspacePath}>
          <span className="workspace-path-text">
            [{currentAgentId}] {workspacePath || '未设置工作区'}
          </span>
        </button>
        <button
          type="button"
          className="workspace-refresh-btn"
          onClick={onRefresh}
          disabled={loading}
          title="重新扫描当前代理工作区中的交付产物文件"
          aria-label="重新扫描工作区交付产物"
        >
          {loading ? (
            <span className="workspace-refresh-spin" aria-hidden="true">↻</span>
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10M1 14l5.36 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          )}
        </button>
      </div>

      <div className="workspace-list-items">
        {loading && entries.length === 0 && <div className="session-empty">正在加载工作区产物...</div>}
        {!loading && error && <div className="session-empty">{error}</div>}
        {!loading && !error && entries.length === 0 && (
          <div className="session-empty">当前工作区暂无可识别的交付产物文件</div>
        )}
        {entries.map((entry) => {
          const badge = extBadge(entry)
          return (
          <div
            key={entry.path}
            className="workspace-item"
            onClick={() => onOpenEntry(entry)}
            title={entry.path}
          >
            <div className="workspace-item-main">
              <span
                className={`workspace-ext workspace-ext--${badge.category}`}
                title={entry.kind === 'dir' ? '目录' : `.${fileExtension(entry.name) || '无后缀'}`}
              >
                {badge.label}
              </span>
              <span className="workspace-name">{entry.relativePath}</span>
            </div>
            <div className="workspace-meta">
              {entry.kind === 'file' ? formatSize(entry.size) : '--'}
              {' · '}
              {formatTime(entry.modifiedAt)}
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}
