/**
 * Gateway WebSocket 客户端 — connect.challenge → connect 握手
 * 协议范围与 bundled OpenClaw 对齐：min 3 / max 4（随网关 PROTOCOL_VERSION 演进）
 */

export type GatewayEventFrame = {
  type: 'event'
  event: string
  payload?: unknown
  seq?: number
  stateVersion?: { presence: number; health: number }
}

export type GatewayResponseFrame = {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: { code: string; message: string; details?: unknown }
}

export type GatewayHelloOk = {
  type: 'hello-ok'
  protocol: number
  features?: { methods?: string[]; events?: string[] }
  snapshot?: unknown
  auth?: {
    deviceToken?: string
    role?: string
    scopes?: string[]
  }
  policy?: { tickIntervalMs?: number; maxPayload?: number }
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
}

export interface GatewayClientOptions {
  url: string
  token?: string
  clientId?: string
  clientVersion?: string
  onHello?: (hello: GatewayHelloOk) => void
  onEvent?: (evt: GatewayEventFrame) => void
  onClose?: (info: { code: number; reason: string }) => void
  onError?: (err: Error) => void
  signDeviceAuth?: (params: {
    clientId: string
    clientMode: string
    role: string
    scopes: string[]
    token: string
    nonce?: string
  }) => Promise<{
    id: string
    publicKey: string
    signature: string
    signedAt: number
    nonce?: string
  }>
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export class GatewayClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, Pending>()
  private closed = false
  private backoffMs = 800
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  // challenge/connect 握手状态
  private connectNonce: string | null = null
  private connectSent = false
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  // 握手完成标志（connect 请求收到 hello-ok 后为 true）
  private _handshakeCompleted = false
  // 握手完成前缓冲的请求（socket 已 OPEN）
  private _pendingQueue: Array<{ method: string; params?: unknown; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
  /** 重连间隙 / socket 未就绪时缓冲的请求，握手完成后与 _pendingQueue 一并发送 */
  private _offlineQueue: Array<{ method: string; params?: unknown; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
  // 额外的事件监听器（供 useCron 等外部 hook 订阅）
  private _eventListeners = new Set<(evt: GatewayEventFrame) => void>()

  constructor(private opts: GatewayClientOptions) {}

  addEventListener(fn: (evt: GatewayEventFrame) => void) {
    this._eventListeners.add(fn)
  }

  removeEventListener(fn: (evt: GatewayEventFrame) => void) {
    this._eventListeners.delete(fn)
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this._handshakeCompleted
  }

  start() {
    this.closed = false
    this.doConnect()
  }

  stop() {
    this.closed = true
    this._handshakeCompleted = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    this.ws?.close()
    this.ws = null
    const err = new Error('client stopped')
    this.flushPending(err)
    this.flushQueue(err)
  }

  clearOfflineQueue() {
    const count = this._offlineQueue.length
    this._offlineQueue = []
    console.log('[gateway] cleared offline queue, dropped', count, 'pending requests')
  }

  private doConnect() {
    if (this.closed) return
    this._handshakeCompleted = false

    try {
      this.ws = new WebSocket(this.opts.url)
    } catch (err) {
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)))
      this.scheduleReconnect()
      return
    }

    this.ws.addEventListener('open', () => {
      // 不立即发送 connect，等 challenge 事件
      // 但设置超时：如果 750ms 内没收到 challenge，主动发 connect
      this.queueConnect()
    })

    this.ws.addEventListener('message', (ev) => {
      this.handleMessage(String(ev.data ?? ''))
    })

    this.ws.addEventListener('close', (ev) => {
      this.ws = null
      this._handshakeCompleted = false
      const reasonStr = String(ev.reason ?? '')
      // 网关侧：startup 未完成时关闭码 1013，提示稍后重连 —— 缩短退避避免长时间卡在「未连接」
      if (ev.code === 1013 || reasonStr.includes('gateway starting')) {
        this.backoffMs = 600
      }
      const err = new Error(`closed (${ev.code}): ${reasonStr}`)
      this.flushPending(err)
      this.flushQueue(err)
      this.opts.onClose?.({ code: ev.code, reason: reasonStr })
      this.scheduleReconnect()
    })

