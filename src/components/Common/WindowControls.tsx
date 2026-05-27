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
        <span className="wc-icon">─</span>
      </button>
      
      <button
        className={`window-control-btn ${isMaximized ? 'window-control-restore' : 'window-control-maximize'}`}
        onClick={handleMaximize}
        title={isMaximized ? "还原" : "最大化"}
      >
        <span className="wc-icon">{isMaximized ? '❐' : '□'}</span>
      </button>
      
      <button
        className="window-control-btn window-control-close"
        onClick={handleClose}
        title="关闭"
      >
        <span className="wc-icon">×</span>
      </button>
    </div>
  )
}
