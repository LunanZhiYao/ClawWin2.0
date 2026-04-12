import { useState, useEffect } from 'react'
import type { GatewayState } from '../../types'
import { StartupSplash } from './StartupSplash'

interface VideoSplashProps {
  gatewayState: GatewayState
  exiting?: boolean
  onRetry?: () => void
}

/**
 * 网关启动/失败全屏层：加载态复用 StartupSplash；失败时保留原有错误卡片。
 */
export function VideoSplash({ gatewayState, exiting = false, onRetry }: VideoSplashProps) {
  const [waitingLong, setWaitingLong] = useState(false)

  useEffect(() => {
    if (gatewayState === 'starting' || gatewayState === 'restarting') {
      const timer = setTimeout(() => setWaitingLong(true), 8000)
      return () => clearTimeout(timer)
    }
    setWaitingLong(false)
  }, [gatewayState])

  const isError = gatewayState === 'error'

  if (isError) {
    return (
      <div className={`video-splash${exiting ? ' video-splash-exit' : ''}`}>
        <div className="startup-splash-gradient-bg" aria-hidden />
        <div className="video-splash-overlay" />
        <div className="video-splash-error">
          <div className="video-splash-error-card">
            <div className="video-splash-error-icon">!</div>
            <h3>网关启动失败</h3>
            <p>Gateway 进程未能响应，请检查配置后重试</p>
            {onRetry && (
              <button type="button" className="btn-primary" onClick={onRetry}>
                重试
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <StartupSplash
      message="正在启动本地网关"
      hint={waitingLong ? '首次启动需要较长时间，请耐心等待...' : undefined}
      exiting={exiting}
    />
  )
}
