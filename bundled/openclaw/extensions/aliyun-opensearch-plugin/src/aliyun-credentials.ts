import type { AliyunOpenSearchConfig, CachedExtras } from './types.js'
import { resolveIntegrationCredentials } from './credential-resolver.js'

const aliyunSearchConfig = {
  api_key: '',
  host: '',
  workspace: '',
  service_id: '',
  content_type: 'summary',
  top_k: '5',
}

export async function resolveAliyunCredentials(
  config: AliyunOpenSearchConfig,
): Promise<{ apiKey: string; extras: CachedExtras }> {
  if (hasLocalConfig()) {
    return toCredentialResult(aliyunSearchConfig)
  }

  const integrationName = (config.integrationName ?? 'aliyun').trim() || 'aliyun'
  const runtimeConfig = await resolveIntegrationCredentials({
    endpoint: config.apiKeyEndpoint,
    integrationName,
    targetConfig: aliyunSearchConfig,
    requiredFields: ['api_key', 'host', 'workspace', 'service_id', 'content_type', 'top_k'],
  })
  return toCredentialResult(runtimeConfig)
}

function hasLocalConfig(): boolean {
  return (
    Boolean(aliyunSearchConfig.api_key?.trim()) &&
    Boolean(aliyunSearchConfig.host?.trim()) &&
    Boolean(aliyunSearchConfig.workspace?.trim()) &&
    Boolean(aliyunSearchConfig.service_id?.trim())
  )
}

function toCredentialResult(config: typeof aliyunSearchConfig): { apiKey: string; extras: CachedExtras } {
  return {
    apiKey: config.api_key,
    extras: {
      host: config.host,
      workspace: config.workspace,
      serviceId: config.service_id,
      contentType: normalizeContentType(config.content_type),
      topK: normalizeTopK(config.top_k),
    },
  }
}

function normalizeContentType(raw: string | undefined): 'snippet' | 'summary' {
  const t = raw?.trim()
  if (t === 'snippet' || t === 'summary') return t
  return 'summary'
}

function normalizeTopK(raw: string | undefined): number {
  const n = parseInt(raw?.trim() || '5', 10)
  if (Number.isFinite(n) && n >= 1 && n <= 10) return n
  return 5
}
