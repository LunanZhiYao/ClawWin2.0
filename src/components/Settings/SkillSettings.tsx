import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { SkillInfo, SkillEntryConfig } from '../../types'
import { SKILL_CN } from '../../constants/skillCn'

interface SkillSettingsProps {
  onBack?: () => void
}

type TabKey = 'enabled' | 'all' | 'recommended' | 'local' | 'store'

interface WebSkillItem {
  id: number
  slug: string
  displayName: string
  summary: string
  status: string
  namespace: string
  downloadCount: number
}

const RECOMMENDED_SKILLS = [
  '天气查询', '新闻资讯', '百度搜索', '高德地图',
  '邮件管理', '图片分析', 'AI 图片生成', '网页设计部署',
  'GitHub', '编程代理', 'windows-control',
  '内容摘要', 'find-skills', 'tavily',
  'Self-Improving Agent (With Self-Reflection)',
  // from ClawX
  'Notion', 'Obsidian', '技能创建器', '会话日志',
  '视频帧提取', 'Oracle',
  // from ClawHub
  'multi-search-engine', 'agent-browser', 'mog',
  'gembox-skill', '纳米PDF',
]

const KEY_URLS: Record<string, string> = {
  'BAIDU_SEARCH_API_KEY': 'https://qianfan.cloud.baidu.com/',
  'AMAP_API_KEY': 'https://console.amap.com/',
  'IMAGE_API_KEY': 'https://open.bigmodel.cn/',
  'IMAGE_GEN_API_KEY': 'https://open.bigmodel.cn/',
  'CLOUDFLARE_API_TOKEN': 'https://dash.cloudflare.com/profile/api-tokens',
  'NOTION_API_KEY': 'https://www.notion.so/my-integrations',
  'GOOGLE_PLACES_API_KEY': 'https://console.cloud.google.com/',
  'EMAIL_PASS': 'https://service.mail.qq.com/detail/0/75',
  'TAVILY_API_KEY': 'https://tavily.com/',
  'OPENAI_API_KEY': 'https://platform.openai.com/api-keys',
  'GEMINI_API_KEY': 'https://aistudio.google.com/apikey',
}

const KEY_TIPS: Record<string, string> = {
  'BAIDU_SEARCH_API_KEY': '前往百度千帆平台获取 API Key（格式 bce-v3/...）',
  'AMAP_API_KEY': '前往高德开放平台创建应用获取 Web服务 Key',
  'IMAGE_API_KEY': '前往智谱开放平台获取 API Key',
  'IMAGE_GEN_API_KEY': '前往智谱开放平台获取 API Key',
  'CLOUDFLARE_API_TOKEN': '前往 Cloudflare 创建 Pages Edit 权限的 Token',
  'EMAIL_PASS': 'QQ邮箱需开启SMTP并获取授权码，163邮箱需开启IMAP',
  'TAVILY_API_KEY': '前往 Tavily 官网注册获取 API Key（免费额度可用）',
}

/** 商城连续多个一键安装成功时，合并为一次网关重启（毫秒） */
const SKILL_STORE_GATEWAY_RESTART_DEBOUNCE_MS = 2000

const TABS: { key: TabKey; label: string }[] = [
  // { key: 'recommended', label: '推荐技能' },
  { key: 'enabled', label: '已开启' },
  { key: 'all', label: '全部技能' },
  { key: 'store', label: '技能商城' },
  { key: 'local', label: '本地技能' },
]

function getKeyUrl(skill: SkillInfo): string | null {
  if (skill.homepage) return skill.homepage
  if (skill.primaryEnv && KEY_URLS[skill.primaryEnv]) return KEY_URLS[skill.primaryEnv]
  return null
}

function getSkillTags(skill: SkillInfo): string[] {
  const tags: string[] = []
  if (skill.requiresApiKey) {
    tags.push('需要 API Key')
  } else {
    tags.push('零配置')
  }
  if (skill.source === 'bundled') tags.push('内置')
  return tags
}

