import { useState, useEffect } from 'react'

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const checkMaximized = async () => {
      try {
        const maximized = await window.electronAPI.windowControls.isMaximized()
        setIsMaximized(maximized)
      } catch (e) {
        console.error('Failed to check window state:', e)
      }
    }
    
    checkMaximized()
    
    const interval = setInterval(checkMaximized, 1000)
    return () => clearInterval(interval)
  }, [])

  const handleMinimize = async () => {
    try {
      await window.electronAPI.windowControls.minimize()
    } catch (e) {
      console.error('Minimize failed:', e)
    }
  }

  const handleMaximize = async () => {
    try {
      await window.electronAPI.windowControls.maximize()
      const maximized = await window.electronAPI.windowControls.isMaximized()
      setIsMaximized(maximized)
    } catch (e) {
      console.error('Maximize failed:', e)
    }
  }

  const handleClose = async () => {
    try {
      await window.electronAPI.windowControls.close()
    } catch (e) {
      console.error('Close failed:', e)
    }
  }

  return (
    <div className="window-controls">
      <button
        className="window-control-btn window-control-minimize"
        onClick={handleMinimize}
        title="最小化"
      >
        <svg className="wc-icon-svg" width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor"/>
        </svg>
      </button>
      
      <button
        className={`window-control-btn ${isMaximized ? 'window-control-restore' : 'window-control-maximize'}`}
        onClick={handleMaximize}
        title={isMaximized ? "还原" : "最大化"}
      >
        {isMaximized ? (
          <svg className="wc-icon-svg" width="10" height="10" viewBox="0 0 10 10">
            <rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1"/>
            <rect x="0" y="2" width="8" height="8" fill="var(--bg-main)" stroke="currentColor" strokeWidth="1"/>
          </svg>
        ) : (
          <svg className="wc-icon-svg" width="10" height="10" viewBox="0 0 10 10">
            <rect width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1"/>
          </svg>
        )}
      </button>
      
      <button
        className="window-control-btn window-control-close"
        onClick={handleClose}
        title="关闭"
      >
        <svg className="wc-icon-svg" width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2"/>
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
      </button>
    </div>
  )
}
