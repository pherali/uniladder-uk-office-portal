import { CheckCircle2, Clock3 } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthPage() {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setMessage(null)
    setLoading(true)

    try {
      if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { username: username.trim() } },
        })
        if (error) throw error

        if (!data.session) {
          setMessage({ type: 'success', text: 'Account created. Check your email to confirm your account, then sign in.' })
          setMode('login')
          setPassword('')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="auth-brand"><Clock3 size={21} /> Uniladder UK Office Portal</div>
        <div>
          <p className="eyebrow">Simple payroll clarity</p>
          <h1>Hours, wages and monthly pay — in one calm workspace.</h1>
          <p className="auth-lead">Track employee shifts, see what is owed, and email a clear month-end report without spreadsheets.</p>
        </div>
        <div className="auth-points">
          <span><CheckCircle2 size={18} /> Private manager accounts</span>
          <span><CheckCircle2 size={18} /> Secure cloud data</span>
          <span><CheckCircle2 size={18} /> Automatic monthly reports</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="segmented-control" aria-label="Choose login or registration">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setMessage(null) }} type="button">Log in</button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setMessage(null) }} type="button">Register</button>
          </div>

          <div className="auth-card-heading">
            <h2>{mode === 'login' ? 'Welcome back' : 'Create manager account'}</h2>
            <p>{mode === 'login' ? 'Sign in to access your employee records.' : 'Set up your private office workspace.'}</p>
          </div>

          <form className="form-stack" onSubmit={submit}>
            {mode === 'register' && (
              <label>
                Username
                <input value={username} onChange={(event) => setUsername(event.target.value)} minLength={2} maxLength={50} required autoFocus />
              </label>
            )}
            <label>
              Email address
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required autoFocus={mode === 'login'} />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required />
            </label>

            {message && <div className={`notice ${message.type}`}>{message.text}</div>}

            <button className="button primary full-width" type="submit" disabled={loading}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>
          <p className="auth-footnote">Passwords are handled securely by Supabase Auth and are never stored by this app.</p>
        </div>
      </section>
    </main>
  )
}
