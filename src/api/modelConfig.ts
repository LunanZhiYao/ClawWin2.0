/**
 * 大模型配置相关 API 封装
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

interface ModelConfig {
  provider: string
  model_id: string
  model_name: string | null
  base_url: string | null
  api_key: string | null
  api_format: string | null
}

interface ModelConfigResponse {
  code: number
  message: string
  data: ModelConfig | null
}

/**
 * 获取用户的模型配置
 * @param userId 用户ID
 * @param token 访问令牌
 */
export async function getUserModelConfig(userId: number, token: string): Promise<ModelConfigResponse> {
  const response = await fetch(`${API_BASE_URL}/model-configs/user/${userId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
  return response.json()
}
