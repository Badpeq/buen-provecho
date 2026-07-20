import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Session() {
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const at = params.get('at')
    const rt = params.get('rt')

    if (at && rt) {
      supabase.auth.setSession({ access_token: at, refresh_token: rt })
        .then(() => navigate('/', { replace: true }))
    } else {
      navigate('/', { replace: true })
    }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-3 border-[var(--color-brand)] border-t-transparent animate-spin" />
        <p className="text-sm text-gray-400">Iniciando sesión…</p>
      </div>
    </div>
  )
}
