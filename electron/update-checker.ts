import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'
import { spawn } from 'node:child_process'

const VERSION_CHECK_URL = 'https://lnqy-server.shouhuisoft.com/api/v1/app/version/check'
const MAX_REDIRECTS = 5
const CONNECT_TIMEOUT = 10_000
const DATA_TIMEOUT = 30_000

// 内置 GitHub 镜像前缀
const BUILTIN_MIRRORS = [
  'https://mirror.ghproxy.com/',
  'https://ghgo.xyz/',
  'https://gh.llkk.cc/',
]

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
// 竞速模式下所有进行中的请求，用于取消
let racingReqs: http.ClientRequest[] = []

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

/** 读取用户配置的自定义镜像地址 */
function getCustomMirror(): string | null {
  try {
    const cfgPath = path.join(os.homedir(), '.openclaw', 'clawwin-ui.json')
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    const url = cfg.updateMirrorUrl
    return typeof url === 'string' && url.trim() ? url.trim() : null
  } catch { return null }
}

/** 构建镜像 URL 列表：自定义镜像 > 内置镜像 > 直连 */
function buildMirrorUrls(directUrl: string): string[] {
  const urls: string[] = []
  const custom = getCustomMirror()

  if (custom) {
    const prefix = custom.endsWith('/') ? custom : custom + '/'
    urls.push(prefix + directUrl)
  }

  if (directUrl.includes('github.com') || directUrl.includes('api.github.com')) {
    for (const mirror of BUILTIN_MIRRORS) {
      urls.push(mirror + directUrl)
    }
  }

  urls.push(directUrl)
  return urls
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

        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          res.resume()
          if (--redirects <= 0) { reject(new Error('重定向次数过多')); return }
          request(res.headers.location)
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
  return {
    version,
    releaseNotes: typeof remark === 'string' ? remark : '',
    downloadUrl,
    fileName: fileNameFromDownloadUrl(downloadUrl),
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
  if (mustVer && mustUrl && matchVersionOk(d.must_match_version, currentVersion)) {
    const force = isForceFlag(d.must_force_update)
    if (shouldOfferUpdate(mustVer, currentVersion, d.must_force_update)) {
      console.log('[update] must update:', mustVer)
      return buildUpdateFromPayload(mustVer, d.must_remark, mustUrl, force)
    }
  }

  const ver = typeof d.version_code === 'string' ? d.version_code.trim() : ''
  const exeUrl = pickExeUrl(d.exe_path, d.exe_path_32)
  if (ver && exeUrl && matchVersionOk(d.match_version, currentVersion)) {
    const force = isForceFlag(d.force_update)
    if (shouldOfferUpdate(ver, currentVersion, d.force_update)) {
      console.log('[update] latest update:', ver)
      return buildUpdateFromPayload(ver, d.remark, exeUrl, force)
    }
  }

  return null
}

/**
 * 下载更新：所有镜像并行竞速连接，最快响应的下载
 * 支持断点续传，支持取消
 */
export async function downloadUpdate(
  downloadUrl: string,
  fileName: string,
  onProgress: (progress: DownloadProgress) => void,
): Promise<string> {
  cancelled = false
  activeReq = null

  const destPath = path.join(app.getPath('temp'), fileName)
  const urls = buildMirrorUrls(downloadUrl)

  // 断点续传：读取已下载的字节数
  let existingBytes = 0
  try { existingBytes = fs.statSync(destPath).size } catch { /* 文件不存在 */ }

  let headers: Record<string, string> = {}
  if (existingBytes > 0) {
    headers['Range'] = `bytes=${existingBytes}-`
    console.log('[update] resuming from byte', existingBytes)
  }

  // 并行竞速：所有 URL 同时连接，第一个成功响应的胜出
  let res: http.IncomingMessage, req: http.ClientRequest, url: string
  try {
    ({ res, req, url } = await raceForResponse(urls, headers))
  } catch (err) {
    // Range 请求全部失败（416 或服务器不支持），删除临时文件从头下载
    if (existingBytes > 0) {
      console.log('[update] range request failed, retrying from scratch')
      try { fs.unlinkSync(destPath) } catch { /* ignore */ }
      existingBytes = 0
      headers = {}
      ;({ res, req, url } = await raceForResponse(urls, headers))
    } else {
      throw err
    }
  }
  activeReq = req
  console.log('[update] winner:', url)

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
  // 取消所有竞速中的请求
  for (const req of racingReqs) {
    try { req.destroy() } catch { /* ignore */ }
  }
  racingReqs = []
}

/** 启动安装程序并退出应用 */
export function installUpdate(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`安装文件不存在: ${filePath}`)
  }
  spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref()
  app.quit()
}

// ========== 并行竞速 ==========

/**
 * 并行竞速连接：所有 URL 同时发起请求，第一个返回有效响应头的胜出
 * 其余请求立即取消，仅用胜出的连接进行下载
 */
function raceForResponse(
  urls: string[],
  headers: Record<string, string> = {},
): Promise<{ res: http.IncomingMessage; req: http.ClientRequest; url: string }> {
  return new Promise((resolve, reject) => {
    if (cancelled) { reject(new Error('下载已取消')); return }

    let settled = false
    let failures = 0
    racingReqs = []

    for (const url of urls) {
      console.log('[update] racing:', url)
      httpGet(url, headers).then(({ res, req }) => {
        if (settled) {
          // 已有赢家，销毁这个迟到的连接
          res.resume()
          req.destroy()
          return
        }
        settled = true
        // 从竞速列表中移除赢家，销毁其余
        racingReqs = racingReqs.filter(r => r !== req)
        for (const r of racingReqs) { try { r.destroy() } catch {} }
        racingReqs = []
        resolve({ res, req, url })
      }).catch((err) => {
        failures++
        console.log('[update] race failed:', url, err instanceof Error ? err.message : err)
        if (!settled && failures >= urls.length) {
          racingReqs = []
          reject(new Error('所有下载源均失败，请检查网络连接'))
        }
      })
    }
  })
}
