import { Banknote, BarChart3, BookOpen, CalendarDays, CalendarRange, ChevronDown, Clock, FileText, LayoutDashboard, LogOut, Menu, Moon, Package, Settings, Shield, ShoppingBag, ShoppingCart, Sun, UserRound, Users, X } from 'lucide-react'
import * as React from 'react'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { useTheme } from '@/hooks/use-theme'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LoadingSquare } from '@/components/loading-square'
import { CommandPalette } from '@/components/command-palette'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'

const Pdv = React.lazy(() => import('@/pages/Pdv').then((m) => ({ default: m.Pdv })))
const Inventario = React.lazy(() => import('@/pages/Inventario').then((m) => ({ default: m.Inventario })))
const Configuracion = React.lazy(() => import('@/pages/Configuracion').then((m) => ({ default: m.Configuracion })))
const Turnos = React.lazy(() => import('@/pages/Turnos').then((m) => ({ default: m.Turnos })))
const Reportes = React.lazy(() => import('@/pages/Reportes').then((m) => ({ default: m.Reportes })))
const Usuarios = React.lazy(() => import('@/pages/Usuarios').then((m) => ({ default: m.Usuarios })))
const Clientes = React.lazy(() => import('@/pages/Clientes').then((m) => ({ default: m.Clientes })))
const ReporteTurnos = React.lazy(() => import('@/pages/ReporteTurnos').then((m) => ({ default: m.ReporteTurnos })))
const ArqueoCaja = React.lazy(() => import('@/pages/ArqueoCaja').then((m) => ({ default: m.ArqueoCaja })))
const Compras = React.lazy(() => import('@/pages/Compras').then((m) => ({ default: m.Compras })))
const Kardex = React.lazy(() => import('@/pages/Kardex').then((m) => ({ default: m.Kardex })))
const ReporteFechas = React.lazy(() => import('@/pages/ReporteFechas').then((m) => ({ default: m.ReporteFechas })))
const Analisis = React.lazy(() => import('@/pages/Analisis').then((m) => ({ default: m.Analisis })))
const ReporteSire = React.lazy(() => import('@/pages/ReporteSire').then((m) => ({ default: m.ReporteSire })))
const VentasPorEmpleado = React.lazy(() => import('@/pages/VentasPorEmpleado').then((m) => ({ default: m.VentasPorEmpleado })))
const Egresos = React.lazy(() => import('@/pages/Egresos'))
const Auditoria = React.lazy(() => import('@/pages/Auditoria'))
const AuditoriaCaja = React.lazy(() => import('@/pages/AuditoriaCaja'))

type NavItem = { id: string; label: string; icon: any; perm: string; always?: boolean }

const MENU: { titulo: string; items: NavItem[] }[] = [
  {
    titulo: 'Operación',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard' },
      { id: 'pdv', label: 'Punto de Venta', icon: ShoppingCart, perm: 'ventas' },
      { id: 'turnos', label: 'Turnos', icon: Clock, perm: 'turnos' },
      { id: 'inventario', label: 'Inventario', icon: Package, perm: 'inventario' },
    ],
  },
  {
    titulo: 'Reportes',
    items: [
      { id: 'reportes', label: 'Facturación', icon: BarChart3, perm: 'reportes' },
      { id: 'reporteTurnos', label: 'Por Turnos', icon: CalendarRange, perm: 'reporteTurnos' },
      { id: 'reporteFechas', label: 'Por Fechas', icon: CalendarDays, perm: 'reporteFechas' },
      { id: 'arqueoCaja', label: 'Arqueo de Caja', icon: Banknote, perm: 'arqueoCaja' },
      { id: 'analisis', label: 'Estadísticas', icon: BarChart3, perm: 'estadisticas' },
      { id: 'compras', label: 'Compras por Fecha', icon: ShoppingBag, perm: 'compras' },
      { id: 'kardex', label: 'Kardex por Producto', icon: BookOpen, perm: 'kardex' },
      { id: 'sire', label: 'Registro SIRE', icon: FileText, perm: 'sire' },
      { id: 'ventasPorEmpleado', label: 'Ventas por Empleado', icon: Users, perm: 'ventasPorEmpleado' },
      { id: 'egresos', label: 'Egresos / Gastos', icon: Banknote, perm: 'egresos' },
    ],
  },
  { titulo: 'Clientes', items: [{ id: 'clientes', label: 'Clientes', icon: UserRound, perm: 'clientes' }] },
  {
    titulo: 'Administración',
    items: [
      { id: 'usuarios', label: 'Usuarios', icon: Users, perm: 'usuarios' },
      { id: 'configuracion', label: 'Configuración', icon: Settings, perm: 'configuracion' },
      { id: 'auditoria', label: 'Auditoría General', icon: Shield, perm: 'auditoria' },
      { id: 'auditoriaCaja', label: 'Auditoría de Caja', icon: Banknote, perm: 'auditoria' },
    ],
  },
]

