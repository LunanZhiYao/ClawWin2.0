import { execSync, spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { app } from 'electron'

export type InstallKind = 'npm' | 'pip' | 'go' | 'chromium'

export interface SkillInstallMeta {
  kind: InstallKind
  package: string
  label: string
}

/**
 * 技能依赖的安装信息映射
 * key = SKILL.md 中的 name 字段
 */
const SKILL_INSTALL_MAP: Record<string, SkillInstallMeta> = {
  'nano-pdf': { kind: 'pip', package: 'nano-pdf', label: 'nano-pdf (pip)' },
  'mog': { kind: 'go', package: 'github.com/visionik/mogcli/cmd/mog@latest', label: 'mog (go)' },
}

/**
 * 获取 bundled 目录路径
 */
function getBundledRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bundled')
  }
  return path.join(__dirname, '..', 'bundled')
}

/**
 * 获取 bundled 预装技能的 .bin 目录路径
 * 例如 bundled/agent-browser/node_modules/.bin/
 * 如果目录不存在返回 null
 */
export function getBundledBinDir(skillName: string): string | null {
  const bundledRoot = getBundledRoot()
  const binDir = path.join(bundledRoot, skillName, 'node_modules', '.bin')
  if (fs.existsSync(binDir)) return binDir
  return null
}

/**
 * 获取所有 bundled 预装技能的 bin 目录
 * 用于将它们加入 PATH 环境变量
 */
export function getAllBundledBinPaths(): string[] {
  const paths: string[] = []
  const bundledRoot = getBundledRoot()

  // 检查已知的 bundled 技能目录
  const knownBundled = ['agent-browser']
  for (const name of knownBundled) {
    const binDir = path.join(bundledRoot, name, 'node_modules', '.bin')
    if (fs.existsSync(binDir)) {
      paths.push(binDir)
    }
  }

  // 也加入 bundled/node/ 以确保 agent-browser daemon 能找到 node
  const nodeBinDir = path.join(bundledRoot, 'node')
  if (fs.existsSync(nodeBinDir)) {
    paths.push(nodeBinDir)
  }

  return paths
}

/**
 * 本地安装目录 (~/.openclaw/skill-bins/)
 * npm 包安装到这里，并将 node_modules/.bin 加入可搜索路径
 */
function getLocalBinDir(): string {
  return path.join(os.homedir(), '.openclaw', 'skill-bins')
}

/**
 * 获取本地安装的 .bin 路径
 */
export function getLocalNpmBinDir(): string {
  return path.join(getLocalBinDir(), 'node_modules', '.bin')
}

/**
 * 检测系统是否安装了某个包管理器
 */
