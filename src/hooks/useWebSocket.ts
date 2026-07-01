import { useState, useEffect, useCallback, useRef } from 'react'
import { GatewayClient, type GatewayEventFrame, type GatewayHelloOk } from '../lib/gateway-protocol'
import type { ChatMessage, ChatAttachment, ChatToolCall, AgentInfo, TaskStatus } from '../types'
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
  /** 对齐官方 UI：run 结束时立即通知 App 清除 hasActiveRun，避免等待 sessions.list 轮询延迟 */
  onRunEnd: React.MutableRefObject<((sessionKey?: string) => void) | null>
  onSessionUsageUpdate: React.MutableRefObject<
    | ((usage: { totalTokens?: number; contextTokens?: number; sessionKey?: string }) => void)
    | null
  >
  onContextOverflow: React.MutableRefObject<((sessionKey?: string) => void) | null>
  onCompactionEnd: React.MutableRefObject<((sessionKey?: string) => void) | null>
  onStreamStart: React.MutableRefObject<(() => void) | null>
  onBackendDisconnected: React.MutableRefObject<((reason: string) => void) | null>
  /** 工具执行失败（final 之后到达的 error）时触发，App 可据此自动发"继续"让 agent 换方式 */
  onToolFailure: React.MutableRefObject<((sessionKey?: string, errorMessage?: string) => void) | null>
  patchSessionModel: (sessionKey: string, model: string | null, agentId?: string) => Promise<void>
  sendModelDirective: (sessionKey: string, modelKey: string, agentId?: string) => Promise<void>
  getSessionTokenUsage: (sessionKey: string, agentId?: string) => Promise<{ input: number; output: number; contextWindow?: number; hasActiveRun?: boolean } | null>
  reconnect: () => void
  refreshAgents: () => void
  client: GatewayClient | null
  clearOfflineQueue: () => void
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

function cleanupStreamBuffers(
  runId: string,
  streamThrottleRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>,
  lastPushedLenRef: React.MutableRefObject<Map<string, number>>,
  idleCountRef: React.MutableRefObject<Map<string, number>>,
  streamBufferRef: React.MutableRefObject<Map<string, string>>,
  thinkingBufferRef: React.MutableRefObject<Map<string, string>>,
  setStreamingCount: (updater: number | ((prev: number) => number)) => void,
) {
  const timer = streamThrottleRef.current.get(runId)
  if (timer) { clearTimeout(timer); streamThrottleRef.current.delete(runId) }
  lastPushedLenRef.current.delete(runId)
  idleCountRef.current.delete(runId)
  thinkingBufferRef.current.delete(runId)
  const hadStream = streamBufferRef.current.delete(runId)
  const hadThinking = thinkingBufferRef.current.delete(runId)
  if (hadStream || hadThinking) setStreamingCount((c: number) => Math.max(0, c - 1))
}

function resetActiveRunState(
  activeRunIdRef: React.MutableRefObject<string | null>,
  agentLifecycleRunIdRef: React.MutableRefObject<string | null>,
  phaseRef: React.MutableRefObject<string>,
  toolCallsBufferRef: React.MutableRefObject<ChatToolCall[]>,
  committedSegmentRunIdsRef?: React.MutableRefObject<Set<string>>,
  lastSegmentAccumulatedTextRef?: React.MutableRefObject<string | null>,
  finalRunIdsRef?: React.MutableRefObject<Map<string, string>>,
) {
  activeRunIdRef.current = null
  agentLifecycleRunIdRef.current = null
  phaseRef.current = 'idle'
  toolCallsBufferRef.current = []
  if (committedSegmentRunIdsRef) committedSegmentRunIdsRef.current.clear()
  if (lastSegmentAccumulatedTextRef) lastSegmentAccumulatedTextRef.current = null
  // finalRunIdsRef is cleared in lifecycle.start and abortSession, not here
  void finalRunIdsRef
}

/** 从 sessionKey 中提取 sub-agent 标识，如 agent:main:subagent:xxx → subagent:xxx */
function extractSubAgentId(sessionKey?: string): string | undefined {
  if (!sessionKey) return undefined
  const match = /^agent:[^:]+:(subagent:.+)$/.exec(sessionKey)
  return match?.[1] || undefined
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

/**
 * 解析 delta 事件的流式文本，对齐官方 UI resolveDeltaChatStreamText 逻辑。
 *
 * 网关 delta 事件可能携带两种文本：
 * - `deltaText`：本轮增量文本（只包含本次新增的片段）
 * - `message`（snapshot）：本轮截至目前的全量文本
 *
 * 关键规则：
 * 1. 若有 `deltaText` 且 `replace=true`，直接用 `deltaText` 替换全量
 * 2. 若有 `deltaText`，且 currentStream 已存在，则 `currentStream + deltaText`（增量拼接）
 * 3. 若有 `deltaText`，且 currentStream 为空，优先用 snapshot（全量），回退 deltaText
 * 4. 若无 `deltaText`，直接用 snapshot（全量），避免与 buffer 拼接导致重复
 *
 * 返回 null 表示本轮无文本。
 */
function resolveDeltaStreamText(
  currentStream: string | null,
  payload: Record<string, unknown>,
): string | null {
  const snapshot = payload.message == null ? null : extractText(payload.message)
  const deltaText = typeof payload.deltaText === 'string' ? payload.deltaText : null
  const replace = payload.replace === true

  if (deltaText !== null) {
    if (replace) return deltaText
    if (currentStream === null || currentStream === '') {
      return typeof snapshot === 'string' && snapshot.length > 0 ? snapshot : deltaText
    }
    // 若 snapshot 可用，校验 snapshot = currentStream + deltaText，不一致则回退 snapshot
    if (typeof snapshot === 'string') {
      const prefixLength = snapshot.length - deltaText.length
      if (
        prefixLength !== currentStream.length ||
        snapshot.slice(0, prefixLength) !== currentStream
      ) {
        return snapshot
      }
    }
    return `${currentStream}${deltaText}`
  }
  return typeof snapshot === 'string' && snapshot.length > 0 ? snapshot : null
}

/**
 * 去除累积流式文本的前一个分段前缀，对齐官方 UI trimAccumulatedStreamPrefix。
 * 网关 delta 累积的 chatStream 是全量文本，分段提交时需要去除前一个分段的前缀，
 * 只显示本轮新增部分，避免每个分段都包含之前所有文本。
 */
function trimAccumulatedStreamPrefix(text: string, previousText: string | null): string {
  if (!previousText || !text.startsWith(previousText)) {
    return text
  }
  return text.slice(previousText.length).trimStart()
}

/** 检测文本是否为上下文溢出相关消息 */
function isContextOverflowText(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('context overflow')
    || lower.includes('prompt too large')
    || (lower.includes('context') && lower.includes('too large'))
    || (lower.includes('context') && lower.includes('overflow'))
    || (lower.includes('context') && lower.includes('length') && (lower.includes('exceed') || lower.includes('too long') || lower.includes('limit')))
  )
}

const CONTEXT_OVERFLOW_FRIENDLY_MSG = '哎呀，上下文溢出了，让我来压缩一下，并继续执行任务，请稍等！'