const TODOS_ITEMS = MENU.flatMap((g) => g.items)
const labelDe = (id: string) => TODOS_ITEMS.find((i) => i.id === id)?.label

function Shell() {
  const { user, loading, logout } = useAuth()
  const { nombre: nombrePerfil, tienePermiso, loading: permisosLoading } = usePermisos()
  const { theme, toggle } = useTheme()
  const [seccion, setSeccion] = React.useState<string | null>(null)
  const [abiertas, setAbiertas] = React.useState<Record<string, boolean>>({ Operación: true, Reportes: true })
  const [toast, setToast] = React.useState<string | null>(null)
  const [menuAbierto, setMenuAbierto] = React.useState(false)
  const [infoAbierto, setInfoAbierto] = React.useState(false)
  const [desvaneciendo, setDesvaneciendo] = React.useState(false)

  const handleLogout = React.useCallback(() => {
    setDesvaneciendo(true)
    setTimeout(() => logout(), 700)
  }, [logout])

  React.useEffect(() => {
    if (!user) setDesvaneciendo(false)
  }, [user])

  const toggleSeccion = (titulo: string) => setAbiertas((prev) => ({ ...prev, [titulo]: !prev[titulo] }))

  const primeraSeccionPermitida = React.useMemo(() => {
    for (const g of MENU) {
      for (const it of g.items) {
        if (it.always || tienePermiso(it.perm)) return it.id
      }
    }
    return 'pdv'
  }, [tienePermiso])

  React.useEffect(() => {
    if (seccion === null) {
      setSeccion(primeraSeccionPermitida)
      return
    }
    const item = TODOS_ITEMS.find((i) => i.id === seccion)
    if (item && !item.always && !tienePermiso(item.perm)) {
      setSeccion(primeraSeccionPermitida)
    }
  }, [seccion, tienePermiso, primeraSeccionPermitida])

  React.useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  // Cierre de sesión por inactividad: si no hay actividad (mouse/teclado/touch)
  // durante N minutos, se hace logout y vuelve a pedir login.
  React.useEffect(() => {
    if (!user) return
    const IDLE_MIN = 15
    let timer: ReturnType<typeof setTimeout> | null = null
    const reset = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => logout(), IDLE_MIN * 60 * 1000)
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click', 'wheel'] as const
    events.forEach((e) => window.addEventListener(e, reset))
    reset()
    return () => {
      if (timer) clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [user, logout])

  if (loading || permisosLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <LoadingSquare />
          <p className="mt-2 text-sm">Cargando sesión…</p>
        </div>
      </div>
    )
  }

  if (!user) return <Login />

  const nombre = nombrePerfil || user.displayName || user.email?.split('@')[0] || 'Usuario'
  const inicial = nombre.charAt(0).toUpperCase()

  return (
    <div className={cn(
      "flex h-screen flex-col bg-app bg-background transition-all duration-700 ease-in-out",
      desvaneciendo && "opacity-0 scale-95 blur-sm pointer-events-none"
    )}>
      <div className="mx-auto flex min-h-0 flex-1 w-full max-w-[1440px]">
        {/* Sidebar (desktop) */}
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex">
          <div className="brand-grad flex flex-col items-center gap-1 px-5 py-6 text-white">
            <img src="/jorfel.png" alt="AppADM" className="h-16 w-16 rounded-2xl bg-white/90 p-1 object-contain shadow-card" />
            <div className="text-lg font-extrabold tracking-tight">AppADM</div>
            <div className="text-[11px] font-medium text-white/80">Punto de Venta</div>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
            {MENU.map((g) => {
              const items = g.items.filter((it) => it.always || tienePermiso(it.perm))
              if (items.length === 0) return null
              const abierta = abiertas[g.titulo]
              return (
                <div key={g.titulo}>
                  <button
                    onClick={() => toggleSeccion(g.titulo)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <span>{g.titulo}</span>
                    <ChevronDown className={cn('h-4 w-4 transition-transform', abierta && 'rotate-180')} />
                  </button>
                  {abierta && (
                    <div className="space-y-1 pb-1">
                      {items.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setSeccion(item.id)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all cursor-pointer',
                            seccion === item.id ? 'brand-grad text-white shadow-glow' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          )}
                        >
                          <item.icon className="h-[18px] w-[18px]" />
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          <div className="border-t p-3">
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-muted p-2.5 shadow-soft">
              <div className="brand-grad flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white">
                {inicial}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{nombre}</div>
                <div className="text-[11px] text-muted-foreground">{user.email}</div>
              </div>
            </div>
            <Button variant="outline" className="w-full" onClick={handleLogout}>
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </Button>
          </div>
        </aside>

        {/* Contenido */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/60 glass px-4 md:px-6">
            <div className="flex items-center gap-2 md:hidden">
              <img src="/jorfel.png" alt="AppADM" className="h-8 w-8 rounded-lg object-contain" />
            </div>
            <h1 className="text-lg font-extrabold tracking-tight">
              {labelDe(seccion ?? '') ?? 'AppADM'}
            </h1>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setInfoAbierto(true)} className="hidden items-center gap-2 rounded-full border border-emerald-200/60 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-100 cursor-pointer md:flex dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> CiberSoft
              </button>
              <Button variant="ghost" size="icon" onClick={toggle} aria-label="Cambiar tema">
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
              <div className="brand-grad flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white md:hidden">
                {inicial}
              </div>
              <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuAbierto(true)} aria-label="Menú">
                <Menu className="h-5 w-5" />
              </Button>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            {seccion === null ? (
              <LoadingSquare />
            ) : (
              <React.Suspense fallback={<LoadingSquare />}>
                <div key={seccion} className="animate-slide-up">
                  {seccion === 'dashboard' ? (
                    <Dashboard onNavigate={setSeccion} />
                  ) : seccion === 'pdv' ? (
                    <Pdv />
                  ) : seccion === 'turnos' ? (
                    <Turnos />
                  ) : seccion === 'inventario' ? (
                    <Inventario />
                  ) : seccion === 'reportes' ? (
                    <Reportes />
                  ) : seccion === 'reporteTurnos' ? (
                    <ReporteTurnos />
                  ) : seccion === 'reporteFechas' ? (
                    <ReporteFechas />
                  ) : seccion === 'arqueoCaja' ? (
                    <ArqueoCaja />
                  ) : seccion === 'analisis' ? (
                    <Analisis />
                  ) : seccion === 'compras' ? (
                    <Compras />
                  ) : seccion === 'kardex' ? (
                    <Kardex />
                  ) : seccion === 'sire' ? (
                    <ReporteSire />
                  ) : seccion === 'ventasPorEmpleado' ? (
                    <VentasPorEmpleado />
                  ) : seccion === 'egresos' ? (
                    <Egresos />
                  ) : seccion === 'clientes' ? (
                    <Clientes />
                  ) : seccion === 'usuarios' ? (
                    <Usuarios />
                  ) : seccion === 'configuracion' ? (
                    <Configuracion />
                  ) : seccion === 'auditoria' ? (
                    <Auditoria />
                  ) : seccion === 'auditoriaCaja' ? (
                    <AuditoriaCaja />
                  ) : (
                    <div className="py-20 text-center text-muted-foreground">🚧 En construcción</div>
                  )}
                </div>
              </React.Suspense>
            )}
          </main>
        </div>
      </div>

      {/* Drawer móvil */}
      {menuAbierto && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuAbierto(false)} />
          <div className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto bg-card shadow-xl">
            <div className="brand-grad flex items-center justify-between px-4 py-4 text-white">
              <div className="flex items-center gap-2">
                <img src="/jorfel.png" alt="AppADM" className="h-9 w-9 rounded-xl bg-white/90 p-1 object-contain" />
                <div>
                  <div className="text-base font-extrabold leading-tight">AppADM</div>
                  <div className="text-[10px] text-white/80">Punto de Venta</div>
                </div>
              </div>
              <button onClick={() => setMenuAbierto(false)} className="text-white/80 hover:text-white cursor-pointer" aria-label="Cerrar menú"><X className="h-5 w-5" /></button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {MENU.map((g) => {
                const items = g.items.filter((it) => it.always || tienePermiso(it.perm))
                if (items.length === 0) return null
                const abierta = abiertas[g.titulo]
                return (
                  <div key={g.titulo}>
                    <button
                      onClick={() => setAbiertas((p) => ({ ...p, [g.titulo]: !p[g.titulo] }))}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <span>{g.titulo}</span>
                      <ChevronDown className={cn('h-4 w-4 transition-transform', abierta && 'rotate-180')} />
                    </button>
                    {abierta && (
                      <div className="space-y-1 pb-1">
                        {items.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => { setSeccion(item.id); setMenuAbierto(false) }}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold transition-all cursor-pointer',
                              seccion === item.id ? 'brand-grad text-white shadow-glow' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                          >
                            <item.icon className="h-[18px] w-[18px]" />
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </nav>

            <div className="border-t p-3">
              <div className="mb-2 flex items-center gap-2 rounded-xl bg-muted p-2.5 shadow-soft">
                <div className="brand-grad flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white">{inicial}</div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{nombre}</div>
                  <div className="text-[11px] text-muted-foreground">{user.email}</div>
                </div>
              </div>
              <Button variant="outline" className="w-full" onClick={handleLogout}><LogOut className="h-4 w-4" /> Cerrar sesión</Button>
            </div>
          </div>
        </div>
      )}

      {/* Información de la app / creador */}
      {infoAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-cyan-400/40 p-8 text-center shadow-[0_0_45px_rgba(34,211,238,0.3)]"
            style={{ backgroundImage: 'url(/bg.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            <div className="pointer-events-none absolute inset-0 bg-slate-950/55" />
            <button onClick={() => setInfoAbierto(false)} className="absolute right-3 top-3 z-10 text-cyan-200/80 hover:text-white cursor-pointer" aria-label="Cerrar"><X className="h-5 w-5" /></button>
            <div className="relative z-10">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/60 bg-black/40 shadow-[0_0_22px_rgba(34,211,238,0.5)]">
                <img src="/jorfel.png" alt="AppADM" className="h-11 w-11 rounded-xl bg-white/90 p-1 object-contain" />
              </div>
              <h2 className="text-2xl font-extrabold tracking-[0.3em] text-white" style={{ textShadow: '0 0 14px rgba(34,211,238,0.8)' }}>CIBERSOFT CyS</h2>
              <p className="mt-1 font-mono text-lg font-bold text-emerald-300" style={{ textShadow: '0 0 10px rgba(52,211,153,0.6)' }}>AppADM</p>
              <div className="mt-5 space-y-1.5 font-mono text-sm text-white/85">
                <p>Desarrollado por: <span className="font-bold text-white">Johan F. Reyna Avalos</span></p>
                <p>📱 +51 910615790</p>
                <p>📧 jreyna2874@gmail.com</p>
              </div>
              <p className="mt-5 text-[11px] uppercase tracking-[0.25em] text-cyan-300/80">Sistema de Punto de Venta y Gestión</p>
              <Button className="brand-grad mt-5 w-full font-bold text-white" onClick={() => setInfoAbierto(false)}>CERRAR</Button>
            </div>
          </div>
        </div>
      )}

      {/* Footer siempre visible */}
      <footer className="flex h-11 shrink-0 items-center justify-center border-t border-border/60 glass px-4 text-center text-xs text-muted-foreground">
        © CIBERSOFT CyS - {new Date().getFullYear()}
      </footer>

      {/* Toast */}
      <div className={cn('pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transition-opacity', toast ? 'opacity-100' : 'opacity-0')}>
        <div className="rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-white shadow-lg">{toast}</div>
      </div>

      <CommandPalette onNavigate={setSeccion} tienePermiso={tienePermiso} />
    </div>
  )
}

export default Shell
