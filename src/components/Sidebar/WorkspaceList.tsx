import React, { useState, useMemo, useCallback } from 'react'
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
  onClose?: () => void
  onReference?: (entry: WorkspaceEntry) => void
}

/** 树节点：文件夹或文件 */
interface TreeNode {
  /** 节点名称（仅当前层级名称） */
  name: string
  /** 完整相对路径 */
  relativePath: string
  /** 绝对路径 */
  path: string
  kind: 'file' | 'dir'
  size?: number
  modifiedAt: number
  /** 子节点（仅文件夹有） */
  children: TreeNode[]
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
 * 将扁平的 WorkspaceEntry 列表转换为树形结构。
 * 根据 relativePath 中的路径分隔符拆分层级。
 * 排序规则：按修改时间倒序（最新在上）。
 */
function buildTree(flatEntries: WorkspaceEntry[]): TreeNode[] {
  const root: TreeNode[] = []
  // 使用 Map 缓存已创建的目录节点，避免重复创建
  const dirMap = new Map<string, TreeNode>()

  for (const entry of flatEntries) {
    // 统一使用 / 分隔
    const parts = entry.relativePath.replace(/\\/g, '/').split('/')
    let currentLevel = root

    for (let i = 0; i < parts.length; i++) {
      const partName = parts[i]
      const partPath = parts.slice(0, i + 1).join('/')

      if (i === parts.length - 1) {
        // 最后一段：叶子节点（文件或目录本身）
        if (entry.kind === 'dir') {
          // 目录节点可能已由子项提前创建
          const existing = dirMap.get(partPath)
          if (existing) {
            // 补充目录自身的信息
            existing.size = entry.size
            existing.modifiedAt = entry.modifiedAt
            existing.path = entry.path
          } else {
            const node: TreeNode = {
              name: partName,
              relativePath: entry.relativePath,
              path: entry.path,
              kind: 'dir',
              size: entry.size,
              modifiedAt: entry.modifiedAt,
              children: [],
            }
            dirMap.set(partPath, node)
            currentLevel.push(node)
          }
        } else {
          // 文件节点
          currentLevel.push({
            name: partName,
            relativePath: entry.relativePath,
            path: entry.path,
            kind: 'file',
            size: entry.size,
            modifiedAt: entry.modifiedAt,
            children: [],
          })
        }
      } else {
        // 中间段：隐含的目录层级（后端可能没有单独返回该目录条目）
        let dirNode = dirMap.get(partPath)
        if (!dirNode) {
          dirNode = {
            name: partName,
            relativePath: partPath,
            path: '', // 隐含目录，无独立绝对路径
            kind: 'dir',
            modifiedAt: 0,
            children: [],
          }
          dirMap.set(partPath, dirNode)
          currentLevel.push(dirNode)
        }
        currentLevel = dirNode.children
      }
    }
  }

  // 递归排序：按修改时间倒序（最新在上），时间相同则按名称排序
  function sortNodes(nodes: TreeNode[]): TreeNode[] {
    return nodes.sort((a, b) => {
      // 有修改时间的排前面
      if (a.modifiedAt > 0 && b.modifiedAt > 0) return b.modifiedAt - a.modifiedAt
      if (a.modifiedAt > 0) return -1
      if (b.modifiedAt > 0) return 1
      return a.name.localeCompare(b.name, 'zh-CN')
    }).map(node => {
      if (node.children.length > 0) {
        return { ...node, children: sortNodes(node.children) }
      }
      return node
    })
  }

  return sortNodes(root)
}

/** 删除确认弹窗组件 */
const DeleteConfirmModal: React.FC<{
  entryName: string
  entryKind: 'file' | 'dir'
  onConfirm: () => void
  onCancel: () => void
}> = ({ entryName, entryKind, onConfirm, onCancel }) => {
  const isDir = entryKind === 'dir'
  return (
    <div className="workspace-delete-overlay" onClick={onCancel}>
      <div className="workspace-delete-modal" onClick={e => e.stopPropagation()}>
        <div className="workspace-delete-modal-title">确认删除</div>
        <div className="workspace-delete-modal-body">
          确定要删除{isDir ? '文件夹' : '文件'} <strong>{entryName}</strong> 吗？
          {isDir && <span className="workspace-delete-modal-warn">该文件夹下的所有内容将被一并删除，此操作不可恢复。</span>}
          {!isDir && <span className="workspace-delete-modal-warn">此操作不可恢复。</span>}
        </div>
        <div className="workspace-delete-modal-actions">
          <button className="workspace-delete-btn-cancel" onClick={onCancel}>取消</button>
          <button className="workspace-delete-btn-confirm" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  )
}

/** 文件类型图标 SVG */
function FileIcon({ ext }: { ext: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    txt: (
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="8" y="6" width="32" height="36" rx="3" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="1.5"/>
        <text x="24" y="30" textAnchor="middle" fontSize="11" fontWeight="700" fill="#6B7280" fontFamily="sans-serif">TXT</text>
      </svg>
    ),
    html: (
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="8" y="6" width="32" height="36" rx="3" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="1.5"/>
        <text x="24" y="28" textAnchor="middle" fontSize="9" fontWeight="700" fill="#E44D26" fontFamily="sans-serif">HTML</text>
      </svg>
    ),
    htm: (
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="8" y="6" width="32" height="36" rx="3" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="1.5"/>
        <text x="24" y="28" textAnchor="middle" fontSize="9" fontWeight="700" fill="#E44D26" fontFamily="sans-serif">HTML</text>
      </svg>
    ),
    css: (
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="8" y="6" width="32" height="36" rx="3" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="1.5"/>
        <text x="24" y="29" textAnchor="middle" fontSize="14" fontWeight="700" fill="#264DE4" fontFamily="monospace">&lt;/&gt;</text>
      </svg>
    ),
    js: (
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="8" y="6" width="32" height="36" rx="3" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="1.5"/>
        <text x="24" y="29" textAnchor="middle" fontSize="14" fontWeight="700" fill="#F7DF1E" fontFamily="monospace">JS</text>
      </svg>
    ),
    ts: (
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="8" y="6" width="32" height="36" rx="3" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="1.5"/>
        <text x="24" y="29" textAnchor="middle" fontSize="12" fontWeight="700" fill="#3178C6" fontFamily="monospace">TS</text>
      </svg>
    ),
    json: (
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="8" y="6" width="32" height="36" rx="3" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="1.5"/>
        <text x="24" y="29" textAnchor="middle" fontSize="10" fontWeight="700" fill="#5C6BC0" fontFamily="monospace">{ }</text>
      </svg>
    ),
    md: (
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="8" y="6" width="32" height="36" rx="3" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="1.5"/>
        <text x="24" y="29" textAnchor="middle" fontSize="11" fontWeight="700" fill="#083FA1" fontFamily="sans-serif">MD</text>
      </svg>
    ),
    py: (
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="8" y="6" width="32" height="36" rx="3" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="1.5"/>
        <text x="24" y="29" textAnchor="middle" fontSize="13" fontWeight="700" fill="#3776AB" fontFamily="monospace">PY</text>
      </svg>
    ),
    pdf: (
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="8" y="6" width="32" height="36" rx="3" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="1.5"/>
        <text x="24" y="29" textAnchor="middle" fontSize="11" fontWeight="700" fill="#DC2626" fontFamily="sans-serif">PDF</text>
      </svg>
    ),
  }

  return (
    <span className="ws-file-icon">
      {iconMap[ext] || (
        <svg viewBox="0 0 48 48" fill="none">
          <rect x="8" y="6" width="32" height="36" rx="3" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="1.5"/>
          <path d="M18 20h12M18 26h12M18 32h8" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      )}
    </span>
  )
}

/** 树节点渲染组件 */
const TreeNodeItem: React.FC<{
  node: TreeNode
  depth: number
  expandedPaths: Set<string>
  toggleExpand: (path: string) => void
  onOpenEntry: (entry: WorkspaceEntry) => void
  onDelete: (node: TreeNode) => void
  onReference?: (node: TreeNode) => void
}> = ({ node, depth, expandedPaths, toggleExpand, onOpenEntry, onDelete, onReference }) => {
  const isDir = node.kind === 'dir'
  const isExpanded = expandedPaths.has(node.relativePath)
  const ext = fileExtension(node.name)

  const handleClick = useCallback(() => {
    if (isDir) {
      toggleExpand(node.relativePath)
    } else {
      onOpenEntry({
        name: node.name,
        path: node.path,
        relativePath: node.relativePath,
        kind: node.kind,
        size: node.size,
        modifiedAt: node.modifiedAt,
      })
    }
  }, [isDir, node, toggleExpand, onOpenEntry])

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(node)
  }, [node, onDelete])

  const handleReferenceClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onReference?.(node)
  }, [node, onReference])

  if (isDir) {
    return (
      <>
        <div
          className={`ws-file-card ws-file-card--dir`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={handleClick}
        >
          <div className="ws-file-card-left">
            <span className={`ws-dir-arrow ${isExpanded ? 'ws-dir-arrow--expanded' : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
            <FileIcon ext="folder" />
          </div>
          <div className="ws-file-card-right">
            <span className="ws-file-name">{node.name}</span>
            <span className="ws-file-meta">{node.children.length} 项</span>
          </div>
          <button className="ws-file-reference" onClick={handleReferenceClick} title="引用">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </button>
          <button className="ws-file-delete" onClick={handleDeleteClick} title="删除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
        {isExpanded && node.children.map(child => (
          <TreeNodeItem
            key={child.relativePath}
            node={child}
            depth={depth + 1}
            expandedPaths={expandedPaths}
            toggleExpand={toggleExpand}
            onOpenEntry={onOpenEntry}
            onDelete={onDelete}
            onReference={onReference}
          />
        ))}
      </>
    )
  }

  return (
    <div
      className="ws-file-card"
      style={{ paddingLeft: `${12 + depth * 16}px` }}
      onClick={handleClick}
    >
      <div className="ws-file-card-left">
        <FileIcon ext={ext} />
      </div>
      <div className="ws-file-card-right">
        <span className="ws-file-name">{node.name}</span>
        <span className="ws-file-meta">
          最后修改 {node.modifiedAt > 0 ? formatTime(node.modifiedAt) : '--'}
        </span>
      </div>
      <button className="ws-file-reference" onClick={handleReferenceClick} title="引用">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </button>
      <button className="ws-file-delete" onClick={handleDeleteClick} title="删除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  )
}

export const WorkspaceList: React.FC<WorkspaceListProps> = ({
  currentAgentId: _currentAgentId,
  workspacePath,
  entries,
  loading,
  error: _error,
  onRefresh,
  onOpenEntry,
  onOpenWorkspace: _onOpenWorkspace,
  onClose,
  onReference,
}) => {
  // 记录已展开的文件夹路径
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  // 删除确认弹窗状态
  const [deleteTarget, setDeleteTarget] = useState<TreeNode | null>(null)
  // 删除中状态
  const [deleting, setDeleting] = useState(false)

  // 将扁平列表转为树形结构
  const tree = useMemo(() => buildTree(entries), [entries])

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  /** 点击删除按钮：弹出确认弹窗 */
  const handleDeleteRequest = useCallback((node: TreeNode) => {
    // 隐含目录（无绝对路径）不允许删除
    if (!node.path) return
    setDeleteTarget(node)
  }, [])

  /** 确认删除 */
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const result = await window.electronAPI.workspace.deleteEntry(deleteTarget.path)
      if (!result.ok) {
        alert(`删除失败：${result.error || '未知错误'}`)
      } else {
        // 删除成功后折叠该路径并刷新列表
        setExpandedPaths(prev => {
          const next = new Set(prev)
          next.delete(deleteTarget.relativePath)
          return next
        })
        onRefresh()
      }
    } catch (err) {
      alert(`删除失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }, [deleteTarget, onRefresh])

  /** 取消删除 */
  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null)
  }, [])

  return (
    <div className="workspace-list">
      {/* 第一行：图标 + 标签 + 窗口控制 */}
      <div className="workspace-toolbar">
        <div className="workspace-toolbar-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        
        <div className="workspace-toolbar-title">工作区</div>
        
        <div className="workspace-toolbar-right">
          {onClose && (
            <button
              type="button"
              className="workspace-toggle-btn"
              onClick={onClose}
              title="收起工作区面板"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 第二行：路径 + 刷新 */}
      <div className="workspace-dir-card">
        <div className="workspace-dir-header">
          <span className="workspace-dir-label">目录地址：</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <span
              className="workspace-dir-path"
              onClick={() => {
                const path = workspacePath || 'C:\\Users\\Ezer\\qianyi'
                window.electronAPI?.shell?.openPath?.(path)
              }}
              title="点击打开文件夹"
              style={{ cursor: 'pointer' }}
            >
              {workspacePath || 'C:\\Users\\Ezer\\qianyi'}
            </span>
            <button
              type="button"
              className={`workspace-refresh-btn ${loading ? 'loading' : ''}`}
              onClick={onRefresh}
              disabled={loading}
              title="刷新"
              style={{
                width: '32px',
                height: '32px',
                border: 'none',
                background: 'var(--bg-main)',
                borderRadius: 'var(--radius)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                transition: 'all 0.2s'
              }}
            >
              {loading ? (
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>↻</span>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10M1 14l5.36 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="workspace-file-tree">
          {tree.map(node => (
            <TreeNodeItem
              key={node.relativePath}
              node={node}
              depth={0}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
              onOpenEntry={onOpenEntry}
              onDelete={handleDeleteRequest}
              onReference={onReference ? (node) => {
                onReference({
                  name: node.name,
                  path: node.path,
                  relativePath: node.relativePath,
                  kind: node.kind,
                  size: node.size,
                  modifiedAt: node.modifiedAt,
                })
              } : undefined}
            />
          ))}
        </div>
      </div>

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <DeleteConfirmModal
          entryName={deleteTarget.name}
          entryKind={deleteTarget.kind}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
      {/* 删除中遮罩 */}
      {deleting && (
        <div className="workspace-delete-overlay">
          <div className="workspace-delete-modal">
            <div className="workspace-delete-modal-title">正在删除...</div>
          </div>
        </div>
      )}
    </div>
  )
}
