import { useEffect, useRef } from 'react'

interface AppCloseDialogProps {
  visible: boolean
  onClose: () => void
  onMinimizeToTray: () => void
  onQuit: () => void
}

export function AppCloseDialog({
  visible,
  onClose,
  onMinimizeToTray,
  onQuit,
}: AppCloseDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visible && dialogRef.current) {
      dialogRef.current.focus()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose])

  if (!visible) return null

  return (
    <div
      className="app-close-dialog-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-close-dialog-title"
    >
      <div
        ref={dialogRef}
        className="app-close-dialog"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="app-close-dialog-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        
        <h2 id="app-close-dialog-title" className="app-close-dialog-title">
          关闭 鲁南千易
        </h2>
        
        <p className="app-close-dialog-desc">
          请选择关闭方式
        </p>

        <div className="app-close-dialog-options">
          <button
            type="button"
            className="app-close-option-btn app-close-option-tray"
            onClick={onMinimizeToTray}
          >
            <div className="app-close-option-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7h18" />
                <path d="M3 12h18" />
                <path d="M3 17h18" />
                <circle cx="12" cy="17" r="1" fill="currentColor" />
              </svg>
            </div>
            <div className="app-close-option-content">
              <span className="app-close-option-title">最小化到托盘</span>
              <span className="app-close-option-desc">保持网关运行，随时唤醒</span>
            </div>
          </button>

          <button
            type="button"
            className="app-close-option-btn app-close-option-quit"
            onClick={onQuit}
          >
            <div className="app-close-option-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </div>
            <div className="app-close-option-content">
              <span className="app-close-option-title">退出程序</span>
              <span className="app-close-option-desc">关闭所有进程</span>
            </div>
          </button>
        </div>

        <button
          type="button"
          className="app-close-cancel-btn"
          onClick={onClose}
        >
          取消
        </button>

        <p className="app-close-dialog-hint">
          提示：可在设置中修改默认关闭行为
        </p>
      </div>
    </div>
  )
}