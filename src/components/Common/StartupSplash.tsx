/**
 * 应用级全屏启动等待层：与网关启动屏（VideoSplash）共用视觉结构，
 * 避免「初始化 / 验证登录」与「等待网关」两套样式不一致。
 */
interface StartupSplashProps {
  /** 主状态文案，显示在转圈下方 */
  message: string
  /** 底部次要说明（如长等待提示） */
  hint?: string
  /** 是否播放底部不确定进度条 */
  showProgressBar?: boolean
  /** 退场动画（与 VideoSplash 一致） */
  exiting?: boolean
}

export function StartupSplash({
  message,
  hint,
  showProgressBar = true,
  exiting = false,
}: StartupSplashProps) {
  return (
    <div className={`video-splash${exiting ? ' video-splash-exit' : ''}`}>
      <div className="startup-splash-gradient-bg" aria-hidden />
      <div className="video-splash-overlay" />

      <div className="startup-splash-center">
        <div className="startup-splash-spinner" aria-hidden />
        <p className="startup-splash-message">{message}</p>
      </div>

      {showProgressBar && (
        <div className="video-splash-status">
          <div className="video-splash-progress">
            <div className="video-splash-progress-bar" />
          </div>
          {hint ? <p className="video-splash-hint">{hint}</p> : null}
        </div>
      )}
    </div>
  )
}
