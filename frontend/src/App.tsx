import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useAuth }          from './hooks/useAuth'
import AppShell             from './components/layout/AppShell'
import Login                from './pages/Login'
import Hoy                  from './pages/Hoy'
import Planificacion        from './pages/Planificacion'
import Compras              from './pages/Compras'
import Configuracion        from './pages/Configuracion'
import Recetas              from './pages/Recetas'
import Session              from './pages/Session'
import { ToastContainer }   from './components/ui/Toast'

function AuthGate() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-3 border-[var(--color-brand)] border-t-transparent animate-spin" />
          <p className="text-sm text-gray-400">Verificando sesión…</p>
        </div>
      </div>
    )
  }

  if (!session) {
    // Ruta especial de sesión directa — accesible sin auth
    if (window.location.pathname === '/session') return <Session />
    return <Login />
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index                element={<Hoy />} />
        <Route path="planificacion" element={<Planificacion />} />
        <Route path="compras"       element={<Compras />} />
        <Route path="recetas"       element={<Recetas />} />
        <Route path="configuracion" element={<Configuracion />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastContainer />
      <AuthGate />
    </BrowserRouter>
  )
}
