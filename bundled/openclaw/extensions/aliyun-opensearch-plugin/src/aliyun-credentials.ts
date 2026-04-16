import type { AliyunOpenSearchConfig, CachedExtras } from './types.js'
import { resolveIntegrationCredentials } from './credential-resolver.js'

const aliyunSearchConfig = {
  api_key: '',
  host: '',
  workspace: '',
  service_id: '',
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
    requiredFields: ['api_key', 'host', 'workspace', 'service_id'],
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
    },
  }
}
