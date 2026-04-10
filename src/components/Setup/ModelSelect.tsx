import React, { useState } from 'react'
import type { ModelProvider, ModelInfo } from '../../types'
import { CustomSelect } from '../Common/CustomSelect'

interface ModelSelectProps {
  providers: ModelProvider[]
  selectedProvider: string | undefined
  selectedModel: string | undefined
  onSelect: (provider: ModelProvider, model: ModelInfo) => void
  onBack: () => void
  onNext: () => void
  onSkip?: () => void
}

export const ModelSelect: React.FC<ModelSelectProps> = ({
  selectedProvider,
  selectedModel,
  onSelect,
  onBack,
  onNext,
  onSkip,
}) => {
  const [expandedProvider, setExpandedProvider] = useState<string | null>(selectedProvider ?? null)
  const [customUrl, setCustomUrl] = useState('')
  const [customModelId, setCustomModelId] = useState('')
  const [customModelName, setCustomModelName] = useState('')
  const [customFormat, setCustomFormat] = useState('openai-completions')
  const [customSelected, setCustomSelected] = useState(false)

  const handleCustomConfirm = () => {
    if (!customUrl.trim() || !customModelId.trim()) return
    const name = customModelName.trim() || customModelId.trim()
    const customProvider: ModelProvider = {
      id: 'custom',
      name: '自定义',
      baseUrl: customUrl.trim().replace(/\/+$/, ''),
      apiFormat: customFormat,
      models: [{
        id: customModelId.trim(),
        name,
        reasoning: false,
        contextWindow: 262000,
        maxTokens: 131000,
      }],
    }
    setCustomSelected(true)
    onSelect(customProvider, customProvider.models[0])
  }

  const isCustomExpanded = expandedProvider === 'custom'

  return (
    <div className="setup-page model-select-page">
      <h2 className="setup-title">选择 AI 模型</h2>
      <p className="setup-subtitle">选择一个 AI 服务提供商和模型</p>

      <div className="provider-list">
        {/* Custom provider - 放在第一个 */}
        <div
          className={`provider-card${isCustomExpanded ? ' expanded' : ''}${customSelected ? ' selected' : ''}`}
          style={{ animationDelay: '0s' }}
        >
          <div
            className="provider-header"
            onClick={() => {
              setExpandedProvider((prev) => (prev === 'custom' ? null : 'custom'))
            }}
          >
            <span className="provider-name">自定义</span>
            <div className="provider-header-right">
              <span className="provider-tag tag-custom">自定义 API</span>
              <span className={`provider-chevron${isCustomExpanded ? ' open' : ''}`}>▸</span>
            </div>
          </div>
          {isCustomExpanded && (
            <div className="model-list custom-model-fields">
              <input
                type="text"
                placeholder="API 地址，如 https://api.example.com/v1"
                value={customUrl}
                onChange={(e) => { setCustomUrl(e.target.value); setCustomSelected(false) }}
                className="input-field"
              />
              <input
                type="text"
                placeholder="模型 ID，如 gpt-4o"
                value={customModelId}
                onChange={(e) => { setCustomModelId(e.target.value); setCustomSelected(false) }}
                className="input-field"
              />
              <input
                type="text"
                placeholder="显示名称（可选）"
                value={customModelName}
                onChange={(e) => setCustomModelName(e.target.value)}
                className="input-field"
              />
              <div className="custom-format-row">
                <CustomSelect
                  value={customFormat}
                  onChange={(val) => setCustomFormat(val)}
                  options={[
                    { value: 'openai-completions', label: 'OpenAI 兼容' },
                    { value: 'anthropic-messages', label: 'Anthropic 格式' },
                  ]}
                  className="custom-format-select"
                />
                <button
                  className="btn-primary btn-custom-confirm"
                  onClick={handleCustomConfirm}
                  disabled={!customUrl.trim() || !customModelId.trim()}
                >
                  {customSelected ? '已选择' : '确认选择'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="setup-actions">
        <button className="btn-secondary" onClick={onBack}>上一步</button>
        {onSkip && <button className="btn-secondary" onClick={onSkip}>跳过</button>}
        <button
          className="btn-primary"
          onClick={onNext}
          disabled={!selectedProvider || !selectedModel}
        >
          下一步
        </button>
      </div>
    </div>
  )
}
