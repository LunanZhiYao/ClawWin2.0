import { abortSignalAfterMs, credentialFetchTimeoutMs } from './timing.js'
import { getCredentialEndpoint, readAccessToken, getCredentialEnvHint } from './env.js'

export interface IntegrationCredentialResolverOptions<TShape extends Record<string, string>> {
  endpoint?: string
  integrationName: string
  targetConfig: TShape
  requiredFields: Array<keyof TShape>
}

const integrationConfigCache = new Map<string, Record<string, string>>()
const integrationConfigInflight = new Map<string, Promise<Record<string, string>>>()

export async function resolveIntegrationCredentials<TShape extends Record<string, string>>(
  options: IntegrationCredentialResolverOptions<TShape>,
): Promise<TShape> {
  const endpoint = getCredentialEndpoint(options.endpoint)
  if (!endpoint) {
    throw new Error(`无法请求凭证接口：请设置 ${getCredentialEnvHint()}。`)
  }

  const accessToken = readAccessToken()
  if (!accessToken) {
    throw new Error('缺少 ACCESS_TOKEN。请先登录后再重试。')
  }

  const cacheKey = `${endpoint}::${options.integrationName}`
  const cached = integrationConfigCache.get(cacheKey)
  if (cached) return fillTargetConfigFromPayload(cached, options)

  const inflight = integrationConfigInflight.get(cacheKey)
  if (inflight) {
    const payload = await inflight
    return fillTargetConfigFromPayload(payload, options)
  }

  const request = requestCredentials(endpoint, options.integrationName, accessToken).then((payload) => {
    integrationConfigCache.set(cacheKey, payload)
    return payload
  })

  integrationConfigInflight.set(cacheKey, request)
  try {
    const payload = await request
    return fillTargetConfigFromPayload(payload, options)
  } finally {
    integrationConfigInflight.delete(cacheKey)
  }
}

async function requestCredentials(
  endpoint: string,
  integrationName: string,
  accessToken: string,
): Promise<Record<string, string>> {
  const timeoutMs = credentialFetchTimeoutMs()
  const sep = endpoint.includes('?') ? '&' : '?'
  const url = `${endpoint}${sep}name=${encodeURIComponent(integrationName)}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: abortSignalAfterMs(timeoutMs),
    })
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: unknown }
    const msg = e?.message ?? String(err)
    const isAbort =
      e?.name === 'AbortError' ||
      /aborted|timeout/i.test(msg) ||
      (typeof e?.cause === 'object' &&
        e.cause !== null &&
        (e.cause as { code?: string }).code === 'UND_ERR_CONNECT_TIMEOUT')
    if (isAbort) {
      throw new Error(`拉取集成凭证超时或连接挂起（>${timeoutMs}ms）。请确认后端地址可访问。`)
    }
    throw new Error(`拉取集成凭证失败: ${msg}`)
  }

  if (!response.ok) {
    const t = await response.text()
    throw new Error(`拉取集成配置失败: HTTP ${response.status}${t ? ` - ${t.slice(0, 200)}` : ''}`)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('拉取集成配置失败: 响应不是 JSON')
  }
  const envelope = data as { code?: number; msg?: string }
  if (typeof envelope.code === 'number' && envelope.code !== 200) {
    throw new Error(envelope.msg ?? `拉取凭证失败: 业务码 ${envelope.code}`)
  }
  return parseCredentialPayload(data)
}

function fillTargetConfigFromPayload<TShape extends Record<string, string>>(
  payload: Record<string, string>,
  options: IntegrationCredentialResolverOptions<TShape>,
): TShape {
  for (const key of options.requiredFields) {
    const v = payload[key as string]
    if (!v) throw new Error(`后端返回的凭证缺少字段: ${String(key)}`)
    options.targetConfig[key] = v as TShape[keyof TShape]
  }
  return options.targetConfig
}

function parseCredentialPayload(data: unknown): Record<string, string> {
  const root = data as Record<string, unknown>
  const inner =
    root?.data !== undefined && typeof root.data === 'object' && root.data !== null
      ? (root.data as Record<string, unknown>)
      : root
  const toText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const contentTypeRaw = toText(inner.content_type) || toText(inner.contentType)
  const content_type =
    contentTypeRaw === 'snippet' || contentTypeRaw === 'summary' ? contentTypeRaw : 'summary'
  return {
    api_key: toText(inner.api_key) || toText(inner.apiKey) || toText(inner.key),
    host: toText(inner.host) || toText(inner.opensearch_host),
    workspace: toText(inner.workspace),
    service_id: toText(inner.service_id) || toText(inner.serviceId),
    content_type,
    top_k: normalizeTopKString(inner.top_k ?? inner.topK),
  }
}

function normalizeTopKString(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = Math.trunc(v)
    if (n >= 1 && n <= 10) return String(n)
  }
  if (typeof v === 'string' && v.trim()) {
    const n = parseInt(v.trim(), 10)
    if (Number.isFinite(n) && n >= 1 && n <= 10) return String(n)
  }
  return '5'
}
