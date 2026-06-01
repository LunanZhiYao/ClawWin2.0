#!/usr/bin/env node
/**
 * sync-custom-extensions.mjs — 编译并同步自定义插件到 bundled/openclaw
 *
 * 功能：
 *   1. 使用 esbuild 编译 TypeScript 插件为 JavaScript
 *   2. 复制编译产物到 bundled/openclaw/dist/extensions/<plugin-id>/
 *   3. 复制 openclaw.plugin.json 和 package.json
 *   4. 同步 Skills 到 bundled/openclaw/skills/
 *
 * 使用：
 *   node scripts/sync-custom-extensions.mjs              # 编译所有插件和 skills
 *   node scripts/sync-custom-extensions.mjs init         # 初始化目录结构
 *   node scripts/sync-custom-extensions.mjs extensions   # 只编译所有插件
 *   node scripts/sync-custom-extensions.mjs skills       # 只同步所有 skills
 *   node scripts/sync-custom-extensions.mjs <plugin-name> # 编译指定插件
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT_DIR = path.join(__dirname, '..')
const CUSTOM_PLUGINS_DIR = path.join(ROOT_DIR, 'custom-plugins')
const EXTENSIONS_SRC_DIR = path.join(CUSTOM_PLUGINS_DIR, 'extensions')
const SKILLS_SRC_DIR = path.join(CUSTOM_PLUGINS_DIR, 'skills')
const BUNDLED_DIR = path.join(ROOT_DIR, 'bundled', 'openclaw')
const DIST_EXTENSIONS_DIR = path.join(BUNDLED_DIR, 'dist', 'extensions')
const DIST_SKILLS_DIR = path.join(BUNDLED_DIR, 'skills')

function log(msg) {
  console.log(`[sync-custom-extensions] ${msg}`)
}

function error(msg) {
  console.error(`[sync-custom-extensions] ERROR: ${msg}`)
}

function warn(msg) {
  console.warn(`[sync-custom-extensions] WARN: ${msg}`)
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    log(`Created directory: ${dir}`)
  }
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest)
  log(`Copied: ${src} -> ${dest}`)
}

function copyDir(src, dest) {
  ensureDir(dest)
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else if (entry.isFile()) {
      copyFile(srcPath, destPath)
    }
  }
}

function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    log(`Removed: ${dir}`)
  }
}

function getPluginId(pluginDir) {
  const manifestPath = path.join(pluginDir, 'openclaw.plugin.json')
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      return manifest.id || path.basename(pluginDir)
    } catch {
      warn(`Failed to parse ${manifestPath}, using directory name`)
      return path.basename(pluginDir)
    }
  }
  return path.basename(pluginDir)
}

function listPlugins() {
  if (!fs.existsSync(EXTENSIONS_SRC_DIR)) {
    return []
  }
  return fs.readdirSync(EXTENSIONS_SRC_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
}

function listSkills() {
  if (!fs.existsSync(SKILLS_SRC_DIR)) {
    return []
  }
  return fs.readdirSync(SKILLS_SRC_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
}

function checkBundledOpenClaw() {
  const entryJs = path.join(BUNDLED_DIR, 'dist', 'entry.js')
  if (!fs.existsSync(entryJs)) {
    error('bundled/openclaw not found. Run `node scripts/prepare-openclaw.js` first.')
    return false
  }
  return true
}

function getExternalDeps(pluginDir) {
  const pkgPath = path.join(pluginDir, 'package.json')
  const externals = ['openclaw', 'openclaw/plugin-sdk']
  
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      if (pkg.dependencies) {
        externals.push(...Object.keys(pkg.dependencies))
      }
      if (pkg.peerDependencies) {
        externals.push(...Object.keys(pkg.peerDependencies))
      }
    } catch {}
  }
  
  return externals
}

function getPluginDependencies(pluginDir) {
  const pkgPath = path.join(pluginDir, 'package.json')
  if (!fs.existsSync(pkgPath)) return {}
  
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    return pkg.dependencies || {}
  } catch {
    return {}
  }
}

function installPluginDependencies(pluginId, deps) {
  if (!deps || Object.keys(deps).length === 0) return
  
  const depList = Object.entries(deps)
    .filter(([name]) => !name.startsWith('openclaw'))
    .map(([name, version]) => `${name}@${version.replace(/^[\^~>=<]+/, '')}`)
  
  if (depList.length === 0) return
  
  log(`Installing dependencies for ${pluginId}: ${depList.join(', ')}`)
  
  try {
    execSync(`npm install ${depList.join(' ')} --prefix "${BUNDLED_DIR}"`, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    })
    log(`Dependencies installed for ${pluginId}`)
  } catch (err) {
    warn(`Failed to install dependencies for ${pluginId}: ${err.message}`)
  }
}

async function compilePlugin(pluginName) {
  const pluginSrcDir = path.join(EXTENSIONS_SRC_DIR, pluginName)
  if (!fs.existsSync(pluginSrcDir)) {
    error(`Plugin not found: ${pluginSrcDir}`)
    return false
  }

  const pluginId = getPluginId(pluginSrcDir)
  const destDir = path.join(DIST_EXTENSIONS_DIR, pluginId)

  log(`Compiling plugin: ${pluginName} -> ${pluginId}`)

  const indexTs = path.join(pluginSrcDir, 'index.ts')
  if (!fs.existsSync(indexTs)) {
    error(`index.ts not found in ${pluginSrcDir}`)
    return false
  }

  ensureDir(destDir)

  const external = getExternalDeps(pluginSrcDir)
  const nodeBuiltins = [
    'node:fs', 'node:path', 'node:child_process', 'node:module', 'node:url',
    'node:crypto', 'node:stream', 'node:util', 'node:events', 'node:os',
    'node:sqlite', 'node:http', 'node:https', 'node:net', 'node:tls',
    'node:zlib', 'node:buffer', 'node:process', 'node:perf_hooks',
  ]
  external.push(...nodeBuiltins)

  try {
    log(`Building ${pluginName} with esbuild...`)
    
    const entryPoints = [indexTs]
    
    const srcDir = path.join(pluginSrcDir, 'src')
    if (fs.existsSync(srcDir)) {
      const srcFiles = fs.readdirSync(srcDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.spec.ts'))
        .map(entry => path.join(srcDir, entry.name))
      entryPoints.push(...srcFiles)
    }

    const tsconfigPath = path.join(pluginSrcDir, 'tsconfig.json')
    const buildOptions = {
      entryPoints: [indexTs],
      outdir: destDir,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      external,
      splitting: false,
      minify: false,
      sourcemap: false,
      treeShaking: true,
      resolveExtensions: ['.ts', '.js', '.mjs'],
      alias: {
        'openclaw/plugin-sdk': path.join(BUNDLED_DIR, 'dist', 'plugin-sdk'),
        'openclaw': path.join(BUNDLED_DIR, 'dist', 'plugin-sdk'),
      },
      logLevel: 'warning',
    }
    
    if (fs.existsSync(tsconfigPath)) {
      buildOptions.tsconfig = tsconfigPath
    }

    await build(buildOptions)

    log(`Compiled ${pluginName} successfully`)
  } catch (err) {
    error(`Failed to compile ${pluginName}: ${err.message}`)
    return false
  }

  const manifestSrc = path.join(pluginSrcDir, 'openclaw.plugin.json')
  if (fs.existsSync(manifestSrc)) {
    copyFile(manifestSrc, path.join(destDir, 'openclaw.plugin.json'))
  }

  const packageSrc = path.join(pluginSrcDir, 'package.json')
  if (fs.existsSync(packageSrc)) {
    const pkg = JSON.parse(fs.readFileSync(packageSrc, 'utf-8'))
    const destPkg = {
      name: pkg.name || `@openclaw/${pluginId}`,
      version: pkg.version || '1.0.0',
      private: true,
      type: 'module',
      description: pkg.description || '',
      openclaw: {
        extensions: ['./index.js'],
      },
    }
    if (pkg.dependencies) {
      destPkg.dependencies = pkg.dependencies
    }
    if (pkg.peerDependencies) {
      destPkg.peerDependencies = pkg.peerDependencies
      destPkg.peerDependenciesMeta = {}
      for (const dep of Object.keys(pkg.peerDependencies)) {
        destPkg.peerDependenciesMeta[dep] = { optional: true }
      }
    }
    fs.writeFileSync(path.join(destDir, 'package.json'), JSON.stringify(destPkg, null, 2))
    log(`Generated package.json for ${pluginId}`)
  } else {
    const destPkg = {
      name: `@openclaw/${pluginId}`,
      version: '1.0.0',
      private: true,
      type: 'module',
      openclaw: {
        extensions: ['./index.js'],
      },
    }
    fs.writeFileSync(path.join(destDir, 'package.json'), JSON.stringify(destPkg, null, 2))
    log(`Generated default package.json for ${pluginId}`)
  }

  const binDir = path.join(pluginSrcDir, 'bin')
  if (fs.existsSync(binDir)) {
    const destBinDir = path.join(destDir, 'bin')
    copyDir(binDir, destBinDir)
    log(`Copied bin directory for ${pluginId}`)
  }

  const deps = getPluginDependencies(pluginSrcDir)
  installPluginDependencies(pluginId, deps)

  log(`Plugin ${pluginId} synced to ${destDir}`)
  return true
}

function syncSkill(skillName) {
  const skillSrcDir = path.join(SKILLS_SRC_DIR, skillName)
  if (!fs.existsSync(skillSrcDir)) {
    error(`Skill not found: ${skillSrcDir}`)
    return false
  }

  const skillMd = path.join(skillSrcDir, 'SKILL.md')
  if (!fs.existsSync(skillMd)) {
    error(`SKILL.md not found in ${skillSrcDir}`)
    return false
  }

  const destDir = path.join(DIST_SKILLS_DIR, skillName)
  ensureDir(destDir)
  copyFile(skillMd, path.join(destDir, 'SKILL.md'))

  const otherFiles = fs.readdirSync(skillSrcDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name !== 'SKILL.md')
    .map(entry => entry.name)

  for (const file of otherFiles) {
    copyFile(path.join(skillSrcDir, file), path.join(destDir, file))
  }

  log(`Skill ${skillName} synced to ${destDir}`)
  return true
}

function initDirectories() {
  log('Initializing directories...')
  ensureDir(EXTENSIONS_SRC_DIR)
  ensureDir(SKILLS_SRC_DIR)
  ensureDir(DIST_EXTENSIONS_DIR)
  ensureDir(DIST_SKILLS_DIR)
  log('Directories initialized')
}

async function syncAllPlugins() {
  if (!checkBundledOpenClaw()) return false

  const plugins = listPlugins()
  if (plugins.length === 0) {
    log('No custom plugins found')
    return true
  }

  log(`Found ${plugins.length} plugins: ${plugins.join(', ')}`)

  let success = true
  for (const plugin of plugins) {
    if (!(await compilePlugin(plugin))) {
      success = false
    }
  }

  return success
}

function syncAllSkills() {
  if (!checkBundledOpenClaw()) return false

  const skills = listSkills()
  if (skills.length === 0) {
    log('No custom skills found')
    return true
  }

  log(`Found ${skills.length} skills: ${skills.join(', ')}`)

  let success = true
  for (const skill of skills) {
    if (!syncSkill(skill)) {
      success = false
    }
  }

  return success
}

async function syncAll() {
  const pluginsOk = await syncAllPlugins()
  const skillsOk = syncAllSkills()
  return pluginsOk && skillsOk
}

function printUsage() {
  console.log(`
Usage:
  node scripts/sync-custom-extensions.mjs              # 编译所有插件和 skills
  node scripts/sync-custom-extensions.mjs init         # 初始化目录结构
  node scripts/sync-custom-extensions.mjs extensions   # 只编译所有插件
  node scripts/sync-custom-extensions.mjs skills       # 只同步所有 skills
  node scripts/sync-custom-extensions.mjs <plugin-name> # 编译指定插件
  node scripts/sync-custom-extensions.mjs <skill-name>  # 同步指定 skill

Examples:
  node scripts/sync-custom-extensions.mjs aliyun-opensearch-plugin
  node scripts/sync-custom-extensions.mjs extensions
`)
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    printUsage()
    process.exit(0)
  }

  log('Starting sync...')

  if (args.length === 0) {
    if (!(await syncAll())) {
      process.exit(1)
    }
  } else if (args[0] === 'init') {
    initDirectories()
  } else if (args[0] === 'extensions') {
    if (!(await syncAllPlugins())) {
      process.exit(1)
    }
  } else if (args[0] === 'skills') {
    if (!syncAllSkills()) {
      process.exit(1)
    }
  } else {
    const name = args[0]
    const isPlugin = fs.existsSync(path.join(EXTENSIONS_SRC_DIR, name))
    const isSkill = fs.existsSync(path.join(SKILLS_SRC_DIR, name))

    if (isPlugin) {
      if (!checkBundledOpenClaw()) process.exit(1)
      if (!(await compilePlugin(name))) process.exit(1)
    } else if (isSkill) {
      if (!checkBundledOpenClaw()) process.exit(1)
      if (!syncSkill(name)) process.exit(1)
    } else {
      error(`Unknown plugin or skill: ${name}`)
      printUsage()
      process.exit(1)
    }
  }

  log('Sync completed!')
}

main().catch(err => {
  error(err.message)
  process.exit(1)
})