import { Clock3, History, LayoutDashboard, LogOut } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Layout() {
  const { profile, user, signOut } = useAuth()

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Go to dashboard">
          <span className="brand-mark"><Clock3 size={19} /></span>
          <span>
            <strong>Uniladder</strong>
            <small>UK Office Portal</small>
          </span>
        </NavLink>

        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/" end>
            <LayoutDashboard size={17} /> Dashboard
          </NavLink>
          <NavLink to="/history">
            <History size={17} /> History
          </NavLink>
        </nav>

        <div className="account-area">
          <div className="account-copy">
            <strong>{profile?.username || 'Manager'}</strong>
            <span>{user?.email}</span>
          </div>
          <button className="icon-button" type="button" onClick={signOut} aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="page-container">
        <Outlet />
      </main>
    </div>
  )
}
