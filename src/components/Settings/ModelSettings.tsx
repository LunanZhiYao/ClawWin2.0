import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { MODEL_PROVIDERS } from '../../hooks/useSetup'
import type { ModelProvider, ModelInfo } from '../../types'
import { CustomSelect } from '../Common/CustomSelect'

interface ModelSettingsProps {
  currentProvider?: string
  currentModel?: string
  /** 来自 openclaw.json 的别名，用于厂商不在预设列表或自定义模型时的展示 */
  currentModelName?: string
  onClose: () => void
  onSaved: () => void
}

/**
 * 汇总「默认模型」展示文案：优先用预设表中的友好名称；否则用磁盘上的 provider/model，避免误判为未配置。
 */
function formatDefaultModelSummary(params: {
  currentProvider?: string
  currentModel?: string
  currentModelName?: string
  getProviderById: (id: string) => ModelProvider | undefined
  getModelById: (providerId: string, modelId: string) => ModelInfo | undefined
}): string {
  const { currentProvider, currentModel, currentModelName, getProviderById, getModelById } = params
  const pid = currentProvider?.trim() ?? ''
  const mid = currentModel?.trim() ?? ''
  if (!pid && !mid) return '未配置'

  const builtIn = getProviderById(pid)
  if (builtIn) {
    const m = getModelById(pid, mid)
    const modelLabel = (m?.name ?? currentModelName ?? mid) || '未选择'
    return `${builtIn.name} / ${modelLabel}`
  }

  // 约定 id 为 custom 时展示「自定义」，与其它任意字符串区分
  if (pid === 'custom') {
    const modelLabel = (currentModelName ?? mid) || '未选择'
    return `自定义 / ${modelLabel}`
  }

  // 磁盘 primary 中的厂商 id 可能不在 MODEL_PROVIDERS（外部工具写入、网关扩展等）
  const modelLabel = (currentModelName ?? mid) || '未选择'
  return `${pid} / ${modelLabel}`
}

