export interface AliyunOpenSearchConfig {
  apiKeyEndpoint?: string
  integrationName?: string
  queryRewrite?: boolean
  contentType?: 'snippet' | 'summary'
  topK?: number
  apiKey?: string
  host?: string
  workspace?: string
  serviceId?: string
}

export interface CachedExtras {
  host?: string
  workspace?: string
  serviceId?: string
  /** 后端 integrations 凭证中的默认内容类型（snippet / summary），缺省为 summary */
  contentType?: 'snippet' | 'summary'
  /** 后端 integrations 凭证中的默认 top_k（1–10），缺省为 5 */
  topK?: number
}

export interface SearchResult {
  title: string
  link: string
  snippet: string
  content?: string
  position: number
}

export interface AliyunSearchResponse {
  result?: {
    search_result?: SearchResult[]
  }
  usage?: {
    search_count?: number
    rewrite_model?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
    }
    filter_model?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
    }
  }
}
