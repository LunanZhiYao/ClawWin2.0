import React, { useState, useEffect, useCallback } from 'react'
import { MODEL_PROVIDERS } from '../../hooks/useSetup'
import type { ModelProvider, ModelInfo } from '../../types'
import { CustomSelect } from '../Common/CustomSelect'

interface ModelSettingsProps {
  currentProvider?: string
  currentModel?: string
  onClose: () => void
  onSaved: () => void
}

export const ModelSettings: React.FC<ModelSettingsProps> = ({
  currentProvider,
  currentModel,
  onClose,
  onSaved,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<string>(currentProvider ?? '')
  const [selectedModel, setSelectedModel] = useState<string>(currentModel ?? '')
  const [apiKey, setApiKey] = useState<string>('')
  const [validating, setValidating] = useState(false)
  const [validateResult, setValidateResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; error?: string } | null>(null)

  // Custom model state
  const [customUrl, setCustomUrl] = useState('')
  const [customModelId, setCustomModelId] = useState('')
  const [customModelName, setCustomModelName] = useState('')
  const [customFormat, setCustomFormat] = useState('openai-completions')
  const [isCustom, setIsCustom] = useState(false)

  // 回填自定义模型配置
  useEffect(() => {
    if (currentProvider !== 'custom') return
    let cancelled = false

    window.electronAPI.config.readConfig().then((config) => {
      if (cancelled || !config) return
      const models = (config as Record<string, unknown>).models as Record<string, unknown> | undefined
      const providers = models?.providers as Record<string, Record<string, unknown>> | undefined
      const customProvider = providers?.custom
      if (!customProvider) return

      setIsCustom(true)
      setSelectedProvider('custom')
      if (customProvider.baseUrl) setCustomUrl(customProvider.baseUrl as string)
      if (customProvider.api) setCustomFormat(customProvider.api as string)

      const modelList = customProvider.models as Array<{ id?: string; name?: string }> | undefined
      const model = modelList?.[0]
      if (model) {
        setCustomModelId(model.id ?? '')
        setCustomModelName(model.name ?? '')
        setSelectedModel(model.id ?? '')
      }
    }).catch(() => {})

    return () => { cancelled = true }
  }, [currentProvider])

  const getProviderById = useCallback(
    (id: string): ModelProvider | undefined => {
      if (id === 'custom' && isCustom) {
        return {
          id: 'custom',
          name: '自定义',
          baseUrl: customUrl.trim().replace(/\/+$/, ''),
          apiFormat: customFormat,
          models: [{
            id: customModelId.trim(),
            name: customModelName.trim() || customModelId.trim(),
            reasoning: false,
            contextWindow: 262000,
            maxTokens: 131000,
          }],
        }
      }
      return MODEL_PROVIDERS.find((p) => p.id === id)
    },
    [isCustom, customUrl, customFormat, customModelId, customModelName]
  )

  const getModelById = useCallback(
    (providerId: string, modelId: string): ModelInfo | undefined => {
      const provider = getProviderById(providerId)
      return provider?.models.find((m) => m.id === modelId)
    },
    [getProviderById]
  )

  const selectedProviderObj = getProviderById(selectedProvider)
  const selectedModelObj = getModelById(selectedProvider, selectedModel)

  const currentProviderObj = getProviderById(currentProvider ?? '')
  const currentModelObj = getModelById(currentProvider ?? '', currentModel ?? '')

  const handleValidate = useCallback(async () => {
    if (!apiKey.trim() || !selectedProviderObj || !selectedModel) return

    setValidating(true)
    setValidateResult(null)

    try {
      const result = await window.electronAPI.setup.validateApiKey({
        baseUrl: selectedProviderObj.baseUrl,
        apiFormat: selectedProviderObj.apiFormat,
        apiKey: apiKey.trim(),
        modelId: selectedModel,
      })
      setValidateResult(result)
    } catch (err) {
      setValidateResult({ ok: false, error: '验证过程发生异常' })
    } finally {
      setValidating(false)
    }
  }, [apiKey, selectedProviderObj, selectedModel])

  const handleSave = useCallback(async () => {
    if (!selectedProviderObj || !selectedModelObj || !apiKey.trim()) return

    setSaving(true)
    setSaveResult(null)

    try {
      const result = await window.electronAPI.config.saveModelConfig({
        provider: selectedProviderObj.id,
        modelId: selectedModelObj.id,
        modelName: selectedModelObj.name,
        baseUrl: selectedProviderObj.baseUrl,
        apiFormat: selectedProviderObj.apiFormat,
        apiKey: apiKey.trim(),
        reasoning: selectedModelObj.reasoning,
        contextWindow: selectedModelObj.contextWindow,
        maxTokens: selectedModelObj.maxTokens,
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
  }, [selectedProviderObj, selectedModelObj, apiKey, onSaved])

  const canSave = selectedProvider && selectedModel && apiKey.trim()

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
              {currentProviderObj
                ? `${currentProviderObj.name} / ${currentModelObj?.name ?? currentModel ?? '未选择'}`
                : '未配置'}
            </div>
          </div>

          {/* Provider card grid with inline model sub-list */}
          <div className="model-settings-provider-grid">
            {/* Custom provider card */}
            <div className={`model-settings-provider-card${isCustom ? ' selected' : ''}`}>
              <div
                className="model-settings-provider-header"
                onClick={() => {
                  setSelectedProvider('custom')
                  setSelectedModel('')
                  setIsCustom(true)
                  setValidateResult(null)
                  setSaveResult(null)
                }}
              >
                <span className="model-settings-provider-name">自定义</span>
                <span className="provider-tag tag-custom">自定义 API</span>
              </div>
              {isCustom && (
                <div className="model-settings-model-list custom-fields">
                  <input
                    type="text"
                    placeholder="API 地址，如 https://api.example.com/v1"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    className="input-field"
                  />
                  <input
                    type="text"
                    placeholder="模型 ID，如 gpt-4o"
                    value={customModelId}
                    onChange={(e) => setCustomModelId(e.target.value)}
                    className="input-field"
                  />
                  <input
                    type="text"
                    placeholder="显示名称（可选）"
                    value={customModelName}
                    onChange={(e) => setCustomModelName(e.target.value)}
                    className="input-field"
                  />
                  <CustomSelect
                    value={customFormat}
                    onChange={(val) => setCustomFormat(val)}
                    options={[
                      { value: 'openai-completions', label: 'OpenAI 兼容' },
                      { value: 'openai-responses', label: 'OpenAI 响应 (Dify 专用)' },
                      { value: 'anthropic-messages', label: 'Anthropic 格式' },
                    ]}
                    className="custom-format-select"
                  />
                  <button
                    className="btn-primary btn-custom-confirm"
                    onClick={() => {
                      if (!customUrl.trim() || !customModelId.trim()) return
                      setSelectedProvider('custom')
                      setSelectedModel(customModelId.trim())
                    }}
                    disabled={!customUrl.trim() || !customModelId.trim()}
                  >
                    确认选择
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Fixed footer: API Key + Save */}
        <div className="model-settings-footer">
          {selectedProvider && selectedProvider !== 'clawwinweb' && selectedModel ? (
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
            <div className="model-settings-footer-hint">请选择一个厂商和模型</div>
          )}
        </div>
      </div>
    </div>
  )
}
