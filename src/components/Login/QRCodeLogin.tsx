/**
 * 扫码登录：轮询仅用于拿到 access_token（1003）；用户与 model_config 由上层通过 /auth/me 拉取，与冷启动一致。
 */
import { useState, useEffect, useCallback } from 'react'
import { getQRCode, checkQRCode } from '../../api/auth'

interface QRCodeLoginProps {
  /** 传入 QR 接口返回的 access_token；由调用方 fetchMeSession 完成后续同步 */
  onLoginSuccess: (token: string) => Promise<void>
  /** 关闭/退出按钮回调 */
  onClose?: () => void
}

export function QRCodeLogin({ onLoginSuccess, onClose }: QRCodeLoginProps) {
  const [qrCodeData, setQRCodeData] = useState<any>(null)
  const [qrCodeKey, setQRCodeKey] = useState<string>('')
  const [status, setStatus] = useState<'loading' | 'waiting' | 'scanned' | 'expired' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string>('')

  const fetchQRCode = useCallback(async () => {
    setStatus('loading')
    setErrorMessage('')
    try {
      const response = await getQRCode()
      if (response.code === 200 && response.data) {
        setQRCodeData(response.data)
        const qrcode = response.data.qrcode || response.data.qr_code
        if (qrcode) {
          setQRCodeKey(qrcode)
          setStatus('waiting')
        } else {
          setStatus('error')
          setErrorMessage('二维码数据格式错误')
        }
      } else {
        setStatus('error')
        setErrorMessage(response.message || '获取二维码失败')
      }
    } catch (error) {
      setStatus('error')
      setErrorMessage('网络错误，请检查后端服务是否启动')
      console.error('获取二维码失败:', error)
    }
  }, [])

  useEffect(() => {
    fetchQRCode()
  }, [fetchQRCode])

  useEffect(() => {
    // 仅等待和已扫码会继续加载
    if ((status !== 'waiting' && status !== 'scanned') || !qrCodeKey) return

    // 使用 setInterval + async 会在上一次请求未完成时又发新请求，易造成并发与顺序错乱；
    // 改为「单次请求结束后再 setTimeout 排下一次」，保证同一时刻最多一个 check 在途。
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const POLL_MS = 1000

    const runPoll = async () => {
      if (cancelled) return
      try {
        const response = await checkQRCode(qrCodeKey)
        if (cancelled) return
        const code = response.data?.code
        console.log('扫码状态检查:', { code, type: typeof code })

        // 兼容字符串和数字类型的 code
        if (code === '1005' || code === 1005) {
          setStatus('expired')
          return
        }
        if (code === '1002' || code === 1002) {
          setStatus('scanned')
        } else if ((code === '1003' || code === 1003) && response.data?.access_token) {
          setStatus('scanned')
          try {
            await onLoginSuccess(response.data.access_token)
          } catch (err) {
            if (!cancelled) {
              setStatus('error')
              setErrorMessage(err instanceof Error ? err.message : '登录失败')
            }
          }
          return
        }
      } catch (error) {
        if (!cancelled) console.error('检查扫码状态失败:', error)
      }

      if (!cancelled) timeoutId = setTimeout(() => void runPoll(), POLL_MS)
    }

    // 与原先 setInterval 一致：首次轮询在间隔后触发
    timeoutId = setTimeout(() => void runPoll(), POLL_MS)

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [status, qrCodeKey, onLoginSuccess])

  const handleRefresh = () => {
    fetchQRCode()
  }

  return (
    <div className="qrcode-login-container">
      {onClose && (
        <button className="qrcode-login-close" onClick={onClose} title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
      <div className="qrcode-login-card">
        <h2 className="qrcode-login-title">鲁南千易 - 扫码登录</h2>

        {status === 'loading' && (
          <div className="qrcode-loading">
            <div className="qrcode-spinner"></div>
            <p>正在加载二维码...</p>
          </div>
        )}

        {status === 'waiting' && qrCodeData && (
          <div className="qrcode-display">
            {qrCodeData.img ? (
              <img
                src={`${qrCodeData.img}`}
                alt="登录二维码"
                className="qrcode-image"
              />
            ) : (
              <div className="qrcode-placeholder">
                <p>二维码已生成</p>
                <p className="qrcode-key">{qrCodeKey}</p>
              </div>
            )}
          </div>
        )}

        {status === 'scanned' && (
          <div className="qrcode-success">
            <div className="qrcode-success-icon">✓</div>
            <p className="qrcode-key">扫码成功，正在登录...</p>
          </div>
        )}

        {status === 'expired' && (
          <div className="qrcode-expired">
            <div className="qrcode-expired-icon">!</div>
            <p>二维码已失效</p>
            <button className="qrcode-refresh-btn" onClick={handleRefresh}>
              刷新二维码
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="qrcode-error">
            <div className="qrcode-error-icon">✗</div>
            <p>{errorMessage}</p>
            <button className="qrcode-refresh-btn" onClick={handleRefresh}>
              重试
            </button>
          </div>
        )}

        <div className="qrcode-footer">
          <p>使用云上鲁南扫码登录</p>
        </div>
      </div>
    </div>
  )
}
