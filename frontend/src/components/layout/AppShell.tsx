import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'

const MAIN_NAV = [
  { to: '/planificacion', label: 'Semana',  icon: '📅', end: false },
  { to: '/',              label: 'Hoy',     icon: '🍽️', end: true  },
  { to: '/compras',       label: 'Compras', icon: '🛒', end: false },
]

const MORE_NAV = [
  { to: '/recetas',       label: 'Recetas',       icon: '📖' },
  { to: '/configuracion', label: 'Configuración', icon: '⚙️' },
]

export default function AppShell() {
  const [showMore, setShowMore] = useState(false)
  const navigate  = useNavigate()
  const location  = useLocation()

  // Cerrar el popover en cada navegación
  useEffect(() => { setShowMore(false) }, [location.pathname])

  const isMoreActive = MORE_NAV.some(n => location.pathname === n.to)

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto bg-white shadow-sm">
      {/* Cabecera */}
      <header className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 bg-[var(--color-brand)] text-white">
        <span className="text-xl font-bold tracking-tight">Buen Provecho</span>
      </header>

      {/* Contenido de la ruta */}
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      {/* Overlay para cerrar el menú al tocar fuera */}
      {showMore && (
        <div className="fixed inset-0 z-30" onClick={() => setShowMore(false)} />
      )}

      {/* Popover "Más" */}
      {showMore && (
        <div className="fixed z-40 bottom-[61px] left-1/2 -translate-x-1/2 w-full max-w-lg pointer-events-none">
          <div className="pointer-events-auto absolute right-2 bottom-0 bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden w-44">
            {MORE_NAV.map(({ to, label, icon }) => (
              <button
                key={to}
                onClick={() => navigate(to)}
                className={`flex items-center gap-3 w-full px-4 py-3.5 text-sm text-left transition-colors hover:bg-gray-50 ${
                  location.pathname === to
                    ? 'text-[var(--color-brand)] font-semibold bg-[var(--color-brand-pale)]'
                    : 'text-gray-700'
                }`}
              >
                <span className="text-base">{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Barra de navegación inferior */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg border-t border-gray-200 bg-white flex justify-around py-2 z-40">
        {MAIN_NAV.map(({ to, label, icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-xs transition-colors ${
                isActive ? 'text-[var(--color-brand)] font-semibold' : 'text-gray-500'
              }`
            }
          >
            <span className="text-xl">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}

        {/* Botón Más */}
        <button
          onClick={() => setShowMore(s => !s)}
          className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-xs transition-colors ${
            showMore || isMoreActive ? 'text-[var(--color-brand)] font-semibold' : 'text-gray-500'
          }`}
        >
          <span className="text-xl">⋯</span>
          <span>Más</span>
        </button>
      </nav>
    </div>
  )
}