    this.ws.addEventListener('error', () => {
      // close handler will fire
    })
  }

  /**
   * 排队发送 connect。
   * 给 Gateway 750ms 的时间来发送 connect.challenge 事件。
   * 如果超时没收到 challenge，也照常发送 connect。
   */
  private queueConnect() {
    this.connectNonce = null
    this.connectSent = false
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer)
    }
    this.connectTimer = setTimeout(() => {
      this.sendConnect()
    }, 750)
  }

  private scheduleReconnect() {
    if (this.closed) return
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15_000)
    this.reconnectTimer = setTimeout(() => this.doConnect(), delay)
  }

  private flushPending(err: Error) {
    for (const [, p] of this.pending) {
      p.reject(err)
    }
    this.pending.clear()
  }

  private flushQueue(err: Error) {
    for (const q of this._pendingQueue) {
      q.reject(err)
    }
    this._pendingQueue = []
    for (const q of this._offlineQueue) {
      q.reject(err)
    }
    this._offlineQueue = []
  }

  /** 握手成功后：发送 OPEN 后、握手前的请求；离线队列不再自动重试，直接清空 */
  private drainAfterHandshake() {
    // 清空离线队列，不再自动重试发送
    const droppedOffline = this._offlineQueue.splice(0)
    for (const q of droppedOffline) {
      q.reject(new Error('offline queue dropped on reconnect'))
    }
    // 只处理握手前缓冲的请求
    const pending = this._pendingQueue.splice(0)
    for (const q of pending) {
      this.request(q.method, q.params).then(q.resolve, q.reject)
    }
  }

  private async sendConnect() {
    if (this.connectSent) return
    this.connectSent = true
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }

    // 使用 cli 身份：
    // - 跳过 Gateway 的 Origin 检查（仅 webchat/control-ui 身份会检查 Origin）
    // - Electron file:// 协议的 Origin 为 "null"，webchat/control-ui 身份会被拒
    // 同时提供 device auth：
    // - 有 device auth 才能获得 scopes（operator.write 等）
    // - chat.send 需要 operator.write scope
    const clientId = this.opts.clientId ?? 'cli'
    const clientMode = 'cli'
    const role = 'operator'
    const scopes = ['operator.admin', 'operator.write']

    // Build device auth if signDeviceAuth is available
    // 即使没有 token（例如连接到 mode=none 的本地 gateway）也签名 device identity，
    // 否则 gateway 会以 "device identity required" 拒绝 cli 模式的 operator 连接。
    // token 传空字符串，与 gateway 端 buildDeviceAuthPayload 的 `token ?? ""` 一致。
    let device: Record<string, unknown> | undefined
    if (this.opts.signDeviceAuth) {
      try {
        device = await this.opts.signDeviceAuth({
          clientId,
          clientMode,
          role,
          scopes,
          token: this.opts.token ?? '',
          nonce: this.connectNonce ?? undefined,
        })
      } catch (err) {
        console.error('[gateway] device auth signing failed:', err)
      }
    }

    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 4,
      client: {
        id: clientId,
        version: this.opts.clientVersion ?? '1.0.0',
        platform: navigator?.platform ?? 'win32',
        mode: clientMode,
      },
      role,
      scopes,
      caps: ['tool-events'],
      auth: this.opts.token ? { token: this.opts.token } : undefined,
      locale: navigator?.language ?? 'zh-CN',
      device,
    }

    this.request<GatewayHelloOk>('connect', params)
      .then((hello) => {
        this.backoffMs = 800
        this._handshakeCompleted = true
        this.opts.onHello?.(hello)
        // 握手完成后，发送缓冲队列中的所有请求
        this.drainAfterHandshake()
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        const gatewayStarting =
          msg.includes('gateway starting') ||
          msg.includes('retry shortly')
        if (gatewayStarting) {
          console.warn('[gateway] connect deferred (gateway starting), reconnecting:', msg)
        } else {
          console.error('[gateway] connect handshake failed:', err)
        }
        this._handshakeCompleted = false
        this.ws?.close(4008, 'connect failed')
      })
  }

  private handleMessage(raw: string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }

    const frame = parsed as { type?: unknown }

    if (frame.type === 'event') {
      const evt = parsed as GatewayEventFrame

      // Gateway 连接后首先发送 connect.challenge，携带 nonce
      if (evt.event === 'connect.challenge') {
        const payload = evt.payload as { nonce?: unknown } | undefined
        const nonce = payload && typeof payload.nonce === 'string' ? payload.nonce : null
        if (nonce) {
          this.connectNonce = nonce
        }
        // 收到 challenge 后立即发送 connect
        this.sendConnect()
        return
      }

      const seq = typeof evt.seq === 'number' ? evt.seq : null
      if (seq !== null) {
        // Track sequence for potential reconnect/resume (reserved for future use)
        void seq
      }

      try {
        this.opts.onEvent?.(evt)
      } catch (err) {
        console.error('[gateway] event handler error:', err)
      }
      // 转发给额外监听器（useCron 等）
      for (const fn of this._eventListeners) {
        try { fn(evt) } catch (e) { console.error('[gateway] listener error:', e) }
      }
      return
    }

    if (frame.type === 'res') {
      const res = parsed as GatewayResponseFrame
      const pending = this.pending.get(res.id)
      if (!pending) return
      this.pending.delete(res.id)
      if (res.ok) {
        pending.resolve(res.payload)
      } else {
        pending.reject(new Error(res.error?.message ?? 'request failed'))
      }
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    // connect 不参与排队（见下方）；其余 RPC 在「未 fully connected」时缓冲，避免竞态 not connected
    if (method !== 'connect') {
      // 已 OPEN 但尚未 hello-ok：缓冲至握手完成
      if (this.ws?.readyState === WebSocket.OPEN && !this._handshakeCompleted) {
        return new Promise<T>((resolve, reject) => {
          this._pendingQueue.push({ method, params, resolve: (v) => resolve(v as T), reject })
        })
      }
      // CONNECTING：等 open 后再走同一套 request（通常会进入上一分支直到握手完成）
      if (this.ws?.readyState === WebSocket.CONNECTING) {
        return new Promise<T>((resolve, reject) => {
          const ws = this.ws!
          const onOpen = () => {
            ws.removeEventListener('close', onClose)
            this.request<T>(method, params).then(
              (v) => resolve(v),
              reject,
            )
          }
          const onClose = () => {
            ws.removeEventListener('open', onOpen)
            reject(new Error('not connected'))
          }
          ws.addEventListener('open', onOpen, { once: true })
          ws.addEventListener('close', onClose, { once: true })
        })
      }
      // 重连间隙或 socket 正在关闭/已关闭：直接拒绝，不再缓冲到离线队列
      if (
        !this.closed &&
        (!this.ws ||
          this.ws.readyState === WebSocket.CLOSING ||
          this.ws.readyState === WebSocket.CLOSED)
      ) {
        return Promise.reject(new Error('not connected (offline queue disabled)'))
      }
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('not connected'))
    }
    const id = generateId()
    const frame = { type: 'req', id, method, params }
    console.log('[gateway] sending request:', { method, id, params })
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject })
    })
    this.ws.send(JSON.stringify(frame))
    return p
  }
}
