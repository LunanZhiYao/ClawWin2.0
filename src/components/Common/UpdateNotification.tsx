import { useState, useEffect, useRef } from 'react'
import type { UpdateInfo, DownloadProgress } from '../../types'

interface UpdateNotificationProps {
  info: UpdateInfo
  onClose: () => void
  /** 从后台恢复时，直接进入指定阶段 */
  initialStage?: 'prompt' | 'done'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

export function UpdateNotification({ info, onClose, initialStage }: UpdateNotificationProps) {
  const [stage, setStage] = useState<'prompt' | 'downloading' | 'done' | 'error'>(initialStage ?? 'prompt')
  const [progress, setProgress] = useState<DownloadProgress>({ percent: 0, transferredBytes: 0, totalBytes: 0 })
  const [speed, setSpeed] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [currentVersion, setCurrentVersion] = useState('')
  const unsubRef = useRef<(() => void) | null>(null)
  const lastBytesRef = useRef(0)
  const speedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const latestProgressRef = useRef<DownloadProgress>({ percent: 0, transferredBytes: 0, totalBytes: 0 })
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    window.electronAPI.app.getVersion().then(setCurrentVersion).catch(() => {})
  }, [])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      unsubRef.current?.()
      if (speedTimerRef.current) clearInterval(speedTimerRef.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const handleDownload = async () => {
    setStage('downloading')
    setProgress({ percent: 0, transferredBytes: 0, totalBytes: 0 })
    lastBytesRef.current = 0
    latestProgressRef.current = { percent: 0, transferredBytes: 0, totalBytes: 0 }

    // 用 ref 存储最新进度，通过 rAF 节流更新 state，避免频繁渲染闪烁
    let rafScheduled = false
    unsubRef.current = window.electronAPI.app.onDownloadProgress((p) => {
      latestProgressRef.current = p
      if (!rafScheduled) {
        rafScheduled = true
        rafRef.current = requestAnimationFrame(() => {
          setProgress(latestProgressRef.current)
          rafScheduled = false
        })
      }
    })

    // 每秒计算下载速度（仅读取 ref，不触发 setProgress）
    speedTimerRef.current = setInterval(() => {
      const transferred = latestProgressRef.current.transferredBytes
      const delta = transferred - lastBytesRef.current
      lastBytesRef.current = transferred
      setSpeed(delta > 0 ? delta : 0)
    }, 1000)

    try {
      await window.electronAPI.app.downloadUpdate()
      setStage('done')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('下载已取消')) {
        onClose()
        return
      }
      setErrorMsg(msg)
      setStage('error')
    } finally {
      unsubRef.current?.()
      unsubRef.current = null
      if (speedTimerRef.current) { clearInterval(speedTimerRef.current); speedTimerRef.current = null }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      setSpeed(0)
    }
  }

  const handleInstall = async () => {
    try {
      await window.electronAPI.app.installUpdate()
    } catch {
      setErrorMsg('启动安装程序失败，请到下载目录手动运行安装包')
      setStage('error')
    }
  }

  return (
    <div className="settings-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="update-dialog" onClick={e => e.stopPropagation()}>
        <div className="update-dialog-header">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00A2E0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <h2>发现新版本</h2>
        </div>

        {stage === 'prompt' && (
          <>
            <div className="update-dialog-body">
              <p className="update-version">
                v{info.version}
                {currentVersion && <span className="update-current-version">当前 v{currentVersion}</span>}
                {info.updateType === 'lite' && <span className="update-type-badge lite">轻量更新</span>}
                {info.updateType === 'full' && <span className="update-type-badge full">完整更新</span>}
              </p>
              {info.releaseNotes && (
                <div className="update-notes">
                  {info.releaseNotes.split('\n').filter(Boolean).map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              )}
            </div>
            <div className="update-dialog-actions">
              {!info.forceUpdate && (
                <button className="btn-secondary" onClick={onClose}>暂不更新</button>
              )}
              <button className="btn-update" onClick={handleDownload}>立即更新</button>
            </div>
          </>
        )}

        {stage === 'downloading' && (
          <>
            <div className="update-dialog-body">
              <p className="update-status-text">正在下载更新...</p>
              <div className="update-progress-bar">
                <div className="update-progress-fill" style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="update-progress-text">
                {progress.percent}%
                {progress.totalBytes > 0 && ` — ${formatBytes(progress.transferredBytes)} / ${formatBytes(progress.totalBytes)}`}
                {speed > 0 && ` — ${formatSpeed(speed)}`}
              </p>
            </div>
          </>
        )}

        {stage === 'done' && (
          <>
            <div className="update-dialog-body">
              <p className="update-status-text">下载完成，准备安装</p>
              <p className="update-hint-text">安装过程中应用将自动关闭</p>
            </div>
            <div className="update-dialog-actions">
              <button className="btn-secondary" onClick={() => window.electronAPI.shell.openPath('')}>打开下载目录</button>
              <button className="btn-update" onClick={handleInstall}>立即安装</button>
            </div>
          </>
        )}

        {stage === 'error' && (
          <>
            <div className="update-dialog-body">
              <p className="update-error-text">{errorMsg}</p>
            </div>
            <div className="update-dialog-actions">
              <button className="btn-secondary" onClick={onClose}>关闭</button>
              <button className="btn-update" onClick={handleDownload}>重试</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
