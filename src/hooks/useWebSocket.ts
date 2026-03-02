import { useState, useEffect, useCallback, useRef } from 'react'
import { GatewayClient, type GatewayEventFrame, type GatewayHelloOk } from '../lib/gateway-protocol'
import type { ChatMessage, ChatAttachment, AgentInfo } from '../types'

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
  sendMessage: (sessionKey: string, content: string, attachments?: ChatAttachment[], agentId?: string) => void
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
    console.log('[ws] event received:', evt.event, evt.event === 'chat' ? JSON.stringify(evt.payload).slice(0, 2000) : '')

    // 处理 agent 事件：提取后台活动状态
    if (evt.event === 'agent') {
      const p = evt.payload as Record<string, unknown> | undefined
      if (!p) return
      const stream = p.stream as string | undefined
      const data = p.data as Record<string, unknown> | undefined
      if (!data) return
      const phase = data.phase as string | undefined

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
          const name = (data.name as string) || '工具'
          const args = data.args as Record<string, unknown> | undefined
          let detail = `正在执行: ${name}`
          if (args) {
            // 展示关键参数的简要信息
            const argStr = Object.entries(args)
              .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 20) : JSON.stringify(v)}`)
              .join(', ')
            if (argStr) detail += ` (${argStr.slice(0, 60)})`
          }
          setBackendStatus(detail)
        } else if (phase === 'update') {
          const name = (data.name as string) || '工具'
          setBackendStatus(`正在执行: ${name}...`)
        } else if (phase === 'end') {
          const name = (data.name as string) || '工具'
          const isError = data.isError as boolean | undefined
          setBackendStatus(isError ? `${name} 执行出错，正在处理...` : `${name} 执行完成，正在思考...`)
        }
      } else if (stream === 'lifecycle') {
        if (phase === 'start') {
          setBackendStatus('思考中...')
        } else if (phase === 'end' || phase === 'error') {
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
    const runId = (payload.runId as string) || generateId()

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

      if (text) {
        const isNew = !streamBufferRef.current.has(runId)
        const accumulated = (streamBufferRef.current.get(runId) || '') + text
        streamBufferRef.current.set(runId, accumulated)

        if (isNew) setStreamingCount((c) => c + 1)

        // 节流：每 80ms 最多更新一次 UI，减少 ReactMarkdown 重渲染
        if (!streamThrottleRef.current.has(runId)) {
          // 首次 delta 立即推送（让气泡立刻出现）
          const thinkingText = streamBufferRef.current.has(runId) ? undefined : thinkingBufferRef.current.get(runId)
          const msg: ChatMessage = {
            id: runId,
            role: 'assistant',
            content: accumulated,
            thinking: thinkingText,
            timestamp: Date.now(),
            status: 'streaming',
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
                    timestamp: Date.now(),
                    status: 'done',
                  }
                  onMessageStream.current?.(m)
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
          // 推送一个只有 thinking 的消息
          const thinkingText = thinkingBufferRef.current.get(runId) || ''
          const msg: ChatMessage = {
            id: runId,
            role: 'assistant',
            content: '',
            thinking: thinkingText,
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

      // 空内容不创建消息，避免空白气泡
      if (!text) return

      const msg: ChatMessage = {
        id: runId,
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
        status: 'done',
      }
      onMessageStream.current?.(msg)

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
        timestamp: Date.now(),
        status: 'error',
      }
      onMessageStream.current?.(msg)
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
        timestamp: Date.now(),
        status: 'done',
      }
      onMessageStream.current?.(msg)
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
        timestamp: Date.now(),
        status: 'done',
      }
      onMessageStream.current?.(msg)
    }
  }, [])

  const sendMessage = useCallback((sessionKey: string, content: string, attachments?: ChatAttachment[], agentId?: string) => {
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
      return
    }

    const idempotencyKey = generateId()

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
      sessionKey: buildAgentSessionKey(sessionKey, agentId),
      message: content,
      deliver: false,
      idempotencyKey,
    }
    if (gatewayAttachments && gatewayAttachments.length > 0) {
      payload.attachments = gatewayAttachments
    }

    client.request('chat.send', payload).catch((err) => {
      console.error('[ws] chat.send failed:', err)
      const msg: ChatMessage = {
        id: idempotencyKey,
        role: 'assistant',
        content: `发送失败: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
        status: 'error',
      }
      onMessageStream.current?.(msg)
    })
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
