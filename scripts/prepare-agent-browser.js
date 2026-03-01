/**
 * prepare-agent-browser.js — 安装 agent-browser 到 bundled/agent-browser/
 *
 * 构建时运行：node scripts/prepare-agent-browser.js
 * 安装 agent-browser npm 包及其所有依赖（含 Rust CLI 二进制）
 * 不包含 Chromium 浏览器（由用户首次使用时下载）
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const TARGET_DIR = path.join(__dirname, '..', 'bundled', 'agent-browser')

function getDirSize(dirPath) {
  let totalSize = 0
  if (!fs.existsSync(dirPath)) return 0
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      totalSize += getDirSize(fullPath)
    } else if (entry.isFile()) {
      totalSize += fs.statSync(fullPath).size
    }
  }
  return totalSize
}

/**
 * 清理不必要的文件以减小体积
 */
function cleanupDir(dir) {
  let totalRemoved = 0
  if (!fs.existsSync(dir)) return 0

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (['test', 'tests', '__tests__', '.github', 'example', 'examples', 'docs'].includes(entry.name)) {
        fs.rmSync(fullPath, { recursive: true, force: true })
        totalRemoved++
        continue
      }
      totalRemoved += cleanupDir(fullPath)
    } else if (entry.isFile()) {
      const name = entry.name.toLowerCase()
      if (
        name === 'changelog.md' ||
        name === 'history.md' ||
        name === 'contributing.md' ||
        name.endsWith('.map') ||
        name.endsWith('.ts') && !name.endsWith('.d.ts')
      ) {
        fs.unlinkSync(fullPath)
        totalRemoved++
      }
    }
  }
  return totalRemoved
}

async function main() {
  console.log('=== 准备 agent-browser ===\n')

  // 检查是否已安装
  const existingBin = path.join(TARGET_DIR, 'node_modules', '.bin', 'agent-browser.cmd')
  if (fs.existsSync(existingBin)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(
        path.join(TARGET_DIR, 'node_modules', 'agent-browser', 'package.json'),
        'utf-8'
      ))
      console.log(`agent-browser@${pkg.version} 已安装在 bundled/ 中`)
      console.log('跳过安装（如需更新请先删除 bundled/agent-browser/ 目录）')
      return
    } catch { /* continue to install */ }
  }

  // 创建目标目录
  fs.mkdirSync(TARGET_DIR, { recursive: true })

  // 初始化 package.json
  const pkgJsonPath = path.join(TARGET_DIR, 'package.json')
  if (!fs.existsSync(pkgJsonPath)) {
    fs.writeFileSync(pkgJsonPath, JSON.stringify({
      name: 'openclaw-agent-browser',
      private: true,
      description: 'Pre-bundled agent-browser for ClawWin'
    }, null, 2))
  }

  // 安装 agent-browser
  console.log('正在安装 agent-browser (含 Rust 二进制, 约 30MB)...')
  try {
    execSync('npm install agent-browser', {
      cwd: TARGET_DIR,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
      timeout: 300000, // 5 minutes
    })
  } catch (err) {
    console.error(`安装失败: ${err.message}`)
    console.error('\n请确保网络畅通后重试')
    process.exit(1)
  }

  // 验证安装
  if (!fs.existsSync(existingBin)) {
    console.error('错误: 安装后未找到 agent-browser 二进制')
    process.exit(1)
  }

  // 清理不必要的文件
  console.log('\n清理不必要的文件...')
  const nodeModulesDir = path.join(TARGET_DIR, 'node_modules')
  if (fs.existsSync(nodeModulesDir)) {
    const removed = cleanupDir(nodeModulesDir)
    console.log(`已清理 ${removed} 个文件/目录`)
  }

  // 报告大小
  const totalSize = getDirSize(TARGET_DIR)
  const pkg = JSON.parse(fs.readFileSync(
    path.join(TARGET_DIR, 'node_modules', 'agent-browser', 'package.json'),
    'utf-8'
  ))
  console.log(`\nagent-browser@${pkg.version} 安装完成!`)
  console.log(`目录大小: ${(totalSize / 1024 / 1024).toFixed(1)} MB`)
  console.log('\n注意: Chromium 浏览器需要用户首次使用时下载 (~200MB)')
}

main().catch((err) => {
  console.error('错误:', err.message)
  process.exit(1)
})
