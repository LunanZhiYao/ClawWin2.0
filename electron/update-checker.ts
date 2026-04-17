import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { spawn } from 'node:child_process'

const VERSION_CHECK_URL = 'https://lnqy-server.shouhuisoft.com/api/v1/app/version/check'
const MAX_REDIRECTS = 5
const CONNECT_TIMEOUT = 10_000
const DATA_TIMEOUT = 30_000

export interface UpdateInfo {
  version: string
  releaseNotes: string
  downloadUrl: string
  fileName: string
  /** 服务端强制更新（must_* 或 force_update） */
  forceUpdate?: boolean
}

export interface DownloadProgress {
  percent: number
  transferredBytes: number
  totalBytes: number
}

// ========== 状态 ==========

let cancelled = false
let activeReq: http.ClientRequest | null = null

// ========== 工具函数 ==========

/** 比较 semver：a > b 返回 true */
function isNewer(remote: string, local: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const r = parse(remote)
  const l = parse(local)
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false
  }
  return false
}

/**
 * 规范化下载 URL：合并路径中连续斜杠（如 https://host//uploadfiles/...），
 * 否则 pathname 会变成 //uploadfiles/...，部分 CDN 会返回 404。
 */
function normalizeDownloadUrl(url: string): string {
  try {
    const u = new URL(url.trim())
    u.pathname = u.pathname.replace(/\/{2,}/g, '/')
    return u.href
  } catch {
    return url.trim()
  }
}

/**
 * HTTP GET，内部跟随重定向，返回最终 response
 * 返回 { res, req } 以便调用方管理请求生命周期
 */
function httpGet(
  url: string,
  headers: Record<string, string> = {},
  timeout = CONNECT_TIMEOUT,
): Promise<{ res: http.IncomingMessage; req: http.ClientRequest }> {
  return new Promise((resolve, reject) => {
    let redirects = MAX_REDIRECTS
    let timer: ReturnType<typeof setTimeout>
    let currentReq: http.ClientRequest

    function request(targetUrl: string) {
      if (cancelled) { reject(new Error('下载已取消')); return }
      const mod = targetUrl.startsWith('https') ? https : http
      const req = mod.get(targetUrl, {
        headers: { 'User-Agent': 'ClawWin-Updater', ...headers },
      }, (res) => {
        clearTimeout(timer)

        const redirect = res.statusCode === 301 || res.statusCode === 302
          || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308
        if (redirect && res.headers.location) {
          res.resume()
          if (--redirects <= 0) { reject(new Error('重定向次数过多')); return }
          const next = new URL(res.headers.location, targetUrl).href
          request(next)
          return
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }

        resolve({ res, req: currentReq })
      })

      currentReq = req
      req.on('error', (err) => { clearTimeout(timer); reject(err) })
      timer = setTimeout(() => { req.destroy(); reject(new Error('连接超时')) }, timeout)
    }

    request(url)
  })
}

function isForceFlag(v: unknown): boolean {
  return v === 1 || v === '1' || v === true
}

function pickExeUrl(exe64: unknown, exe32: unknown): string {
  const a = typeof exe64 === 'string' ? exe64.trim() : ''
  const b = typeof exe32 === 'string' ? exe32.trim() : ''
  if (a) return a
  if (b) return b
  return ''
}

function fileNameFromDownloadUrl(downloadUrl: string): string {
  try {
    const base = path.basename(new URL(downloadUrl).pathname)
    return base || 'ClawWin-Update.exe'
  } catch {
    return 'ClawWin-Update.exe'
  }
}

function matchVersionOk(matchVersion: unknown, currentVersion: string): boolean {
  const m = typeof matchVersion === 'string' ? matchVersion.trim() : ''
  if (!m) return true
  return m === currentVersion
}

/** 是否应展示该条更新：有更新包且版本更新，或强制更新且版本不同 */
function shouldOfferUpdate(
  remoteVersion: string,
  currentVersion: string,
  forceFlag: unknown,
): boolean {
  if (isNewer(remoteVersion, currentVersion)) return true
  if (isForceFlag(forceFlag) && remoteVersion !== currentVersion) return true
  return false
}

type VersionCheckData = Record<string, unknown>

function buildUpdateFromPayload(
  version: string,
  remark: unknown,
  downloadUrl: string,
  force: boolean,
): UpdateInfo {
  const url = normalizeDownloadUrl(downloadUrl)
  return {
    version,
    releaseNotes: typeof remark === 'string' ? remark : '',
    downloadUrl: url,
    fileName: fileNameFromDownloadUrl(url),
    forceUpdate: force,
  }
}

// ========== 公开 API ==========

/**
 * 检查更新：GET 官方版本接口，需 Bearer accessToken（与渲染进程 localStorage accessToken 一致）
 */
