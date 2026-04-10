import { logout as logoutAPI } from '../../api/auth'

interface LoginStatusProps {
  user: any
  onLogout: () => void
}

export function LoginStatus({ user, onLogout }: LoginStatusProps) {
  const handleLogout = () => {
    logoutAPI()
    onLogout()
  }

  return (
    <div className="login-status">
      <div className="user-info">
        {user.avatar ? (
          <img src={user.avatar} alt="用户头像" className="user-avatar" />
        ) : (
          <div className="user-avatar-placeholder">
            {(user.name || 'U').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="user-details">
          <p className="user-name">{user.name}</p>
        </div>
      </div>
      
      <button className="logout-btn" onClick={handleLogout}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        退出
      </button>
    </div>
  )
}