export function SkillSettings({ onBack }: SkillSettingsProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  // 当前 UI 未展示 recommended 标签，默认必须落在可见标签上
  const [tab, setTab] = useState<TabKey>('enabled')
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [installing, setInstalling] = useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = useState<Record<string, boolean>>({})
  /** 本地技能卡片右上角菜单：当前展开的技能 name */
  const [localSkillMenuOpen, setLocalSkillMenuOpen] = useState<string | null>(null)
  const [storeSkills, setStoreSkills] = useState<WebSkillItem[]>([])
  const [storeLoading, setStoreLoading] = useState(false)
  const [storePage, setStorePage] = useState(0)
  const [storeSize] = useState(24)
  const [storeTotal, setStoreTotal] = useState(0)
  const [storeDownloading, setStoreDownloading] = useState<Record<string, boolean>>({})
  const [storeInstalledMap, setStoreInstalledMap] = useState<Record<string, string>>({})
  const [storeRefreshTick, setStoreRefreshTick] = useState(0)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [skillToDelete, setSkillToDelete] = useState<SkillInfo | null>(null)
  const [showUnavailable, setShowUnavailable] = useState(false)
  const downloadBeforeNamesRef = useRef<Record<string, Set<string>>>({})
  const gatewayRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await window.electronAPI.skills.list()
        if (!cancelled) setSkills(list)
      } catch {
        if (!cancelled) setStatus({ type: 'error', message: '加载技能列表失败' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (tab !== 'store') return
    let cancelled = false
    setStoreLoading(true)
    ;(async () => {
      try {
        const result = await window.electronAPI.skills.fetchWebSkills({
          q: debouncedSearch || undefined,
          page: storePage,
          size: storeSize,
        })
        if (cancelled) return
        if (!result.ok || !result.data) {
          setStoreSkills([])
          setStoreTotal(0)
          setStatus({ type: 'error', message: result.error ?? '加载技能商城失败' })
          return
        }
        const mapped = (result.data.items as Array<Record<string, unknown>>).map((item) => ({
          id: Number(item.id ?? 0),
          slug: String(item.slug ?? ''),
          displayName: String(item.displayName ?? item.slug ?? ''),
          summary: String(item.summary ?? ''),
          status: String(item.status ?? ''),
          namespace: String(item.namespace ?? ''),
          downloadCount: Number(item.downloadCount ?? 0),
        }))
        setStoreSkills(mapped)
        setStoreTotal(Number(result.data.total ?? 0))
      } catch {
        if (!cancelled) {
          setStoreSkills([])
          setStoreTotal(0)
          setStatus({ type: 'error', message: '加载技能商城失败' })
        }
      } finally {
        if (!cancelled) setStoreLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [tab, debouncedSearch, storePage, storeSize, storeRefreshTick])

  const filtered = useMemo(() => {
    let list = skills
    // tab filter
    if (tab === 'enabled') {
      list = list.filter(s => s.enabled)
    } else if (tab === 'recommended') {
      const recSet = new Set(RECOMMENDED_SKILLS.map(n => n.toLowerCase()))
      list = list.filter(s => recSet.has(s.name.toLowerCase()))
    } else if (tab === 'local') {
      list = list.filter(s => s.source === 'local' || s.source === 'workspace')
    }
    // hide unavailable skills (blocked) unless showUnavailable is true
    if (!showUnavailable && tab === 'all') {
      list = list.filter(s => s.status !== 'blocked')
    }
    // search filter
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (SKILL_CN[s.name] ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [skills, tab, search, showUnavailable])

  useEffect(() => {
    setStorePage(0)
  }, [debouncedSearch])

  useEffect(() => {
    if (tab !== 'local') setLocalSkillMenuOpen(null)
  }, [tab])

  useEffect(() => {
    if (!skillToDelete) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSkillToDelete(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [skillToDelete])

  useEffect(() => {
    if (!localSkillMenuOpen) return
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-local-skill-menu-root="1"]')) return
      setLocalSkillMenuOpen(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [localSkillMenuOpen])

  const handleToggle = useCallback((name: string) => {
    setSkills(prev => prev.map(s =>
      s.name === name ? { ...s, enabled: !s.enabled } : s
    ))
    setStatus(null)
  }, [])

  const handleApiKeyChange = useCallback((name: string, value: string) => {
    setSkills(prev => prev.map(s =>
      s.name === name ? { ...s, apiKey: value } : s
    ))
    setStatus(null)
  }, [])

  const handleInstallDep = useCallback(async (skillName: string) => {
    setInstalling(prev => ({ ...prev, [skillName]: true }))
    setStatus(null)
    try {
      const check = await window.electronAPI.skills.canInstall(skillName)
      if (!check.canInstall) {
        setStatus({ type: 'error', message: check.reason ?? '无法自动安装' })
        return
      }
      setStatus({ type: 'success', message: `正在安装 ${skillName} 依赖...` })
      const result = await window.electronAPI.skills.installDep(skillName)
      if (result.ok) {
        setStatus({ type: 'success', message: `${skillName} 依赖安装成功，刷新中...` })
        // 重新扫描技能列表
        const list = await window.electronAPI.skills.list()
        setSkills(list)
      } else {
        setStatus({ type: 'error', message: result.error ?? '安装失败' })
      }
    } catch {
      setStatus({ type: 'error', message: '安装过程出错' })
    } finally {
      setInstalling(prev => ({ ...prev, [skillName]: false }))
    }
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setStatus(null)
    try {
      const config: Record<string, SkillEntryConfig> = {}
      skills.forEach(s => {
        config[s.name] = { enabled: s.enabled }
        if (s.apiKey) config[s.name].apiKey = s.apiKey
      })
      const result = await window.electronAPI.skills.saveConfig(config)
      if (result.ok) {
        setStatus({ type: 'success', message: '技能配置已保存，正在重启服务...' })
        await window.electronAPI.gateway.restart()
        onBack?.()
      } else {
        setStatus({ type: 'error', message: result.error ?? '保存失败' })
      }
    } catch {
      setStatus({ type: 'error', message: '保存技能配置时出错' })
    } finally {
      setSaving(false)
    }
  }, [skills, onBack])

  const handleOpenFolder = useCallback(async () => {
    try {
      const homedir = await window.electronAPI.setup.getHomedir()
      await window.electronAPI.shell.openPath(`${homedir}/.openclaw/skills`)
    } catch { /* ignore */ }
  }, [])

  const handleDeleteLocalSkill = useCallback(async (skill: SkillInfo) => {
    if (skill.source !== 'local' && skill.source !== 'workspace') return

    setDeleting(prev => ({ ...prev, [skill.name]: true }))
    setStatus(null)
    try {
      const result = await window.electronAPI.skills.deleteLocalSkill({ name: skill.name, source: skill.source })
      if (!result.ok) {
        setStatus({ type: 'error', message: result.error ?? `删除 ${skill.name} 失败` })
        return
      }
      const list = await window.electronAPI.skills.list()
      setSkills(list)
      setStatus({ type: 'success', message: `${skill.name} 已删除并同步更新配置` })
    } catch {
      setStatus({ type: 'error', message: `删除 ${skill.name} 失败` })
    } finally {
      setDeleting(prev => ({ ...prev, [skill.name]: false }))
    }
  }, [])

  const findInstalledSkill = useCallback((webSkill: WebSkillItem) => {
    const mapKey = `${webSkill.namespace}/${webSkill.slug}`
    const mappedName = storeInstalledMap[mapKey]
    if (mappedName) {
      const mapped = skills.find(s => s.name === mappedName)
      if (mapped) return mapped
    }
    const byDisplayName = skills.find(s => s.name === webSkill.displayName)
    if (byDisplayName) return byDisplayName
    return skills.find(s => s.name === webSkill.slug)
  }, [skills, storeInstalledMap])

  const refreshLocalSkills = useCallback(async () => {
    const list = await window.electronAPI.skills.list()
    setSkills(list)
    return list
  }, [])

  const handleDownloadWebSkill = useCallback(async (webSkill: WebSkillItem) => {
    const key = `${webSkill.namespace}/${webSkill.slug}`
    downloadBeforeNamesRef.current[key] = new Set(skills.map(s => s.name))
    setStoreDownloading(prev => ({ ...prev, [key]: true }))
    setStatus(null)
    try {
      const result = await window.electronAPI.skills.downloadWebSkill({
        namespace: webSkill.namespace,
        slug: webSkill.slug,
        displayName: webSkill.displayName,
      })
      if (!result.ok) {
        setStatus({ type: 'error', message: result.error ?? '安装失败' })
        setStoreDownloading(prev => ({ ...prev, [key]: false }))
        delete downloadBeforeNamesRef.current[key]
        return
      }
      setStatus({ type: 'success', message: `${webSkill.displayName} 已加入后台安装队列` })
    } catch {
      setStatus({ type: 'error', message: '一键安装失败' })
      setStoreDownloading(prev => ({ ...prev, [key]: false }))
      delete downloadBeforeNamesRef.current[key]
    }
  }, [skills])

  useEffect(() => {
    const dispose = window.electronAPI.skills.onWebDownloadStatus(async (event) => {
      const key = `${event.namespace}/${event.slug}`
      if (event.status === 'running') {
        setStoreDownloading(prev => ({ ...prev, [key]: true }))
        return
      }

      setStoreDownloading(prev => ({ ...prev, [key]: false }))
      if (event.status === 'error') {
        delete downloadBeforeNamesRef.current[key]
        setStatus({ type: 'error', message: event.error ?? `${event.slug} 安装失败` })
        return
      }

      let nextSkills = await refreshLocalSkills()
      const relatedWebSkill = storeSkills.find(s => `${s.namespace}/${s.slug}` === key)
      const beforeNames = downloadBeforeNamesRef.current[key] ?? new Set<string>()
      delete downloadBeforeNamesRef.current[key]

      const installedNamesFromEvent = Array.isArray(event.installedNames) ? event.installedNames : []
      let installedSkill = relatedWebSkill
        ? nextSkills.find(s => s.name === relatedWebSkill.displayName || s.name === relatedWebSkill.slug)
        : undefined
      if (!installedSkill && installedNamesFromEvent.length > 0) {
        installedSkill = nextSkills.find(s => installedNamesFromEvent.includes(s.name))
      }
      if (!installedSkill) {
        installedSkill = nextSkills.find(s => !beforeNames.has(s.name) && (s.source === 'local' || s.source === 'workspace'))
      }
      if (!installedSkill) {
        for (let i = 0; i < 4 && !installedSkill; i++) {
          await new Promise(resolve => setTimeout(resolve, 500))
          nextSkills = await refreshLocalSkills()
          installedSkill = relatedWebSkill
            ? nextSkills.find(s => s.name === relatedWebSkill.displayName || s.name === relatedWebSkill.slug)
            : undefined
          if (!installedSkill && installedNamesFromEvent.length > 0) {
            installedSkill = nextSkills.find(s => installedNamesFromEvent.includes(s.name))
          }
          if (!installedSkill) {
            installedSkill = nextSkills.find(s => !beforeNames.has(s.name) && (s.source === 'local' || s.source === 'workspace'))
          }
        }
      }
      setStoreRefreshTick(t => t + 1)
      const label = relatedWebSkill?.displayName ?? event.slug

      if (!installedSkill) {
        setStatus({ type: 'error', message: `${label} 已解压到技能文件夹，但未识别到可安装技能，请检查压缩包结构` })
        return
      }

      const installedName = installedSkill.name
      setStoreInstalledMap(prev => ({ ...prev, [key]: installedName }))
      if (!installedSkill.enabled) {
        const config: Record<string, SkillEntryConfig> = {}
        nextSkills.forEach(s => {
          config[s.name] = { enabled: s.name === installedName ? true : s.enabled }
          if (s.apiKey) config[s.name].apiKey = s.apiKey
        })
        const saveResult = await window.electronAPI.skills.saveConfig(config)
        if (!saveResult.ok) {
          setStatus({ type: 'error', message: saveResult.error ?? `${label} 配置保存失败，请稍后重试` })
          return
        }
        await refreshLocalSkills()
      }

      setStatus({ type: 'success', message: `${label} 一键安装成功` })

      if (gatewayRestartTimerRef.current) {
        clearTimeout(gatewayRestartTimerRef.current)
      }
      gatewayRestartTimerRef.current = setTimeout(async () => {
        gatewayRestartTimerRef.current = null
        try {
          await window.electronAPI.gateway.restart()
          setStatus({ type: 'success', message: '网关已重启，新技能在对话中已生效' })
        } catch {
          setStatus({
            type: 'error',
            message: '网关重启失败，请点击「应用新技能」或重启应用后再试',
          })
        }
      }, SKILL_STORE_GATEWAY_RESTART_DEBOUNCE_MS)
    })
    return () => {
      if (gatewayRestartTimerRef.current) {
        clearTimeout(gatewayRestartTimerRef.current)
        gatewayRestartTimerRef.current = null
        // 避免关闭面板时清掉定时器导致网关从未重启
        void window.electronAPI.gateway.restart().catch(() => {})
      }
      dispose()
    }
  }, [refreshLocalSkills, storeSkills])

  const statusLabel = (s: SkillInfo) => {
    switch (s.status) {
      case 'ready': return '就绪'
      case 'disabled': return '已禁用'
      case 'blocked': return '不可用'
      case 'missing': return s.missingReason ?? '缺失'
      default: return ''
    }
  }

  const statusClass = (s: SkillInfo) => {
    switch (s.status) {
      case 'ready': return 'skill-status-ready'
      case 'disabled': return 'skill-status-disabled'
      case 'blocked':
      case 'missing': return 'skill-status-blocked'
      default: return ''
    }
  }

  const panelContent = (
    <>
      <div className="settings-header">
        <h2>技能管理</h2>
        <div style={{ width: '32px' }}></div>
      </div>

      <div className="settings-body">
        <div className="skill-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`skill-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key === 'enabled' && (
                <span className="skill-tab-count">{skills.filter(s => s.enabled).length}</span>
              )}
              {t.key === 'local' && (
                <span className="skill-tab-count">{skills.filter(s => s.source === 'local' || s.source === 'workspace').length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="skill-search">
          <span className="skill-search-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="text"
            className="input-field"
            placeholder={tab === 'store' ? '搜索商城技能名称...' : '搜索技能名称或描述...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {tab === 'all' && (
            <label className="skill-checkbox-label">
              <input
                type="checkbox"
                checked={showUnavailable}
                onChange={e => setShowUnavailable(e.target.checked)}
                className="skill-checkbox"
              />
              <span>显示不可用</span>
            </label>
          )}
        </div>

        {/* grid */}
        <div key={tab} className="skill-list-scroll">
          {tab === 'store' ? (
            storeLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem 0', opacity: 0.6 }}>
                正在加载技能商城...
              </div>
            ) : storeSkills.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 0', opacity: 0.5 }}>
                {search ? '技能商城中没有匹配结果' : '技能商城暂无可用技能'}
              </div>
            ) : (
              <>
                <div className="skill-settings-grid">
                  {storeSkills.map((skill) => {
                    const installed = findInstalledSkill(skill)
                    const downloadKey = `${skill.namespace}/${skill.slug}`
                    const downloading = !!storeDownloading[downloadKey]
                    return (
                      <div
                        key={`store-${skill.namespace}-${skill.slug}`}
                        className={`skill-card${installed?.enabled ? ' skill-card-active' : ''}`}
                      >
                        <div className="skill-card-header">
                          <span className="skill-icon">🛒</span>
                          <div className="skill-info">
                            <span className="skill-name">{skill.displayName}</span>
                            <span className="skill-desc" title={skill.summary}>{skill.summary || '暂无描述'}</span>
                          </div>
                        </div>
                        <div className="skill-card-meta">
                          <span className={`skill-status-badge ${installed ? 'skill-status-ready' : 'skill-status-disabled'}`}>
                            {installed ? '已安装' : '未安装'}
                          </span>
                          <span className="skill-tag">下载 {skill.downloadCount}</span>
                          <div style={{ flex: 1 }} />
                          {installed ? (
                            <div
                              className={`skill-toggle${installed.enabled ? ' skill-toggle-on' : ''}`}
                              onClick={() => handleToggle(installed.name)}
                            >
                              <div className="skill-toggle-thumb" />
                            </div>
                          ) : (
                            <button
                              className="skill-install-btn"
                              disabled={downloading}
                              onClick={() => handleDownloadWebSkill(skill)}
                            >
                              {downloading ? '安装中...' : '一键安装'}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>
                    第 {storePage + 1} 页 / 共 {Math.max(1, Math.ceil(storeTotal / storeSize))} 页，共 {storeTotal} 项
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-secondary" disabled={storePage <= 0} onClick={() => setStorePage(p => Math.max(0, p - 1))}>
                      上一页
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={(storePage + 1) * storeSize >= storeTotal}
                      onClick={() => setStorePage(p => p + 1)}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </>
            )
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', opacity: 0.5 }}>
              {search ? '没有匹配的技能' : tab === 'enabled' ? '暂无已开启的技能' : tab === 'local' ? '暂无本地技能' : '暂无可用技能'}
            </div>
          ) : (
            <div className={`skill-settings-grid${tab === 'local' && localSkillMenuOpen ? ' skill-settings-grid-menu-open' : ''}`}>
              {filtered.map((skill) => {
                const showLocalMore = tab === 'local' && (skill.source === 'local' || skill.source === 'workspace')
                const menuOpen = localSkillMenuOpen === skill.name
                return (
                <div
                  key={`${tab}-${skill.name}`}
                  className={`skill-card${skill.enabled ? ' skill-card-active' : ''}${skill.status === 'blocked' || skill.status === 'missing' ? ' disabled' : ''}${menuOpen ? ' skill-card-menu-popover-open' : ''}`}
                >
                  <div className={`skill-card-header${showLocalMore ? ' skill-card-header-with-more' : ''}`}>
                    <span className="skill-icon">{skill.emoji || '🧩'}</span>
                    <div className="skill-info">
                      <span className="skill-name">{skill.name}</span>
                      <span className="skill-desc" title={SKILL_CN[skill.name] || skill.description}>{SKILL_CN[skill.name] || skill.description}</span>
                    </div>
                    {showLocalMore && (
                      <div className="skill-card-more-root" data-local-skill-menu-root="1">
                        <button
                          type="button"
                          className={`skill-card-more-btn${localSkillMenuOpen === skill.name ? ' skill-card-more-btn-active' : ''}`}
                          aria-expanded={localSkillMenuOpen === skill.name}
                          aria-haspopup="menu"
                          aria-label="更多操作"
                          onClick={(e) => {
                            e.stopPropagation()
                            setLocalSkillMenuOpen(prev => (prev === skill.name ? null : skill.name))
                          }}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>
                        {localSkillMenuOpen === skill.name && (
                          <div className="skill-card-more-dropdown" role="menu">
                            <button
                              type="button"
                              className="skill-card-more-item skill-card-more-item-danger"
                              role="menuitem"
                              disabled={deleting[skill.name]}
                              onClick={(e) => {
                                e.stopPropagation()
                                setLocalSkillMenuOpen(null)
                                setSkillToDelete(skill)
                              }}
                            >
                              {deleting[skill.name] ? '删除中...' : '删除技能'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="skill-card-meta">
                    <span className={`skill-status-badge ${statusClass(skill)}`}>
                      {statusLabel(skill)}
                    </span>
                    {skill.status === 'missing' && skill.missingReason?.startsWith('需安装') && (
                      <button
                        className="skill-install-btn"
                        disabled={installing[skill.name]}
                        onClick={e => { e.stopPropagation(); handleInstallDep(skill.name) }}
                      >
                        {installing[skill.name] ? '安装中...' : '一键安装'}
                      </button>
                    )}
                    {tab === 'recommended' && getSkillTags(skill).map(tag => (
                      <span key={tag} className={`skill-tag${tag === '需要 API Key' ? ' skill-tag-warn' : ''}`}>
                        {tag}
                      </span>
                    ))}
                    <div style={{ flex: 1 }} />
                    <div
                      className={`skill-toggle${skill.enabled ? ' skill-toggle-on' : ''}`}
                      onClick={() => handleToggle(skill.name)}
                    >
                      <div className="skill-toggle-thumb" />
                    </div>
                  </div>

                  {/* API Key section - 已开启时显示输入框 */}
                  {skill.enabled && skill.requiresApiKey && (
                    <div className="skill-card-actions">
                      <label className="skill-card-actions-label">
                        API Key {skill.primaryEnv && <span style={{ opacity: 0.5 }}>({skill.primaryEnv})</span>}
                      </label>
                      <div className="skill-card-actions-row">
                        <input
                          type="password"
                          className="input-field skill-apikey-input"
                          placeholder="输入 API Key..."
                          value={skill.apiKey ?? ''}
                          onChange={e => handleApiKeyChange(skill.name, e.target.value)}
                          onClick={e => e.stopPropagation()}
                        />
                        {getKeyUrl(skill) && (
                          <a
                            className="skill-key-link"
                            href="#"
                            onClick={e => { e.preventDefault(); window.electronAPI.shell.openExternal(getKeyUrl(skill)!) }}
                          >
                            获取 Key
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 推荐标签页 - 未开启时显示获取提示 */}
                  {tab === 'recommended' && !skill.enabled && skill.requiresApiKey && skill.primaryEnv && (
                    <div className="skill-card-keytip">
                      {KEY_TIPS[skill.primaryEnv] && (
                        <span className="skill-keytip-text">{KEY_TIPS[skill.primaryEnv]}</span>
                      )}
                      {getKeyUrl(skill) && (
                        <a
                          className="skill-key-link"
                          href="#"
                          onClick={e => { e.preventDefault(); window.electronAPI.shell.openExternal(getKeyUrl(skill)!) }}
                        >
                          前往获取 →
                        </a>
                      )}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          )}
        </div>

        {status && (
          <div style={{ padding: '0 28px' }}>
            <div className={`channel-settings-status ${status.type}`}>
              {status.message}
            </div>
          </div>
        )}
      </div>

      <div className="skill-settings-footer">
        <button className="btn-secondary" onClick={handleOpenFolder}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          打开技能文件夹
        </button>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '应用中...' : '✨ 应用新技能'}
        </button>
      </div>
      {skillToDelete && (
        <div className="session-delete-confirm-overlay">
          <div
            className="session-delete-confirm-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="session-delete-confirm-title">删除这个技能？</div>
            <div className="session-delete-confirm-desc">
              {`"${skillToDelete.name}" 将从本地技能列表中移除。`}
            </div>
            <div className="session-delete-confirm-actions">
              <button
                className="session-delete-cancel-btn"
                onClick={() => setSkillToDelete(null)}
              >
                取消
              </button>
              <button
                className="session-delete-confirm-btn"
                disabled={deleting[skillToDelete.name]}
                onClick={async () => {
                  await handleDeleteLocalSkill(skillToDelete)
                  setSkillToDelete(null)
                }}
              >
                {deleting[skillToDelete.name] ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  return (
    <div className="page-panel">
      {loading ? (
        <>
          <div className="settings-header">
            <h2>技能管理</h2>
            <button className="settings-close" onClick={() => onBack?.()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="settings-body">
            <div className="skill-loading-container">
              <div className="skill-loading-bar" />
              <span className="skill-loading-text">正在扫描技能目录...</span>
            </div>
          </div>
        </>
      ) : panelContent}
    </div>
  )
}
