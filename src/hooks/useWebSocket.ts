import { useState, useEffect, useCallback, useRef } from 'react'
import { GatewayClient, type GatewayEventFrame, type GatewayHelloOk } from '../lib/gateway-protocol'
import type { ChatMessage, ChatAttachment, ChatToolCall, AgentInfo } from '../types'

interface UseWebSocketOptions {
  url: string
  token?: string
  enabled: boolean
}

interface UseWebSocketReturn {
  connected: boolean
  hello: GatewayHelloOk | null
  agents: AgentInfo[]
  defaultAgentId: string
  sendMessage: (sessionKey: string, content: string, attachments?: ChatAttachment[], agentId?: string) => Promise<{ runId?: string; status?: string; sessionKey: string; idempotencyKey: string } | null>
  abortSession: (sessionKey: string, agentId?: string) => Promise<void>
  isStreaming: boolean
  backendStatus: string
  onMessageStream: React.MutableRefObject<((msg: ChatMessage) => void) | null>
  onFinalUsage: React.MutableRefObject<((usage: { input: number; output: number }) => void) | null>
  onCompactionEnd: React.MutableRefObject<(() => void) | null>
  reconnect: () => void
  refreshAgents: () => void
  client: GatewayClient | null
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
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
  if (typeof message === 'string') return message
  if (!message || typeof message !== 'object') return ''

  const msg = message as Record<string, unknown>
  const content = msg.content

  // content 是字符串
  if (typeof content === 'string') return content

  // content 是数组 [{type: "text", text: "..."}, ...]
  if (Array.isArray(content)) {
    return content
      .map((block: unknown) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && 'text' in block) {
          return (block as { text: string }).text
        }
        return ''
      })
      .join('')
  }

  // 备用：直接使用 text 字段
  if (typeof msg.text === 'string') return msg.text

  return ''
}

