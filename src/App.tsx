import { useState, useCallback, useEffect, useRef } from 'react'
import { ChatArea } from './components/Chat/ChatArea'
import { SessionList } from './components/Sidebar/SessionList'
import { WorkspaceSetup } from './components/Setup/WorkspaceSetup'
import { GatewaySetup } from './components/Setup/GatewaySetup'
import { SetupComplete } from './components/Setup/SetupComplete'
import { ErrorBoundary } from './components/Common/ErrorBoundary'
import { StartupSplash } from './components/Common/StartupSplash'
import { VideoSplash } from './components/Common/VideoSplash'
import { UpdateNotification } from './components/Common/UpdateNotification'
import { ModelSettings } from './components/Settings/ModelSettings'
import { ChannelSettings } from './components/Settings/ChannelSettings'
import { SkillSettings } from './components/Settings/SkillSettings'
import { CronManager } from './components/Settings/CronManager'
import { UserCenter } from './components/Settings/UserCenter'
import { QRCodeLogin } from './components/Login/QRCodeLogin'
import { LoginStatus } from './components/Login/LoginStatus'
import { fetchMeSession, type MeSessionResult } from './api/auth'
import { useGateway } from './hooks/useGateway'
import { useWebSocket } from './hooks/useWebSocket'
import { useSetup, type SetupStep } from './hooks/useSetup'
import type { ChatMessage, ChatSession, ChatAttachment, UpdateInfo, AvailableModel } from './types'
import logoSrc from '../assets/logo.png'
import './components/Login/Login.css'

const SETUP_STEPS: SetupStep[] = [ 'workspace', 'gateway', 'complete']

/** /auth/me 成功分支的结构化类型，供冷启动与扫码登录共用落盘逻辑 */
type MeSessionOk = Extract<MeSessionResult, { ok: true }>

/**
 * 将扫码/me 返回的 model_config 写入 openclaw。
 * 安全约束：真实 API Key 只注入主进程内存，不落盘到配置文件。
 */
async function persistServerModelConfig(config: Record<string, unknown>) {
  await window.electronAPI.auth.setRuntimeApiKey(((config.api_key as string) || '').trim() || null)
  await window.electronAPI.config.saveModelConfig({
    provider: config.provider as string,
    modelId: config.model_id as string,
    modelName: (config.model_name as string) || (config.model_id as string),
    baseUrl: (config.base_url as string) || '',
    // 禁止明文落盘：openai 仅写环境变量占位符，真实 key 仅驻留主进程内存
    apiKey: 'OPENAI_API_KEY',
    // 显式声明本次写入走“运行时鉴权模式”，由主进程跳过 auth.profiles 落盘。
    runtimeAuthOnly: true,
    // /auth/me 下发模型应覆盖 providers 中已有模型，避免不断追加。
    replaceProvidersModels: true,
    apiFormat: (config.api_format as string) || 'openai-completions',
    input: (config.input_types as string[]) || ['image', 'text'],
    contextWindow: (config.context_window as number) || 256000,
    maxTokens: (config.max_tokens as number) || 131000,
  })
}

/**
 * /auth/me 成功后：持久化 token、服务端模型写入 openclaw、hydrate 向导 state、拉起网关。
 * 与冷启动 bootstrap 共用，避免扫码与启动两套「登录态生效」逻辑分叉。
 * ensureGateway：由调用方实现「已运行则重启、否则启动」，以便新模型配置被进程重新加载。
 * refreshModelPicker：hydrate 后从磁盘重拉可选模型列表，避免热切换下拉仍显示旧列表。
 */
async function applyMeSessionAfterFetch(
  token: string,
  me: MeSessionOk,
  opts: {
    hydrateFromOpenclawDisk: () => Promise<void>
    /** 网关已在跑则重启读新配置，否则 start（见 App 内 ensureGatewayAfterAuth） */
    ensureGateway: () => Promise<void>
    setCurrentUser: (u: Record<string, unknown>) => void
    setIsLoggedIn: (v: boolean) => void
    /** 任一步骤后返回 true 表示应中止（如 React effect 已清理） */
    shouldAbort?: () => boolean
    /** hydrate 之后调用，同步 Chat 区模型下拉的数据源 */
    refreshModelPicker?: () => Promise<void>
  },
): Promise<void> {
  if (opts.shouldAbort?.()) return
  await window.electronAPI.auth.setRuntimeAccessToken(token)
  localStorage.setItem('accessToken', token)
  opts.setCurrentUser(me.user)
  opts.setIsLoggedIn(true)
  if (me.modelConfig) {
    try {
      await persistServerModelConfig(me.modelConfig)
    } catch (e) {
      console.error('[auth] 写入模型配置失败:', e)
    }
  }
  if (opts.shouldAbort?.()) return
  try {
    await opts.hydrateFromOpenclawDisk()
  } catch (e) {
    console.error('[auth] hydrate 失败:', e)
  }
  if (opts.shouldAbort?.()) return
  if (opts.refreshModelPicker) {
    try {
      await opts.refreshModelPicker()
    } catch (e) {
      console.error('[auth] 刷新可选模型列表失败:', e)
    }
  }
  if (opts.shouldAbort?.()) return
  try {
    await opts.ensureGateway()
  } catch (e) {
    console.error('[auth] gateway 启动/重启 失败:', e)
  }
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}


