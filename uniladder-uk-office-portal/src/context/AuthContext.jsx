import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function hydrateProfile(nextSession) {
      if (!nextSession?.user) {
        if (active) setProfile(null)
        return
      }

      const { data } = await supabase
        .from('manager_profiles')
        .select('username')
        .eq('id', nextSession.user.id)
        .maybeSingle()

      if (active) {
        setProfile({
          username:
            data?.username ||
            nextSession.user.user_metadata?.username ||
            nextSession.user.email?.split('@')[0] ||
            'Manager',
        })
      }
    }

    supabase.auth.getSession().then(async ({ data: { session: initialSession } }) => {
      if (!active) return
      setSession(initialSession)
      await hydrateProfile(initialSession)
      if (active) setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      hydrateProfile(nextSession).finally(() => setLoading(false))
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signOut: () => supabase.auth.signOut(),
    }),
    [session, profile, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