export const ModelSettings: React.FC<ModelSettingsProps> = ({
  currentProvider,
  currentModel,
  currentModelName,
  onClose,
  onSaved,
}) => {
  // 提供商标识：对应 openclaw 中 models.providers 的键与 auth 的 profile 后缀（厂商:default）；须非空，默认预填 custom
  const [providerIdInput, setProviderIdInput] = useState(() => currentProvider?.trim() || 'custom')
  const [customUrl, setCustomUrl] = useState('')
  const [customModelId, setCustomModelId] = useState('')
  const [customModelName, setCustomModelName] = useState('')
  const [customFormat, setCustomFormat] = useState('openai-completions')
  const [apiKey, setApiKey] = useState<string>('')
  const [validating, setValidating] = useState(false)
  const [validateResult, setValidateResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; error?: string } | null>(null)

  // 顶部「默认模型」摘要仅对照预设表解析友好名；与下方表单解耦
  const resolvePresetProvider = useCallback(
    (id: string) => MODEL_PROVIDERS.find((p) => p.id === id),
    [],
  )
  const resolvePresetModel = useCallback(
    (providerId: string, modelId: string): ModelInfo | undefined =>
      resolvePresetProvider(providerId)?.models.find((m) => m.id === modelId),
    [resolvePresetProvider],
  )

  // 从磁盘按当前默认 primary 的厂商键回填表单（任意厂商 id，不再写死 custom）
  useEffect(() => {
    let cancelled = false
    const diskPid = currentProvider?.trim() || 'custom'

    window.electronAPI.config.readConfig().then((config) => {
      if (cancelled || !config) return
      setProviderIdInput(diskPid)

      const modelsRoot = (config as Record<string, unknown>).models as Record<string, unknown> | undefined
      const providers = modelsRoot?.providers as Record<string, Record<string, unknown>> | undefined
      const prov = providers?.[diskPid]
      if (!prov) {
        setCustomUrl('')
        setCustomFormat('openai-completions')
        setCustomModelId(currentModel?.trim() ?? '')
        setCustomModelName(currentModelName?.trim() ?? '')
        return
      }
      if (typeof prov.baseUrl === 'string') setCustomUrl(prov.baseUrl)
      if (typeof prov.api === 'string') setCustomFormat(prov.api)

      const modelList = prov.models as Array<{ id?: string; name?: string }> | undefined
      const mid = currentModel?.trim()
      const hit = mid ? modelList?.find((m) => m.id === mid) : undefined
      const pick = hit ?? modelList?.[0]
      if (pick) {
        setCustomModelId(pick.id ?? '')
        setCustomModelName((pick.name as string | undefined)?.trim() || '')
      } else {
        setCustomModelId(mid ?? '')
        setCustomModelName(currentModelName?.trim() ?? '')
      }
    }).catch(() => {})

    return () => { cancelled = true }
  }, [currentProvider, currentModel, currentModelName])

  /** 由表单拼出的厂商对象，供验证/保存；与 MODEL_PROVIDERS 无强制关联 */
  const endpointProvider = useMemo((): ModelProvider | undefined => {
    // 提供商标识须显式填写（界面默认预填 custom），留空则不启用验证/保存
    const id = providerIdInput.trim()
    const mid = customModelId.trim()
    const url = customUrl.trim().replace(/\/+$/, '')
    if (!id || !url || !mid) return undefined
    return {
      id,
      name: id,
      baseUrl: url,
      apiFormat: customFormat,
      models: [{
        id: mid,
        name: customModelName.trim() || mid,
        reasoning: false,
        contextWindow: 262000,
        maxTokens: 131000,
      }],
    }
  }, [providerIdInput, customUrl, customFormat, customModelId, customModelName])
  const endpointModel = endpointProvider?.models[0]

  const defaultModelSummary = formatDefaultModelSummary({
    currentProvider,
    currentModel,
    currentModelName,
    getProviderById: resolvePresetProvider,
    getModelById: resolvePresetModel,
  })

  const handleValidate = useCallback(async () => {
    if (!apiKey.trim() || !endpointProvider || !endpointModel) return

    setValidating(true)
    setValidateResult(null)

    try {
      const result = await window.electronAPI.setup.validateApiKey({
        baseUrl: endpointProvider.baseUrl,
        apiFormat: endpointProvider.apiFormat,
        apiKey: apiKey.trim(),
        modelId: endpointModel.id,
      })
      setValidateResult(result)
    } catch (err) {
      setValidateResult({ ok: false, error: '验证过程发生异常' })
    } finally {
      setValidating(false)
    }
  }, [apiKey, endpointProvider, endpointModel])

  const handleSave = useCallback(async () => {
    if (!endpointProvider || !endpointModel || !apiKey.trim()) return

    setSaving(true)
    setSaveResult(null)

    try {
      const result = await window.electronAPI.config.saveModelConfig({
        provider: endpointProvider.id,
        modelId: endpointModel.id,
        modelName: endpointModel.name,
        baseUrl: endpointProvider.baseUrl,
        apiFormat: endpointProvider.apiFormat,
        apiKey: apiKey.trim(),
        reasoning: endpointModel.reasoning,
        contextWindow: endpointModel.contextWindow,
        maxTokens: endpointModel.maxTokens,
      })

      setSaveResult(result)

      if (result.ok) {
        onSaved()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSaveResult({ ok: false, error: `保存失败：${message}` })
    } finally {
      setSaving(false)
    }
  }, [endpointProvider, endpointModel, apiKey, onSaved])

  const canSave = !!(endpointProvider && endpointModel && apiKey.trim())

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel-wide" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div className="model-settings-tabs">
            <button className="model-settings-tab active">
              云端模型
            </button>
          </div>
          <button className="settings-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="model-settings-body">
          {/* Current model display */}
          <div className="model-settings-current">
            <div className="model-settings-current-label">默认模型</div>
            <div className="model-settings-current-value">
              {defaultModelSummary}
            </div>
          </div>

          {/* 端点表单常驻展示，不提供点击展开/收起 */}
          <div className="model-settings-provider-grid">
            <div className="model-settings-endpoint-panel">
              <div className="model-settings-endpoint-panel-header">
                <span className="model-settings-provider-name">兼容 API 端点</span>
                <span className="provider-tag tag-custom">OpenAI / Anthropic 等</span>
              </div>
              <div className="model-settings-model-list custom-fields model-settings-endpoint-fields">
                <label className="model-settings-field-label" htmlFor="model-settings-provider-id">
                  提供商标识
                </label>
                <input
                  id="model-settings-provider-id"
                  type="text"
                  className="input-field"
                  placeholder="必填：4~9 位可辨识英文字符，如 myopenai"
                  value={providerIdInput}
                  onChange={(e) => {
                    setProviderIdInput(e.target.value)
                    setValidateResult(null)
                    setSaveResult(null)
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
                <ul className="model-settings-hint-list" aria-label="提供商标识说明">
                  <li>请使用 4~9 位可辨识英文字符。</li>
                  <li>同一提供商标识下可登记多个模型，它们共用同一套 API Key。</li>
                  <li>若多套服务端点密钥不同，请使用不同的提供商标识分别保存，以免后一次保存覆盖先前的密钥。</li>
                </ul>
                <input
                  type="text"
                  placeholder="API 地址，如 https://api.example.com/v1"
                  value={customUrl}
                  onChange={(e) => {
                    setCustomUrl(e.target.value)
                    setValidateResult(null)
                    setSaveResult(null)
                  }}
                  className="input-field"
                />
                <input
                  type="text"
                  placeholder="模型 ID，如 gpt-4o"
                  value={customModelId}
                  onChange={(e) => {
                    setCustomModelId(e.target.value)
                    setValidateResult(null)
                    setSaveResult(null)
                  }}
                  className="input-field"
                />
                <input
                  type="text"
                  placeholder="显示名称（可选）"
                  value={customModelName}
                  onChange={(e) => {
                    setCustomModelName(e.target.value)
                    setValidateResult(null)
                    setSaveResult(null)
                  }}
                  className="input-field"
                />
                <CustomSelect
                  value={customFormat}
                  onChange={(val) => {
                    setCustomFormat(val)
                    setValidateResult(null)
                    setSaveResult(null)
                  }}
                  options={[
                    { value: 'openai-completions', label: 'OpenAI 兼容' },
                    { value: 'anthropic-messages', label: 'Anthropic 格式' },
                    { value: 'openai-responses', label: 'OpenAI 响应' },
                  ]}
                  className="custom-format-select"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Fixed footer: API Key + Save */}
        <div className="model-settings-footer">
          {endpointProvider && endpointModel ? (
            <>
              <div className="model-settings-apikey-row">
                <input
                  type="password"
                  className="input-field"
                  placeholder="请输入 API Key"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    setValidateResult(null)
                    setSaveResult(null)
                  }}
                />
                <button
                  className="btn-test"
                  onClick={handleValidate}
                  disabled={!apiKey.trim() || validating}
                >
                  {validating ? '验证中...' : '验证'}
                </button>
                <button
                  className="btn-primary"
                  onClick={handleSave}
                  disabled={!canSave || saving}
                >
                  {saving ? '保存中...' : '保存并应用'}
                </button>
              </div>
              {validateResult?.ok && (
                <div className="model-settings-status success">API Key 验证通过！</div>
              )}
              {validateResult && !validateResult.ok && (
                <div className="model-settings-status error">
                  {validateResult.error || '连接失败，请检查 API Key 是否正确'}
                </div>
              )}
              {saveResult?.ok && (
                <div className="model-settings-status success">配置已保存，正在重启网关...</div>
              )}
              {saveResult && !saveResult.ok && (
                <div className="model-settings-status error">
                  {saveResult.error || '保存失败，请重试'}
                </div>
              )}
            </>
          ) : (
            <div className="model-settings-footer-hint">
              请填写提供商标识、API 地址与模型 ID 后再输入密钥并保存
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
