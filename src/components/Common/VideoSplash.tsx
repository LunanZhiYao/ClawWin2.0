import { useState, useEffect } from 'react'
import type { GatewayState } from '../../types'

interface VideoSplashProps {
  gatewayState: GatewayState
  exiting?: boolean
  onRetry?: () => void
}

/**
 * 简化的启动屏组件 - 使用渐变背景和加载动画替代视频
 */
export function VideoSplash({ gatewayState, exiting = false, onRetry }: VideoSplashProps) {
  const [waitingLong, setWaitingLong] = useState(false)

  // 等待超过 8 秒后显示提示
  useEffect(() => {
    if (gatewayState === 'starting' || gatewayState === 'restarting') {
      const timer = setTimeout(() => setWaitingLong(true), 8000)
      return () => clearTimeout(timer)
    }
    setWaitingLong(false)
  }, [gatewayState])

  const isError = gatewayState === 'error'

  return (
    <div className={`video-splash${exiting ? ' video-splash-exit' : ''}`}>
      {/* 渐变背景替代视频 */}
      <div
        className="video-splash-bg"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'
        }}
      />

      <div className="video-splash-overlay" />

      {/* 加载动画 */}
      {!isError && (
        <div className="video-splash-loading" style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          zIndex: 10
        }}>
          <div style={{
            width: '60px',
            height: '60px',
            border: '4px solid rgba(255,255,255,0.1)',
            borderTop: '4px solid #e94560',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 20px'
          }} />
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {isError && (
        <div className="video-splash-error">
          <div className="video-splash-error-card">
            <div className="video-splash-error-icon">!</div>
            <h3>网关启动失败</h3>
            <p>Gateway 进程未能响应，请检查配置后重试</p>
            {onRetry && (
              <button className="btn-primary" onClick={onRetry}>重试</button>
            )}
          </div>
        </div>
      )}

      {!isError && (
        <div className="video-splash-status">
          <div className="video-splash-progress">
            <div className="video-splash-progress-bar" />
          </div>
          {waitingLong && (
            <p className="video-splash-hint">首次启动需要较长时间，请耐心等待...</p>
          )}
        </div>
      )}
    </div>
  )
}