/** 将常见英文错误消息翻译为中文 */
function translateError(msg: string): string {
  const safeMsg = redactSensitiveText(msg)
  const lower = safeMsg.toLowerCase()
  if (isContextOverflowText(safeMsg))
    return CONTEXT_OVERFLOW_FRIENDLY_MSG
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
  const streamingCountRef = useRef(0)
  const syncStreamingCount = useCallback((updater: number | ((prev: number) => number)) => {
    // 立即同步更新 ref，不依赖 setStreamingCount updater 的执行时机。
    // React 18 批处理下 setState 的 updater 可能延迟执行，若 ref 在 updater 内更新，
    // 会导致同步回调（如 onMessageStream → auto-continue）读到陈旧的 streaming 状态，
    // 从而错误地跳过恢复（"run still streaming, skip auto-continue"）。
    const prev = streamingCountRef.current
    const next = Math.max(0, typeof updater === 'function' ? updater(prev) : updater)
    streamingCountRef.current = next
    setStreamingCount(next)
  }, [])
  const [backendStatus, setBackendStatus] = useState('')
  // 跟踪当前是否处于错误状态，防止后台任务 lifecycle 事件覆盖错误提示
  const hasErrorRef = useRef(false)
  // 跟踪 post-final error 的重试次数（per session），用于生成俏皮提示文案
  const postFinalErrorCountRef = useRef<Map<string, number>>(new Map())
  const [backendHealthy, setBackendHealthy] = useState(true)
  const clientRef = useRef<GatewayClient | null>(null)
  const onMessageStream = useRef<((msg: ChatMessage) => void) | null>(null)
  const onBackendDisconnected = useRef<((reason: string) => void) | null>(null)
  const onToolFailure = useRef<((sessionKey?: string, errorMessage?: string) => void) | null>(null)
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
  // 记录已提交过流式分段（segment）的 runId。
  // 当工具调用开始时，会把已累积的流式文本作为独立消息提交（segment），
  // 后续 final 只应显示最后一轮的文本，避免与 segment 重复。
  const committedSegmentRunIdsRef = useRef<Set<string>>(new Set())
  // 流式分段计数器，用于生成分段消息的唯一 ID
  const streamSegmentCounterRef = useRef(0)
  // 记录上一个已提交分段的累积文本（chatStream 全量值），
  // 用于提交下一个分段时去除前缀，对齐官方 UI trimAccumulatedStreamPrefix。
  const lastSegmentAccumulatedTextRef = useRef<string | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const isAutoAbortRef = useRef(false)
  const isFrontendTimeoutRef = useRef(false)
  // 标记前端是否发起了 abort（用户点停止/前端超时）。final 处理据此区分：
  // 前端发起的 abort → 'user_aborted'（不触发 auto-continue）
  // 网关主动 abort（LLM 超时等）→ 'interrupted'（触发 auto-continue）
  const abortInitiatedRef = useRef(false)
  const directiveRunIdsRef = useRef<Set<string>>(new Set())
  // 记录每个会话最近一次已确认的 runId，供 abort 等非 chat 事件兜底关联
  const lastRunIdBySessionRef = useRef<Map<string, string>>(new Map())
  // 记录已收到 final 事件的 runId + taskStatus，用于 error 事件处理时判断是否应跳过
  const finalRunIdsRef = useRef<Map<string, string>>(new Map())
  // agent lifecycle.start 分配的 runId（工具调用流式消息用此 ID）
  // 与 chat 事件的 runId 可能不同，需要在 final 时用此 ID 确保消息正确替换
  const agentLifecycleRunIdRef = useRef<string | null>(null)
  const runIdAgentIdMapRef = useRef<Map<string, string>>(new Map())
  // 阶段追踪：idle → thinking → tool → text → idle
  // thinking/tool 阶段不推送流式文本，只推送工具调用和思考内容
  const phaseRef = useRef<'idle' | 'thinking' | 'tool' | 'text'>('idle')
  // 等待 lifecycle.start 的超时定时器：用于在发送消息后一段时间内没有收到响应时显示"正在处理中..."
  const lifecycleStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 自动压缩：暴露给 App.tsx 的回调
  const onFinalUsage = useRef<((usage: { input: number; output: number; sessionKey?: string }) => void) | null>(null)
  /** 对齐官方 UI：run 结束时立即通知 App 清除 hasActiveRun，避免等待 sessions.list 轮询延迟 */
  const onRunEnd = useRef<((sessionKey?: string) => void) | null>(null)
  const onSessionUsageUpdate = useRef<
    | ((usage: { totalTokens?: number; contextTokens?: number; sessionKey?: string }) => void)
    | null
  >(null)
  const onContextOverflow = useRef<((sessionKey?: string) => void) | null>(null)
  const onCompactionEnd = useRef<((sessionKey?: string) => void) | null>(null)
  const contextOverflowRunIdsRef = useRef<Set<string>>(new Set())
  // agent 活动开始通知（用于清除 isWaiting 等待状态）
  const onStreamStart = useRef<(() => void) | null>(null)
  // 追踪最后发送的消息内容，用于检测 /compact 命令的响应
  const lastSentMessageRef = useRef<string>('')
  // 存储 /compact 命令的 idempotencyKey，用于更新压缩进度消息
  const compactMessageIdRef = useRef<string | null>(null)
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
        syncStreamingCount(0)
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
      if (timeSinceLastCheck > HEALTH_CHECK_TIMEOUT && streamingCountRef.current > 0) {
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

  // W16 fix: use userIdRef to avoid stale closure in handleEvent
  const userIdRef = useRef(userId)
  userIdRef.current = userId

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
      const agentIdFromEvent = (p.agentId as string | undefined) || extractSubAgentId(p.sessionKey as string | undefined)
      const agentSessionKey = normalizeSessionKey(p.sessionKey as string | undefined)
      // 检查是否是 heartbeat 任务
      const isHeartbeat = p.isHeartbeat as boolean | undefined

      // 识别后台任务（memory 插件的 L1/L2/L3 提取任务等）
      const isBackgroundTask = agentRunId?.startsWith('memory-') ||
        agentIdFromEvent?.startsWith('memory-') ||
        agentRunId?.includes('-extraction-run-') ||
        agentRunId?.includes('-scene-run-') ||
        agentRunId?.includes('-persona-run-') ||
        isHeartbeat === true

      if (isBackgroundTask) {
        // 后台任务：只在状态栏显示进度，不作为主对话消息处理
        // 错误状态下不覆盖状态栏，避免清除工具失败等错误提示
        if (stream === 'lifecycle') {
          if (phase === 'start') {
            if (!hasErrorRef.current) {
              const taskType = isHeartbeat ? '心跳检查' :
                agentRunId?.includes('l1-extraction') ? 'L1 记忆提取' :
                agentRunId?.includes('scene') ? 'L2 场景归纳' :
                agentRunId?.includes('persona') ? 'L3 用户画像' : '后台任务'
              setBackendStatus(`[${taskType}] 运行中...`)
            }
          } else if (phase === 'end') {
            if (!hasErrorRef.current) {
              setBackendStatus('')
            }
          }
        } else if (stream === 'assistant') {
          // L1 提取输出 JSON，显示简短预览
          if (!hasErrorRef.current) {
            const text = (data.text as string) || ''
            if (text && text.length < 200) {
              setBackendStatus(`[L1 提取] ${text.slice(0, 60)}...`)
            }
          }
        }
        console.log('[ws] agent event: background task', { agentRunId, stream, phase, isHeartbeat, dataKeys: Object.keys(data) })
        return
      }

      if (agentRunId && agentIdFromEvent) {
        runIdAgentIdMapRef.current.set(agentRunId, agentIdFromEvent)
      }
      console.log('[ws] agent event:', { stream, phase, agentRunId, agentIdFromEvent, sessionKey: p.sessionKey, activeRunId: activeRunIdRef.current, toolCallsCount: toolCallsBufferRef.current.length, dataKeys: Object.keys(data) })

      // 从 agent 事件的 session 字段中提取 token 使用信息
      const sessionData = p.session as Record<string, unknown> | undefined
      if (sessionData && agentSessionKey) {
        const totalTokens = sessionData.totalTokens as number | undefined
        const contextTokens = sessionData.contextTokens as number | undefined
        const totalTokensFresh = sessionData.totalTokensFresh as boolean | undefined

        // 只有当 totalTokensFresh 为 true 或者有有效的 token 值时才更新
        if (totalTokensFresh || (totalTokens !== undefined && totalTokens > 0) || (contextTokens !== undefined && contextTokens > 0)) {
          onSessionUsageUpdate.current?.({
            totalTokens,
            contextTokens,
            sessionKey: agentSessionKey
          })
        }
      }

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
            // 工具调用开始前，把已累积的流式文本作为独立分段消息提交，
            // 对齐官方 UI 的 chatStreamSegments 模式：工具调用前的文本
            // 作为独立消息渲染在工具卡片上方，而非被工具调用覆盖丢失。
            const accumulatedText = streamBufferRef.current.get(runId)
            if (accumulatedText && accumulatedText.trim().length > 0) {
              // 取消该 runId 的节流定时器，避免节流回调推送已过期的内容
              const throttleTimer = streamThrottleRef.current.get(runId)
              if (throttleTimer) {
                clearTimeout(throttleTimer)
                streamThrottleRef.current.delete(runId)
              }
              // 去除前一个分段的累积前缀，只显示本轮新增文本（对齐官方 UI trimAccumulatedStreamPrefix）
              const visibleText = trimAccumulatedStreamPrefix(accumulatedText, lastSegmentAccumulatedTextRef.current)
              // 更新上一个分段的累积文本为当前累积值
              lastSegmentAccumulatedTextRef.current = accumulatedText
              // 提交分段消息（独立 ID，status=done，不会被后续 streaming 更新覆盖）
              if (visibleText.trim().length > 0) {
                const segmentId = `${runId}-seg-${++streamSegmentCounterRef.current}`
                onMessageStream.current?.({
                  id: segmentId,
                  role: 'assistant',
                  content: visibleText,
                  thinking: thinkingBufferRef.current.get(runId),
                  timestamp: Date.now(),
                  status: 'done',
                  // 分段消息不设置 taskStatus，避免显示"任务已完成"提示
                  agentId: agentIdFromEvent || runIdAgentIdMapRef.current.get(runId),
                  sessionKey: agentSessionKey,
                })
              }
              // 重置 buffer 为空字符串（保留 key 避免 isNew 重复递增 streamingCount）
              streamBufferRef.current.set(runId, '')
              lastPushedLenRef.current.set(runId, -1)
              idleCountRef.current.delete(runId)
              committedSegmentRunIdsRef.current.add(runId)
            }
            onMessageStream.current?.({
              id: runId,
              role: 'assistant',
              content: '',
              thinking: thinkingBufferRef.current.get(runId),
              toolCalls: [...toolCallsBufferRef.current],
              timestamp: Date.now(),
              status: 'streaming',
              taskStatus: 'calling_tool',
              agentId: agentIdFromEvent || runIdAgentIdMapRef.current.get(runId),
              sessionKey: agentSessionKey,
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
          if (isError) {
            // agent 在 run 内工具失败，会自行决定换方式重试（OpenClaw 模型自主模式）
            console.log('[ws] ★ 工具执行失败，agent 将自行决定下一步（换方式/重试/放弃）:', { name, sessionKey: agentSessionKey, error: (data.error as string)?.slice(0, 120) || result?.slice(0, 120) })
            setBackendStatus(`⚠️ ${name} 执行失败，等待 agent 决定下一步...`)
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
              taskStatus: 'waiting',
              agentId: agentIdFromEvent || runIdAgentIdMapRef.current.get(runId),
              sessionKey: agentSessionKey,
            })
          }
          setBackendStatus(isError ? `${name} 执行出错，正在处理...` : `${name} 执行完成，正在思考...`)
        }
      } else if (stream === 'lifecycle') {
        if (phase === 'start') {
          // 收到 lifecycle.start，清除等待超时定时器
          if (lifecycleStartTimeoutRef.current) {
            clearTimeout(lifecycleStartTimeoutRef.current)
            lifecycleStartTimeoutRef.current = null
          }
          // 注意：不重置 toolCallsBufferRef，避免多次 lifecycle.start（子代理/多轮 agent 调用）
          // 导致之前已收集的工具调用丢失。对齐官方 UI：工具调用在整个会话中累积显示。
          // 只重置流式相关状态（分段、buffer 前缀记录）
          committedSegmentRunIdsRef.current.clear()
          lastSegmentAccumulatedTextRef.current = null
          // W4 fix: clear finalRunIdsRef when a new run starts, preventing stale entries
          finalRunIdsRef.current.clear()
          // 重置 abort 标记：新 run 开始时，之前的 abort（可能因网络断开未收到 final/aborted）
          // 不应影响本 run 的 taskStatus 决策
          abortInitiatedRef.current = false
          phaseRef.current = 'thinking'
          // 用 agent 事件的 runId 提前设置 activeRunIdRef
          // 这样后续的 tool.start/end 事件能关联到正确的消息
          if (agentRunId) {
            activeRunIdRef.current = agentRunId
            agentLifecycleRunIdRef.current = agentRunId
          }
          // 通知 App 层 agent 活动已开始，清除等待动画
          syncStreamingCount((c) => c + 1)
          onStreamStart.current?.()
          hasErrorRef.current = false
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
              taskStatus: 'starting',
              agentId: agentIdFromEvent,
              sessionKey: agentSessionKey,
            })
          }
        } else if (phase === 'end' || phase === 'error') {
          // 收到 lifecycle.end/error，清除等待超时定时器
          if (lifecycleStartTimeoutRef.current) {
            clearTimeout(lifecycleStartTimeoutRef.current)
            lifecycleStartTimeoutRef.current = null
          }
          // 防止 stale run 的延迟 end 事件干扰新 run：
          // 如果 agentRunId 不为空且与当前 activeRunIdRef 不匹配，
          // 说明这是已 abort 的旧 run 的延迟事件，跳过 streamingCount 递减，
          // 避免把新 run 的 streamingCount 错误清零导致 UI 卡住。
          const isStaleLifecycleEnd = agentRunId && activeRunIdRef.current && agentRunId !== activeRunIdRef.current
          if (isStaleLifecycleEnd) {
            console.log('[ws] lifecycle.end: stale runId, skipping streamingCount decrement', { agentRunId, activeRunId: activeRunIdRef.current })
          } else {
            phaseRef.current = 'idle'
            setBackendStatus('')
            // agent 活动结束时减少 streamingCount
            syncStreamingCount((c) => Math.max(0, c - 1))
          }
        }
      } else if (stream === 'compaction') {
        if (phase === 'start') {
          console.log('[溢出] 收到 compaction.start 事件:', { agentRunId, activeRunId: activeRunIdRef.current, sessionKey: agentSessionKey })
          setBackendStatus('正在压缩上下文...')
          const runId = agentRunId || activeRunIdRef.current || generateId()
          activeRunIdRef.current = runId
          syncStreamingCount((c) => c + 1)
          console.log('[ws] compaction.start: runId=', runId, 'agentRunId=', agentRunId, 'activeRunIdRef=', runId)
          onMessageStream.current?.({
            id: runId,
            role: 'assistant',
            content: '',
            thinking: '',
            toolCalls: [],
            timestamp: Date.now(),
            status: 'streaming',
            taskStatus: 'compacting',
            agentId: agentIdFromEvent || runIdAgentIdMapRef.current.get(runId),
            sessionKey: agentSessionKey,
          })
        } else if (phase === 'end') {
          console.log('[溢出] 收到 compaction.end 事件:', { agentRunId, activeRunId: activeRunIdRef.current, sessionKey: agentSessionKey })
          setBackendStatus('压缩完成')
          const runId = agentRunId || activeRunIdRef.current
          console.log('[ws] compaction.end: runId=', runId, 'activeRunIdRef=', activeRunIdRef.current)
          if (runId) {
            syncStreamingCount((c) => Math.max(0, c - 1))
            onMessageStream.current?.({
              id: runId,
              role: 'assistant',
              content: '上下文压缩已完成',
              thinking: '',
              toolCalls: [],
              timestamp: Date.now(),
              status: 'done',
              taskStatus: 'completed',
              agentId: agentIdFromEvent || runIdAgentIdMapRef.current.get(runId),
              sessionKey: agentSessionKey,
            })
            // W14 fix: only clear activeRunIdRef if it's still the compaction run
            // otherwise a new chat run may have already taken over
            if (activeRunIdRef.current === runId) {
              activeRunIdRef.current = null
            }
          }
          console.log('[溢出] 触发 onCompactionEnd 回调:', normalizeSessionKey(p.sessionKey as string | undefined))
          onCompactionEnd.current?.(normalizeSessionKey(p.sessionKey as string | undefined))
        }
      }
      return
    }

    // OpenClaw Gateway 用 "chat" 事件名传递聊天消息
    if (evt.event !== 'chat') return

    if (!evt.payload || typeof evt.payload !== 'object') return
    const payload = evt.payload as Record<string, unknown>

    // 过滤后台任务的 chat 事件（heartbeat、memory 插件等），不作为主对话消息处理
    const chatIsHeartbeat = payload.isHeartbeat as boolean | undefined
    const chatRunId = payload.runId as string | undefined
    const chatSessionKey = payload.sessionKey as string | undefined
    const isBackgroundChatTask = chatIsHeartbeat === true ||
      chatRunId?.startsWith('memory-') ||
      chatRunId?.includes('-extraction-run-') ||
      chatRunId?.includes('-scene-run-') ||
      chatRunId?.includes('-persona-run-') ||
      chatSessionKey?.includes('memory-') ||
      chatSessionKey?.includes('extraction-session')

    if (isBackgroundChatTask) {
      console.log('[ws] chat event: background task, skipping', { runId: chatRunId, sessionKey: chatSessionKey, state: payload.state, isHeartbeat: chatIsHeartbeat })
      return
    }

    const state = payload.state as string | undefined
    // 优先使用 agent lifecycle 的 runId（与工具调用流式消息一致），
    // 解决 agent 事件 runId 与 chat 事件 runId 不一致导致工具调用卡在 "running" 的问题
    const runId = (toolCallsBufferRef.current.length > 0 && agentLifecycleRunIdRef.current)
      ? agentLifecycleRunIdRef.current
      : (chatRunId || generateId())
    const rawSessionKey = payload.sessionKey as string | undefined
    const sessionKey = normalizeSessionKey(rawSessionKey)
    const chatAgentId = (payload.agentId as string | undefined)
      || (runId ? runIdAgentIdMapRef.current.get(runId) : undefined)
      || extractSubAgentId(rawSessionKey)
    if (sessionKey && runId) {
      lastRunIdBySessionRef.current.set(sessionKey, runId)
    }

    // 过滤指令消息的响应（如 /model 切换命令），不显示在聊天中
    if (chatRunId && directiveRunIdsRef.current.has(chatRunId)) {
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
      // 流式增量更新 — 对齐官方 UI resolveDeltaChatStreamText 逻辑
      // 使用 deltaText（增量）优先，避免 extractText(snapshot) + buffer 拼接导致文本重复
      const currentBuffer = streamBufferRef.current.get(runId) ?? null
      const resolvedText = resolveDeltaStreamText(currentBuffer, payload)
      const text = resolvedText ?? ''

      // 提取推理/思考内容，累积到 thinkingBuffer
      // 注意：thinking 也可能是全量 snapshot，需要同样的增量处理
      if (payload.message && typeof payload.message === 'object') {
        const msg = payload.message as Record<string, unknown>
        const thinking = (msg.reasoning_content as string) || (msg.thinking as string) || ''
        if (thinking) {
          // thinking 采用 snapshot 替换策略（网关通常发送全量 thinking）
          thinkingBufferRef.current.set(runId, thinking)
        }
      }

      // 辅助：构建当前工具调用列表
      const currentToolCalls = toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined

      const thinkingText = thinkingBufferRef.current.get(runId) || ''
      const hasThinking = thinkingText.length > 0

      if (text) {
        const isNew = !streamBufferRef.current.has(runId)
        // resolvedText 已是全量文本（deltaText 增量拼接或 snapshot 全量），
        // 直接设置 buffer，不再做 buffer + text 拼接（避免重复）
        const accumulated = text
        streamBufferRef.current.set(runId, accumulated)

        if (isNew) {
          syncStreamingCount((c) => c + 1)
          activeRunIdRef.current = runId
        }

        if (isContextOverflowText(accumulated)) {
          console.log('[溢出] delta 阶段检测到上下文溢出:', { runId, sessionKey, textLength: accumulated.length })
          contextOverflowRunIdsRef.current.add(runId)
          const overflowMsg: ChatMessage = {
            id: runId,
            role: 'assistant',
            content: CONTEXT_OVERFLOW_FRIENDLY_MSG,
            toolCalls: currentToolCalls,
            timestamp: Date.now(),
            status: 'streaming',
            agentId: chatAgentId,
            sessionKey,
          }
          onMessageStream.current?.(overflowMsg)
          return
        }

        if (contextOverflowRunIdsRef.current.has(runId)) {
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
              agentId: chatAgentId,
              sessionKey,
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
                  agentId: chatAgentId,
                  sessionKey,
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

        // 正常流式推送（含工具调用后的文本，对齐官方 UI 的 chatStream 模式）
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
            agentId: chatAgentId,
            sessionKey,
          }
          onMessageStream.current?.(msg)

          streamThrottleRef.current.set(runId, setTimeout(function flush() {
            const latest = streamBufferRef.current.get(runId)
            if (latest != null) {
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
                  agentId: chatAgentId,
                  sessionKey,
                }
                onMessageStream.current?.(m)
              } else {
                // 内容未变，累加空转计数
                const idle = (idleCountRef.current.get(runId) ?? 0) + 1
                idleCountRef.current.set(runId, idle)
                // 超过 50 次空转（~6 秒）视为 final 丢失，自动停止
                // 但如果 lifecycle 还在进行中且有过工具调用，说明 agent 在思考下一步，不触发兜底
                if (idle > 50) {
                  if (agentLifecycleRunIdRef.current === runId && toolCallsBufferRef.current.length > 0) {
                    // run 还在进行中（lifecycle 未 end），agent 调用过工具后正在思考，
                    // 此时 streamBuffer 无增量是正常的，重置 idle 计数继续等待
                    idleCountRef.current.set(runId, 0)
                  } else {
                    // 监听场景：正文流长时间无增量，触发「流式超时兜底」
                    emitTelemetry({
                      event_name: 'stream_idle_fallback_triggered',
                      event_time: new Date().toISOString(),
                      user_id: userIdRef.current ?? null,
                      session_id: sessionKey || null,
                      run_id: runId,
                      status: 'text_stream',
                      payload: {
                        idle_count: idle,
                        latest_length: latest.length,
                        has_tool_calls: toolCallsBufferRef.current.length > 0,
                      },
                    })
                    cleanupStreamBuffers(runId, streamThrottleRef, lastPushedLenRef, idleCountRef, streamBufferRef, thinkingBufferRef, syncStreamingCount)
                    const m: ChatMessage = {
                      id: runId,
                      role: 'assistant',
                      content: latest || '（响应超时，正在尝试恢复…）',
                      toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
                      timestamp: Date.now(),
                      status: 'done',
                      taskStatus: 'interrupted',
                      agentId: chatAgentId,
                      sessionKey,
                    }
                    onMessageStream.current?.(m)
                    resetActiveRunState(activeRunIdRef, agentLifecycleRunIdRef, phaseRef, toolCallsBufferRef, committedSegmentRunIdsRef, lastSegmentAccumulatedTextRef, finalRunIdsRef)
                    return
                  }
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
          syncStreamingCount((c) => c + 1)
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
            agentId: chatAgentId,
            sessionKey,
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
                  agentId: chatAgentId,
                  sessionKey,
                }
                onMessageStream.current?.(m)
              } else {
                const idle = (idleCountRef.current.get(runId) ?? 0) + 1
                idleCountRef.current.set(runId, idle)
                if (idle > 50) {
                  // lifecycle 还在进行中且有过工具调用，agent 在思考，不触发兜底
                  if (agentLifecycleRunIdRef.current === runId && toolCallsBufferRef.current.length > 0) {
                    idleCountRef.current.set(runId, 0)
                  } else {
                    // 监听场景：仅 thinking 流长时间无变化，触发「流式超时兜底」
                    emitTelemetry({
                      event_name: 'stream_idle_fallback_triggered',
                      event_time: new Date().toISOString(),
                      user_id: userIdRef.current ?? null,
                      session_id: sessionKey || null,
                      run_id: runId,
                      status: 'thinking_stream',
                      payload: {
                        idle_count: idle,
                        thinking_length: thinkingNow.length,
                      },
                    })
                    cleanupStreamBuffers(runId, streamThrottleRef, lastPushedLenRef, idleCountRef, streamBufferRef, thinkingBufferRef, syncStreamingCount)
                    const m: ChatMessage = {
                      id: runId,
                      role: 'assistant',
                      content: '',
                      thinking: thinkingNow,
                      toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
                      timestamp: Date.now(),
                      status: 'done',
                      taskStatus: 'interrupted',
                      agentId: chatAgentId,
                      sessionKey,
                    }
                    onMessageStream.current?.(m)
                    resetActiveRunState(activeRunIdRef, agentLifecycleRunIdRef, phaseRef, toolCallsBufferRef, committedSegmentRunIdsRef, lastSegmentAccumulatedTextRef, finalRunIdsRef)
                    return
                  }
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
      hasErrorRef.current = false
      const timer = streamThrottleRef.current.get(runId)
      const hadTimer = !!timer
      if (timer) { clearTimeout(timer); streamThrottleRef.current.delete(runId) }
      lastPushedLenRef.current.delete(runId)
      idleCountRef.current.delete(runId)
      thinkingBufferRef.current.delete(runId)

      const extractedText = extractText(payload.message)
      const bufferedText = streamBufferRef.current.get(runId)
      const hasCommittedSegments = committedSegmentRunIdsRef.current.has(runId)

      // 对齐官方 UI 的 final 处理逻辑（chat.ts:1297-1303 + stream-reconciliation.ts）：
      // - final 消息优先使用 payload.message 的完整文本（extractedText）
      // - 若有分段且 extractedText 有效，final 只显示超出最后一个分段的新增部分（去除前缀），
      //   避免与分段重复（对齐官方 UI terminalMessageReplacesStreamFallback 去重）
      // - 若 extractedText 为空，才把剩余 buffer 提交为独立分段
      // 这样可避免工具调用失败时丢失 agent 的文本回复（payload.message 仍包含完整回复）
      let finalText: string
      if (hasCommittedSegments && extractedText && extractedText.trim().length > 0) {
        // 有分段且 extractedText 有效：去除最后一个分段的前缀，只显示新增部分
        finalText = trimAccumulatedStreamPrefix(extractedText, lastSegmentAccumulatedTextRef.current)
      } else if (hasCommittedSegments && bufferedText && bufferedText.trim().length > 0) {
        // 有分段但 extractedText 为空：提交剩余 buffer 为独立分段，final 不携带文本
        const visibleText = trimAccumulatedStreamPrefix(bufferedText, lastSegmentAccumulatedTextRef.current)
        if (visibleText.trim().length > 0) {
          const segmentId = `${runId}-seg-${++streamSegmentCounterRef.current}`
          onMessageStream.current?.({
            id: segmentId,
            role: 'assistant',
            content: visibleText,
            thinking: '',
            timestamp: Date.now(),
            status: 'done',
            // 分段消息不设置 taskStatus，避免显示"任务已完成"提示
            agentId: chatAgentId,
            sessionKey,
          })
        }
        finalText = ''
      } else {
        // 无分段：直接使用 extractedText 或 bufferedText
        finalText = extractedText || bufferedText || ''
      }

      const rawText = finalText
      const isOverflowDetected = contextOverflowRunIdsRef.current.has(runId) || isContextOverflowText(rawText)
      const isCompactResponse = !rawText && lastSentMessageRef.current.trim().startsWith('/compact')
      if (isCompactResponse) {
        console.log('[溢出] 检测到 /compact 命令响应 (final):', { runId, sessionKey, lastSentMessage: lastSentMessageRef.current })
      }
      if (isOverflowDetected) {
        console.log('[溢出] final 阶段检测到上下文溢出:', { runId, sessionKey, textLength: rawText.length })
      }
      lastSentMessageRef.current = ''
      const text = isCompactResponse ? '上下文压缩已完成' : (isOverflowDetected ? CONTEXT_OVERFLOW_FRIENDLY_MSG : rawText)
      const hadStream = streamBufferRef.current.delete(runId)
      if (isOverflowDetected) contextOverflowRunIdsRef.current.delete(runId)
      // 修复: 当只有 thinking delta (无 text delta) 时，streamBuffer 未设置
      // 但 streamingCount 已在 thinking 分支中递增，需要同步递减
      // 同时确保 /compact 命令响应也能正确减少 streamingCount
      // 防止 stale run 的延迟 final 事件干扰新 run：
      // 如果 runId 与当前 activeRunIdRef 不匹配，说明是已 abort 的旧 run，
      // 跳过 streamingCount 递减避免把新 run 的计数清零。
      const isStaleFinal = activeRunIdRef.current && runId !== activeRunIdRef.current && agentLifecycleRunIdRef.current && runId !== agentLifecycleRunIdRef.current
      if (isStaleFinal) {
        console.log('[ws] final: stale runId, skipping streamingCount decrement', { runId, activeRunId: activeRunIdRef.current })
      } else if (hadStream || hadTimer || isCompactResponse) {
        syncStreamingCount((c) => Math.max(0, c - 1))
      }

      // 空内容不创建消息，避免空白气泡（但有工具调用时仍然推送）
      // 例外：如果是对 /compact 命令的响应，则创建压缩完成消息
      if (!text && !(toolCallsBufferRef.current.length > 0) && !isCompactResponse) {
        // 兜底：如果用户此前已看到分段消息（工具调用前提交的文本），直接 return 是安全的；
        // 但若没有任何已显示内容，静默 return 会导致"加载消失、界面空白、什么都没有"。
        // 此时推送一条友好的中断消息，让 auto-continue 能接管恢复，避免会话卡死。
        if (!hasCommittedSegments) {
          const fallbackMsg: ChatMessage = {
            id: runId,
            role: 'assistant',
            content: 'AI 暂未返回有效内容，可能遇到了临时问题，正在尝试恢复…',
            thinking: '',
            toolCalls: undefined,
            timestamp: Date.now(),
            status: 'done',
            taskStatus: 'interrupted',
            agentId: chatAgentId,
            sessionKey,
          }
          finalRunIdsRef.current.set(runId, 'interrupted')
          onMessageStream.current?.(fallbackMsg)
        }
        resetActiveRunState(activeRunIdRef, agentLifecycleRunIdRef, phaseRef, toolCallsBufferRef, committedSegmentRunIdsRef, lastSegmentAccumulatedTextRef, finalRunIdsRef)
        return
      }

      // 兜底：把所有残留 running 的工具强制标记为 done
      if (toolCallsBufferRef.current.some((tc) => tc.status === 'running')) {
        toolCallsBufferRef.current = toolCallsBufferRef.current.map((tc) =>
          tc.status === 'running' ? { ...tc, status: 'done' as const, endedAt: Date.now() } : tc
        )
      }

      // 使用 compactMessageIdRef.current 作为消息 ID，确保更新之前创建的压缩进度消息
      const msgId = isCompactResponse && compactMessageIdRef.current ? compactMessageIdRef.current : runId
      if (isCompactResponse) {
        compactMessageIdRef.current = null
      }

      // taskStatus 决策：
      // - stopReason='aborted' 且前端发起 abort → 'user_aborted'（不触发 auto-continue）
      // - stopReason='aborted' 且网关主动 abort（LLM 超时等）→ 'interrupted'（触发 auto-continue）
      // - 有 agent 回复或工具调用 → 'completed'
      // - 完全失败（无回复且无工具调用）→ 'failed'
      const stopReason = payload.stopReason as string | undefined
      const hasToolCalls = toolCallsBufferRef.current.length > 0
      // Check if any tool call in this run failed
      const hasFailedTool = toolCallsBufferRef.current.some((tc) => tc.isError)
      // 当 final 的 text 为空时，完整文本可能已在工具调用前作为分段消息（seg-*）提交。
      // 此时用最后一次分段的累积文本判断 agent 是否有实质回复，避免把"已换方式并成功
      // 调用新工具"的 run 误判为 interrupted（导致状态显示错误并触发无效 auto-continue）。
      const committedText = hasCommittedSegments ? (lastSegmentAccumulatedTextRef.current ?? '') : ''
      const fullRunText = (text && text.trim().length > 0) ? text : committedText
      const hasAgentReply = fullRunText.trim().length > 0
      // W15 fix: handle more stopReason values
      // If a tool failed and the agent didn't provide substantive follow-up text,
      // treat as interrupted so auto-continue can kick in
      const toolFailedWithoutRecovery = hasFailedTool && (!hasAgentReply || fullRunText.trim().length < 50)
      // 区分前端主动 abort 与网关主动 abort（LLM 超时等）：
      // abortInitiatedRef 在 abortSession 中置 true，这里读取后重置防止跨 run 泄漏。
      const isUserAbort = abortInitiatedRef.current
      abortInitiatedRef.current = false
      const taskStatus: TaskStatus = stopReason === 'aborted' || stopReason === 'length'
        ? (isUserAbort ? 'user_aborted' : 'interrupted')
        : stopReason === 'error'
          ? 'failed'
          : toolFailedWithoutRecovery
            ? 'interrupted'
            : (hasAgentReply || hasToolCalls ? 'completed' : 'failed')

      const msg: ChatMessage = {
        id: msgId,
        role: 'assistant',
        content: text,
        toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
        sessionKey,
        timestamp: Date.now(),
        status: 'done',
        taskStatus,
        agentId: chatAgentId,
      }
      // 记录已收到 final 事件的 runId + taskStatus，用于后续 error 事件处理
      finalRunIdsRef.current.set(runId, taskStatus)
      // 任务成功完成时重置 post-final error 重试计数
      if (taskStatus === 'completed') {
        postFinalErrorCountRef.current.delete(sessionKey || runId)
      }
      onMessageStream.current?.(msg)
      // 埋点：本轮助手最终文本已确定
      emitTelemetry({
        event_name: 'assistant_message_rendered',
        event_time: new Date().toISOString(),
        user_id: userIdRef.current ?? null,
        session_id: sessionKey || null,
        run_id: runId,
        status: 'final',
        content: msg.content,
      })
      resetActiveRunState(activeRunIdRef, agentLifecycleRunIdRef, phaseRef, toolCallsBufferRef, committedSegmentRunIdsRef, lastSegmentAccumulatedTextRef, finalRunIdsRef)

      // 提取 usage 供自动压缩判断（兼容不同字段命名/层级）
      const usage = extractUsage(payload)
      // 只要提取到 usage 就立刻回传给 App，避免首轮因为字段差异导致占用率一直停在 0。
      if (usage) onFinalUsage.current?.({ ...usage, sessionKey })

      // 对齐官方 UI：run 结束时立即通知 App 清除 hasActiveRun，避免等待 sessions.list 轮询延迟
      onRunEnd.current?.(sessionKey)

      // 如果是 /compact 命令的响应，触发 onCompactionEnd 回调
      // 这样即使网关不支持 compaction 事件，也能正确处理压缩完成后的恢复逻辑
      if (isCompactResponse) {
        console.log('[溢出] /compact 命令响应完成，触发 onCompactionEnd 回调:', sessionKey)
        onCompactionEnd.current?.(sessionKey)
      }

      if (isOverflowDetected) {
        console.log('[溢出] 触发 onContextOverflow 回调:', sessionKey)
        onContextOverflow.current?.(sessionKey)
      }
    } else if (state === 'error') {
      // 防止 stale run 的延迟 error 事件干扰新 run
      if (activeRunIdRef.current && runId !== activeRunIdRef.current && agentLifecycleRunIdRef.current && runId !== agentLifecycleRunIdRef.current) {
        console.log('[ws] error: stale runId, skipping', { runId, activeRunId: activeRunIdRef.current })
        cleanupStreamBuffers(runId, streamThrottleRef, lastPushedLenRef, idleCountRef, streamBufferRef, thinkingBufferRef, syncStreamingCount)
        finalRunIdsRef.current.delete(runId)
        return
      }
      // 对齐官方 UI：error 事件在顶部弹窗提示错误，不影响最终消息展示。
      // error 事件的 payload.message 通常是错误文本（如 "⚠️ 🛠️ ... failed"），
      // 不作为 agent 回复显示。后续 final 事件会显示 agent 的完整回复。
      // 只有当没有后续 final 事件时（无工具调用且无分段），才显示错误信息作为最后手段。
      const rawErrorMsg = (payload.errorMessage as string) || '发生错误'
      const errorMessage = translateError(rawErrorMsg)
      hasErrorRef.current = true
      setBackendStatus(`错误：${errorMessage}`)

      // 如果该 runId 已经收到 final 事件，则跳过 error 事件的消息推送
      // 避免工具执行失败的错误消息覆盖 agent 的正常回复
      if (finalRunIdsRef.current.has(runId)) {
        const finalTaskStatus = finalRunIdsRef.current.get(runId)
        const isContextOverflow = isContextOverflowText(rawErrorMsg)
        if (isContextOverflow) {
          console.log('[ws] context overflow after final, not auto-continuing', { runId, sessionKey, rawErrorMsg: rawErrorMsg.slice(0, 120) })
          setBackendStatus(`上下文溢出，请压缩或清理会话：${errorMessage}`)
        } else if (finalTaskStatus === 'completed') {
          // final 已标记为 completed（agent 在 run 内已自行处理工具失败并成功），
          // 这个 post-final error 是之前工具失败的延迟通知，不需要自动继续
          console.log('[ws] post-final error but final was completed, agent already recovered, skipping', { runId, sessionKey, rawErrorMsg: rawErrorMsg.slice(0, 120), finalTaskStatus })
          hasErrorRef.current = false
          setBackendStatus('')
        } else if (finalTaskStatus === 'interrupted') {
          // final 已标记为 interrupted（如 LLM 超时 stopReason=aborted），
          // App.tsx 的 interrupted 路径已经会触发 auto-continue。
          // post-final error 不再调用 onToolFailure，避免同一次超时触发两次重试。
          console.log('[ws] post-final error but final was interrupted, auto-continue already handled by interrupted path, skipping', { runId, sessionKey, rawErrorMsg: rawErrorMsg.slice(0, 120), finalTaskStatus })
          hasErrorRef.current = false
          setBackendStatus('')
        } else if (finalTaskStatus === 'user_aborted') {
          // 用户主动中止，不应触发 auto-continue
          console.log('[ws] post-final error but final was user_aborted, skipping', { runId, sessionKey, rawErrorMsg: rawErrorMsg.slice(0, 120), finalTaskStatus })
          hasErrorRef.current = false
          setBackendStatus('')
        } else {
          // final 的 taskStatus 是 failed（非 interrupted、非 completed），说明任务确实没完成，
          // 且 interrupted 路径不会处理 failed，需要 onToolFailure 兜底触发 auto-continue
          console.log('[ws] ★ post-final error, notifying App to auto-continue', { runId, sessionKey, rawErrorMsg: rawErrorMsg.slice(0, 120), finalTaskStatus })
          // 根据重试次数生成俏皮提示文案
          const errorKey = sessionKey || runId
          const retryCount = (postFinalErrorCountRef.current.get(errorKey) ?? 0) + 1
          postFinalErrorCountRef.current.set(errorKey, retryCount)
          const playfulPrefix = retryCount === 1
            ? '哎呀，工具返回了个错误：'
            : retryCount === 2
              ? '这种方式也不行：😶'
              : retryCount === 3
                ? '工具又又又报错了 😮‍💨'
                : '工具还是不行 😭'
          const playfulSuffix = retryCount === 1
            ? '让我来换一种方式尝试继续...'
            : retryCount === 2
              ? '再想想别的办法...'
              : retryCount === 3
                ? '最后一次尝试了...'
                : '试了三次还是不行，可能需要你手动介入了 🙏'
          // 将错误提示作为独立消息推送到会话气泡中，避免被状态栏事件覆盖
          onMessageStream.current?.({
            id: `${runId}-err`,
            role: 'assistant',
            content: `${playfulPrefix}\n\n${errorMessage}\n\n${playfulSuffix}`,
            thinking: '',
            timestamp: Date.now(),
            status: 'done',
            taskStatus: 'retrying',
            agentId: chatAgentId,
            sessionKey,
          })
          onToolFailure.current?.(sessionKey, rawErrorMsg)
        }
        cleanupStreamBuffers(runId, streamThrottleRef, lastPushedLenRef, idleCountRef, streamBufferRef, thinkingBufferRef, syncStreamingCount)
        finalRunIdsRef.current.delete(runId)
        return
      }
      const isErrorOverflow = isContextOverflowText(rawErrorMsg)
      if (isErrorOverflow) {
        console.log('[溢出] error 阶段检测到上下文溢出:', { runId, sessionKey, errorMessage: rawErrorMsg.slice(0, 100) })
      }

      // error 事件的 payload.message 通常是错误文本，不作为 agent 回复显示
      // 只使用 bufferedText 提交剩余分段（如果有）
      const bufferedText = streamBufferRef.current.get(runId)
      const hasCommittedSegments = committedSegmentRunIdsRef.current.has(runId)

      // 若已提交过流式分段，把剩余 buffer 也提交为独立分段（与 final 一致）
      if (hasCommittedSegments && bufferedText && bufferedText.trim().length > 0) {
        // 去除前一个分段的累积前缀，只显示本轮新增文本
        const visibleText = trimAccumulatedStreamPrefix(bufferedText, lastSegmentAccumulatedTextRef.current)
        if (visibleText.trim().length > 0) {
          const segmentId = `${runId}-seg-${++streamSegmentCounterRef.current}`
          onMessageStream.current?.({
            id: segmentId,
            role: 'assistant',
            content: visibleText,
            thinking: '',
            timestamp: Date.now(),
            status: 'done',
            agentId: chatAgentId,
            sessionKey,
          })
        }
      }

      // 决定最终消息内容：
      // - error 事件的 payload.message 通常是错误文本（如 "⚠️ 🛠️ ... failed"），不应作为 agent 回复显示
      // - 对齐官方 UI：error 事件只显示工具调用（如果有），不显示错误文本作为消息内容
      // - 后续 final 事件会显示 agent 的完整回复
      // - 只有当没有工具调用且没有分段时，才显示错误信息作为最后手段
      // - 特殊处理：工具执行失败的警告（errorMessage 以 "⚠️ 🛠️" 开头）不显示"执行失败了"提示
      let text: string
      let msgStatus: 'done' | 'error'
      let msgTaskStatus: 'completed' | 'failed'
      const hasToolCalls = toolCallsBufferRef.current.length > 0
      const isToolExecutionWarning = rawErrorMsg.startsWith('⚠️ 🛠️') || rawErrorMsg.includes('failed')
      if (isErrorOverflow) {
        text = CONTEXT_OVERFLOW_FRIENDLY_MSG
        msgStatus = 'done'
        msgTaskStatus = 'completed'
      } else if (hasCommittedSegments || hasToolCalls || isToolExecutionWarning) {
        // 有分段、工具调用或工具执行警告时，error 消息只显示工具调用，不携带错误文本
        // 后续 final 事件会显示 agent 的完整回复
        // taskStatus='completed'（不显示"执行失败了"提示）
        text = ''
        msgStatus = 'done'
        msgTaskStatus = 'completed'
      } else {
        // 无工具调用且无分段且非工具执行警告：显示错误信息作为最后手段
        text = errorMessage
        msgStatus = 'error'
        msgTaskStatus = 'failed'
      }

      cleanupStreamBuffers(runId, streamThrottleRef, lastPushedLenRef, idleCountRef, streamBufferRef, thinkingBufferRef, syncStreamingCount)

      const msg: ChatMessage = {
        id: runId,
        role: 'assistant',
        content: text,
        toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
        timestamp: Date.now(),
        status: msgStatus,
        taskStatus: msgTaskStatus,
        agentId: chatAgentId,
        sessionKey,
        // 将工具执行错误作为状态提醒，不显示在正文
        errorHint: (hasToolCalls || isToolExecutionWarning) && !isErrorOverflow ? errorMessage : undefined,
      }
      onMessageStream.current?.(msg)
      emitTelemetry({
        event_name: 'assistant_message_rendered',
        event_time: new Date().toISOString(),
        user_id: userIdRef.current ?? null,
        session_id: sessionKey || null,
        run_id: runId,
        status: msgStatus === 'done' ? 'final' : 'error',
        content: msg.content,
      })
      // 注意：不调用 resetActiveRunState，避免重置 toolCallsBufferRef，
      // 后续 final 事件需要 toolCallsBufferRef 来显示工具调用。
      // 保留 agentLifecycleRunIdRef，以便后续 final 事件能正确替换 error 创建的消息。
      // 对齐官方 UI：error 后 final 仍会处理，显示 agent 完整回复 + 工具调用。
      activeRunIdRef.current = null
      // W13: do NOT clear committedSegmentRunIdsRef/lastSegmentAccumulatedTextRef here
      // so that subsequent final event can correctly deduplicate segment text

      if (isErrorOverflow) {
        console.log('[溢出] error 阶段触发 onContextOverflow 回调:', sessionKey)
        onContextOverflow.current?.(sessionKey)
      }
      // W7: do not call onRunEnd in error handler, final event will do it
    } else if (state === 'aborted') {
      // 防止 stale run 的延迟 aborted 事件干扰新 run
      if (activeRunIdRef.current && runId !== activeRunIdRef.current && agentLifecycleRunIdRef.current && runId !== agentLifecycleRunIdRef.current) {
        console.log('[ws] aborted: stale runId, skipping', { runId, activeRunId: activeRunIdRef.current })
        cleanupStreamBuffers(runId, streamThrottleRef, lastPushedLenRef, idleCountRef, streamBufferRef, thinkingBufferRef, syncStreamingCount)
        finalRunIdsRef.current.delete(runId)
        return
      }
      // W8: skip if already finalized
      if (finalRunIdsRef.current.has(runId)) {
        console.log('[ws] aborted event skipped: runId already finalized', { runId, sessionKey })
        cleanupStreamBuffers(runId, streamThrottleRef, lastPushedLenRef, idleCountRef, streamBufferRef, thinkingBufferRef, syncStreamingCount)
        finalRunIdsRef.current.delete(runId)
        return
      }
      setBackendStatus('')
      // W5: read and reset abort flags to prevent cross-run leakage
      const wasFrontendTimeout = isFrontendTimeoutRef.current
      const wasAutoAbort = isAutoAbortRef.current
      isFrontendTimeoutRef.current = false
      isAutoAbortRef.current = false
      abortInitiatedRef.current = false
      let text: string
      if (wasFrontendTimeout) {
        text = '抱歉让你久等了，我接着完成'
      } else if (wasAutoAbort) {
        text = redactSensitiveText(streamBufferRef.current.get(runId) || '')
      } else {
        text = `${redactSensitiveText(streamBufferRef.current.get(runId) || '')}任务已中断`
      }
      cleanupStreamBuffers(runId, streamThrottleRef, lastPushedLenRef, idleCountRef, streamBufferRef, thinkingBufferRef, syncStreamingCount)

      const msg: ChatMessage = {
        id: runId,
        role: 'assistant',
        content: text,
        toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
        timestamp: Date.now(),
        status: 'done',
        taskStatus: wasFrontendTimeout ? 'retrying' : 'user_aborted',
        agentId: chatAgentId,
        sessionKey,
      }
      onMessageStream.current?.(msg)
      // 埋点：用户中止生成
      emitTelemetry({
        event_name: 'assistant_message_rendered',
        event_time: new Date().toISOString(),
        user_id: userIdRef.current ?? null,
        session_id: sessionKey || null,
        run_id: runId,
        status: 'aborted',
        content: msg.content,
      })
      resetActiveRunState(activeRunIdRef, agentLifecycleRunIdRef, phaseRef, toolCallsBufferRef, committedSegmentRunIdsRef, lastSegmentAccumulatedTextRef, finalRunIdsRef)
      // 对齐官方 UI：run 结束时立即通知 App 清除 hasActiveRun，避免等待 sessions.list 轮询延迟
      onRunEnd.current?.(sessionKey)
    } else if (state === 'terminated') {
      // W8: skip if already finalized
      if (finalRunIdsRef.current.has(runId)) {
        console.log('[ws] terminated event skipped: runId already finalized', { runId, sessionKey })
        cleanupStreamBuffers(runId, streamThrottleRef, lastPushedLenRef, idleCountRef, streamBufferRef, thinkingBufferRef, syncStreamingCount)
        finalRunIdsRef.current.delete(runId)
        return
      }
      setBackendStatus('')
      const buffered = redactSensitiveText(streamBufferRef.current.get(runId) || '')
      cleanupStreamBuffers(runId, streamThrottleRef, lastPushedLenRef, idleCountRef, streamBufferRef, thinkingBufferRef, syncStreamingCount)

      const terminateReason = String(payload.errorMessage ?? payload.reason ?? '').toLowerCase()
      const isTerminateOverflow = isContextOverflowText(terminateReason) || isContextOverflowText(buffered)
      if (isTerminateOverflow) {
        console.log('[溢出] terminated 阶段检测到上下文溢出:', { runId, sessionKey, terminateReason: terminateReason.slice(0, 100) })
      }

      const displayContent = isTerminateOverflow
        ? CONTEXT_OVERFLOW_FRIENDLY_MSG
        : buffered + '\n\n---\n> 回复被中断，可能是上下文空间不足。建议点击「压缩」后重试。'

      const msg: ChatMessage = {
        id: runId,
        role: 'assistant',
        content: displayContent,
        toolCalls: toolCallsBufferRef.current.length > 0 ? [...toolCallsBufferRef.current] : undefined,
        timestamp: Date.now(),
        status: 'done',
        taskStatus: isTerminateOverflow ? 'completed' : 'interrupted',
        agentId: chatAgentId,
        sessionKey,
      }
      onMessageStream.current?.(msg)
      if (isTerminateOverflow) {
        console.log('[溢出] terminated 阶段触发 onContextOverflow 回调:', sessionKey)
        onContextOverflow.current?.(sessionKey)
      }
      emitTelemetry({
        event_name: 'assistant_message_rendered',
        event_time: new Date().toISOString(),
        user_id: userIdRef.current ?? null,
        session_id: sessionKey || null,
        run_id: runId,
        status: isTerminateOverflow ? 'final' : 'terminated',
        content: msg.content,
      })
      resetActiveRunState(activeRunIdRef, agentLifecycleRunIdRef, phaseRef, toolCallsBufferRef, committedSegmentRunIdsRef, lastSegmentAccumulatedTextRef, finalRunIdsRef)
      // 对齐官方 UI：run 结束时立即通知 App 清除 hasActiveRun，避免等待 sessions.list 轮询延迟
      onRunEnd.current?.(sessionKey)
    }
  }, [])

  const sendMessage = useCallback(async (sessionKey: string, content: string, attachments?: ChatAttachment[], agentId?: string, modelOverride?: string) => {
    // 记录发送的消息内容，用于检测 /compact 命令的响应
    lastSentMessageRef.current = content
    const client = clientRef.current
    if (!client) {
      console.error('[ws] cannot send: no client instance')
      const msg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: '无法发送消息：WebSocket 客户端未初始化，请检查网关状态',
        timestamp: Date.now(),
        status: 'error',
        agentId: agentId,
        sessionKey,
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

    // 特殊处理 /compact 命令：立即创建"正在压缩..."的消息气泡
    if (content.trim().startsWith('/compact')) {
      console.log('[溢出] 发送 /compact 命令，创建压缩进度消息气泡')
      syncStreamingCount((c) => c + 1)
      compactMessageIdRef.current = idempotencyKey
      const compactMsg: ChatMessage = {
        id: idempotencyKey,
        role: 'assistant',
        content: '正在压缩上下文...',
        timestamp: Date.now(),
        status: 'streaming',
        taskStatus: 'compacting',
        agentId: agentId,
        sessionKey,
      }
      onMessageStream.current?.(compactMsg)
    }

    try {
      // 埋点：用户消息已发起（与 idempotencyKey 对齐，后端可能用其作为 run_id）
      emitTelemetry({
        event_name: 'user_message_sent',
        event_time: new Date().toISOString(),
        user_id: userIdRef.current ?? null,
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
      // 特殊处理 /compact 命令的日志
      if (content.trim().startsWith('/compact')) {
        console.log('[溢出] /compact 命令发送成功，收到 ack:', { runId: ack?.runId, status: ack?.status, sessionKey: builtSessionKey })
      }
      // 埋点：chat.send 已收到 ack，建立 idempotency_key -> run_id 映射
      emitTelemetry({
        event_name: 'chat_send_ack',
        event_time: new Date().toISOString(),
        user_id: userIdRef.current ?? null,
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
      // 启动等待 lifecycle.start 的超时定时器：5秒内没有收到响应则在气泡中显示"正在优化上下文"
      if (lifecycleStartTimeoutRef.current) {
        clearTimeout(lifecycleStartTimeoutRef.current)
      }
      const timeoutRunId = ack?.runId || idempotencyKey
      lifecycleStartTimeoutRef.current = setTimeout(() => {
        console.log('[ws] lifecycle.start 超时，在气泡中显示"正在优化上下文"')
        setBackendStatus('正在处理上下文长度')
        // 在气泡中显示提示
        onMessageStream.current?.({
          id: timeoutRunId,
          role: 'assistant',
          content: '',
          thinking: '',
          toolCalls: [],
          timestamp: Date.now(),
          status: 'streaming',
          taskStatus: 'auto_compacting',
          agentId: agentId,
          sessionKey: normalizeSessionKey(builtSessionKey) || sessionKey,
        })
      }, 5000)
      return { ...ack, sessionKey: builtSessionKey, idempotencyKey }
    } catch (err) {
      // 发送失败，清除等待超时定时器
      if (lifecycleStartTimeoutRef.current) {
        clearTimeout(lifecycleStartTimeoutRef.current)
        lifecycleStartTimeoutRef.current = null
      }
      console.error('[ws] chat.send failed:', err)
      const msg: ChatMessage = {
        id: idempotencyKey,
        role: 'assistant',
        content: `发送失败: ${translateError(err instanceof Error ? err.message : String(err))}`,
        timestamp: Date.now(),
        status: 'error',
        taskStatus: 'failed',
        agentId: agentId,
        sessionKey: normalizeSessionKey(builtSessionKey) || sessionKey,
      }
      onMessageStream.current?.(msg)
      return null
    }
  }, [emitTelemetry, userId])

  const abortSession = useCallback(async (sessionKey: string, agentId?: string, isAuto = false, isFrontendTimeout = false): Promise<{ success: boolean; error?: string }> => {
    isAutoAbortRef.current = isAuto
    isFrontendTimeoutRef.current = isFrontendTimeout
    // 只有用户手动停止（非 auto、非 timeout）才标记为 user_aborted。
    // auto abort（后端断线等）和 frontend timeout 不设此标记，
    // 避免后续 final 的 aborted 被误判为用户主动中止而阻止 auto-continue。
    abortInitiatedRef.current = !isAuto && !isFrontendTimeout
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
      user_id: userIdRef.current ?? null,
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
      // 对齐官方 UI abortChatRun：必须传递 runId 参数，否则网关无法定位要中断的 run
      const abortParams: Record<string, unknown> = {
        sessionKey: builtSessionKey,
      }
      if (runIdForAbort) {
        abortParams.runId = runIdForAbort
      }
      // 对齐官方 UI：global session 时需要传递 agentId
      if (agentId && agentId !== 'main') {
        abortParams.agentId = agentId
      }
      await client.request('chat.abort', abortParams)
      // 清除 lifecycle.start 超时定时器，防止 abort 后定时器仍触发推送假 streaming 消息
      if (lifecycleStartTimeoutRef.current) {
        clearTimeout(lifecycleStartTimeoutRef.current)
        lifecycleStartTimeoutRef.current = null
      }
      syncStreamingCount(0)
      streamBufferRef.current.clear()
      thinkingBufferRef.current.clear()
      toolCallsBufferRef.current = []
      committedSegmentRunIdsRef.current.clear()
      lastSegmentAccumulatedTextRef.current = null
      activeRunIdRef.current = null
      agentLifecycleRunIdRef.current = null
      phaseRef.current = 'idle'
      hasErrorRef.current = false
      setBackendStatus('')
      emitTelemetry({
        event_name: 'chat_abort_result',
        event_time: new Date().toISOString(),
        user_id: userIdRef.current ?? null,
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
      // 清除 lifecycle.start 超时定时器
      if (lifecycleStartTimeoutRef.current) {
        clearTimeout(lifecycleStartTimeoutRef.current)
        lifecycleStartTimeoutRef.current = null
      }
      syncStreamingCount(0)
      streamBufferRef.current.clear()
      thinkingBufferRef.current.clear()
      toolCallsBufferRef.current = []
      committedSegmentRunIdsRef.current.clear()
      lastSegmentAccumulatedTextRef.current = null
      activeRunIdRef.current = null
      agentLifecycleRunIdRef.current = null
      phaseRef.current = 'idle'
      hasErrorRef.current = false
      setBackendStatus('')
      emitTelemetry({
        event_name: 'chat_abort_result',
        event_time: new Date().toISOString(),
        user_id: userIdRef.current ?? null,
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
      // 对齐官方 UI：从 sessions.list 返回的 hasActiveRun 字段判断会话是否有活跃运行
      // 用于停止按钮的显示逻辑（即使前端 streamingCount=0，只要 session.hasActiveRun=true 也显示停止按钮）
      const hasActiveRun = hit.hasActiveRun === true
      return { input: normalizedInput, output, contextWindow: contextWindow > 0 ? contextWindow : undefined, hasActiveRun }
    } catch (err) {
      console.warn('[ws] getSessionTokenUsage failed:', err)
      return null
    }
  }, [])

  const clearOfflineQueue = useCallback(() => {
    clientRef.current?.clearOfflineQueue()
  }, [])

  return { connected, hello, agents, defaultAgentId, sendMessage, abortSession, isStreaming, backendStatus, backendHealthy, onMessageStream, onFinalUsage, onRunEnd, onSessionUsageUpdate, onContextOverflow, onCompactionEnd, onStreamStart, onBackendDisconnected, onToolFailure, patchSessionModel, sendModelDirective, getSessionTokenUsage, reconnect, refreshAgents, client: clientRef.current, clearOfflineQueue }
}
