import { useState, useEffect, useCallback, useRef } from 'react'
import { GatewayClient, type GatewayEventFrame, type GatewayHelloOk } from '../lib/gateway-protocol'
import type { ChatMessage, ChatAttachment, ChatToolCall, AgentInfo } from '../types'
import { sendTelemetryEvent, type TelemetryAttachmentMeta } from '../api/telemetry'

interface UseWebSocketOptions {
  url: string
  token?: string
  enabled: boolean
  userId?: number | null
  /** 改变此值会销毁旧 GatewayClient 并创建新的，模拟完整重连 */
  reconnectKey?: number
}

interface UseWebSocketReturn {
  connected: boolean
  hello: GatewayHelloOk | null
  agents: AgentInfo[]
  defaultAgentId: string
  sendMessage: (sessionKey: string, content: string, attachments?: ChatAttachment[], agentId?: string, modelOverride?: string) => Promise<{ runId?: string; status?: string; sessionKey: string; idempotencyKey: string } | null>
  abortSession: (sessionKey: string, agentId?: string, isAuto?: boolean, isFrontendTimeout?: boolean) => Promise<{ success: boolean; error?: string }>
  isStreaming: boolean
  backendStatus: string
  backendHealthy: boolean
  onMessageStream: React.MutableRefObject<((msg: ChatMessage) => void) | null>
  onFinalUsage: React.MutableRefObject<((usage: { input: number; output: number; sessionKey?: string }) => void) | null>
  onContextOverflow: React.MutableRefObject<((sessionKey?: string) => void) | null>
  onCompactionEnd: React.MutableRefObject<((sessionKey?: string) => void) | null>
  onStreamStart: React.MutableRefObject<(() => void) | null>
  onBackendDisconnected: React.MutableRefObject<((reason: string) => void) | null>
  patchSessionModel: (sessionKey: string, model: string | null, agentId?: string) => Promise<void>
  sendModelDirective: (sessionKey: string, modelKey: string, agentId?: string) => Promise<void>
  getSessionTokenUsage: (sessionKey: string, agentId?: string) => Promise<{ input: number; output: number; contextWindow?: number } | null>
  reconnect: () => void
  refreshAgents: () => void
  client: GatewayClient | null
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/**
 * 对后端返回文本做统一脱敏，防止敏感凭证被展示到 UI。
 * 说明：
 * 1) 这里是“最后一道前端展示闸门”，即使上游模型误回显，也会被替换。
 * 2) 规则尽量覆盖常见凭证形态（API Key / Bearer / JWT / 环境变量赋值）。
 * 3) 采用纯文本替换，不抛错、不终止流式过程，避免影响正常会话体验。
 */
function redactSensitiveText(input: string): string {
  // 非字符串或空串直接返回，避免不必要处理开销。
  if (!input || typeof input !== 'string') return input

  // 用局部变量逐步替换，保证每条规则都作用在最新文本上。
  let output = input

  // 规则1：OpenAI 风格密钥（sk-...）直接整体替换。
  // 例如：sk-xxxx... 这类高风险模式一律不允许透出。
  output = output.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')

  // 规则2：常见 Bearer Token（Authorization 头）替换。
  // 保留 "Bearer " 前缀便于上下文可读，但令牌正文全部抹除。
  output = output.replace(/\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*\b/gi, '$1 [REDACTED]')

  // 规则3：JWT（三段式 base64url）替换，避免会话 token 外泄。
  output = output.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[REDACTED]')

  // 规则4：API Key/Token/Password 等键值对（含中英文 key 名）替换值部分。
  // 只替换赋值右侧，尽量保留字段名帮助用户定位问题来源。
  output = output.replace(
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|private[_-]?key|OPENAI_API_KEY|ACCESS_TOKEN)\b\s*[:=]\s*["']?([^\s"',`]+)["']?/gi,
    (_m, key) => `${key}: [REDACTED]`,
  )

  // 规则5：环境变量导出/设置语句中的高风险变量值替换。
  // 覆盖 bash `export X=...`、PowerShell `$env:X=...`、Windows `set X=...`。
  output = output.replace(
    /\b(export|set|\$env:)\s*(OPENAI_API_KEY|ACCESS_TOKEN|API_KEY|AUTH_TOKEN)\s*=\s*([^\s"']+)/gi,
    (_m, cmd, key) => `${cmd} ${key}=[REDACTED]`,
  )

  return output
}

/** 构造 gateway 可解析的 sessionKey: agent:{agentId}:{originalId} */
function buildAgentSessionKey(sessionKey: string, agentId?: string): string {
  if (!agentId || agentId === 'main') return sessionKey
  // 如果已经是 agent: 格式，不重复包装
  if (sessionKey.startsWith('agent:')) return sessionKey
  return `agent:${agentId}:${sessionKey}`
}

/** 从 agent:xxx:originalId 格式中提取原始 sessionKey */
function normalizeSessionKey(sessionKey?: string): string | undefined {
  if (!sessionKey) return undefined
  const match = /^agent:[^:]+:(.+)$/.exec(sessionKey)
  return match?.[1] || sessionKey
}

/**
 * 从 Gateway chat event payload 中提取文本内容
 * content 可能是 string、{content: string}、{content: [{type:"text", text:"..."}]} 等格式
 */
function extractText(message: unknown): string {
  // 直接是字符串
  if (typeof message === 'string') return redactSensitiveText(message)
  if (!message || typeof message !== 'object') return ''

  const msg = message as Record<string, unknown>
  const content = msg.content

  // content 是字符串
  if (typeof content === 'string') return redactSensitiveText(content)

  // content 是数组 [{type: "text", text: "..."}, ...]
  if (Array.isArray(content)) {
    return redactSensitiveText(content
      .map((block: unknown) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && 'text' in block) {
          return (block as { text: string }).text
        }
        return ''
      })
      .join(''))
  }

  // 备用：直接使用 text 字段
  if (typeof msg.text === 'string') return redactSensitiveText(msg.text)

  return ''
}

/** 将常见英文错误消息翻译为中文 */
function translateError(msg: string): string {
  // 先做一次脱敏，避免错误消息里夹带服务端返回的原始凭证。
  const safeMsg = redactSensitiveText(msg)
  const lower = safeMsg.toLowerCase()
  if (lower.includes('insufficient') && (lower.includes('balance') || lower.includes('credit') || lower.includes('fund') || lower.includes('quota')))
    return '余额不足，请充值后再试'
  if (lower.includes('402') || lower.includes('payment required'))
    return '余额不足，请充值后再试'
  if (lower.includes('rate limit') || lower.includes('too many request') || lower.includes('api rate limit'))
    return '请求过于频繁，请稍后再试'
  if (lower.includes('unauthorized') || lower.includes('401'))
    return '认证失败，请重新登录'
  if (lower.includes('forbidden') || lower.includes('403'))
    return '访问被拒绝，请检查权限'
  if (lower.includes('not found') || lower.includes('404'))
    return '请求的资源不存在'
  if (lower.includes('timeout') || lower.includes('timed out'))
    return '请求超时，请稍后再试'
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('econnreset'))
    return '网络连接失败，请检查网络'
  if (lower.includes('model') && lower.includes('not') && (lower.includes('found') || lower.includes('available') || lower.includes('support')))
    return '模型不可用，请切换其他模型'
  if (lower.includes('context') && (lower.includes('length') || lower.includes('exceed') || lower.includes('too long')))
    return '上下文长度超限，请压缩对话或开启新会话'
  return safeMsg
}

