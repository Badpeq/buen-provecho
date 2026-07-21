import { useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { useAuth }          from './hooks/useAuth'
import { useFamilyStore }   from './store/familyStore'
import { limaDateDow, limaToday, LIMA_TZ } from './lib/date'
import AppShell             from './components/layout/AppShell'
import Login                from './pages/Login'
import Hoy                  from './pages/Hoy'
import Planificacion        from './pages/Planificacion'
import Compras              from './pages/Compras'
import Configuracion        from './pages/Configuracion'
import Recetas              from './pages/Recetas'
import Session              from './pages/Session'
import { ToastContainer }   from './components/ui/Toast'

/** Devuelve "DD mmm" del próximo martes en hora Lima */
function nextTuesdayLabel(): string {
  const today = new Date(limaToday() + 'T12:00:00')
  const daysUntilTue = (2 - today.getDay() + 7) % 7 || 7
  today.setDate(today.getDate() + daysUntilTue)
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric', month: 'short', timeZone: LIMA_TZ,
  }).format(today)
}

/**
 * Devuelve la week_start_date que debería tener un plan activo hoy.
 * En planning_dow: la semana que EMPIEZA ese ciclo (próximo weekStartDow).
 * Otros días: la semana en curso.
 */
function expectedPlanWeekStart(weekStartDow: number, planningDow: number): string {
  const today = new Date(limaToday() + 'T12:00:00')
  const dow   = today.getDay()
  const d     = new Date(today)
  if (dow === planningDow) {
    // Día de planificación: apuntamos a la próxima semana
    d.setDate(today.getDate() + ((weekStartDow - dow + 7) % 7 || 7))
  } else {
    // Resto de días: semana actual
    d.setDate(today.getDate() - ((dow - weekStartDow + 7) % 7))
  }
  return d.toISOString().slice(0, 10)
}

/** Ruta índice contextual: redirige a Planificación si es día de planificación o no hay plan vigente */
function ContextualIndex() {
  const { currentFamily, activePlan } = useFamilyStore()
  const navigate   = useNavigate()
  const redirected = useRef(false)

  useEffect(() => {
    if (redirected.current || !currentFamily) return
    redirected.current = true

    const todayDow  = limaDateDow()
    const isPlanDay = todayDow === currentFamily.planning_dow
    const expected  = expectedPlanWeekStart(currentFamily.week_start_dow, currentFamily.planning_dow)
    const hasNoPlan = !activePlan || activePlan.week_start_date < expected

    if (isPlanDay || hasNoPlan) {
      navigate('/planificacion', {
        replace: true,
        state: { banner: `Tu semana del martes ${nextTuesdayLabel()} está sin planificar` },
      })
    }
  }, [currentFamily, activePlan])

  return <Hoy />
}

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
    if (window.location.pathname === '/session') return <Session />
    return <Login />
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index                element={<ContextualIndex />} />
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
