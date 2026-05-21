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
function extBadge(entry: WorkspaceEntry | TreeNode): { label: string; category: string } {
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

/** 树节点渲染组件 */
const TreeNodeItem: React.FC<{
  node: TreeNode
  depth: number
  expandedPaths: Set<string>
  toggleExpand: (path: string) => void
  onOpenEntry: (entry: WorkspaceEntry) => void
  onDelete: (node: TreeNode) => void
}> = ({ node, depth, expandedPaths, toggleExpand, onOpenEntry, onDelete }) => {
  const isDir = node.kind === 'dir'
  const isExpanded = expandedPaths.has(node.relativePath)
  const badge = extBadge(node)

  const handleClick = useCallback(() => {
    if (isDir) {
      toggleExpand(node.relativePath)
    } else {
      // 将 TreeNode 转回 WorkspaceEntry 传给父组件
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

  /** 阻止事件冒泡，避免触发展开/打开 */
  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(node)
  }, [node, onDelete])

  return (
    <>
      <div
        className={`workspace-item ${isDir ? 'workspace-item--dir' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        title={node.path || node.relativePath}
      >
        <div className="workspace-item-main">
          {/* 文件夹展开/折叠箭头 */}
          {isDir && (
            <span className={`workspace-dir-arrow ${isExpanded ? 'workspace-dir-arrow--expanded' : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          )}
          <span
            className={`workspace-ext workspace-ext--${badge.category}`}
            title={isDir ? '目录' : `.${fileExtension(node.name) || '无后缀'}`}
          >
            {badge.label}
          </span>
          <span className="workspace-name">{node.name}</span>
          {/* 删除按钮 */}
          <button
            className="workspace-item-delete"
            onClick={handleDeleteClick}
            title="删除"
            aria-label={`删除 ${node.name}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </div>
        <div className="workspace-meta">
          {node.kind === 'file' ? formatSize(node.size) : `${node.children.length} 项`}
          {' · '}
          {node.modifiedAt > 0 ? formatTime(node.modifiedAt) : '--'}
        </div>
      </div>
      {/* 展开子节点 */}
      {isDir && isExpanded && node.children.map(child => (
        <TreeNodeItem
          key={child.relativePath}
          node={child}
          depth={depth + 1}
          expandedPaths={expandedPaths}
          toggleExpand={toggleExpand}
          onOpenEntry={onOpenEntry}
          onDelete={onDelete}
        />
      ))}
    </>
  )
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
        {tree.map(node => (
          <TreeNodeItem
            key={node.relativePath}
            node={node}
            depth={0}
            expandedPaths={expandedPaths}
            toggleExpand={toggleExpand}
            onOpenEntry={onOpenEntry}
            onDelete={handleDeleteRequest}
          />
        ))}
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
