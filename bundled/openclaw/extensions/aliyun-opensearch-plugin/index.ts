import type { OpenClawPluginApi } from '../../dist/plugin-sdk/index.js'
import type { AliyunOpenSearchConfig } from './src/types.js'
import { createAliyunSearchTool } from './src/search-tool.js'

const aliyunOpenSearchPlugin = {
  id: 'aliyun-opensearch',
  name: '阿里云 OpenSearch',
  description: '阿里云 OpenSearch 联网搜索插件，提供实时网络搜索能力，支持智能查询重写和多轮对话上下文',
  
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      apiKeyEndpoint: {
        type: 'string',
        description:
          '可选。凭证接口路径，默认 /api/v1/integrations/credentials；完整 URL 或相对 CLAWWIN_SERVER_URL。可用环境变量 ALIYUN_OPENSEARCH_KEY_ENDPOINT 覆盖。',
      },
      integrationName: {
        type: 'string',
        description:
          '后端查询参数 name（如 aliyun）。凭证 JSON 含 api_key、host、workspace、service_id，以及可选的 content_type（默认 summary）、top_k（默认 5，1–10）；插件仅做内存缓存。',
        default: 'aliyun',
      },
      queryRewrite: {
        type: 'boolean',
        description: '是否默认启用查询重写',
        default: true,
      },
      contentType: {
        type: 'string',
        enum: ['snippet', 'summary'],
        description:
          '默认内容类型；未在工具调用中指定时生效。优先于后端凭证中的 content_type；均未设置时为 summary。',
        default: 'summary',
      },
      topK: {
        type: 'number',
        description:
          '默认返回结果数量（1-10）；未在工具调用中指定时生效。优先于后端凭证中的 top_k；均未设置时为 5。',
        default: 5,
        minimum: 1,
        maximum: 10,
      },
      apiKey: {
        type: 'string',
        description:
          '已弃用：凭证改由千易 integrations 接口返回；保留仅为兼容旧版配置。',
      },
      host: {
        type: 'string',
        description: '已弃用：由后端凭证响应提供。',
      },
      workspace: {
        type: 'string',
        description: '已弃用：由后端凭证响应提供。',
      },
      serviceId: {
        type: 'string',
        description: '已弃用：由后端凭证响应提供。',
      },
    },
  },
  
  /** 注册插件工具到运行时。 */
  register(api: OpenClawPluginApi) {
    const pluginConfig = api.pluginConfig as AliyunOpenSearchConfig | undefined
    api.registerTool(createAliyunSearchTool(pluginConfig || {}))
    api.logger.info('阿里云 OpenSearch 搜索工具已注册')
  },
}

export default aliyunOpenSearchPlugin
