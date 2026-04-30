/**
 * 对话埋点上报：写入后端 telemetry_events，供管理后台会话/轮次分析。
 * event_time 使用 UTC ISO 字符串；服务端会规范为东八区入库。
 */
const API_BASE_URL = import.meta.env.VITE_EXPORT_API_BASE_URL || 'http://localhost:8000/api/v1'

/** 当前支持的上报事件名 */
export type TelemetryEventName =
  | 'user_message_sent'
  | 'chat_send_ack'
  | 'assistant_message_rendered'
  | 'chat_abort_requested'
  | 'chat_abort_result'
  | 'stream_idle_fallback_triggered'

export interface TelemetryAttachmentMeta {
  file_name: string
  file_type: 'image' | 'file' | 'folder'
  mime_type: string | null
}

export interface TelemetryEventPayload {
  event_name: TelemetryEventName
  event_time: string
  user_id?: number | null
  session_id?: string | null
  run_id?: string | null
  status?: string | null
  content?: string | null
  attachments?: TelemetryAttachmentMeta[]
  payload?: Record<string, unknown> | null
  error_message?: string | null
}

/** POST /app/telemetry/events，失败仅打日志、不阻塞聊天主流程 */
export async function sendTelemetryEvent(event: TelemetryEventPayload): Promise<void> {
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${API_BASE_URL}/app/telemetry/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(800),
  })
  if (!response.ok) {
    throw new Error(`telemetry http ${response.status}`)
  }
}