export function useWebSocket({ url, token, enabled }: UseWebSocketOptions): UseWebSocketReturn {
  const [connected, setConnected] = useState(false)
  const [hello, setHello] = useState<GatewayHelloOk | null>(null)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [defaultAgentId, setDefaultAgentId] = useState('main')
  const [streamingCount, setStreamingCount] = useState(0)
  const isStreaming = streamingCount > 0
  const [backendStatus, setBackendStatus] = useState('')
  const clientRef = useRef<GatewayClient | null>(null)
  const onMessageStream = useRef<((msg: ChatMessage) => void) | null>(null)
  // 追踪每个 runId 的累积文本（用于 delta 流式更新）
  const streamBufferRef = useRef<Map<string, string>>(new Map())
  // 追踪每个 runId 的累积思维链内容
  const thinkingBufferRef = useRef<Map<string, string>>(new Map())
  // 节流：限制流式 UI 更新频率，避免 ReactMarkdown 频繁重渲染导致闪烁
  const streamThrottleRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // 追踪每个 runId 上次推送的内容长度，避免内容未变时重复推送导致 React 卡死
  const lastPushedLenRef = useRef<Map<string, number>>(new Map())
  // 空转计数器：内容连续未变的次数，超过阈值自动停止 timer（兜底 final 丢失）
  const idleCountRef = useRef<Map<string, number>>(new Map())
  // 追踪 agent 事件中的工具调用信息
  const toolCallsBufferRef = useRef<ChatToolCall[]>([])
  const toolCallIdRef = useRef(0)
  const activeRunIdRef = useRef<string | null>(null)
  // agent lifecycle.start 分配的 runId（工具调用流式消息用此 ID）
  // 与 chat 事件的 runId 可能不同，需要在 final 时用此 ID 确保消息正确替换
  const agentLifecycleRunIdRef = useRef<string | null>(null)
  // 阶段追踪：idle → thinking → tool → text → idle
  // thinking/tool 阶段不推送流式文本，只推送工具调用和思考内容
  const phaseRef = useRef<'idle' | 'thinking' | 'tool' | 'text'>('idle')
  // 自动压缩：暴露给 App.tsx 的回调
  const onFinalUsage = useRef<((usage: { input: number; output: number }) => void) | null>(null)
  const onCompactionEnd = useRef<(() => void) | null>(null)

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
        handleEvent(evt)
      },
      onClose: (info) => {
        console.log('[ws] connection closed:', info.code, info.reason)
        setConnected(false)
        setStreamingCount(0)
      },
      onError: (err) => {
        console.error('[ws] error:', err.message)
      },
    })

    client.start()
    clientRef.current = client

    return () => {
      client.stop()
      clientRef.current = null
      setConnected(false)
    }
  }, [url, token, enabled])

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
            if (typeof val === 'string' && val) { result = val; break }
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
          setBackendStatus('思考中...')
        } else if (phase === 'end' || phase === 'error') {
          phaseRef.current = 'idle'
          setBackendStatus('')
        }
      } else if (stream === 'compaction') {
        if (phase === 'start') {
          setBackendStatus('正在压缩上下文...')
        } else if (phase === 'end') {
          setBackendStatus('压缩完成，正在思考...')
          onCompactionEnd.current?.()
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
      if (timer) { clearTimeout(timer); streamThrottleRef.current.delete(runId) }
      lastPushedLenRef.current.delete(runId)
      idleCountRef.current.delete(runId)
      thinkingBufferRef.current.delete(runId)

      const extractedText = extractText(payload.message)
      const bufferedText = streamBufferRef.current.get(runId)
      const text = extractedText || bufferedText || ''
      if (streamBufferRef.current.delete(runId)) setStreamingCount((c) => Math.max(0, c - 1))

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
      activeRunIdRef.current = null
      agentLifecycleRunIdRef.current = null
      phaseRef.current = 'idle'
      toolCallsBufferRef.current = []

      // 提取 usage 供自动压缩判断
      const rawUsage = payload.usage as Record<string, unknown> | undefined
      if (rawUsage) {
        const input = (rawUsage.input ?? rawUsage.input_tokens ?? rawUsage.prompt_tokens ?? 0) as number
        const output = (rawUsage.output ?? rawUsage.output_tokens ?? rawUsage.completion_tokens ?? 0) as number
        if (input > 0) onFinalUsage.current?.({ input, output })
      }
    } else if (state === 'error') {
      setBackendStatus('')
      const errorMessage = (payload.errorMessage as string) || '发生错误'
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
      activeRunIdRef.current = null
      agentLifecycleRunIdRef.current = null
      phaseRef.current = 'idle'
      toolCallsBufferRef.current = []
    } else if (state === 'aborted') {
      // 被中断的响应，使用已有内容
      setBackendStatus('')
      const text = streamBufferRef.current.get(runId) || '（已中断）'
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
      activeRunIdRef.current = null
      agentLifecycleRunIdRef.current = null
      phaseRef.current = 'idle'
      toolCallsBufferRef.current = []
    } else if (state === 'terminated') {
      // 上下文耗尽或进程被终止
      setBackendStatus('')
      const buffered = streamBufferRef.current.get(runId) || ''
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
      activeRunIdRef.current = null
      agentLifecycleRunIdRef.current = null
      phaseRef.current = 'idle'
      toolCallsBufferRef.current = []
    }
  }, [])

  const sendMessage = useCallback(async (sessionKey: string, content: string, attachments?: ChatAttachment[], agentId?: string) => {
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
      idempotencyKey,
    }
    if (gatewayAttachments && gatewayAttachments.length > 0) {
      payload.attachments = gatewayAttachments
    }

    try {
      const ack = await client.request<{ runId?: string; status?: string }>('chat.send', payload)
      return { ...ack, sessionKey: builtSessionKey, idempotencyKey }
    } catch (err) {
      console.error('[ws] chat.send failed:', err)
      const msg: ChatMessage = {
        id: idempotencyKey,
        role: 'assistant',
        content: `发送失败: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
        status: 'error',
      }
      onMessageStream.current?.(msg)
      return null
    }
  }, [])

  const abortSession = useCallback(async (sessionKey: string, agentId?: string) => {
    const client = clientRef.current
    if (!client) return
    try {
      await client.request('chat.abort', { sessionKey: buildAgentSessionKey(sessionKey, agentId) })
    } catch (err) {
      console.error('[ws] chat.abort failed:', err)
    }
  }, [])

  const reconnect = useCallback(() => {
    clientRef.current?.stop()
    clientRef.current?.start()
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

  return { connected, hello, agents, defaultAgentId, sendMessage, abortSession, isStreaming, backendStatus, onMessageStream, onFinalUsage, onCompactionEnd, reconnect, refreshAgents, client: clientRef.current }
}
