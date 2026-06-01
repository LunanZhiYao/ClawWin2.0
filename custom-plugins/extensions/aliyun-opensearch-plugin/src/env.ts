const ENV_API_BASE_URL = 'VITE_EXPORT_API_BASE_URL'
const ENV_DEFAULT_CREDENTIALS_PATH = 'VITE_EXPORT_DEFAULT_CREDENTIALS_PATH'

export function getCredentialEndpoint(explicitEndpoint?: string): string | null {

  const raw =
    explicitEndpoint?.trim() ||
    getEnvValue(ENV_DEFAULT_CREDENTIALS_PATH)
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw

  const base = (getEnvValue(ENV_API_BASE_URL) ?? '').replace(/\/$/, '')
  if (!base) return null
  const apiPath = raw.startsWith('/') ? raw : `/${raw}`
  return `${base}${apiPath}`
}

export function readAccessToken(): string | null {

  const token = process.env.ACCESS_TOKEN?.trim()
  return token || null
}

export function getCredentialEnvHint(): string {
  return `${ENV_API_BASE_URL} 与 ${ENV_DEFAULT_CREDENTIALS_PATH}`
}

function getEnvValue(key: string): string | undefined {
  const fromProcess = process.env[key]?.trim()
  return fromProcess || undefined
}

