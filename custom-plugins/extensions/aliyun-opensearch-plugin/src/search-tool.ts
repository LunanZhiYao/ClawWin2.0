import type { AnyAgentTool } from 'openclaw/plugin-sdk'
import { opensearchPostTimeoutMs, abortSignalAfterMs } from './timing.js'
import { resolveAliyunCredentials } from './aliyun-credentials.js'
import type { AliyunOpenSearchConfig, CachedExtras, AliyunSearchResponse } from './types.js'

export function createAliyunSearchTool(config: AliyunOpenSearchConfig): AnyAgentTool {
  return {
    name: 'aliyun_opensearch_search',
    label: '阿里云搜索',
    description:
      '使用阿里云 OpenSearch 进行实时网络搜索，获取最新的网页信息和搜索结果。' +
      '支持智能查询重写和多轮对话上下文。' +
      '适用于需要获取实时信息、新闻、天气、技术文档等场景。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索查询词，例如："最新 AI 技术发展趋势"、"北京今日天气"',
        },
        top_k: {
          type: 'number',
          description: '返回结果数量（1-10），默认为 5',
          default: config.topK ?? 5,
        },
        query_rewrite: {
          type: 'boolean',
          description: '是否启用 LLM 对查询词进行智能重写优化，默认为 true',
          default: config.queryRewrite !== false,
        },
        content_type: {
          type: 'string',
          enum: ['snippet', 'summary'],
          description:
            '搜索结果内容类型。snippet: 网页内容的简短描述（速度快）；' +
            'summary: 网页内容的文本摘要（内容更详细，耗时较长）',
          default: config.contentType ?? 'summary',
        },
        history: {
          type: 'array',
          description:
            '用户与模型的对话历史，用于多轮对话搜索。' +
            '格式: [{"role": "user/assistant", "content": "内容"}]',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['system', 'user', 'assistant'] },
              content: { type: 'string' },
            },
            required: ['role', 'content'],
          },
        },
      },
      required: ['query'],
    },
    execute: async (_callId: string, params: any) => {
      const { apiKey, extras } = await resolveAliyunCredentials(config)
      const { host, workspace, serviceId } = normalizeConnectionConfig(extras)
      const url = `${host.replace(/\/$/, '')}/v3/openapi/workspaces/${workspace}/web-search/${serviceId}`
      const requestBody = buildSearchRequestBody(params, config, extras)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: abortSignalAfterMs(opensearchPostTimeoutMs()),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(buildSearchErrorMessage(response.status, errorText))
      }

      const data = (await response.json()) as AliyunSearchResponse
      const output = formatSearchOutput(data)
      return { content: [{ type: 'text', text: output.text }], details: {} }
    },
  }
}

function normalizeConnectionConfig(extras: CachedExtras): { host: string; workspace: string; serviceId: string } {
  const host = extras.host?.trim() ?? ''
  const workspace = extras.workspace?.trim() ?? ''
  const serviceId = (extras.serviceId ?? '').trim()
  if (!host || !workspace || !serviceId) {
    throw new Error('集成配置不完整：请在后端 integration 的 JSON 中提供 host、workspace、service_id（或 serviceId）。')
  }
  return { host, workspace, serviceId }
}

function buildSearchRequestBody(
  params: any,
  config: AliyunOpenSearchConfig,
  extras: CachedExtras,
): Record<string, any> {
  const defaultTopK = config.topK ?? extras.topK ?? 5
  const defaultContentType = config.contentType ?? extras.contentType ?? 'summary'
  return {
    query: params.query,
    query_rewrite: params.query_rewrite !== undefined ? params.query_rewrite : config.queryRewrite !== false,
    top_k: Math.min(Math.max(params.top_k ?? defaultTopK, 1), 10),
    content_type: params.content_type || defaultContentType,
    history: params.history && Array.isArray(params.history) ? params.history : [],
  }
}

function buildSearchErrorMessage(status: number, errorText: string): string {
  let errorMessage = `搜索请求失败: ${status}`
  try {
    const errorJson = JSON.parse(errorText)
    if (errorJson.message || errorJson.error) {
      errorMessage = `${errorMessage} - ${errorJson.message || errorJson.error}`
    }
  } catch {
    if (errorText) errorMessage = `${errorMessage} - ${errorText}`
  }
  if (status === 401) return 'API Key 无效或已过期，请检查配置'
  if (status === 403) return '权限不足或 QPS 超限，请检查 API Key 权限或联系技术支持'
  if (status === 429) return '请求频率超限（默认 QPS 限制为 3），请稍后重试'
  return errorMessage
}

function formatSearchOutput(data: AliyunSearchResponse): { text: string } {
  const searchResults = data.result?.search_result || []
  if (searchResults.length === 0) {
    return { text: '未找到相关搜索结果，建议尝试不同的搜索词。' }
  }
  const formattedResults = searchResults
    .map((item, index) => {
      let result = `### ${index + 1}. ${item.title}\n`
      result += `${item.snippet}\n`
      result += `[查看详情](${item.link})`
      return result
    })
    .join('\n\n')

  let usageInfo = ''
  if (data.usage) {
    const parts: string[] = []
    if (data.usage.search_count) parts.push(`搜索次数: ${data.usage.search_count}`)
    if (data.usage.rewrite_model?.total_tokens) parts.push(`查询重写 tokens: ${data.usage.rewrite_model.total_tokens}`)
    if (parts.length > 0) usageInfo = `\n\n---\n*${parts.join(' | ')}*`
  }
  return {
    text: `## 搜索结果（共 ${searchResults.length} 条）\n\n${formattedResults}${usageInfo}`,
  }
}
