import React, { useState, useEffect, useCallback } from 'react'

interface UserCenterProps {
  onClose: () => void
  onCwwStateChange?: (state: {
    loggedIn: boolean
    email: string
    nickname: string
    credits: number
  }) => void
}

const CWW_SERVER_URL = 'https://www.mybotworld.com'

export const UserCenter: React.FC<UserCenterProps> = ({ onClose, onCwwStateChange }) => {
  const [view, setView] = useState<'login' | 'register' | 'profile' | 'recharge'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [credits, setCredits] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [codeCountdown, setCodeCountdown] = useState(0)
  const [rechargeAmount, setRechargeAmount] = useState(30)
  const [rechargeStatus, setRechargeStatus] = useState<'idle' | 'paying' | 'success'>('idle')
  const [showCustomRecharge, setShowCustomRecharge] = useState(false)
  const [customRechargeInput, setCustomRechargeInput] = useState('')
  const [refreshingCredits, setRefreshingCredits] = useState(false)

  // Restore login state on mount
  useEffect(() => {
    let cancelled = false
    const restore = async () => {
      try {
        const state = await window.electronAPI.cww.getState()
        const savedKey = await window.electronAPI.config.getApiKey('clawwinweb:default')
        if (cancelled) return
        if (state && state.email && savedKey) {
          setEmail(state.email || '')
          setNickname(state.nickname || '')
          setCredits(state.credits || 0)
          setToken(savedKey)
          setView('profile')
          // Refresh profile — 立即获取最新积分
          setRefreshingCredits(true)
          try {
            const profileRes = await window.electronAPI.cww.getProfile({
              serverUrl: CWW_SERVER_URL,
              token: savedKey,
            })
            if (!cancelled) {
              const freshCredits = profileRes.user?.credits ?? 0
              setCredits(freshCredits)
              setNickname(profileRes.user?.nickname ?? '')
              // 同步更新缓存
              await window.electronAPI.cww.saveState({
                email: state.email!,
                nickname: profileRes.user?.nickname ?? state.nickname ?? '',
                credits: freshCredits,
                serverUrl: CWW_SERVER_URL,
              })
              onCwwStateChange?.({
                loggedIn: true,
                email: state.email!,
                nickname: profileRes.user?.nickname ?? state.nickname ?? '',
                credits: freshCredits,
              })
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
              setToken('')
              setView('login')
              setError('登录已过期，请重新登录')
            }
          } finally {
            if (!cancelled) setRefreshingCredits(false)
          }
        }
      } catch { /* no saved state */ }
    }
    restore()
    return () => { cancelled = true }
  }, [])

  // Countdown timer
  useEffect(() => {
    if (codeCountdown <= 0) return
    const timer = setTimeout(() => setCodeCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [codeCountdown])

  const handleLogin = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const res = await window.electronAPI.cww.login({
        serverUrl: CWW_SERVER_URL,
        email,
        password,
      })
      const t = res.token
      setToken(t)
      setCredits(res.user?.credits ?? 0)
      setNickname(res.user?.nickname ?? '')
      setView('profile')
      await window.electronAPI.cww.saveState({
        email,
        nickname: res.user?.nickname ?? '',
        credits: res.user?.credits ?? 0,
        serverUrl: CWW_SERVER_URL,
      })
      onCwwStateChange?.({
        loggedIn: true,
        email,
        nickname: res.user?.nickname ?? '',
        credits: res.user?.credits ?? 0,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || '登录失败')
    } finally {
      setLoading(false)
    }
  }, [email, password, onCwwStateChange])

  const handleRegister = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const res = await window.electronAPI.cww.register({
        serverUrl: CWW_SERVER_URL,
        email,
        password,
        nickname,
        code,
      })
      const t = res.token
      setToken(t)
      setCredits(res.user?.credits ?? 0)
      setNickname(res.user?.nickname ?? '')
      setView('profile')
      await window.electronAPI.cww.saveState({
        email,
        nickname: res.user?.nickname ?? '',
        credits: res.user?.credits ?? 0,
        serverUrl: CWW_SERVER_URL,
      })
      onCwwStateChange?.({
        loggedIn: true,
        email,
        nickname: res.user?.nickname ?? '',
        credits: res.user?.credits ?? 0,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || '注册失败')
    } finally {
      setLoading(false)
    }
  }, [email, password, nickname, code, onCwwStateChange])

  const handleSendCode = useCallback(async () => {
    setError('')
    try {
      await window.electronAPI.cww.sendCode({ serverUrl: CWW_SERVER_URL, email })
      setCodeCountdown(60)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || '发送验证码失败')
    }
  }, [email])

  const handleLogout = useCallback(() => {
    setToken('')
    setCredits(0)
    setEmail('')
    setPassword('')
    setNickname('')
    setError('')
    setView('login')
    window.electronAPI.cww.saveState({
      email: '',
      nickname: '',
      credits: 0,
      serverUrl: CWW_SERVER_URL,
    }).catch(() => {})
    onCwwStateChange?.({ loggedIn: false, email: '', nickname: '', credits: 0 })
  }, [onCwwStateChange])

  const handleRecharge = useCallback(async () => {
    setError('')
    setRechargeStatus('paying')
    try {
      const res = await window.electronAPI.cww.createOrder({
        serverUrl: CWW_SERVER_URL,
        token,
        amount: rechargeAmount,
        payType: 'alipay',
      })
      if (res.payUrl) {
        window.electronAPI.shell.openExternal(res.payUrl)
      }
      const pollInterval = setInterval(async () => {
        try {
          const checkRes = await window.electronAPI.cww.checkOrder({
            serverUrl: CWW_SERVER_URL,
            token,
            orderNo: res.orderNo,
          })
          if (checkRes.order?.status === 'paid') {
            clearInterval(pollInterval)
            setRechargeStatus('success')
            try {
              const profileRes = await window.electronAPI.cww.getProfile({
                serverUrl: CWW_SERVER_URL,
                token,
              })
              const newCredits = profileRes.user?.credits ?? 0
              setCredits(newCredits)
              await window.electronAPI.cww.saveState({
                email,
                nickname,
                credits: newCredits,
                serverUrl: CWW_SERVER_URL,
              })
              onCwwStateChange?.({ loggedIn: true, email, nickname, credits: newCredits })
            } catch {}
          }
        } catch {
          clearInterval(pollInterval)
          setRechargeStatus('idle')
          setError('查询订单状态失败')
        }
      }, 3000)
      setTimeout(() => clearInterval(pollInterval), 300000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || '创建订单失败')
      setRechargeStatus('idle')
    }
  }, [token, rechargeAmount, email, nickname, onCwwStateChange])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="user-center-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>用户中心</h2>
          <button className="settings-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="user-center-body">
          {/* 登录 */}
          {view === 'login' && (
            <div className="cww-login-panel cww-panel-center">
              <div className="cww-panel-title">登录 ClawWinWeb</div>
              <input type="email" placeholder="邮箱" value={email}
                onChange={(e) => setEmail(e.target.value)} />
              <input type="password" placeholder="密码" value={password}
                onChange={(e) => setPassword(e.target.value)} />
              {error && <div className="cww-error">{error}</div>}
              <div className="cww-login-actions">
                <button className="btn-primary" onClick={handleLogin}
                  disabled={loading || !email.trim() || !password.trim()}>
                  {loading ? '登录中...' : '登录'}
                </button>
              </div>
              <div className="cww-login-link"
                onClick={() => { setView('register'); setError('') }}>
                没有账号？注册
              </div>
            </div>
          )}

          {/* 注册 */}
          {view === 'register' && (
            <div className="cww-login-panel cww-panel-center">
              <div className="cww-panel-title">注册 ClawWinWeb</div>
              <input type="email" placeholder="邮箱" value={email}
                onChange={(e) => setEmail(e.target.value)} />
              <input type="password" placeholder="密码" value={password}
                onChange={(e) => setPassword(e.target.value)} />
              <input type="text" placeholder="昵称" value={nickname}
                onChange={(e) => setNickname(e.target.value)} />
              <div className="cww-code-row">
                <input type="text" placeholder="验证码" value={code}
                  onChange={(e) => setCode(e.target.value)} />
                <button className="btn-secondary" onClick={handleSendCode}
                  disabled={codeCountdown > 0 || !email.trim()}>
                  {codeCountdown > 0 ? `${codeCountdown}s` : '发送验证码'}
                </button>
              </div>
              {error && <div className="cww-error">{error}</div>}
              <div className="cww-login-actions">
                <button className="btn-primary" onClick={handleRegister}
                  disabled={loading || !email.trim() || !password.trim() || !code.trim()}>
                  {loading ? '注册中...' : '注册'}
                </button>
              </div>
              <div className="cww-login-link"
                onClick={() => { setView('login'); setError('') }}>
                已有账号？登录
              </div>
            </div>
          )}

          {/* 个人资料 */}
          {view === 'profile' && (
            <div className="user-center-profile">
              <div className="user-center-avatar">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div className="user-center-name">{nickname || email}</div>
              <div className="user-center-email">{email}</div>
              <div className="user-center-credits-card">
                <span className="user-center-credits-label">积分余额</span>
                <span className="user-center-credits-value">
                  {refreshingCredits ? (
                    <span style={{ opacity: 0.5, fontSize: '0.85em' }}>刷新中...</span>
                  ) : credits}
                </span>
              </div>
              {error && <div className="cww-error">{error}</div>}
              <div className="user-center-actions">
                <button className="btn-primary" onClick={() => {
                  setView('recharge')
                  setRechargeStatus('idle')
                  setShowCustomRecharge(false)
                  setCustomRechargeInput('')
                }}>
                  充值积分
                </button>
                <button className="btn-secondary user-center-logout" onClick={handleLogout}>
                  退出登录
                </button>
              </div>
              <div className="cww-login-link" onClick={() => {
                window.electronAPI.shell.openExternal('https://www.mybotworld.com')
              }}>
                访问 ClawWinWeb 官网
              </div>
            </div>
          )}

          {/* 充值 */}
          {view === 'recharge' && (
            <div className="user-center-recharge">
              <div className="cww-panel-title">充值积分</div>
              {rechargeStatus === 'idle' && (
                <>
                  <div className="cww-amount-grid">
                    {[10, 30, 50, 100, 500, 1000, 2000].map((amt) => (
                      <div key={amt}
                        className={`cww-amount-btn${rechargeAmount === amt && !showCustomRecharge ? ' selected' : ''}`}
                        onClick={() => { setRechargeAmount(amt); setShowCustomRecharge(false) }}>
                        {amt} 元
                      </div>
                    ))}
                    <div
                      className={`cww-amount-btn${showCustomRecharge ? ' selected' : ''}`}
                      onClick={() => setShowCustomRecharge(true)}>
                      自定义
                    </div>
                  </div>
                  {showCustomRecharge && (
                    <input type="number" className="input-field"
                      placeholder="输入金额 (1-10000)"
                      value={customRechargeInput}
                      onChange={(e) => {
                        setCustomRechargeInput(e.target.value)
                        const val = parseInt(e.target.value, 10)
                        if (val >= 1 && val <= 10000) setRechargeAmount(val)
                      }}
                      min={1} max={10000}
                      style={{ marginBottom: '12px' }}
                    />
                  )}
                  {error && <div className="cww-error">{error}</div>}
                  <div className="cww-login-actions">
                    <button className="btn-primary" onClick={handleRecharge}>
                      充值 {rechargeAmount} 元
                    </button>
                    <button className="btn-secondary" onClick={() => setView('profile')}>
                      返回
                    </button>
                  </div>
                </>
              )}
              {rechargeStatus === 'paying' && (
                <>
                  <div className="cww-recharge-info">请在浏览器中完成支付，支付完成后将自动更新积分...</div>
                  <div className="cww-login-actions">
                    <button className="btn-secondary"
                      onClick={() => { setRechargeStatus('idle'); setView('profile') }}>
                      返回
                    </button>
                  </div>
                </>
              )}
              {rechargeStatus === 'success' && (
                <>
                  <div className="cww-recharge-success">充值成功！当前积分: {credits}</div>
                  <div className="cww-login-actions">
                    <button className="btn-primary"
                      onClick={() => { setRechargeStatus('idle'); setView('profile') }}>
                      返回
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
