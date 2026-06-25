/**
 * build-installer-lite.js — 精简(覆盖升级)安装包构建流程
 *
 * 与 build-installer.js 的区别：
 *   - 不执行 prepare-node / prepare-openclaw / patch-shell-utils
 *     （bundled 目录不打包进安装包，无需准备）
 *   - 使用 electron-builder.lite.yml 配置，排除 bundled/ 下的
 *     node、openclaw、agent-browser，安装包体积大幅缩小
 *   - 配合 installer-upgrade.nsh，覆盖安装时自动备份/还原已存在的
 *     bundled 目录，保证升级后 openclaw 等运行时仍然可用
 *
 * 步骤:
 * 1. vite build            — 编译前端 + Electron 主进程
 * 2. electron-builder      — 打包精简 NSIS 安装包
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const LITE_CONFIG = path.join(ROOT, 'electron-builder.lite.yml')

function run(cmd, label) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  ${label}`)
  console.log(`${'='.repeat(60)}\n`)

  try {
    execSync(cmd, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env },
    })
  } catch (err) {
    console.error(`\n构建步骤失败: ${label}`)
    console.error(err.message)
    process.exit(1)
  }
}

function checkPrerequisites() {
  console.log('检查构建环境...\n')

  const nodeVersion = process.version
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10)
  if (major < 18) {
    console.error(`需要 Node.js >= 18，当前版本: ${nodeVersion}`)
    process.exit(1)
  }
  console.log(`  Node.js: ${nodeVersion}`)

  try {
    const npmVersion = execSync('npm --version', { encoding: 'utf-8' }).trim()
    console.log(`  npm: ${npmVersion}`)
  } catch {
    console.error('未找到 npm')
    process.exit(1)
  }

  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    console.log('\n正在安装项目依赖...')
    run('npm install', '安装项目依赖')
  }

  if (!fs.existsSync(LITE_CONFIG)) {
    console.error(`未找到精简打包配置: ${LITE_CONFIG}`)
    process.exit(1)
  }

  console.log('\n环境检查通过!\n')
}

async function main() {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   OpenClaw 中文版 — 精简覆盖升级构建     ║
  ║   (不含 bundled，仅覆盖程序文件)          ║
  ╚══════════════════════════════════════════╝
  `)

  checkPrerequisites()

  // Step 1: Build React frontend + Electron main process
  run('npx vite build', '步骤 1/2: 编译前端 + Electron 主进程')

  // Step 2: Build lite installer (excludes bundled)
  run('npx electron-builder --win --config electron-builder.lite.yml --publish never', '步骤 2/2: 打包精简 NSIS 安装包')

  console.log(`
  ╔══════════════════════════════════════════╗
  ║           精简安装包构建完成！            ║
  ╠══════════════════════════════════════════╣
  ║  安装包位于: release/ 目录               ║
  ║  文件名: LunanQianyi-Upgrade-*.exe       ║
  ╚══════════════════════════════════════════╝
  `)

  const releaseDir = path.join(ROOT, 'release')
  if (fs.existsSync(releaseDir)) {
    const files = fs.readdirSync(releaseDir).filter((f) => f.endsWith('.exe'))
    if (files.length > 0) {
      console.log('生成的安装包:')
      for (const file of files) {
        const stats = fs.statSync(path.join(releaseDir, file))
        console.log(`  ${file} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`)
      }
    }
  }
}

main().catch((err) => {
  console.error('构建失败:', err.message)
  process.exit(1)
})
