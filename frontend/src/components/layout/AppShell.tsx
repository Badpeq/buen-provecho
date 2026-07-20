import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/',              label: 'Hoy',          icon: '🍽️' },
  { to: '/planificacion', label: 'Planificación', icon: '📅' },
  { to: '/compras',       label: 'Compras',       icon: '🛒' },
  { to: '/recetas',       label: 'Recetas',       icon: '📖' },
  { to: '/configuracion', label: 'Config',        icon: '⚙️' },
]

export default function AppShell() {
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

      {/* Barra de navegación inferior (estilo móvil) */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg border-t border-gray-200 bg-white flex justify-around py-2">
        {NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-xs transition-colors ${
                isActive
                  ? 'text-[var(--color-brand)] font-semibold'
                  : 'text-gray-500'
              }`
            }
          >
            <span className="text-xl">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
