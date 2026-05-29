export interface WelcomeCard {
  id: number
  tab_id: number
  title: string
  content: string | null
  prompt: string | null
  sort_order: number
  status: number
  created_at: string
  updated_at: string
}

export interface WelcomeTab {
  id: number
  tab_name: string
  sort_order: number
  status: number
  created_at: string
  updated_at: string
  cards: WelcomeCard[]
}

export interface WelcomePageResponse {
  code: number
  data: WelcomeTab[]
  msg?: string
}

export async function fetchWelcomePage(serverUrl: string): Promise<WelcomeTab[] | null> {
  try {
    // 如果URL已经包含 /api/v1，直接使用，否则添加
    const url = serverUrl
    const response = await fetch(`${url}/welcome`)
    console.log('[欢迎页API] 请求URL:', `${url}/welcome`)
    const data: WelcomePageResponse = await response.json()
    console.log('[欢迎页API] 响应数据:', data)

    if (data.code === 200 && data.data) {
      return data.data
    }
    return null
  } catch (error) {
    console.error('[欢迎页API] 获取欢迎页配置失败:', error)
    return null
  }
}
