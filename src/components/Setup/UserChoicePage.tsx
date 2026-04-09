import React from 'react'

interface UserChoicePageProps {
  onClawWin: () => void
  onCustom: () => void
  onSkip: () => void
}

export const UserChoicePage: React.FC<UserChoicePageProps> = ({ onCustom, onSkip }) => {
  return (
    <div className="setup-page welcome-page">
      <h1 className="setup-title">欢迎使用 OpenClaw</h1>
      <p className="setup-subtitle">选择使用方式</p>

      <div className="setup-features">
        <div className="feature-item choice-card" onClick={onCustom}>
          <span className="feature-icon">&#128295;</span>
          <div>
            <strong>自配 API Key</strong>
            <p>我已有厂商大模型 API Key，直接配置使用</p>
          </div>
          <span className="choice-arrow">&#8250;</span>
        </div>
        <div className="feature-item choice-card" onClick={onSkip}>
          <span className="feature-icon">&#9203;</span>
          <div>
            <strong>之后再配置</strong>
            <p>跳过模型配置，先体验界面，稍后在设置中配置</p>
          </div>
          <span className="choice-arrow">&#8250;</span>
        </div>
      </div>
    </div>
  )
}
