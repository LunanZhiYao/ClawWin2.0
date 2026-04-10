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

interface UserResponse {
  code: number
  message: string
  data: {
    id: number
    name: string
    mobile: string | null
    department_id: number
    reasonable_department_id: number
    avatar: string | null
    status: number
  }
}

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
 * 获取当前用户信息
 * @param token 访问令牌
 */
export async function getCurrentUser(token: string): Promise<UserResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
  return response.json()
}

/**
 * 退出登录（清除本地存储）
 */
export function logout(): void {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('userInfo')
  localStorage.removeItem('modelConfig')
}
