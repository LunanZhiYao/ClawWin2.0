/**
 * 认证相关 API 封装
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

interface QRCodeResponse {
  code: number
  message: string
  data: {
    qrcode: string
    img: string
    [key: string]: any
  }
}

interface CheckQRCodeResponse {
  code: number
  message: string
  data: {
    code: number | string  // 后端可能返回数字或字符串
    access_token: string | null
    auth_type: string | null
    user: any | null
    model_config: any | null
  }
}

/** /auth/me 成功时的结构化结果，供启动恢复与后续复用 */
export type MeSessionResult =
  | { ok: true; user: Record<string, unknown>; modelConfig: Record<string, unknown> | null }
  | { ok: false; unauthorized: true }
  | { ok: false; unauthorized: false; message?: string }

/**
 * 获取登录二维码
 */
export async function getQRCode(): Promise<QRCodeResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/qr-code`)
  return response.json()
}

/**
 * 检查二维码扫描状态
 * @param qrCode 二维码 key
 */
export async function checkQRCode(qrCode: string): Promise<CheckQRCodeResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/qr-code/${encodeURIComponent(qrCode)}`)
  return response.json()
}

/**
 * 拉取当前登录态：用户 + 服务端下发的模型配置。
 * 401：HTTP 状态为 401，或 JSON 体 code 为 401（与业务约定一致）。
 */
export async function fetchMeSession(token: string): Promise<MeSessionResult> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    return { ok: false, unauthorized: false, message: '网络错误' }
  }

  let body: Record<string, unknown> | null = null
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    body = null
  }

  const bodyCode = body?.code as number | string | undefined
  if (response.status === 401 || bodyCode === 401 || bodyCode === '401') {
    return { ok: false, unauthorized: true }
  }

  if (!response.ok) {
    const msg = (body?.message as string) || `HTTP ${response.status}`
    return { ok: false, unauthorized: false, message: msg }
  }

  if (bodyCode !== undefined && bodyCode !== 200 && bodyCode !== 0 && bodyCode !== '200' && bodyCode !== '0') {
    if (bodyCode === 401 || bodyCode === '401') return { ok: false, unauthorized: true }
    const msg = (body?.message as string) || String(bodyCode)
    return { ok: false, unauthorized: false, message: msg }
  }

  const raw = (body?.data ?? body) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') {
    return { ok: false, unauthorized: false, message: '无效的响应数据' }
  }

  const modelConfig =
    (raw.model_config as Record<string, unknown> | undefined) ??
    (raw.modelConfig as Record<string, unknown> | undefined) ??
    null

  let user: Record<string, unknown>
  if (raw.user && typeof raw.user === 'object') {
    user = raw.user as Record<string, unknown>
  } else {
    user = { ...raw }
    delete user.model_config
    delete user.modelConfig
  }

  if (!user || Object.keys(user).length === 0) {
    return { ok: false, unauthorized: false, message: '缺少用户信息' }
  }

  return { ok: true, user, modelConfig }
}

/**
 * 退出登录（仅清理本地 token；顺带移除旧版本写入的 userInfo/modelConfig）
 */
export function logout(): void {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('userInfo')
  localStorage.removeItem('modelConfig')
}
