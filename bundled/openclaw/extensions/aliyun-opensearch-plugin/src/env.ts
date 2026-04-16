import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENV_API_BASE_URL = 'VITE_API_BASE_URL'
const ENV_DEFAULT_CREDENTIALS_PATH = 'DEFAULT_CREDENTIALS_PATH'
const ENV_KEY_ENDPOINT = 'ALIYUN_OPENSEARCH_KEY_ENDPOINT'

let dotEnvCache: Record<string, string> | null = null

export function getCredentialEndpoint(explicitEndpoint?: string): string | null {
  const raw =
    getEnvValue(ENV_KEY_ENDPOINT) ||
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
  return `${ENV_API_BASE_URL} 与 ${ENV_DEFAULT_CREDENTIALS_PATH}，或 ${ENV_KEY_ENDPOINT}`
}

function getEnvValue(key: string): string | undefined {
  const fromProcess = process.env[key]?.trim()
  if (fromProcess) return fromProcess
  const fromDotEnv = readDotEnvFile()[key]?.trim()
  return fromDotEnv || undefined
}

function readDotEnvFile(): Record<string, string> {
  if (dotEnvCache) return dotEnvCache
  const result: Record<string, string> = {}
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url))
    const envPath = findEnvFileFrom(process.cwd()) || findEnvFileFrom(moduleDir)
    if (!envPath) {
      dotEnvCache = result
      return result
    }
    const text = fs.readFileSync(envPath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (key) result[key] = value
    }
  } catch {
    // ignore
  }
  dotEnvCache = result
  return result
}

function findEnvFileFrom(startDir: string): string | null {
  let current = path.resolve(startDir)
  for (let i = 0; i < 12; i += 1) {
    const candidate = path.join(current, '.env')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}