function App() {
  const gateway = useGateway()
  const setup = useSetup()

  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  /** setup 就绪后，用 /auth/me 完成一次会话恢复；未完成前不渲染登录/主界面，避免闪屏 */
  const [authBootstrapDone, setAuthBootstrapDone] = useState(false)
  const gatewayRef = useRef(gateway)
  gatewayRef.current = gateway
  const hydrateFromDiskRef = useRef(setup.hydrateFromOpenclawDisk)
  hydrateFromDiskRef.current = setup.hydrateFromOpenclawDisk

  useEffect(() => {
    /**
     * 在 renderer 启动后把 Vite 注入的构建环境变量同步到主进程。
     * 这里采用运行时 IPC 注入，避免主进程初始化阶段拿不到 import.meta.env 的问题。
     */
    const exportEnvs: Record<string, string> = {}

    for (const [key, value] of Object.entries(import.meta.env)) {
      if (key.startsWith('VITE_EXPORT_')) {
        exportEnvs[key] = value as string
      }
    }
    console.log("[gateway:info] 注入环境变量:",JSON.stringify(Object.keys(exportEnvs)))
    void window.electronAPI.gateway.setExtraEnvs(exportEnvs).catch((err) => {
      console.warn('[gateway] 同步 extra envs 失败:', err)
    })
  }, [])

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showSkills, setShowSkills] = useState(false)
  const [showModelSettings, setShowModelSettings] = useState(false)
  const [showChannelSettings, setShowChannelSettings] = useState(false)
  const [showCronManager, setShowCronManager] = useState(false)
  const [settingsWorkspace, setSettingsWorkspace] = useState(setup.config.workspace ?? '~/qianyi')
  const [responseTimeout, setResponseTimeout] = useState(300000)
  const [splashDismissed, setSplashDismissed] = useState(false)
  const [showSplashExit, setShowSplashExit] = useState(false)
  const [splashActive, setSplashActive] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateDialogVisible, setUpdateDialogVisible] = useState(true)
  const [bgDownloadDone, setBgDownloadDone] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateCheckResult, setUpdateCheckResult] = useState<string | null>(null)
  const [skipUpdateCheck, setSkipUpdateCheck] = useState(true)
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [showUserCenter, setShowUserCenter] = useState(false)
  const splashActivatedAt = useRef(0)
  const waitingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortSessionRef = useRef<(sessionKey: string, agentId?: string) => Promise<void>>(async () => {})
  const [autoCompact, setAutoCompact] = useState(true)
  const [shellHints, setShellHints] = useState(true)
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [sessionUsageTotalMap, setSessionUsageTotalMap] = useState<Record<string, number>>({})
  const [sessionContextWindowMap, setSessionContextWindowMap] = useState<Record<string, number>>({})
  // 使用 ref 持有最新 usage 映射，供异步重试逻辑读取“当前 UI 值”避免闭包拿旧值。
  const sessionUsageTotalMapRef = useRef<Record<string, number>>({})
  const sessionContextWindowMapRef = useRef<Record<string, number>>({})
  sessionUsageTotalMapRef.current = sessionUsageTotalMap
  sessionContextWindowMapRef.current = sessionContextWindowMap
  const isAutoCompactingRef = useRef(false)
  const autoCompactUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 记录“因流式进行中而延后”的自动压缩目标会话。
  // 根因：达到阈值时若 ws.isStreaming=true，旧逻辑会直接 return，导致本轮遗漏压缩。
  const pendingAutoCompactSessionRef = useRef<string | null>(null)
  // 递增此值会销毁旧 GatewayClient 并创建新的，模拟完整重启
  const [wsReconnectKey, setWsReconnectKey] = useState(0)

  // 使用 ref 追踪最新的 activeSessionId，避免回调闭包中拿到旧值
  const activeSessionIdRef = useRef<string | null>(null)
  activeSessionIdRef.current = activeSessionId

  // 使用 ref 追踪 sessions 实时值，避免回调闭包捕获旧值
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  // 使用 ref 追踪 isWaiting 实时值，避免 handleSend 闭包捕获旧值
  const isWaitingRef = useRef(false)
  isWaitingRef.current = isWaiting

  // 追踪 runId → sessionId 的映射，确保 AI 回复路由到正确的会话
  const runIdSessionMapRef = useRef<Map<string, string>>(new Map())
  const runIdUserMessageMapRef = useRef<Map<string, string>>(new Map())
  // 追踪最近一次发送消息的 sessionId
  const lastSendSessionIdRef = useRef<string | null>(null)
  const refreshSessionUsageRef = useRef<(sessionId: string, checkAutoCompact: boolean) => Promise<void>>(async () => {})
  // 记录每个会话的 usage 延迟补拉定时器：
  // chat.final 后网关会异步写回 sessions.list，首轮常出现“立即拉取仍是旧值”。
  // 这里做一次可取消的补拉，保证最终 UI 与会话累计 usage 一致。
  const usageSyncTimerBySessionRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const markUserMessageComplete = useCallback((sessionId: string, userMessageId?: string) => {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) return session

        let updated = false
        let consumedFallbackQueue = false
        const messages = session.messages.map((message) => {
          if (userMessageId) {
            if (message.id !== userMessageId || message.status !== 'queued') return message
          } else if (message.status !== 'queued' || consumedFallbackQueue) {
            return message
          }

          updated = true
          if (!userMessageId) consumedFallbackQueue = true
          return { ...message, status: 'done' as const }
        })

        return updated ? { ...session, messages, updatedAt: Date.now() } : session
      })
    )
  }, [])

  const registerRunBinding = useCallback((ack: { runId?: string; sessionKey: string } | null, sessionId: string, userMessageId?: string) => {
    if (!ack?.runId) return
    runIdSessionMapRef.current.set(ack.runId, sessionId)
    if (userMessageId) {
      runIdUserMessageMapRef.current.set(ack.runId, userMessageId)
    }
  }, [])

  // 根据用户配置的超时时间自动取消等待并提示错误
  const startWaiting = useCallback(() => {
    setIsWaiting(true)
    if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current)
    waitingTimerRef.current = setTimeout(() => {
      setIsWaiting(false)
      // 超时自动中断任务
      const sid = activeSessionIdRef.current
      if (sid) {
        const session = sessionsRef.current?.find((s: { id: string }) => s.id === sid)
        void abortSessionRef.current(sid, session?.agentId)
      }
      // 添加一条超时错误消息
      setSessions((prev) => {
        if (!sid) return prev
        return prev.map((s) => {
          if (s.id !== sid) return s
          const secs = Math.round(responseTimeout / 1000)
          const errMsg: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: `AI 响应超时（已等待 ${secs} 秒），系统已自动停止本次任务。可能的原因：\n1. 当前超时时间设置较短，可在"设置"中调大响应超时\n2. 网络连接不稳定\n3. API Key 无效或额度已用尽\n4. 所选模型服务暂时不可用`,
            timestamp: Date.now(),
            status: 'error',
          }
          return { ...s, messages: [...s.messages, errMsg], updatedAt: Date.now() }
        })
      })
    }, responseTimeout)
  }, [responseTimeout])

  const stopWaiting = useCallback(() => {
    setIsWaiting(false)
    if (waitingTimerRef.current) {
      clearTimeout(waitingTimerRef.current)
      waitingTimerRef.current = null
    }
  }, [])

  // Determine WebSocket URL
  const wsUrl = `ws://127.0.0.1:${gateway.port}`
  const ws = useWebSocket({
    url: wsUrl,
    token: gateway.token ?? undefined,
    enabled: gateway.state === 'ready',
    userId: typeof currentUser?.id === 'number' ? currentUser.id : null,
    reconnectKey: wsReconnectKey,
  })
  abortSessionRef.current = ws.abortSession

  /** 重启 Gateway 并销毁旧 WebSocket 客户端，模拟完整重启 */
  const restartGateway = useCallback(async () => {
    await gateway.restart()
    // 递增 reconnectKey 销毁旧 GatewayClient、创建新连接，确保 session 状态一致
    setWsReconnectKey(k => k + 1)
  }, [gateway])

  /**
   * /auth/me 落盘模型后拉起网关：已在运行/拉起中则 restart 以载入新配置，否则 start。
   * 重启时递增 wsReconnectKey，与设置页「重启网关」行为一致。
   */
  const ensureGatewayAfterAuth = useCallback(async () => {
    const g = gatewayRef.current
    if (g.state === 'ready' || g.state === 'starting' || g.state === 'restarting') {
      await g.restart()
      setWsReconnectKey((k) => k + 1)
    } else {
      await g.start()
    }
  }, [])

  /** openclaw 落盘或 hydrate 后重拉模型列表，供 /auth/me 成功路径与设置保存共用思路 */
  const refreshModelPickerFromDisk = useCallback(async () => {
    const models = await window.electronAPI.config.getAvailableModels()
    setAvailableModels(models)
  }, [])

  const handleStop = useCallback(() => {
    const sid = activeSessionIdRef.current
    if (sid) {
      const session = sessionsRef.current?.find((s: { id: string }) => s.id === sid)
      ws.abortSession(sid, session?.agentId)
    }
  }, [ws])

  /**
   * 扫码仅拿到 access_token；用户与 model_config 一律走 fetchMeSession（/auth/me），与冷启动一致。
   * 首次使用场景（登录前本地尚无 openclaw 配置）下，登录后应优先进入向导，不应提前拉起网关。
   * 仅依赖 setup.isFirstRun 会误伤旧配置用户（如历史配置缺少 wizard 字段），因此额外结合“登录前是否已有配置”判定。
   */
  const handleLoginSuccess = useCallback(
    async (token: string) => {
      // 在写入服务端模型前读取一次磁盘配置，作为“是否真正首次使用”的可靠判据。
      const configBeforeLogin = await window.electronAPI.config.readConfig()
      const hadConfigBeforeLogin = !!configBeforeLogin
      const shouldEnterFirstRunSetup = setup.isFirstRun && !hadConfigBeforeLogin
      const me = await fetchMeSession(token)
      if (!me.ok) {
        const msg = me.unauthorized
          ? '登录已失效，请重新扫码'
          : (me.message || '同步用户信息失败，请重试')
        throw new Error(msg)
      }
      await applyMeSessionAfterFetch(token, me, {
        hydrateFromOpenclawDisk: () => setup.hydrateFromOpenclawDisk(),
        // 首次使用时网关应由向导完成页触发启动，避免“登录即跳过向导自动启动”。
        ensureGateway: shouldEnterFirstRunSetup ? async () => {} : ensureGatewayAfterAuth,
        setCurrentUser,
        setIsLoggedIn,
        refreshModelPicker: refreshModelPickerFromDisk,
      })
      // 重新登录后服务端默认模型可能已变；会话级 modelOverride 会盖住新 default，须清空以免 UI 仍显示旧模型
      setSessions((prev) => prev.map((s) => ({ ...s, modelOverride: undefined, updatedAt: Date.now() })))
      if (shouldEnterFirstRunSetup) {
        // 首次进入向导时强制回到第一步，避免复用旧 step 导致直接落在最后一页。
        setup.setStep('workspace')
        setShowSetup(true)
      } else {
        // 非首次（退出重登/鉴权失效后重登）一律回主页面。
        setShowSetup(false)
      }
    },
    [ensureGatewayAfterAuth, refreshModelPickerFromDisk, setup.hydrateFromOpenclawDisk, setup.isFirstRun, setup.setStep],
  )

  const handleLogout = useCallback(async () => {
    localStorage.removeItem('accessToken')
    try {
      await window.electronAPI.auth.clearRuntimeApiKey()
      await window.electronAPI.auth.clearRuntimeAccessToken()
    } catch (err) {
      console.warn('[auth] 清空运行时鉴权信息失败:', err)
    }

    setCurrentUser(null)
    setIsLoggedIn(false)
  }, [])

  // 启动后：在 setup 自磁盘加载完成后，用 accessToken 调 /auth/me 恢复用户并刷新模型落盘；依赖含 ensure/refresh 回调的稳定引用
  useEffect(() => {
    if (setup.isLoading) return

    let cancelled = false
    const finish = () => {
      if (!cancelled) setAuthBootstrapDone(true)
    }

    ;(async () => {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        if (!cancelled) {
          setIsLoggedIn(false)
          finish()
        }
        return
      }

      const me = await fetchMeSession(token)
      if (cancelled) return

      if (!me.ok && me.unauthorized) {
        localStorage.removeItem('accessToken')
        if (!cancelled) {
          setCurrentUser(null)
          setIsLoggedIn(false)
          finish()
        }
        return
      }

      if (!me.ok) {
        console.warn('[auth] /auth/me 失败，保留 token 以便网络恢复后重试:', me.message)
        if (!cancelled) {
          setCurrentUser(null)
          setIsLoggedIn(false)
          finish()
        }
        return
      }

      if (cancelled) return
      await applyMeSessionAfterFetch(token, me, {
        hydrateFromOpenclawDisk: () => hydrateFromDiskRef.current(),
        ensureGateway: ensureGatewayAfterAuth,
        setCurrentUser,
        setIsLoggedIn,
        shouldAbort: () => cancelled,
        refreshModelPicker: refreshModelPickerFromDisk,
      })
      finish()
    })()

    return () => {
      cancelled = true
    }
  }, [setup.isLoading, ensureGatewayAfterAuth, refreshModelPickerFromDisk])

  // Load sessions from disk on mount
  useEffect(() => {
    window.electronAPI.sessions.load().then((loaded) => {
      if (Array.isArray(loaded) && loaded.length > 0) {
        setSessions(loaded)
        // Restore active session to the most recently updated one
        const sorted = [...loaded].sort((a, b) => b.updatedAt - a.updatedAt)
        setActiveSessionId(sorted[0].id)
      }
      setSessionsLoaded(true)
    }).catch(() => {
      setSessionsLoaded(true)
    })
    // Load response timeout
    window.electronAPI.config.getTimeout().then((ms) => {
      if (ms > 0) setResponseTimeout(ms)
    }).catch(() => {})
    // Load skip-update-check preference
    window.electronAPI.config.getSkipUpdate().then(setSkipUpdateCheck).catch(() => {})
    // Load auto-compact preference
    window.electronAPI.config.getAutoCompact().then(setAutoCompact).catch(() => {})
    // Load shell-hints preference
    window.electronAPI.config.getShellHints().then(setShellHints).catch(() => {})
    // Load app version
    window.electronAPI.app.getVersion().then(setAppVersion).catch(() => {})
    // Load available models for hot-switching
    window.electronAPI.config.getAvailableModels().then(setAvailableModels).catch(() => {})
  }, [])

  // 设置页工作区：首帧 useState 早于 useSetup 从磁盘合并，须随 setup.config.workspace 同步
  useEffect(() => {
    setSettingsWorkspace(setup.config.workspace ?? '~/qianyi')
  }, [setup.config.workspace])

  // 监听窗口关闭请求（主进程已 preventDefault，须由渲染进程弹窗后 hideToTray / quitApp）
  useEffect(() => {
    const unsub = window.electronAPI.app.onCloseRequested(() => {
      setShowCloseDialog(true)
    })
    return unsub
  }, [])

  // 监听更新通知
  useEffect(() => {
    if (skipUpdateCheck) return
    const unsub = window.electronAPI.app.onUpdateAvailable((info) => {
      setUpdateInfo(info)
      setUpdateDialogVisible(true)
      setBgDownloadDone(false)
    })
    
    // 主动检查一次（防止后端事件在 React 挂载前已发送而被错过）
    const timer = setTimeout(() => {
      window.electronAPI.app.checkForUpdate(localStorage.getItem('accessToken')).then((info) => {
        if (info) {
          setUpdateInfo(info)
          setUpdateDialogVisible(true)
          setBgDownloadDone(false)
        }
      }).catch(() => {})
    }, 3000)
    return () => { unsub(); clearTimeout(timer) }
  }, [skipUpdateCheck])

  // Save sessions to disk on change (debounced)
  useEffect(() => {
    if (!sessionsLoaded) return
    const timer = setTimeout(() => {
      window.electronAPI.sessions.save(sessions)
    }, 1000)
    return () => clearTimeout(timer)
  }, [sessions, sessionsLoaded])

  // Save response timeout on change (debounced)
  const timeoutLoadedRef = useRef(false)
  useEffect(() => {
    if (!timeoutLoadedRef.current) {
      timeoutLoadedRef.current = true
      return
    }
    const timer = setTimeout(() => {
      window.electronAPI.config.saveTimeout(responseTimeout)
    }, 500)
    return () => clearTimeout(timer)
  }, [responseTimeout])

  // Show setup on first run
  useEffect(() => {
    if (!setup.isLoading && setup.isFirstRun) {
      setShowSetup(true)
    }
  }, [setup.isLoading, setup.isFirstRun])

  // Handle incoming messages from WebSocket
  const messagesRef = useRef(sessions)
  messagesRef.current = sessions

  ws.onMessageStream.current = useCallback(
    (msg: ChatMessage) => {
      // 通过 runId / sessionKey → sessionId 映射，确保 AI 回复路由到发起请求的会话
      let sid = msg.sessionKey || runIdSessionMapRef.current.get(msg.id)
      const userMessageId = runIdUserMessageMapRef.current.get(msg.id)

      if (!sid) {
        // 新 runId：绑定到最近发送消息的会话
        sid = lastSendSessionIdRef.current ?? activeSessionIdRef.current ?? undefined
        if (sid) runIdSessionMapRef.current.set(msg.id, sid)
      }
      console.log('[app] onMessageStream called:', { sid, msgId: msg.id, content: msg.content?.slice(0, 100), status: msg.status })
      if (!sid) {
        console.warn('[app] DROPPED message: no session for runId', msg.id)
        return
      }

      // 回复完成或出错时清理映射
      if (msg.status === 'done' || msg.status === 'error') {
        runIdSessionMapRef.current.delete(msg.id)
        runIdUserMessageMapRef.current.delete(msg.id)
      }

      // 仅在终态消息时停止 waiting，避免工具调用阶段停止按钮/加载态提前消失
      if (msg.status === 'done' || msg.status === 'error') {
        stopWaiting()
        void refreshSessionUsageRef.current(sid, msg.status === 'done')
        if (msg.status === 'done') {
          // 先清理该会话上一次遗留的补拉任务，避免快速连续回复时并发覆盖。
          const prevTimer = usageSyncTimerBySessionRef.current.get(sid)
          if (prevTimer) {
            clearTimeout(prevTimer)
            usageSyncTimerBySessionRef.current.delete(sid)
          }
          // 再延迟补拉一次 authoritative usage：
          // 目的不是“多做防御”，而是对齐网关已确认存在的异步写回时序。
          const timer = setTimeout(() => {
            usageSyncTimerBySessionRef.current.delete(sid)
            void refreshSessionUsageRef.current(sid, true)
          }, 900)
          usageSyncTimerBySessionRef.current.set(sid, timer)
        }
      }
      markUserMessageComplete(sid, userMessageId)

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sid) return s
          // 收到 AI 回复，将所有 queued 消息标记为 done
          const messages = [...s.messages]
          const existingIdx = messages.findIndex((m) => m.id === msg.id)
          if (existingIdx >= 0) {
            // 防止已完成的消息被残留的流式定时器回调覆盖
            if (messages[existingIdx].status === 'done' && msg.status === 'streaming') {
              return s
            }
            messages[existingIdx] = msg
            return { ...s, messages, updatedAt: Date.now() }
          }
          return {
            ...s,
            messages: [...messages, msg],
            updatedAt: Date.now(),
          }
        })
      )
    },
    [markUserMessageComplete, stopWaiting] // 不依赖会变化的业务状态，通过 ref 获取最新值
  )

  // 自动压缩上下文：usage 超 70% 时自动发 /compact
  const autoCompactRef = useRef(autoCompact)
  autoCompactRef.current = autoCompact
  const ctxWindowRef = useRef(setup.config.contextWindow ?? 0)
  ctxWindowRef.current = setup.config.contextWindow ?? 0

  /**
   * 统一自动压缩入口：
   * - usage 达阈值触发
   * - context overflow 终止兜底触发
   */
  const triggerAutoCompact = useCallback((targetSessionId?: string): boolean => {
    if (!autoCompactRef.current) return false
    // 优先使用触发来源会话，避免多会话时压缩错会话；兜底再回退到当前激活会话。
    const sid = targetSessionId || activeSessionIdRef.current
    if (!sid) return false
    if (isAutoCompactingRef.current) {
      // 当前正在压缩，先记录待处理会话，待 compaction.end 后补触发。
      pendingAutoCompactSessionRef.current = sid
      return false
    }
    // 模型仍在流式输出时先延后，避免中断当前回复；流结束后会自动补触发。
    if (ws.isStreaming) {
      pendingAutoCompactSessionRef.current = sid
      return false
    }

    isAutoCompactingRef.current = true
    // 本次已正式发起压缩，清空待处理标记。
    pendingAutoCompactSessionRef.current = null
    if (autoCompactUnlockTimerRef.current) clearTimeout(autoCompactUnlockTimerRef.current)
    // 兜底解锁：避免 compaction end 事件丢失导致后续一直不再触发自动压缩
    autoCompactUnlockTimerRef.current = setTimeout(() => {
      isAutoCompactingRef.current = false
      autoCompactUnlockTimerRef.current = null
    }, 15000)

    const compactSession = sessionsRef.current.find((s) => s.id === sid)
    void ws.sendMessage(sid, '/compact', undefined, compactSession?.agentId)
    return true
  }, [ws, ws.isStreaming])

  const refreshSessionUsage = useCallback(async (sessionId: string, checkAutoCompact: boolean) => {
    const session = sessionsRef.current.find((s) => s.id === sessionId)
    const prevTotal = sessionUsageTotalMapRef.current[sessionId]
    const prevContextWindow = sessionContextWindowMapRef.current[sessionId]
    let usage = await ws.getSessionTokenUsage(sessionId, session?.agentId)
    // 网关在 chat.final 后可能有短暂写回延迟（尤其新会话首轮），
    // 这里统一做短重试：首读为 null 或值未变化都重试，确保第一条回复后占用率也能及时刷新。
    if (checkAutoCompact) {
      // 首轮回复后 sessions.list 的 usage 可能延迟写回（实测可超过 800ms），
      // 这里适当拉长重试窗口，避免 UI 长时间停留在 0。
      for (let attempt = 0; attempt < 10; attempt++) {
        if (usage) {
          // 首轮通常还没有 prevTotal；这时“读到 0”并不代表真实写回完成，
          // 不能把 undefined -> 0 当成“已变化”提前退出重试。
          const hasPrevTotal = typeof prevTotal === 'number'
          const sameTotal = hasPrevTotal ? usage.input === prevTotal : usage.input === 0
          const nextContextWindow = usage.contextWindow && usage.contextWindow > 0 ? usage.contextWindow : prevContextWindow
          const sameContextWindow = nextContextWindow === prevContextWindow
          // 只有拿到“可信变化”才停止：
          // 1) 已有历史值：total 发生变化；或
          // 2) 首轮无历史值：input 从 0 变为正值；或
          // 3) contextWindow 出现有效变化。
          // 这样可避免首次 reply 时因临时 0 值提前退出，导致占用率卡 0。
          const totalReady = hasPrevTotal ? !sameTotal : usage.input > 0
          const contextReady = !sameContextWindow
          if (totalReady || contextReady) break
        }
        // 每次重试间隔稍微放大，降低短时抖动读到旧值的概率。
        await new Promise((resolve) => setTimeout(resolve, 250))
        const retried = await ws.getSessionTokenUsage(sessionId, session?.agentId)
        // 无论 retried 是否为空都覆盖 usage，确保“最后一次有效值”被保留。
        usage = retried ?? usage
        // 首次从 null 变成可用 usage 后继续由下一轮判断是否还需要重试。
      }
    }
    if (!usage) return

    // 页面展示值与自动压缩判定值必须同源同口径：
    // 统一使用本次 sessions.list 读取到的 usage.input（会话累计值）。
    const currentUsageTotal = usage.input
    setSessionUsageTotalMap((prev) => ({ ...prev, [sessionId]: currentUsageTotal }))
    if (usage.contextWindow && usage.contextWindow > 0) {
      setSessionContextWindowMap((prev) => ({ ...prev, [sessionId]: usage.contextWindow as number }))
    }

    // 自动压缩判定必须与页面展示口径一致：
    // 1) 优先用本次 usage 返回的 contextWindow；
    // 2) 若本次缺失，则回退到该会话已缓存的 contextWindow（页面展示同样使用该值）；
    // 3) 最后再回退到全局默认配置。
    // 之前遗漏了第 2 步，会出现“页面显示 80%，但判定拿到 0 导致不触发压缩”的情况。
    const ctxWindow = usage.contextWindow && usage.contextWindow > 0
      ? usage.contextWindow
      : (prevContextWindow && prevContextWindow > 0 ? prevContextWindow : ctxWindowRef.current)
    if (!checkAutoCompact) return
    if (ctxWindow <= 0) return
    if (currentUsageTotal / ctxWindow < 0.7) return
    // 用 usage 所属会话触发压缩，避免会话切换导致目标偏移。
    triggerAutoCompact(sessionId)
  }, [ws, triggerAutoCompact])
  refreshSessionUsageRef.current = refreshSessionUsage

  /**
   * 处理“延后压缩”会话：
   * 不直接盲发 /compact，而是先按统一口径重拉 usage 并走阈值判断。
   * 这样可避免上一轮已压缩到低占用后，仍因旧 pending 标记再次触发重复压缩。
   */
  const flushPendingAutoCompact = useCallback(async () => {
    const pendingSessionId = pendingAutoCompactSessionRef.current
    if (!pendingSessionId) return
    // 先清空标记，避免异常路径下重复进入死循环。
    pendingAutoCompactSessionRef.current = null
    await refreshSessionUsageRef.current(pendingSessionId, true)
  }, [])

  // Gateway 连接恢复后，主动为已有会话回填 usage，避免重启后所有会话先显示 0%。
  useEffect(() => {
    if (!ws.connected) return
    if (!sessionsLoaded) return
    if (sessionsRef.current.length === 0) return
    sessionsRef.current.forEach((session) => {
      void refreshSessionUsageRef.current(session.id, false)
    })
  }, [ws.connected, sessionsLoaded])

  // 切换会话时懒刷新一次，保证会话列表较多时当前会话的占用率优先准确。
  useEffect(() => {
    if (!ws.connected || !activeSessionId) return
    void refreshSessionUsageRef.current(activeSessionId, false)
  }, [ws.connected, activeSessionId])

  // 若阈值命中时正好处于 streaming，流结束后补触发一次自动压缩。
  useEffect(() => {
    if (ws.isStreaming) return
    void flushPendingAutoCompact()
  }, [ws.isStreaming, flushPendingAutoCompact])

  // 正常路径：根据本轮 input token 占 contextWindow 的比例触发自动压缩
  ws.onFinalUsage.current = useCallback(({ sessionKey }: { input: number; sessionKey?: string }) => {
    // 关键约束：不再使用 final usage 直接覆盖 UI 占用率。
    // 原因：该值在部分网关实现中是“单轮 token”，会导致占用率忽大忽小、非累计。
    // 统一只信 sessions.list 的会话累计值，并且只在明确 sessionKey 时刷新对应会话。
    if (!sessionKey) return
    void refreshSessionUsageRef.current(sessionKey, true)
  }, [])

  // 兜底路径：若已出现上下文溢出错误，立即尝试自动压缩一次
  ws.onContextOverflow.current = useCallback((sessionId?: string) => {
    // overflow 事件同样按来源会话触发，避免误压缩当前激活会话。
    triggerAutoCompact(sessionId)
  }, [triggerAutoCompact])

  // 收到压缩完成事件后解锁，允许后续再次自动触发
  ws.onCompactionEnd.current = useCallback((sessionKey?: string) => {
    if (autoCompactUnlockTimerRef.current) {
      clearTimeout(autoCompactUnlockTimerRef.current)
      autoCompactUnlockTimerRef.current = null
    }
    isAutoCompactingRef.current = false
    // 若压缩期间积压了新的待压缩会话，按阈值口径补判定，避免重复压缩。
    void flushPendingAutoCompact()
    // 优先使用压缩事件来源会话，避免用户切换会话后把占用率刷到错误会话。
    const sid = sessionKey ?? activeSessionIdRef.current
    if (sid) {
      // 压缩结束后主动拉一次最新 usage，让 UI 展示压缩后的真实占用率而不是旧值。
      // 增加重试机制，确保获取到有效的 usage 数据。
      // 关键修复：不能把 usage.input > 0 当作唯一“有效值”。
      // 压缩后 input 可能合法地回落到 0；若拒绝 0，会导致 UI 停留旧占用率并误判压缩未生效。
      const refreshWithRetry = async (attempt: number = 0) => {
        if (attempt > 5) return // 最多重试5次
        
        const delay = 500 + attempt * 200 // 首次500ms，每次增加200ms
        await new Promise(resolve => setTimeout(resolve, delay))
        
        const session = sessionsRef.current.find((s) => s.id === sid)
        const usage = await ws.getSessionTokenUsage(sid, session?.agentId)
        const prevContextWindow = sessionContextWindowMapRef.current[sid]
        const nextContextWindow = usage?.contextWindow && usage.contextWindow > 0
          ? usage.contextWindow
          : prevContextWindow

        // 只要拿到了 usage，并且上下文窗口可判定（本次返回或历史缓存），就更新展示值；
        // input 允许为 0（压缩后常见），否则会卡住旧占用率。
        if (usage && nextContextWindow && nextContextWindow > 0) {
          setSessionUsageTotalMap((prev) => ({ ...prev, [sid]: usage.input }))
          if (usage.contextWindow && usage.contextWindow > 0) {
            setSessionContextWindowMap((prev) => ({ ...prev, [sid]: usage.contextWindow as number }))
          }
          return
        }

        // 数据暂未稳定，继续重试
        await refreshWithRetry(attempt + 1)
      }
      void refreshWithRetry()
    }
  }, [ws, flushPendingAutoCompact])


  // Get active session
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null
  const currentContextWindow = activeSessionId
    ? (sessionContextWindowMap[activeSessionId] ?? setup.config.contextWindow ?? 0)
    : (setup.config.contextWindow ?? 0)
  const currentUsageTotal = activeSessionId ? (sessionUsageTotalMap[activeSessionId] ?? 0) : 0

  // 模型热切换
  const defaultModelKey = setup.config.provider && setup.config.modelId
    ? `${setup.config.provider}/${setup.config.modelId}`
    : ''
  const currentModelKey = activeSession?.modelOverride || defaultModelKey

  const handleSwitchModel = useCallback((modelKey: string) => {
    const isDefault = modelKey === defaultModelKey
    const override = isDefault ? undefined : modelKey
    console.log('[app] handleSwitchModel:', { modelKey, defaultModelKey, isDefault, override, activeSessionId })

    if (!activeSessionId) {
      const session: ChatSession = {
        id: generateId(),
        title: '新对话',
        agentId: ws.agents.length > 0 ? ws.defaultAgentId : undefined,
        modelOverride: override,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      setSessions((prev) => [session, ...prev])
      setActiveSessionId(session.id)
      return
    }

    setSessions((prev) =>
      prev.map((s) => s.id === activeSessionId
        ? { ...s, modelOverride: override, updatedAt: Date.now() }
        : s
      )
    )
    ws.sendModelDirective(activeSessionId, modelKey, sessionsRef.current.find((s) => s.id === activeSessionId)?.agentId)
  }, [activeSessionId, defaultModelKey, ws])

  // WebSocket 重连后自动重新 apply 模型覆盖
  useEffect(() => {
    if (!ws.connected) return
    const session = sessionsRef.current.find((s) => s.id === activeSessionIdRef.current)
    if (session?.modelOverride) {
      ws.sendModelDirective(session.id, session.modelOverride, session.agentId)
    }
  }, [ws.connected, ws.sendModelDirective])

  // 切换当前会话的 agent
  const handleChangeAgent = useCallback((agentId: string) => {
    if (!activeSessionId) return
    setSessions((prev) =>
      prev.map((s) => s.id === activeSessionId ? { ...s, agentId, updatedAt: Date.now() } : s)
    )
  }, [activeSessionId])

  // Session management
  const createSession = useCallback((agentId?: string) => {
    // 继承当前会话的模型选择
    const currentSession = sessionsRef.current.find((s) => s.id === activeSessionIdRef.current)
    const inheritedModel = currentSession?.modelOverride
    const session: ChatSession = {
      id: generateId(),
      title: '新对话',
      agentId: agentId || (ws.agents.length > 0 ? ws.defaultAgentId : undefined),
      modelOverride: inheritedModel,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setSessions((prev) => [session, ...prev])
    setActiveSessionId(session.id)
    // 新会话也要发送 /model 指令，确保 gateway 侧 session store 生效
    if (inheritedModel) {
      ws.sendModelDirective(session.id, inheritedModel, session.agentId)
    }
  }, [ws.agents, ws.defaultAgentId, ws])

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (activeSessionId === id) {
        setActiveSessionId(sessions.length > 1 ? sessions.find((s) => s.id !== id)?.id ?? null : null)
      }
    },
    [activeSessionId, sessions]
  )

  const handleSend = useCallback(
    (content: string, attachments?: ChatAttachment[]) => {
      // Extract a meaningful title (exclude file paths appended by InputArea)
      const titleText = attachments?.length
        ? content.split('\n').filter((line) => {
            const trimmed = line.trim()
            return !attachments.some((a) => a.filePath && a.filePath === trimmed)
          }).join(' ').trim()
        : content
      const title = titleText.slice(0, 30) || (attachments?.length ? `${attachments[0].fileName || '文件'}` : '新对话')

      if (!activeSessionId) {
        // Auto-create session
        const agentId = ws.agents.length > 0 ? ws.defaultAgentId : undefined
        const session: ChatSession = {
          id: generateId(),
          title,
          agentId,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        const userMsg: ChatMessage = {
          id: generateId(),
          role: 'user',
          content,
          attachments,
          timestamp: Date.now(),
          status: 'done',
        }
        session.messages.push(userMsg)
        setSessions((prev) => [session, ...prev])
        // 立即同步更新 ref，确保 gateway 响应到达时回调能拿到正确的 sessionId
        activeSessionIdRef.current = session.id
        lastSendSessionIdRef.current = session.id
        setActiveSessionId(session.id)
        startWaiting()
        // 每个前端会话用自己的 id 作为 Gateway sessionKey，避免历史污染
        void ws.sendMessage(session.id, content, attachments, session.agentId, session.modelOverride).then((ack) => {
          registerRunBinding(ack, session.id, userMsg.id)
          if (!ack && userMsg.status === 'queued') {
            markUserMessageComplete(session.id, userMsg.id)
          }
          // 新会话首次 send 后重新 apply 模型覆盖（pre-send 可能因会话不存在而失败）
          if (session.modelOverride) {
            ws.patchSessionModel(session.id, session.modelOverride, session.agentId)
          }
        })
        return
      }

      const isAiBusy = isWaitingRef.current || ws.isStreaming

      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content,
        attachments,
        timestamp: Date.now(),
        status: isAiBusy ? 'queued' : 'done',
      }

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeSessionId) return s
          const sessionTitle = s.messages.length === 0 ? title : s.title
          return {
            ...s,
            title: sessionTitle,
            messages: [...s.messages, userMsg],
            updatedAt: Date.now(),
          }
        })
      )

      // 只在空闲时才显示等待指示器，避免空白气泡
      if (!isAiBusy) {
        startWaiting()
      }

      // 记录发送消息的会话，确保 AI 回复路由到正确的会话
      lastSendSessionIdRef.current = activeSessionId

      // 发送消息到后端，后端队列会自动处理（collect 模式）
      const currentSession = sessionsRef.current.find((s) => s.id === activeSessionId)
      console.log('[app] sendMessage modelOverride:', currentSession?.modelOverride, 'agentId:', currentSession?.agentId, 'sessionId:', activeSessionId)
      void ws.sendMessage(activeSessionId, content, attachments, currentSession?.agentId, currentSession?.modelOverride).then((ack) => {
        registerRunBinding(ack, activeSessionId, userMsg.id)
        if (!ack && userMsg.status === 'queued') {
          markUserMessageComplete(activeSessionId, userMsg.id)
        }
        // 新会话首次 send 后重新 apply 模型覆盖（Gateway 侧会话刚创建）
        const sess = sessionsRef.current.find((s) => s.id === activeSessionId)
        if (sess?.modelOverride) {
          ws.patchSessionModel(activeSessionId, sess.modelOverride, sess.agentId)
        }
      })
    },
    [activeSessionId, ws, startWaiting, registerRunBinding, markUserMessageComplete]
  )

  const handleSetupComplete = useCallback(async () => {
    try {
      const ok = await setup.saveConfig()
      if (ok) {
        setShowSetup(false)
        // 加载新配置的可用模型列表
        window.electronAPI.config.getAvailableModels().then(setAvailableModels).catch(() => {})
        // Refresh gateway token/port from the newly written config before starting
        await gateway.start()
      }
    } catch (err) {
      // saveConfig already sets saveError internally, but log for debugging
      console.error('Setup completion failed:', err)
    }
  }, [setup, gateway])

  // 网关启动/重启时激活视频启动屏
  useEffect(() => {
    if (gateway.state === 'starting' || gateway.state === 'restarting' || gateway.state === 'error') {
      if (!splashActive && !showSetup && !setup.isLoading) {
        setSplashDismissed(false)
        setSplashActive(true)
        splashActivatedAt.current = Date.now()
      }
    }
  }, [gateway.state, splashActive, showSetup, setup.isLoading])

  // 网关就绪后：保证至少播放2秒，再触发退场动画
  useEffect(() => {
    if (gateway.state === 'ready' && splashActive && !splashDismissed) {
      const elapsed = Date.now() - splashActivatedAt.current
      const delay = Math.max(0, 2000 - elapsed)
      const timer = setTimeout(() => {
        setShowSplashExit(true)
        setTimeout(() => {
          setSplashDismissed(true)
          setSplashActive(false)
          setShowSplashExit(false)
        }, 700)
      }, delay)
      return () => clearTimeout(timer)
    }
  }, [gateway.state, splashActive, splashDismissed])

  // 视频启动屏：激活后直到dismiss前一直显示
  const showVideoSplash = splashActive && !splashDismissed

  /** 与主界面相同的关闭选择层；各分支早退时也必须挂载，否则 closeRequested 无 UI */
  const appCloseDialog = showCloseDialog ? (
    <div
      className="settings-overlay app-close-dialog-overlay"
      onClick={() => setShowCloseDialog(false)}
    >
      <div className="close-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="close-dialog-header">
          <h2>关闭 鲁南千易</h2>
        </div>
        <div className="close-dialog-body">
          <p>请选择关闭方式</p>
        </div>
        <div className="close-dialog-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setShowCloseDialog(false)
              window.electronAPI.app.hideToTray()
            }}
          >
            最小化到托盘
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              setShowCloseDialog(false)
              window.electronAPI.app.quitApp()
            }}
          >
            退出程序
          </button>
        </div>
        <p className="close-dialog-hint">最小化到托盘将保持网关运行，退出程序将关闭所有进程</p>
      </div>
    </div>
  ) : null

  // Loading state
  if (setup.isLoading) {
    return (
      <>
        <StartupSplash message="正在初始化..." />
        {appCloseDialog}
      </>
    )
  }

  if (!authBootstrapDone) {
    return (
      <>
        <StartupSplash message="正在验证登录..." />
        {appCloseDialog}
      </>
    )
  }

  // Login page
  if (!isLoggedIn) {
    return (
      <>
        <ErrorBoundary>
          <QRCodeLogin onLoginSuccess={handleLoginSuccess} />
        </ErrorBoundary>
        {appCloseDialog}
      </>
    )
  }

  // Setup wizard
  if (showSetup) {
    // modelselect maps to the same progress position as clawwin
    const displayStep = setup.step === 'modelselect' ? 'clawwin' : setup.step
    const currentStepIndex = SETUP_STEPS.indexOf(displayStep)

    return (
      <>
        <ErrorBoundary>
          <div className="setup-container">
            <div className="setup-progress">
              {SETUP_STEPS.map((s, i) => (
                <div
                  key={s}
                  className={`progress-step ${
                    displayStep === s ? 'active' : i < currentStepIndex ? 'done' : ''
                  }`}
                >
                  <div className="progress-dot">{i + 1}</div>
                </div>
              ))}
            </div>

            {setup.step === 'workspace' && (
              <WorkspaceSetup
                workspace={setup.config.workspace ?? '~/qianyi'}
                onNext={(workspace) => {
                  setup.updateConfig({ workspace })
                  setup.setStep('gateway')
                }}
                onSkip={() => setup.setStep('gateway')}
              />
            )}

            {setup.step === 'gateway' && (
              <GatewaySetup
                port={setup.config.gatewayPort ?? 18888}
                token={setup.config.gatewayToken ?? ''}
                onBack={() => setup.setStep('workspace')}
                onNext={(port) => {
                  setup.updateConfig({ gatewayPort: port })
                  setup.setStep('complete')
                }}
                onSkip={() => setup.setStep('complete')}
              />
            )}

            {setup.step === 'complete' && (
              <SetupComplete
                providerName={setup.config.provider === 'clawwinweb' ? 'ClawWinWeb' : (setup.config.provider || '未配置（稍后在设置中配置）')}
                modelName={setup.config.modelName || '未配置'}
                apiKey={setup.config.apiKey || '未配置'}
                workspace={setup.config.workspace ?? '~/qianyi'}
                gatewayPort={setup.config.gatewayPort ?? 18888}
                saving={setup.isSaving}
                error={setup.saveError}
                onBack={() => {
                  setup.clearError()
                  setup.setStep('gateway')
                }}
                onComplete={handleSetupComplete}
              />
            )}
          </div>
        </ErrorBoundary>
        {appCloseDialog}
      </>
    )
  }

  // 视频启动屏：网关正在启动时循环播放
  if (showVideoSplash || showSplashExit) {
    return (
      <>
        <ErrorBoundary>
          <VideoSplash
            gatewayState={gateway.state}
            exiting={showSplashExit}
            onRetry={() => restartGateway()}
          />
        </ErrorBoundary>
        {appCloseDialog}
      </>
    )
  }

  // Main chat interface
  return (
    <ErrorBoundary>
      <div className="app-container">
        <div className="navbar">
          <div className="navbar-logo">
            <div className="navbar-brand">
              <img src={logoSrc} alt="鲁南千易" className="navbar-brand-logo" />
              <span className="navbar-brand-name">鲁南千易</span>
            </div>
          </div>
          {currentUser && (
            <LoginStatus user={currentUser} onLogout={handleLogout} />
          )}
        </div>
        <div className="app-main">
          <div className="system-sidebar">
            <div className="system-sidebar-icons">
              {/* <div className="system-icon-item" style={{animationDelay: '0s'}} onClick={() => setShowModelSettings(true)}>
                <div className="system-icon-circle">
                  <svg className="system-icon-svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="3" />
                    <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" />
                    <circle cx="15" cy="9" r="1" fill="currentColor" stroke="none" />
                    <path d="M9 15c0 0 1.5 2 3 2s3-2 3-2" />
                    <line x1="4" y1="12" x2="2" y2="12" />
                    <line x1="22" y1="12" x2="20" y2="12" />
                    <line x1="12" y1="4" x2="12" y2="2" />
                  </svg>
                </div>
                <span className="system-icon-label">大模型</span>
              </div> */}

              <div className="system-icon-item" style={{animationDelay: '0.10s'}} onClick={() => setShowCronManager(true)}>
                <div className="system-icon-circle">
                  <svg className="system-icon-svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <polyline points="12 7 12 12 15.5 14" />
                  </svg>
                </div>
                <span className="system-icon-label">定时任务</span>
              </div>
              <div className="system-icon-item" style={{animationDelay: '0.15s'}} onClick={() => setShowSkills(true)}>
                <div className="system-icon-circle">
                  <svg className="system-icon-svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 6.5a2.5 2.5 0 0 0-5 0v3h-3a2.5 2.5 0 0 0 0 5h3v3a2.5 2.5 0 0 0 5 0v-3h3a2.5 2.5 0 0 0 0-5h-3z" />
                  </svg>
                </div>
                <span className="system-icon-label">技能</span>
              </div>
              <div className="system-icon-item" style={{animationDelay: '0.20s'}} onClick={() => setShowSettings(true)}>
                <div className="system-icon-circle">
                  <svg className="system-icon-svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z" />
                  </svg>
                </div>
                <span className="system-icon-label">设置</span>
              </div>

            </div>
          </div>
          <div className="sidebar">
            <SessionList
              sessions={sessions}
              activeSessionId={activeSessionId}
              agents={ws.agents}
              defaultAgentId={ws.defaultAgentId}
              onSelectSession={setActiveSessionId}
              onNewSession={createSession}
              onDeleteSession={deleteSession}
              onRestartGateway={() => restartGateway()}
            />
          </div>
          <div className="main-content">
            <ChatArea
              messages={activeSession?.messages ?? []}
              onSend={handleSend}
              gatewayState={gateway.state}
              backendStatus={ws.backendStatus}
              isWaiting={isWaiting}
              gatewayPort={gateway.port}
              onStop={handleStop}
              isStreaming={ws.isStreaming}
              agents={ws.agents}
              currentAgentId={activeSession?.agentId}
              defaultAgentId={ws.defaultAgentId}
              onChangeAgent={handleChangeAgent}
              onRestartGateway={() => restartGateway()}
              availableModels={availableModels}
              currentModelKey={currentModelKey}
              onSwitchModel={handleSwitchModel}
              contextUsageTotal={currentUsageTotal}
              contextWindow={currentContextWindow}
            />
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="settings-overlay" onClick={(e) => e.stopPropagation()}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h2>设置</h2>
              <button className="settings-close" onClick={() => setShowSettings(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="settings-body">
              {/* 上半部分：两列网格 */}
              <div className="settings-grid">
                <div className="settings-section">
                  <h3>模型</h3>
                  <p className="settings-value">
                    {setup.providers.find(p => p.id === setup.config.provider)?.name
                      ?? setup.config.provider
                      ?? '未配置'}
                    {' / '}
                    {setup.config.modelName ?? '未选择'}
                  </p>
                </div>
                <div className="settings-section">
                  <h3>网关服务</h3>
                  <div className="settings-update-row">
                    <p className="settings-value">端口 {gateway.port} · {gateway.state === 'ready' ? '运行中' : gateway.state}</p>
                    <button
                      className="btn-secondary"
                      disabled={gateway.state === 'starting' || gateway.state === 'restarting'}
                      onClick={() => restartGateway()}
                    >
                      {gateway.state === 'starting' || gateway.state === 'restarting' ? '重启中...' : '重启网关'}
                    </button>
                  </div>
                </div>
                <div className="settings-section">
                  <h3>版本</h3>
                  <div className="settings-update-row">
                    <p className="settings-value">v{appVersion || '...'}</p>
                    <button
                      className="btn-secondary"
                      disabled={updateChecking}
                      onClick={async () => {
                        setUpdateChecking(true)
                        setUpdateCheckResult(null)
                        try {
                          const info = await window.electronAPI.app.checkForUpdate(localStorage.getItem('accessToken'))
                          if (info) {
                            setUpdateInfo(info)
                            setUpdateDialogVisible(true)
                            setBgDownloadDone(false)
                            setShowSettings(false)
                          } else {
                            setUpdateCheckResult('已是最新版本')
                          }
                        } catch {
                          setUpdateCheckResult('检查失败，请稍后重试')
                        } finally {
                          setUpdateChecking(false)
                        }
                      }}
                    >
                      {updateChecking ? '检查中...' : '检查更新'}
                    </button>
                  </div>
                  {updateCheckResult && <p className="settings-hint">{updateCheckResult}</p>}
                </div>
                <div className="settings-section">
                  <h3>消息渠道</h3>
                  {setup.config.channels && Object.keys(setup.config.channels).length > 0 ? (
                    <div className="settings-channels-list">
                      {Object.keys(setup.config.channels).map((ch) => (
                        <span key={ch} className="settings-channel-tag">{ch}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="settings-value settings-muted">未配置</p>
                  )}
                </div>
              </div>

              {/* 工作区 - 独占一行 */}
              <div className="settings-section">
                <h3>工作区</h3>
                <div className="settings-workspace-row">
                  <p className="settings-value settings-workspace-path">{settingsWorkspace}</p>
                  <button
                    className="btn-folder-picker"
                    onClick={async () => {
                      try {
                        const selected = await window.electronAPI.dialog.selectFolder(settingsWorkspace || undefined)
                        if (selected) {
                          setSettingsWorkspace(selected)
                          const res = await window.electronAPI.config.saveWorkspace(selected)
                          if (res.ok) {
                            setup.updateConfig({ workspace: selected })
                            await restartGateway()
                          }
                        }
                      } catch (err) {
                        console.error('工作区设置失败:', err)
                      }
                    }}
                  >
                    选择文件夹
                  </button>
                </div>
              </div>

              {/* 响应超时 - 独占一行 */}
              <div className="settings-section">
                <h3>响应超时</h3>
                <p className="settings-hint">发送消息后等待 AI 回复的最长时间，推理模型建议 120 秒以上</p>
                <div className="settings-timeout-row">
                  <input
                    type="range"
                    min={15000}
                    max={600000}
                    step={5000}
                    value={responseTimeout}
                    onChange={(e) => setResponseTimeout(Number(e.target.value))}
                    className="settings-timeout-slider"
                  />
                  <span className="settings-timeout-value">
                    {responseTimeout >= 60000
                      ? `${Math.floor(responseTimeout / 60000)}分${(responseTimeout % 60000) / 1000 > 0 ? `${(responseTimeout % 60000) / 1000}秒` : ''}`
                      : `${responseTimeout / 1000}秒`}
                  </span>
                </div>
              </div>

              {/* 开关选项 */}
              <div className="settings-grid">
                <div className="settings-section">
                  <label className="settings-toggle-row">
                    <input
                      type="checkbox"
                      checked={autoCompact}
                      onChange={(e) => {
                        const val = e.target.checked
                        setAutoCompact(val)
                        window.electronAPI.config.saveAutoCompact(val).catch(() => {})
                      }}
                    />
                    <span>自动压缩上下文</span>
                  </label>
                </div>
                {/* <div className="settings-section">
                  <label className="settings-toggle-row">
                    <input
                      type="checkbox"
                      checked={skipUpdateCheck}
                      onChange={(e) => {
                        const val = e.target.checked
                        setSkipUpdateCheck(val)
                        window.electronAPI.config.saveSkipUpdate(val).catch(() => {})
                      }}
                    />
                    <span>禁用自动更新提示</span>
                  </label>
                </div> */}
                <div className="settings-section">
                  <label className="settings-toggle-row">
                    <input
                      type="checkbox"
                      checked={shellHints}
                      onChange={(e) => {
                        const val = e.target.checked
                        setShellHints(val)
                        window.electronAPI.config.saveShellHints(val).catch(() => {})
                      }}
                    />
                    <span>兼容 Windows</span>
                  </label>
                </div>
              </div>

              {/* 底部操作栏 */}
              <div className="settings-footer">
                <button
                  className="btn-secondary settings-reconfig-btn"
                  onClick={() => {
                    setShowSettings(false)
                    setShowSetup(true)
                    setup.setStep('workspace')
                  }}
                >
                  重新配置向导
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSkills && (
        <SkillSettings
          onClose={() => setShowSkills(false)}
        />
      )}

      {showModelSettings && (
        <ModelSettings
          currentProvider={setup.config.provider}
          currentModel={setup.config.modelId}
          currentModelName={setup.config.modelName}
          onClose={() => { setShowModelSettings(false); }}
          onSaved={() => {
            setShowModelSettings(false)
            // 重新读取配置以更新前端状态（当前模型显示等）
            window.electronAPI.config.readConfig().then((savedConfig) => {
              if (savedConfig) {
                const agents = (savedConfig as Record<string, unknown>).agents as Record<string, unknown> | undefined
                const defaults = agents?.defaults as Record<string, unknown> | undefined
                const modelCfg = defaults?.model as Record<string, unknown> | undefined
                const primary = modelCfg?.primary as string | undefined
                if (primary?.includes('/')) {
                  const idx = primary.indexOf('/')
                  const modelsMap = defaults?.models as Record<string, { alias?: string }> | undefined
                  setup.updateConfig({
                    provider: primary.slice(0, idx),
                    modelId: primary.slice(idx + 1),
                    modelName: modelsMap?.[primary]?.alias || primary.slice(idx + 1),
                  })
                }
              }
            }).catch(() => {})
            // 清除当前会话的模型覆盖，让下拉框跟随新默认模型
            if (activeSessionId) {
              setSessions((prev) => prev.map((s) =>
                s.id === activeSessionId ? { ...s, modelOverride: undefined, updatedAt: Date.now() } : s
              ))
            }
            // 重新加载可用模型列表
            window.electronAPI.config.getAvailableModels().then(setAvailableModels).catch(() => {})
            restartGateway().catch((err) => console.error('gateway restart failed:', err))
          }}
        />
      )}

      {showChannelSettings && (
        <ChannelSettings
          onClose={() => setShowChannelSettings(false)}
          onSaved={() => {
            restartGateway().catch((err) => console.error('gateway restart failed:', err))
          }}
          gatewayClient={ws.client}
        />
      )}

      {showCronManager && (
        <CronManager
          client={ws.client}
          connected={ws.connected}
          onClose={() => setShowCronManager(false)}
        />
      )}

      {showUserCenter && (
        <UserCenter
          onClose={() => setShowUserCenter(false)}
        />
      )}

      {updateInfo && updateDialogVisible && (
        <UpdateNotification
          info={updateInfo}
          initialStage={bgDownloadDone ? 'done' : 'prompt'}
          onClose={() => { setUpdateDialogVisible(false); setUpdateInfo(null); setBgDownloadDone(false) }}
          onBackground={() => {
            setUpdateDialogVisible(false)
            // 下载继续在后台进行，监听完成事件
            const unsub = window.electronAPI.app.onDownloadProgress((p) => {
              if (p.percent >= 100) {
                unsub()
                setBgDownloadDone(true)
                setUpdateDialogVisible(true)
              }
            })
          }}
        />
      )}

      {appCloseDialog}
    </ErrorBoundary>
  )
}

export default App