function hasCommand(cmd: string): boolean {
  try {
    const check = os.platform() === 'win32' ? `where ${cmd}` : `which ${cmd}`
    execSync(check, { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * 获取技能的安装信息
 */
export function getSkillInstallInfo(skillName: string): SkillInstallMeta | null {
  return SKILL_INSTALL_MAP[skillName] ?? null
}

/**
 * 检查技能依赖是否可安装（对应的包管理器是否存在）
 */
export function canInstallSkill(skillName: string): { canInstall: boolean; reason?: string } {
  const meta = SKILL_INSTALL_MAP[skillName]
  if (!meta) return { canInstall: false, reason: '无安装信息' }

  switch (meta.kind) {
    case 'npm':
      if (hasCommand('npm')) return { canInstall: true }
      return { canInstall: false, reason: '需要先安装 Node.js (https://nodejs.org)' }
    case 'pip':
      if (hasCommand('uv')) return { canInstall: true }
      if (hasCommand('pip')) return { canInstall: true }
      if (hasCommand('pip3')) return { canInstall: true }
      return { canInstall: false, reason: '需要先安装 Python (https://python.org) 或 uv (https://docs.astral.sh/uv)' }
    case 'go':
      if (hasCommand('go')) return { canInstall: true }
      return { canInstall: false, reason: '需要先安装 Go (https://go.dev)' }
    case 'chromium':
      // agent-browser 已预装，无需额外安装
      return { canInstall: false, reason: 'agent-browser 已预装' }
    default:
      return { canInstall: false, reason: '不支持的安装类型' }
  }
}

/**
 * 安装技能依赖
 * 返回 Promise，安装完成后 resolve
 */
export function installSkillDep(skillName: string): Promise<{ ok: boolean; error?: string }> {
  const meta = SKILL_INSTALL_MAP[skillName]
  if (!meta) return Promise.resolve({ ok: false, error: `未知技能: ${skillName}` })

  switch (meta.kind) {
    case 'npm':
      return installNpmPackage(meta.package)
    case 'pip':
      return installPipPackage(meta.package)
    case 'go':
      return installGoPackage(meta.package)
    case 'chromium':
      return Promise.resolve({ ok: false, error: '请使用系统已安装的浏览器' })
    default:
      return Promise.resolve({ ok: false, error: '不支持的安装类型' })
  }
}

/**
 * npm install --prefix ~/.openclaw/skill-bins <package>
 * 安装到本地目录，避免需要管理员权限
 */
function installNpmPackage(packageName: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const binDir = getLocalBinDir()
    fs.mkdirSync(binDir, { recursive: true })

    // 初始化 package.json（如果不存在）
    const pkgJsonPath = path.join(binDir, 'package.json')
    if (!fs.existsSync(pkgJsonPath)) {
      fs.writeFileSync(pkgJsonPath, JSON.stringify({ name: 'openclaw-skill-bins', private: true }, null, 2))
    }

    const npmCmd = os.platform() === 'win32' ? 'npm.cmd' : 'npm'
    const proc = spawn(npmCmd, ['install', packageName], {
      cwd: binDir,
      env: { ...process.env as Record<string, string> },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
    })

    let stderr = ''
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.on('error', (err) => {
      resolve({ ok: false, error: `npm 启动失败: ${err.message}` })
    })

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve({ ok: true })
      } else {
        resolve({ ok: false, error: stderr.trim() || `npm install 退出码: ${code}` })
      }
    })
  })
}

/**
 * pip install / uv tool install
 */
function installPipPackage(packageName: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let cmd: string
    let args: string[]

    if (hasCommand('uv')) {
      cmd = 'uv'
      args = ['tool', 'install', packageName]
    } else if (hasCommand('pip')) {
      cmd = 'pip'
      args = ['install', packageName]
    } else if (hasCommand('pip3')) {
      cmd = 'pip3'
      args = ['install', packageName]
    } else {
      resolve({ ok: false, error: '未找到 pip 或 uv' })
      return
    }

    const proc = spawn(cmd, args, {
      env: { ...process.env as Record<string, string> },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
    })

    let stderr = ''
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.on('error', (err) => {
      resolve({ ok: false, error: `${cmd} 启动失败: ${err.message}` })
    })

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve({ ok: true })
      } else {
        resolve({ ok: false, error: stderr.trim() || `${cmd} install 退出码: ${code}` })
      }
    })
  })
}

/**
 * go install <package>
 */
function installGoPackage(packageName: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!hasCommand('go')) {
      resolve({ ok: false, error: '未找到 Go 编译器' })
      return
    }

    const proc = spawn('go', ['install', packageName], {
      env: { ...process.env as Record<string, string> },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
    })

    let stderr = ''
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.on('error', (err) => {
      resolve({ ok: false, error: `go install 启动失败: ${err.message}` })
    })

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve({ ok: true })
      } else {
        resolve({ ok: false, error: stderr.trim() || `go install 退出码: ${code}` })
      }
    })
  })
}

/**
 * 检测系统已安装的 Chromium 内核浏览器路径（Edge / Chrome）
 * 返回可执行文件路径，未找到返回 null
 */
export function detectSystemBrowser(): string | null {
  if (os.platform() !== 'win32') return null

  const candidates = [
    // Edge (Windows 自带)
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    // Chrome
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }

  return null
}