/** 将聊天附件转为埋点所需元信息（文件名/类型/mime），随 user_message_sent 上报 */
function buildAttachmentMeta(attachments?: ChatAttachment[]): TelemetryAttachmentMeta[] {
  if (!attachments?.length) return []
  return attachments.map((item) => ({
    file_name: item.fileName || item.filePath.split(/[\\/]/).pop() || 'unknown',
    file_type: item.type,
    mime_type: item.mimeType || null,
  }))
}

export function useWebSocket({ url, token, enabled, userId, reconnectKey }: UseWebSocketOptions): UseWebSocketReturn {
  const [connected, setConnected] = useState(false)
  const [hello, setHello] = useState<GatewayHelloOk | null>(null)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [defaultAgentId, setDefaultAgentId] = useState('main')
  const [streamingCount, setStreamingCount] = useState(0)
  const isStreaming = streamingCount > 0
  const [backendStatus, setBackendStatus] = useState('')
  const [backendHealthy, setBackendHealthy] = useState(true)
  const clientRef = useRef<GatewayClient | null>(null)
  const onMessageStream = useRef<((msg: ChatMessage) => void) | null>(null)
  const onBackendDisconnected = useRef<((reason: string) => void) | null>(null)
  const healthCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastHealthCheckRef = useRef<number>(Date.now())
  const HEALTH_CHECK_INTERVAL = 30000
  const HEALTH_CHECK_TIMEOUT = 60000
  // 追踪每个 runId 的累积文本（用于 delta 流式更新）
  const streamBufferRef = useRef<Map<string, string>>(new Map())
  // 追踪每个 runId 的累积思维链内容
  const thinkingBufferRef = useRef<Map<string, string>>(new Map())
  // 节流：限制流式 UI 更新频率，避免 ReactMarkdown 频繁重渲染导致闪烁
  const streamThrottleRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // 追踪每个 runId 上次推送的内容长度，避免内容未变时重复推送导致 React 卡死
  const lastPushedLenRef = useRef<Map<string, number>>(new Map())
  const idleCountRef = useRef<Map<string, number>>(new Map())
  const toolCallsBufferRef = useRef<ChatToolCall[]>([])
  const toolCallIdRef = useRef(0)
  const activeRunIdRef = useRef<string | null>(null)
  const isAutoAbortRef = useRef(false)
  const isFrontendTimeoutRef = useRef(false)
  const directiveRunIdsRef = useRef<Set<string>>(new Set())
  // 记录每个会话最近一次已确认的 runId，供 abort 等非 chat 事件兜底关联
  const lastRunIdBySessionRef = useRef<Map<string, string>>(new Map())
  // agent lifecycle.start 分配的 runId（工具调用流式消息用此 ID）
  // 与 chat 事件的 runId 可能不同，需要在 final 时用此 ID 确保消息正确替换
  const agentLifecycleRunIdRef = useRef<string | null>(null)
  // 阶段追踪：idle → thinking → tool → text → idle
  // thinking/tool 阶段不推送流式文本，只推送工具调用和思考内容
  const phaseRef = useRef<'idle' | 'thinking' | 'tool' | 'text'>('idle')
  // 自动压缩：暴露给 App.tsx 的回调
  const onFinalUsage = useRef<((usage: { input: number; output: number; sessionKey?: string }) => void) | null>(null)
  const onContextOverflow = useRef<((sessionKey?: string) => void) | null>(null)
  const onCompactionEnd = useRef<((sessionKey?: string) => void) | null>(null)
  // agent 活动开始通知（用于清除 isWaiting 等待状态）
  const onStreamStart = useRef<(() => void) | null>(null)
  /** 异步上报埋点：不 await，避免拖慢 WS 主流程 */
  const emitTelemetry = useCallback((payload: Parameters<typeof sendTelemetryEvent>[0]) => {
    void sendTelemetryEvent(payload).catch((err) => {
      console.warn('[telemetry] send failed:', err)
    })
  }, [])

  /** 兼容网关返回的 number / string token 数值 */
  const parseUsageNumber = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    if (typeof value === 'string') {
      const n = Number(value)
      return Number.isFinite(n) ? n : 0
    }
    return 0
  }

  /**
   * 从 chat.final 事件中提取 usage。
   * 兼容不同网关/适配器的字段命名与嵌套层级，避免自动压缩因字段不一致失效。
   */
  const extractUsage = (payload: Record<string, unknown>): { input: number; output: number } | null => {
    const directUsage = payload.usage
    const messageObj = payload.message && typeof payload.message === 'object'
      ? payload.message as Record<string, unknown>
      : null
    const detailsObj = payload.details && typeof payload.details === 'object'
      ? payload.details as Record<string, unknown>
      : null
    const usageObj = (
      (directUsage && typeof directUsage === 'object' ? directUsage : null) ||
      (messageObj?.usage && typeof messageObj.usage === 'object' ? messageObj.usage as Record<string, unknown> : null) ||
      (detailsObj?.usage && typeof detailsObj.usage === 'object' ? detailsObj.usage as Record<string, unknown> : null)
    ) as Record<string, unknown> | null

    const extractFromCandidate = (candidate: Record<string, unknown>): { input: number; output: number } | null => {
      // 兼容更多上游字段：不同 provider/gateway 可能使用驼峰、下划线或 Count 后缀命名。
      const input = parseUsageNumber(
        candidate.input
        ?? candidate.input_tokens
        ?? candidate.inputTokens
        ?? candidate.inputTokenCount
        ?? candidate.input_token_count
        ?? candidate.prompt_tokens
        ?? candidate.promptTokens
        ?? candidate.promptTokenCount
        ?? candidate.prompt_token_count
        ?? candidate.input_token_count
        ?? candidate.tokens_in
        ?? candidate.tokensIn
        ?? candidate.total_input_tokens
        ?? candidate.totalInputTokens
      )
      // 输出 token 同样补齐常见别名，避免只拿到一侧字段导致 usage 被误判为空。
      const output = parseUsageNumber(
        candidate.output
        ?? candidate.output_tokens
        ?? candidate.outputTokens
        ?? candidate.outputTokenCount
        ?? candidate.output_token_count
        ?? candidate.completion_tokens
        ?? candidate.completionTokens
        ?? candidate.completionTokenCount
        ?? candidate.completion_token_count
        ?? candidate.output_token_count
        ?? candidate.tokens_out
        ?? candidate.tokensOut
        ?? candidate.total_output_tokens
        ?? candidate.totalOutputTokens
      )
      // 某些实现只回传 total_tokens；此时把“总 token”兜底映射到 input，
      // 目的是让 UI 首轮先有占用率显示，后续 sessions.list 会再校正到精确 input/output。
      const total = parseUsageNumber(
        candidate.total_tokens
        ?? candidate.totalTokens
        ?? candidate.token_count
        ?? candidate.tokenCount
      )
      const normalizedInput = input > 0 ? input : (total > 0 ? total : 0)
      if (normalizedInput <= 0 && output <= 0) return null
      return { input: normalizedInput, output }
    }

    if (usageObj) {
      const direct = extractFromCandidate(usageObj)
      if (direct) return direct
    }

    // 兜底：不同网关适配器可能把 usage 放在更深层结构中，这里做有限深度递归扫描
    const visited = new Set<unknown>()
    const queue: unknown[] = [payload]
    let depth = 0
    while (queue.length > 0 && depth < 6) {
      const levelSize = queue.length
      for (let i = 0; i < levelSize; i++) {
        const node = queue.shift()
        if (!node || typeof node !== 'object' || visited.has(node)) continue
        visited.add(node)

        if (!Array.isArray(node)) {
          const candidate = extractFromCandidate(node as Record<string, unknown>)
          if (candidate) return candidate
          for (const v of Object.values(node as Record<string, unknown>)) {
            if (v && typeof v === 'object') queue.push(v)
          }
        } else {
          for (const v of node) {
            if (v && typeof v === 'object') queue.push(v)
          }
        }
      }
      depth += 1
    }

    return null
  }

  useEffect(() => {
    if (!enabled || !url) return

    console.log('[ws] creating GatewayClient:', { url, hasToken: !!token })

    const client = new GatewayClient({
      url,
      token,
      signDeviceAuth: window.electronAPI?.gateway?.signDeviceAuth,
      onHello: (h) => {
        console.log('[ws] handshake completed (hello-ok received)')
        setConnected(true)
        setBackendHealthy(true)
        lastHealthCheckRef.current = Date.now()
        setHello(h)
        // 握手完成后获取 agent 列表
        client.request<{ defaultId?: string; agents?: AgentInfo[] }>('agents.list', {})
          .then((res) => {
            if (res?.agents) setAgents(res.agents)
            if (res?.defaultId) setDefaultAgentId(res.defaultId)
            console.log('[ws] agents loaded:', res?.agents?.map((a: AgentInfo) => a.id))
          })
          .catch((err) => console.warn('[ws] agents.list failed:', err))
      },
      onEvent: (evt: GatewayEventFrame) => {
        lastHealthCheckRef.current = Date.now()
        setBackendHealthy(true)
        handleEvent(evt)
      },
      onClose: (info) => {
        console.log('[ws] connection closed:', info.code, info.reason)
        setConnected(false)
        setStreamingCount(0)
        setBackendHealthy(false)
        const reason = info.reason || `连接关闭 (code: ${info.code})`
        onBackendDisconnected.current?.(reason)
      },
      onError: (err) => {
        console.error('[ws] error:', err.message)
        setBackendHealthy(false)
      },
    })

    client.start()
    clientRef.current = client

    const healthCheckTimer = setInterval(() => {
      const now = Date.now()
      const timeSinceLastCheck = now - lastHealthCheckRef.current
      if (timeSinceLastCheck > HEALTH_CHECK_TIMEOUT && streamingCount > 0) {
        console.warn('[ws] backend health check timeout, marking unhealthy')
        setBackendHealthy(false)
        onBackendDisconnected.current?.('后端响应超时，可能已中断')
      }
    }, HEALTH_CHECK_INTERVAL)
    healthCheckTimerRef.current = healthCheckTimer

    return () => {
      clearInterval(healthCheckTimer)
      healthCheckTimerRef.current = null
      client.stop()
      clientRef.current = null
      setConnected(false)
      setBackendHealthy(false)
    }
  // reconnectKey 变化时会销毁旧 client 并创建新的，模拟完整重启
  }, [url, token, enabled, reconnectKey])

  const handleEvent = useCallback((evt: GatewayEventFrame) => {
    console.log('[ws] event received:', evt.event, JSON.stringify(evt.payload).slice(0, 2000))

    // 处理 agent 事件：提取后台活动状态
    if (evt.event === 'agent') {
      const p = evt.payload as Record<string, unknown> | undefined
      if (!p) return
      const stream = p.stream as string | undefined
      const data = p.data as Record<string, unknown> | undefined
      if (!data) return
      const phase = data.phase as string | undefined
      // agent 事件的 payload 携带 runId，用于关联工具调用和消息
      const agentRunId = p.runId as string | undefined
      console.log('[ws] agent event:', { stream, phase, agentRunId, activeRunId: activeRunIdRef.current, toolCallsCount: toolCallsBufferRef.current.length, dataKeys: Object.keys(data) })

      if (stream === 'assistant') {
        // AI 正在生成文本，显示预览
        const delta = (data.delta as string) || ''
        const text = (data.text as string) || ''
        const preview = (text || delta).replace(/\s+/g, ' ').trim()
        if (preview) {
          const short = preview.length > 40 ? preview.slice(-40) + '...' : preview
          setBackendStatus(`正在输出: ${short}`)
        }
      } else if (stream === 'tool') {
        if (phase === 'start') {
          phaseRef.current = 'tool'
          const name = (data.name as string) || '工具'
          const args = data.args as Record<string, unknown> | undefined
          let input: string | undefined
          let summary: string | undefined
          if (args) {
            if (typeof args.command === 'string') { input = args.command; summary = args.command.slice(0, 80) }
            else if (typeof args.file_path === 'string') { input = args.file_path; summary = args.file_path }
            else if (typeof args.pattern === 'string') { input = args.pattern; summary = args.pattern.slice(0, 60) }
            else if (typeof args.url === 'string') { summary = args.url.slice(0, 60) }
            else if (typeof args.query === 'string') { summary = args.query.slice(0, 60) }
            else {
              const firstStr = Object.entries(args).find(([, v]) => typeof v === 'string')
              if (firstStr) summary = `${firstStr[0]}=${String(firstStr[1]).slice(0, 40)}`
            }
          }
          const toolCall: ChatToolCall = {
            id: `tc-${++toolCallIdRef.current}`,
            name,
            status: 'running',
            summary,
            input,
            kind: /(bash|shell|powershell|terminal|cmd)/i.test(name) ? 'terminal' : 'default',
            startedAt: Date.now(),
          }
          toolCallsBufferRef.current = [...toolCallsBufferRef.current, toolCall]
          // 推送工具调用更新到消息气泡（不传文本，由 MessageBubble 显示动画占位）
          const runId = activeRunIdRef.current
          if (runId) {
            onMessageStream.current?.({
              id: runId,
              role: 'assistant',
              content: '',
              thinking: thinkingBufferRef.current.get(runId),
              toolCalls: [...toolCallsBufferRef.current],
              timestamp: Date.now(),
              status: 'streaming',
            })
          }
          setBackendStatus(`正在执行: ${name}${summary ? ` (${summary.slice(0, 60)})` : ''}`)
        } else if (phase === 'update') {
          const name = (data.name as string) || '工具'
          setBackendStatus(`正在执行: ${name}...`)
        } else if (phase && phase !== 'start') {
          // 处理所有结束类 phase（'end'、'complete'、'done'、'finish' 等）
          console.log('[ws] tool end-like phase:', phase, 'data:', JSON.stringify(data).slice(0, 500))
          const name = (data.name as string) || '工具'
          const isError = data.isError as boolean | undefined
          // 尝试多种字段名提取工具输出
          let result: string | undefined
          for (const key of ['result', 'output', 'content', 'text', 'response', 'stdout']) {
            const val = data[key]
            if (typeof val === 'string' && val) { result = redactSensitiveText(val); break }
          }
          // 更新最后一个 running 状态的工具调用
          const buf = toolCallsBufferRef.current
          let idx = -1
          for (let i = buf.length - 1; i >= 0; i--) {
            if (buf[i].status === 'running') { idx = i; break }
          }
          // 退而求其次：按 name 匹配最后一个同名工具
          if (idx < 0) {
            for (let i = buf.length - 1; i >= 0; i--) {
              if (buf[i].name === name) { idx = i; break }
            }
            console.log('[ws] tool.end fallback by name:', { name, idx, bufLen: buf.length })
          }
          if (idx >= 0) {
            const newBuf = [...buf]
            newBuf[idx] = {
              ...buf[idx],
              status: isError ? 'error' : 'done',
              isError: isError || false,
              endedAt: Date.now(),
              ...(result && { output: result }),
            }
            toolCallsBufferRef.current = newBuf
          }
          // 始终推送工具调用状态更新（不传文本，由 MessageBubble 显示动画占位）
          const runId = activeRunIdRef.current
          if (runId) {
            onMessageStream.current?.({
              id: runId,
              role: 'assistant',
              content: '',
              thinking: thinkingBufferRef.current.get(runId),
              toolCalls: [...toolCallsBufferRef.current],
              timestamp: Date.now(),
              status: 'streaming',
            })
          }
          setBackendStatus(isError ? `${name} 执行出错，正在处理...` : `${name} 执行完成，正在思考...`)
        }
      } else if (stream === 'lifecycle') {
        if (phase === 'start') {
          toolCallsBufferRef.current = []
          toolCallIdRef.current = 0
          phaseRef.current = 'thinking'
          // 用 agent 事件的 runId 提前设置 activeRunIdRef
          // 这样后续的 tool.start/end 事件能关联到正确的消息
          if (agentRunId) {
            activeRunIdRef.current = agentRunId
            agentLifecycleRunIdRef.current = agentRunId
          }
          // 通知 App 层 agent 活动已开始，清除等待动画
          setStreamingCount((c) => c + 1)
          onStreamStart.current?.()
          setBackendStatus('思考中...')
          if (agentRunId) {
            onMessageStream.current?.({
              id: agentRunId,
              role: 'assistant',
              content: '',
              thinking: '',
              toolCalls: [],
              timestamp: Date.now(),
              status: 'streaming',
            })
          }
        } else if (phase === 'end' || phase === 'error') {
          phaseRef.current = 'idle'
          setBackendStatus('')
          // agent 活动结束时减少 streamingCount
          setStreamingCount((c) => Math.max(0, c - 1))
        }
      } else if (stream === 'compaction') {
        if (phase === 'start') {
          setBackendStatus('正在压缩上下文...')
        } else if (phase === 'end') {
          setBackendStatus('压缩完成，正在思考...')
          // 透传压缩事件的 sessionKey，避免 App 层在多会话场景下刷新错会话占用率。
          onCompactionEnd.current?.(normalizeSessionKey(p.sessionKey as string | undefined))
        }
      }
      return
    }

    // OpenClaw Gateway 用 "chat" 事件名传递聊天消息
    if (evt.event !== 'chat') return

    if (!evt.payload || typeof evt.payload !== 'object') return
    const payload = evt.payload as Record<string, unknown>
    const state = payload.state as string | undefined
    const chatRunId = (payload.runId as string) || generateId()
    // 优先使用 agent lifecycle 的 runId（与工具调用流式消息一致），
    // 解决 agent 事件 runId 与 chat 事件 runId 不一致导致工具调用卡在 "running" 的问题
    const runId = (toolCallsBufferRef.current.length > 0 && agentLifecycleRunIdRef.current)
      ? agentLifecycleRunIdRef.current
      : chatRunId
    const sessionKey = normalizeSessionKey(payload.sessionKey as string | undefined)
    if (sessionKey && runId) {
      lastRunIdBySessionRef.current.set(sessionKey, runId)
    }

    // 过滤指令消息的响应（如 /model 切换命令），不显示在聊天中
    if (directiveRunIdsRef.current.has(chatRunId)) {
      console.log('[ws] suppressing directive response:', { chatRunId, state })
      if (state === 'final' || state === 'error' || state === 'aborted' || state === 'terminated') {
        directiveRunIdsRef.current.delete(chatRunId)
      }
      return
    }

    // 详细打印 payload 结构，用于排查 thinking/reasoning 字段
    console.log('[ws] chat payload keys:', Object.keys(payload))
    if (payload.message && typeof payload.message === 'object') {
      const msg = payload.message as Record<string, unknown>
      console.log('[ws] message keys:', Object.keys(msg))
      if (msg.content) {
        if (Array.isArray(msg.content)) {
          console.log('[ws] message.content blocks:', msg.content.map((b: unknown) => {
            if (b && typeof b === 'object') {
              const block = b as Record<string, unknown>
              return { type: block.type, keys: Object.keys(block) }
            }
            return typeof b
          }))
        } else {
          console.log('[ws] message.content type:', typeof msg.content, 'len:', String(msg.content).length)
        }
      }
      // 专门检查 reasoning/thinking 相关字段
      if ('reasoning_content' in msg) console.log('[ws] ★ found reasoning_content:', String(msg.reasoning_content).slice(0, 200))
      if ('thinking' in msg) console.log('[ws] ★ found thinking:', String(msg.thinking).slice(0, 200))
    }
    console.log('[ws] chat event:', { state, runId, hasMessage: !!payload.message })

    if (state === 'delta') {
      // 流式增量更新
      const text = extractText(payload.message)

      // 提取推理/思考内容，累积到 thinkingBuffer
      if (payload.message && typeof payload.message === 'object') {
        const msg = payload.message as Record<string, unknown>
        const thinking = (msg.reasoning_content as string) || (msg.thinking as string) || ''
        if (thinking) {
          const accumulated = (thinkingBufferRef.current.get(runId) || '') + thinking
          thinkingBufferRef.current.set(runId, accumulated)
        }
      }

      // 辅助：构建当前工具调用列表
      const currentToolCalls = toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined

      // 核心规则：一旦本轮有工具调用（toolCallsBuffer 非空），
      // 所有文本只累积不推送，等 final 一次性显示
      const hasToolCalls = toolCallsBufferRef.current.length > 0

      const thinkingText = thinkingBufferRef.current.get(runId) || ''
      const hasThinking = thinkingText.length > 0

      if (text) {
        const isNew = !streamBufferRef.current.has(runId)
        const accumulated = (streamBufferRef.current.get(runId) || '') + text
        streamBufferRef.current.set(runId, accumulated)

        if (isNew) {
          setStreamingCount((c) => c + 1)
          activeRunIdRef.current = runId
        }

        // 有工具调用时，文本只累积不推送 — 等 final 一次性出现
        if (hasToolCalls) {
          return
        }

        if (phaseRef.current === 'thinking' && hasThinking) {
          if (!streamThrottleRef.current.has(runId)) {
            const msg: ChatMessage = {
              id: runId,
              role: 'assistant',
              content: '',
              thinking: thinkingText,
              toolCalls: currentToolCalls,
              timestamp: Date.now(),
              status: 'streaming',
            }
            onMessageStream.current?.(msg)

            streamThrottleRef.current.set(runId, setTimeout(function flushThinkingWithText() {
              const thinkingNow = thinkingBufferRef.current.get(runId) || ''
              const lastLen = lastPushedLenRef.current.get(runId) ?? -1
              if (thinkingNow.length !== lastLen) {
                lastPushedLenRef.current.set(runId, thinkingNow.length)
                idleCountRef.current.set(runId, 0)
                const m: ChatMessage = {
                  id: runId,
                  role: 'assistant',
                  content: '',
                  thinking: thinkingNow,
                  toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
                  timestamp: Date.now(),
                  status: 'streaming',
                }
                onMessageStream.current?.(m)
              } else {
                const idle = (idleCountRef.current.get(runId) ?? 0) + 1
                idleCountRef.current.set(runId, idle)
              }
              if (streamBufferRef.current.has(runId) || thinkingBufferRef.current.has(runId)) {
                streamThrottleRef.current.set(runId, setTimeout(flushThinkingWithText, 120))
              } else {
                streamThrottleRef.current.delete(runId)
                lastPushedLenRef.current.delete(runId)
                idleCountRef.current.delete(runId)
              }
            }, 120))
          }
          return
        }

        // Agent 生命周期内（思考/工具调用阶段），文本只累积不推送，等 final 一次显示
        // 避免 final 前闪现残留流式文本
        if (phaseRef.current !== 'idle') {
          return
        }

        // 无工具调用：正常流式推送
        if (!streamThrottleRef.current.has(runId)) {
          // 首次 delta 立即推送（让气泡立刻出现）
          const msg: ChatMessage = {
            id: runId,
            role: 'assistant',
            content: accumulated,
            thinking: thinkingBufferRef.current.get(runId),
            toolCalls: currentToolCalls,
            timestamp: Date.now(),
            status: 'streaming',
          }
          onMessageStream.current?.(msg)

          streamThrottleRef.current.set(runId, setTimeout(function flush() {
            const latest = streamBufferRef.current.get(runId)
            if (latest != null) {
              // 如果中途出现了工具调用，停止流式推送
              if (toolCallsBufferRef.current.length > 0) {
                if (streamBufferRef.current.has(runId)) {
                  streamThrottleRef.current.set(runId, setTimeout(flush, 120))
                }
                return
              }
              const lastLen = lastPushedLenRef.current.get(runId) ?? -1
              if (latest.length !== lastLen) {
                // 内容有变化，推送并重置空转计数
                lastPushedLenRef.current.set(runId, latest.length)
                idleCountRef.current.set(runId, 0)
                const m: ChatMessage = {
                  id: runId,
                  role: 'assistant',
                  content: latest,
                  thinking: latest.length > 0 ? undefined : thinkingBufferRef.current.get(runId),
                  toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
                  timestamp: Date.now(),
                  status: 'streaming',
                }
                onMessageStream.current?.(m)
              } else {
                // 内容未变，累加空转计数
                const idle = (idleCountRef.current.get(runId) ?? 0) + 1
                idleCountRef.current.set(runId, idle)
                // 超过 50 次空转（~6 秒）视为 final 丢失，自动停止
                if (idle > 50) {
                  // 监听场景：正文流长时间无增量，触发「流式超时兜底」
                  emitTelemetry({
                    event_name: 'stream_idle_fallback_triggered',
                    event_time: new Date().toISOString(),
                    user_id: userId ?? null,
                    session_id: sessionKey || null,
                    run_id: runId,
                    status: 'text_stream',
                    payload: {
                      idle_count: idle,
                      latest_length: latest.length,
                      has_tool_calls: toolCallsBufferRef.current.length > 0,
                    },
                  })
                  streamThrottleRef.current.delete(runId)
                  lastPushedLenRef.current.delete(runId)
                  idleCountRef.current.delete(runId)
                  if (streamBufferRef.current.delete(runId)) setStreamingCount((c) => Math.max(0, c - 1))
                  thinkingBufferRef.current.delete(runId)
                  // 推送最终状态
                  const m: ChatMessage = {
                    id: runId,
                    role: 'assistant',
                    content: latest,
                    toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
                    timestamp: Date.now(),
                    status: 'done',
                  }
                  onMessageStream.current?.(m)
                  activeRunIdRef.current = null
                  agentLifecycleRunIdRef.current = null
                  phaseRef.current = 'idle'
                  toolCallsBufferRef.current = []
                  return
                }
              }
            }
            // 如果 runId 还在 buffer 中，继续下一轮节流
            if (streamBufferRef.current.has(runId)) {
              streamThrottleRef.current.set(runId, setTimeout(flush, 120))
            } else {
              streamThrottleRef.current.delete(runId)
              lastPushedLenRef.current.delete(runId)
              idleCountRef.current.delete(runId)
            }
          }, 120))
        }
        // 非首次 delta：只累积到 buffer，等节流 timer 触发时统一推送
      } else if (thinkingBufferRef.current.has(runId) && !streamBufferRef.current.has(runId)) {
        // 只有思维内容，还没有正文，也推送消息让气泡出现
        const isNew = !streamThrottleRef.current.has(runId)
        if (isNew) {
          setStreamingCount((c) => c + 1)
          activeRunIdRef.current = runId
          // 推送一个只有 thinking 的消息
          const thinkingText = thinkingBufferRef.current.get(runId) || ''
          const msg: ChatMessage = {
            id: runId,
            role: 'assistant',
            content: '',
            thinking: thinkingText,
            toolCalls: currentToolCalls,
            timestamp: Date.now(),
            status: 'streaming',
          }
          onMessageStream.current?.(msg)

          streamThrottleRef.current.set(runId, setTimeout(function flushThinking() {
            if (!streamBufferRef.current.has(runId) && thinkingBufferRef.current.has(runId)) {
              const thinkingNow = thinkingBufferRef.current.get(runId) || ''
              const lastLen = lastPushedLenRef.current.get(runId) ?? -1
              if (thinkingNow.length !== lastLen) {
                lastPushedLenRef.current.set(runId, thinkingNow.length)
                idleCountRef.current.set(runId, 0)
                const m: ChatMessage = {
                  id: runId,
                  role: 'assistant',
                  content: '',
                  thinking: thinkingNow,
                  toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
                  timestamp: Date.now(),
                  status: 'streaming',
                }
                onMessageStream.current?.(m)
              } else {
                const idle = (idleCountRef.current.get(runId) ?? 0) + 1
                idleCountRef.current.set(runId, idle)
                if (idle > 50) {
                  // 监听场景：仅 thinking 流长时间无变化，触发「流式超时兜底」
                  emitTelemetry({
                    event_name: 'stream_idle_fallback_triggered',
                    event_time: new Date().toISOString(),
                    user_id: userId ?? null,
                    session_id: sessionKey || null,
                    run_id: runId,
                    status: 'thinking_stream',
                    payload: {
                      idle_count: idle,
                      thinking_length: thinkingNow.length,
                    },
                  })
                  streamThrottleRef.current.delete(runId)
                  lastPushedLenRef.current.delete(runId)
                  idleCountRef.current.delete(runId)
                  thinkingBufferRef.current.delete(runId)
                  activeRunIdRef.current = null
                  agentLifecycleRunIdRef.current = null
                  phaseRef.current = 'idle'
                  toolCallsBufferRef.current = []
                  return
                }
              }
              streamThrottleRef.current.set(runId, setTimeout(flushThinking, 120))
            }
          }, 120))
        }
      }
    } else if (state === 'final') {
      // 最终完整响应 — 清除节流 timer 并立即推送
      setBackendStatus('')
      const timer = streamThrottleRef.current.get(runId)
      const hadTimer = !!timer
      if (timer) { clearTimeout(timer); streamThrottleRef.current.delete(runId) }
      lastPushedLenRef.current.delete(runId)
      idleCountRef.current.delete(runId)
      thinkingBufferRef.current.delete(runId)

      const extractedText = extractText(payload.message)
      const bufferedText = streamBufferRef.current.get(runId)
      const text = extractedText || bufferedText || ''
      const hadStream = streamBufferRef.current.delete(runId)
      // 修复: 当只有 thinking delta (无 text delta) 时，streamBuffer 未设置
      // 但 streamingCount 已在 thinking 分支中递增，需要同步递减
      if (hadStream || hadTimer) setStreamingCount((c) => Math.max(0, c - 1))

      // 空内容不创建消息，避免空白气泡（但有工具调用时仍然推送）
      if (!text && !(toolCallsBufferRef.current.length > 0)) {
        activeRunIdRef.current = null
        agentLifecycleRunIdRef.current = null
        toolCallsBufferRef.current = []
        return
      }

      // 兜底：把所有残留 running 的工具强制标记为 done
      if (toolCallsBufferRef.current.some((tc) => tc.status === 'running')) {
        toolCallsBufferRef.current = toolCallsBufferRef.current.map((tc) =>
          tc.status === 'running' ? { ...tc, status: 'done' as const, endedAt: Date.now() } : tc
        )
      }

      const msg: ChatMessage = {
        id: runId,
        role: 'assistant',
        content: text,
        toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
        sessionKey,
        timestamp: Date.now(),
        status: 'done',
      }
      onMessageStream.current?.(msg)
      // 埋点：本轮助手最终文本已确定
      emitTelemetry({
        event_name: 'assistant_message_rendered',
        event_time: new Date().toISOString(),
        user_id: userId ?? null,
        session_id: sessionKey || null,
        run_id: runId,
        status: 'final',
        content: msg.content,
      })
      activeRunIdRef.current = null
      agentLifecycleRunIdRef.current = null
      phaseRef.current = 'idle'
      toolCallsBufferRef.current = []

      // 提取 usage 供自动压缩判断（兼容不同字段命名/层级）
      const usage = extractUsage(payload)
      // 只要提取到 usage 就立刻回传给 App，避免首轮因为字段差异导致占用率一直停在 0。
      if (usage) onFinalUsage.current?.({ ...usage, sessionKey })
    } else if (state === 'error') {
      setBackendStatus('')
      const errorMessage = translateError((payload.errorMessage as string) || '发生错误')
      const timer = streamThrottleRef.current.get(runId)
      if (timer) { clearTimeout(timer); streamThrottleRef.current.delete(runId) }
      lastPushedLenRef.current.delete(runId)
      idleCountRef.current.delete(runId)
      thinkingBufferRef.current.delete(runId)
      if (streamBufferRef.current.delete(runId)) setStreamingCount((c) => Math.max(0, c - 1))

      const msg: ChatMessage = {
        id: runId,
        role: 'assistant',
        content: errorMessage,
        toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
        timestamp: Date.now(),
        status: 'error',
      }
      onMessageStream.current?.(msg)
      // 埋点：助手回复以 error 结束
      emitTelemetry({
        event_name: 'assistant_message_rendered',
        event_time: new Date().toISOString(),
        user_id: userId ?? null,
        session_id: sessionKey || null,
        run_id: runId,
        status: 'error',
        content: msg.content,
      })
      activeRunIdRef.current = null
      agentLifecycleRunIdRef.current = null
      phaseRef.current = 'idle'
      toolCallsBufferRef.current = []
    } else if (state === 'aborted') {
      setBackendStatus('')
      let text: string
      if (isFrontendTimeoutRef.current) {
        text = '让我来继续完成任务'
      } else if (isAutoAbortRef.current) {
        text = redactSensitiveText(streamBufferRef.current.get(runId) || '')
      } else {
        text = `${redactSensitiveText(streamBufferRef.current.get(runId) || '')}(已中断)`
      }
      const timer = streamThrottleRef.current.get(runId)
      if (timer) { clearTimeout(timer); streamThrottleRef.current.delete(runId) }
      lastPushedLenRef.current.delete(runId)
      idleCountRef.current.delete(runId)
      thinkingBufferRef.current.delete(runId)
      if (streamBufferRef.current.delete(runId)) setStreamingCount((c) => Math.max(0, c - 1))

      const msg: ChatMessage = {
        id: runId,
        role: 'assistant',
        content: text,
        toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
        timestamp: Date.now(),
        status: 'done',
      }
      onMessageStream.current?.(msg)
      // 埋点：用户中止生成
      emitTelemetry({
        event_name: 'assistant_message_rendered',
        event_time: new Date().toISOString(),
        user_id: userId ?? null,
        session_id: sessionKey || null,
        run_id: runId,
        status: 'aborted',
        content: msg.content,
      })
      activeRunIdRef.current = null
      agentLifecycleRunIdRef.current = null
      phaseRef.current = 'idle'
      toolCallsBufferRef.current = []
    } else if (state === 'terminated') {
      // 上下文耗尽或进程被终止
      setBackendStatus('')
      const buffered = redactSensitiveText(streamBufferRef.current.get(runId) || '')
      const timer = streamThrottleRef.current.get(runId)
      if (timer) { clearTimeout(timer); streamThrottleRef.current.delete(runId) }
      lastPushedLenRef.current.delete(runId)
      idleCountRef.current.delete(runId)
      thinkingBufferRef.current.delete(runId)
      if (streamBufferRef.current.delete(runId)) setStreamingCount((c) => Math.max(0, c - 1))
      const hint = '\n\n---\n> 回复被中断，可能是上下文空间不足。建议点击「压缩」后重试。'

      const msg: ChatMessage = {
        id: runId,
        role: 'assistant',
        content: buffered + hint,
        toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
        timestamp: Date.now(),
        status: 'done',
      }
      onMessageStream.current?.(msg)
      // 终止原因命中上下文溢出时，通知 App 层触发一次自动压缩兜底。
      // 这里把 sessionKey 一并透出，避免 App 层误压缩当前激活之外的其它会话。
      const terminateReason = String(payload.errorMessage ?? payload.reason ?? '').toLowerCase()
      if (
        terminateReason.includes('context overflow')
        || terminateReason.includes('prompt too large')
        || (terminateReason.includes('context') && terminateReason.includes('too large'))
        || (terminateReason.includes('context') && terminateReason.includes('overflow'))
      ) {
        onContextOverflow.current?.(sessionKey)
      }
      // 埋点：上下文耗尽或进程终止导致的中断
      emitTelemetry({
        event_name: 'assistant_message_rendered',
        event_time: new Date().toISOString(),
        user_id: userId ?? null,
        session_id: sessionKey || null,
        run_id: runId,
        status: 'terminated',
        content: msg.content,
      })
      activeRunIdRef.current = null
      agentLifecycleRunIdRef.current = null
      phaseRef.current = 'idle'
      toolCallsBufferRef.current = []
    }
  }, [])

  const sendMessage = useCallback(async (sessionKey: string, content: string, attachments?: ChatAttachment[], agentId?: string, modelOverride?: string) => {
    const client = clientRef.current
    if (!client) {
      console.error('[ws] cannot send: no client instance')
      const msg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: '无法发送消息：WebSocket 客户端未初始化，请检查网关状态',
        timestamp: Date.now(),
        status: 'error',
      }
      onMessageStream.current?.(msg)
      return null
    }

    const idempotencyKey = generateId()
    const builtSessionKey = buildAgentSessionKey(sessionKey, agentId)

    // Build gateway attachments with file paths and base64 content
    const gatewayAttachments = attachments
      ?.filter((a) => a.filePath)
      .map((a) => ({
        type: a.type,
        mimeType: a.mimeType,
        fileName: a.fileName,
        filePath: a.filePath,
        content: a.content,
      }))

    // Debug: log attachment details before sending to gateway
    if (gatewayAttachments && gatewayAttachments.length > 0) {
      console.log('[ws] sendMessage attachments:', gatewayAttachments.map((a, i) => ({
        index: i,
        type: a.type,
        mimeType: a.mimeType,
        fileName: a.fileName,
        hasFilePath: !!a.filePath,
        hasContent: typeof a.content === 'string',
        contentLen: typeof a.content === 'string' ? a.content.length : 0,
      })))
    }

    const payload: Record<string, unknown> = {
      sessionKey: builtSessionKey,
      message: content,
      deliver: false,
      idempotencyKey
    }
    if (gatewayAttachments && gatewayAttachments.length > 0) {
      payload.attachments = gatewayAttachments
    }

    // 在 chat.send 之前 apply 模型覆盖，确保本条消息使用新模型
    if (modelOverride) {
      let patchOk = false
      for (let attempt = 0; attempt < 3 && !patchOk; attempt++) {
        try {
          await client.request('sessions.patch', { key: builtSessionKey, model: modelOverride })
          console.log('[ws] pre-send sessions.patch ok:', modelOverride)
          patchOk = true
        } catch (err) {
          console.warn(`[ws] pre-send sessions.patch attempt ${attempt + 1} failed:`, err)
          if (attempt < 2) {
            // 等待重连或 gateway 就绪后重试
            await new Promise(r => setTimeout(r, 600))
          }
        }
      }
    }

    try {
      // 埋点：用户消息已发起（与 idempotencyKey 对齐，后端可能用其作为 run_id）
      emitTelemetry({
        event_name: 'user_message_sent',
        event_time: new Date().toISOString(),
        user_id: userId ?? null,
        session_id: builtSessionKey,
        content,
        attachments: buildAttachmentMeta(attachments),
        payload: {
          agent_id: agentId || null,
          model_override: modelOverride || null,
          idempotency_key: idempotencyKey,
        },
      })
      const ack = await client.request<{ runId?: string; status?: string }>('chat.send', payload)
      // 埋点：chat.send 已收到 ack，建立 idempotency_key -> run_id 映射
      emitTelemetry({
        event_name: 'chat_send_ack',
        event_time: new Date().toISOString(),
        user_id: userId ?? null,
        session_id: builtSessionKey,
        run_id: ack?.runId || null,
        status: ack?.status || 'accepted',
        payload: {
          agent_id: agentId || null,
          model_override: modelOverride || null,
          idempotency_key: idempotencyKey,
        },
      })
      // chat.send 一旦拿到 ack.runId，就提前建立 session -> run 关联，避免“快速中断”时 run_id 丢失
      if (ack?.runId) {
        activeRunIdRef.current = ack.runId
        lastRunIdBySessionRef.current.set(normalizeSessionKey(builtSessionKey) || builtSessionKey, ack.runId)
      }
      return { ...ack, sessionKey: builtSessionKey, idempotencyKey }
    } catch (err) {
      console.error('[ws] chat.send failed:', err)
      const msg: ChatMessage = {
        id: idempotencyKey,
        role: 'assistant',
        content: `发送失败: ${translateError(err instanceof Error ? err.message : String(err))}`,
        timestamp: Date.now(),
        status: 'error',
      }
      onMessageStream.current?.(msg)
      return null
    }
  }, [emitTelemetry, userId])

  const abortSession = useCallback(async (sessionKey: string, agentId?: string, isAuto = false, isFrontendTimeout = false): Promise<{ success: boolean; error?: string }> => {
    isAutoAbortRef.current = isAuto
    isFrontendTimeoutRef.current = isFrontendTimeout
    const client = clientRef.current
    if (!client) {
      return { success: false, error: 'WebSocket 未连接' }
    }
    const builtSessionKey = buildAgentSessionKey(sessionKey, agentId)
    const normalizedSessionKey = normalizeSessionKey(builtSessionKey) || builtSessionKey
    const runIdForAbort =
      activeRunIdRef.current ||
      agentLifecycleRunIdRef.current ||
      lastRunIdBySessionRef.current.get(normalizedSessionKey) ||
      null
    emitTelemetry({
      event_name: 'chat_abort_requested',
      event_time: new Date().toISOString(),
      user_id: userId ?? null,
      session_id: builtSessionKey,
      run_id: runIdForAbort,
      status: 'requested',
      payload: {
        agent_id: agentId || null,
        is_auto: isAuto,
        is_frontend_timeout: isFrontendTimeout,
      },
    })
    try {
      await client.request('chat.abort', { sessionKey: builtSessionKey })
      setStreamingCount(0)
      streamBufferRef.current.clear()
      thinkingBufferRef.current.clear()
      toolCallsBufferRef.current = []
      activeRunIdRef.current = null
      agentLifecycleRunIdRef.current = null
      phaseRef.current = 'idle'
      setBackendStatus('')
      emitTelemetry({
        event_name: 'chat_abort_result',
        event_time: new Date().toISOString(),
        user_id: userId ?? null,
        session_id: builtSessionKey,
        run_id: runIdForAbort,
        status: 'success',
        payload: {
          agent_id: agentId || null,
          is_auto: isAuto,
        },
      })
      return { success: true }
    } catch (err) {
      console.error('[ws] chat.abort failed:', err)
      // 监听场景：chat.abort 请求执行失败
      const errorMessage = err instanceof Error ? err.message : String(err)
      setStreamingCount(0)
      streamBufferRef.current.clear()
      thinkingBufferRef.current.clear()
      toolCallsBufferRef.current = []
      activeRunIdRef.current = null
      agentLifecycleRunIdRef.current = null
      phaseRef.current = 'idle'
      setBackendStatus('')
      emitTelemetry({
        event_name: 'chat_abort_result',
        event_time: new Date().toISOString(),
        user_id: userId ?? null,
        session_id: builtSessionKey,
        run_id: runIdForAbort,
        status: 'failed',
        payload: {
          agent_id: agentId || null,
          error_message: errorMessage,
        },
      })
      return { success: false, error: errorMessage }
    }
  }, [emitTelemetry, userId])

  const reconnect = useCallback(() => {
    clientRef.current?.stop()
    clientRef.current?.start()
  }, [])

  const patchSessionModel = useCallback(async (sessionKey: string, model: string | null, agentId?: string) => {
    const client = clientRef.current
    if (!client) return
    const key = buildAgentSessionKey(sessionKey, agentId)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await client.request('sessions.patch', { key, model })
        console.log('[ws] patchSessionModel ok:', { key, model })
        return
      } catch (err) {
        console.warn(`[ws] patchSessionModel attempt ${attempt + 1} failed:`, err)
        if (attempt < 2) await new Promise(r => setTimeout(r, 800))
      }
    }
  }, [])

  /** 通过 /model 指令切换模型，直接写入 session store，比 sessions.patch 更可靠 */
  const sendModelDirective = useCallback(async (sessionKey: string, modelKey: string, agentId?: string) => {
    const client = clientRef.current
    if (!client) return
    const builtSessionKey = buildAgentSessionKey(sessionKey, agentId)
    const idempotencyKey = generateId()
    try {
      const ack = await client.request<{ runId?: string }>('chat.send', {
        sessionKey: builtSessionKey,
        message: `/model ${modelKey}`,
        deliver: false,
        idempotencyKey,
      })
      if (ack?.runId) {
        directiveRunIdsRef.current.add(ack.runId)
      }
      console.log('[ws] sendModelDirective ok:', { modelKey, runId: ack?.runId })
    } catch (err) {
      console.warn('[ws] sendModelDirective failed:', err)
    }
  }, [])

  const refreshAgents = useCallback(() => {
    const client = clientRef.current
    if (!client) return
    client.request<{ defaultId?: string; agents?: AgentInfo[] }>('agents.list', {})
      .then((res) => {
        if (res?.agents) setAgents(res.agents)
        if (res?.defaultId) setDefaultAgentId(res.defaultId)
        console.log('[ws] agents refreshed:', res?.agents?.map((a: AgentInfo) => a.id))
      })
      .catch((err) => console.warn('[ws] agents.list refresh failed:', err))
  }, [])

  const getSessionTokenUsage = useCallback(async (sessionKey: string, agentId?: string) => {
    const client = clientRef.current
    if (!client) return null
    try {
      const builtSessionKey = buildAgentSessionKey(sessionKey, agentId)
      const payload = await client.request<{
        defaults?: { contextTokens?: number; contextWindow?: number }
        sessions?: Array<Record<string, unknown>>
      }>('sessions.list', {})
      const sessions = Array.isArray(payload?.sessions) ? payload.sessions : []
      const hit = sessions.find((item) => {
        const key = typeof item.key === 'string' ? item.key : ''
        return key === builtSessionKey || normalizeSessionKey(key) === sessionKey
      })
      if (!hit) return null
      // 兼容 sessions.list 的多种 usage 字段形态（平铺/嵌套 usage/tokenUsage）。
      // 压缩后某些网关实现会只在嵌套对象里返回最新 input，不兼容会被误读为 0。
      const usageContainer = (
        (hit.usage && typeof hit.usage === 'object' ? hit.usage : null)
        || (hit.tokenUsage && typeof hit.tokenUsage === 'object' ? hit.tokenUsage : null)
      ) as Record<string, unknown> | null
      // 逐个兜底读取“输入” token（该字段在不同网关实现里可能是单轮值，不一定累计）。
      // 保留解析是为了兼容历史返回结构，但最终展示值会优先用 total（累计）口径。
      const input = parseUsageNumber(
        hit.input
        ?? hit.inputTokens
        ?? hit.input_tokens
        ?? hit.inputTokenCount
        ?? hit.input_token_count
        ?? hit.prompt_tokens
        ?? hit.promptTokens
        ?? hit.promptTokenCount
        ?? hit.prompt_token_count
        ?? hit.tokens_in
        ?? hit.tokensIn
        ?? hit.total_input_tokens
        ?? hit.totalInputTokens
        ?? usageContainer?.input
        ?? usageContainer?.inputTokens
        ?? usageContainer?.input_tokens
        ?? usageContainer?.inputTokenCount
        ?? usageContainer?.input_token_count
        ?? usageContainer?.prompt_tokens
        ?? usageContainer?.promptTokens
        ?? usageContainer?.promptTokenCount
        ?? usageContainer?.prompt_token_count
        ?? usageContainer?.tokens_in
        ?? usageContainer?.tokensIn
        ?? usageContainer?.total_input_tokens
        ?? usageContainer?.totalInputTokens
      )
      // 会话占用率应使用“累计口径”。
      // 对应网关字段通常是 total_tokens / totalTokens / token_count；
      // 若该值存在，必须优先使用它，避免误用单轮 input 导致占用率忽大忽小。
      const total = parseUsageNumber(
        hit.total_tokens
        ?? hit.totalTokens
        ?? hit.token_count
        ?? hit.tokenCount
        ?? hit.total
        ?? hit.totalTokenCount
        ?? usageContainer?.total_tokens
        ?? usageContainer?.totalTokens
        ?? usageContainer?.token_count
        ?? usageContainer?.tokenCount
        ?? usageContainer?.total
        ?? usageContainer?.totalTokenCount
      )
      // 输出 token 同样做兼容读取，保持 usage 结构稳定。
      const output = parseUsageNumber(
        hit.output
        ?? hit.outputTokens
        ?? hit.output_tokens
        ?? hit.outputTokenCount
        ?? hit.output_token_count
        ?? hit.completion_tokens
        ?? hit.completionTokens
        ?? hit.completionTokenCount
        ?? hit.completion_token_count
        ?? hit.tokens_out
        ?? hit.tokensOut
        ?? hit.total_output_tokens
        ?? hit.totalOutputTokens
        ?? usageContainer?.output
        ?? usageContainer?.outputTokens
        ?? usageContainer?.output_tokens
        ?? usageContainer?.outputTokenCount
        ?? usageContainer?.output_token_count
        ?? usageContainer?.completion_tokens
        ?? usageContainer?.completionTokens
        ?? usageContainer?.completionTokenCount
        ?? usageContainer?.completion_token_count
        ?? usageContainer?.tokens_out
        ?? usageContainer?.tokensOut
        ?? usageContainer?.total_output_tokens
        ?? usageContainer?.totalOutputTokens
      )
      // normalizedInput 是 UI 展示的“当前会话上下文已占用 token”。
      // 正确口径：优先 total（累计，通常=输入+输出）；
      // 若 total 缺失，则回退到 input + output，避免只按输入计算导致占用率偏低。
      const summedInputOutput = input + output
      const normalizedInput = total > 0 ? total : (summedInputOutput > 0 ? summedInputOutput : (input > 0 ? input : 0))
      // context window 兼容 contextWindow/context_tokens 等不同命名。
      const contextWindow = parseUsageNumber(
        hit.contextWindow
        ?? hit.contextTokens
        ?? hit.context_tokens
        ?? hit.contextTokenCount
        ?? hit.context_token_count
        ?? usageContainer?.contextWindow
        ?? usageContainer?.contextTokens
        ?? usageContainer?.context_tokens
        ?? usageContainer?.contextTokenCount
        ?? usageContainer?.context_token_count
        ?? payload?.defaults?.contextWindow
        ?? payload?.defaults?.contextTokens
      )
      return { input: normalizedInput, output, contextWindow: contextWindow > 0 ? contextWindow : undefined }
    } catch (err) {
      console.warn('[ws] getSessionTokenUsage failed:', err)
      return null
    }
  }, [])

  return { connected, hello, agents, defaultAgentId, sendMessage, abortSession, isStreaming, backendStatus, backendHealthy, onMessageStream, onFinalUsage, onContextOverflow, onCompactionEnd, onStreamStart, onBackendDisconnected, patchSessionModel, sendModelDirective, getSessionTokenUsage, reconnect, refreshAgents, client: clientRef.current }
}