export async function checkForUpdate(accessToken: string | null): Promise<UpdateInfo | null> {
  const currentVersion = app.getVersion()
  console.log('[update] current version:', currentVersion)

  const token = typeof accessToken === 'string' ? accessToken.trim() : ''
  if (!token) {
    console.log('[update] skip: no access token')
    return null
  }

  // cancelDownload() 会把 cancelled 置为 true；httpGet 与下载共用该标志，不重置则后续检查更新会立刻失败并返回 null（像“没发请求”）
  cancelled = false

  const url = `${VERSION_CHECK_URL}?${new URLSearchParams({ current_version: currentVersion })}`
  let raw: unknown
  try {
    const { res } = await httpGet(url, {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    }, 15_000)
    const body = await new Promise<string>((resolve, reject) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    raw = JSON.parse(body)
  } catch (e) {
    console.warn('[update] check failed:', e instanceof Error ? e.message : e)
    return null
  }

  const root = raw as { code?: unknown; data?: VersionCheckData | null }
  if (root.code !== 200 || !root.data || typeof root.data !== 'object') {
    console.log('[update] no update payload or bad code:', root.code)
    return null
  }

  const d = root.data

  const mustVer = typeof d.must_version_code === 'string' ? d.must_version_code.trim() : ''
  const mustUrl = pickExeUrl(d.must_exe_path, d.must_exe_path_32)

  // 优先 must_*：仅当 must 版本高于当前时使用 must 包地址（与当前相同时不占用 must 通道）
  if (mustVer && mustUrl && matchVersionOk(d.must_match_version, currentVersion)) {
    if (isNewer(mustVer, currentVersion) && shouldOfferUpdate(mustVer, currentVersion, d.must_force_update)) {
      console.log('[update] must update:', mustVer)
      return buildUpdateFromPayload(mustVer, d.must_remark, mustUrl, isForceFlag(d.must_force_update))
    }
  }

  const ver = typeof d.version_code === 'string' ? d.version_code.trim() : ''
  const exeUrl = pickExeUrl(d.exe_path, d.exe_path_32)

  // must_version_code 与当前相同（或当前已不低于 must、或缺少 must 包地址）时，才用 version_code + exe_path / exe_path_32
  const canUseOptionalExe =
    !mustVer || !isNewer(mustVer, currentVersion) || !mustUrl

  if (
    canUseOptionalExe &&
    ver &&
    exeUrl &&
    matchVersionOk(d.match_version, currentVersion) &&
    isNewer(ver, currentVersion)
  ) {
    console.log('[update] latest update:', ver)
    return buildUpdateFromPayload(ver, d.remark, exeUrl, isForceFlag(d.force_update))
  }

  return null
}

/**
 * 下载更新：直连接口返回的地址，支持断点续传与取消
 */
export async function downloadUpdate(
  downloadUrl: string,
  fileName: string,
  onProgress: (progress: DownloadProgress) => void,
): Promise<string> {
  cancelled = false
  activeReq = null

  const destPath = path.join(app.getPath('temp'), fileName)
  const url = normalizeDownloadUrl(downloadUrl)

  // 断点续传：读取已下载的字节数
  let existingBytes = 0
  try { existingBytes = fs.statSync(destPath).size } catch { /* 文件不存在 */ }

  let headers: Record<string, string> = {}
  if (existingBytes > 0) {
    headers['Range'] = `bytes=${existingBytes}-`
    console.log('[update] resuming from byte', existingBytes)
  }

  let res: http.IncomingMessage, req: http.ClientRequest
  try {
    ({ res, req } = await httpGet(url, headers))
  } catch (err) {
    // Range 失败（416 或服务器不支持），删除临时文件从头下载
    if (existingBytes > 0) {
      console.log('[update] range request failed, retrying from scratch')
      try { fs.unlinkSync(destPath) } catch { /* ignore */ }
      existingBytes = 0
      headers = {}
      ;({ res, req } = await httpGet(url, headers))
    } else {
      throw err
    }
  }
  activeReq = req
  console.log('[update] downloading:', url)

  // 服务器返回 206 = 支持续传，200 = 不支持，从头开始
  const isResume = res.statusCode === 206
  if (!isResume) existingBytes = 0

  const contentLength = parseInt(res.headers['content-length'] ?? '0', 10)
  const totalBytes = existingBytes + contentLength
  let transferredBytes = existingBytes

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const done = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(dataTimer)
      if (err) {
        file.destroy()
        reject(err)
      } else {
        file.close(() => resolve())
      }
    }

    const file = fs.createWriteStream(destPath, isResume ? { flags: 'a' } : {})

    let dataTimer = setTimeout(() => {
      activeReq?.destroy()
      done(new Error('下载超时'))
    }, DATA_TIMEOUT)

    res.on('data', (chunk: Buffer) => {
      clearTimeout(dataTimer)
      dataTimer = setTimeout(() => {
        activeReq?.destroy()
        done(new Error('下载超时'))
      }, DATA_TIMEOUT)

      transferredBytes += chunk.length
      onProgress({
        percent: totalBytes > 0 ? Math.round((transferredBytes / totalBytes) * 100) : 0,
        transferredBytes,
        totalBytes,
      })
    })

    res.pipe(file)
    file.on('finish', () => done())
    file.on('error', (err) => done(err))
    res.on('error', (err) => done(err))
  })

  return destPath
}

/** 取消正在进行的下载 */
export function cancelDownload(): void {
  cancelled = true
  activeReq?.destroy()
  activeReq = null
}

/** 启动安装程序并退出应用 */
export function installUpdate(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`安装文件不存在: ${filePath}`)
  }
  spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref()
  app.quit()
}
