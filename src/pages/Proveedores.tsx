import { Download, Loader2, Plus, Search, Truck, X, BarChart3, TrendingUp, LayoutDashboard, Star } from 'lucide-react'
import * as React from 'react'
import { usePermisos } from '@/context/permisos'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { cargarProveedores, buscarProveedores, type Proveedor } from '@/services/proveedores'
import { ProveedorDetalle } from './ProveedorDetalle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { exportarExcel } from '@/lib/excel'
import { ComprasPorProveedor } from '@/components/reportes/ComprasPorProveedor'
import { EvolucionPrecios } from '@/components/reportes/EvolucionPrecios'
import { DashboardProveedores } from '@/components/reportes/DashboardProveedores'
import { RankingConfiabilidad } from '@/components/reportes/RankingConfiabilidad'

const AVATAR_COLORS = ['#0891B2', '#059669', '#7C3AED', '#D97706', '#DC2626', '#4F46E5', '#0D9488', '#DB2777']
const getInitials = (name?: string) => {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}
const getAvatarColor = (name?: string) => {
  if (!name) return AVATAR_COLORS[0]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

type Vista = { tipo: 'lista' } | { tipo: 'detalle'; id?: string; nuevo?: boolean }
type Tab = 'lista' | 'dashboard' | 'compras' | 'precios' | 'ranking'

export function Proveedores() {
  const { tienePermiso } = usePermisos()
  const [vista, setVista] = React.useState<Vista>({ tipo: 'lista' })
  const [tab, setTab] = React.useState<Tab>('lista')

  if (!tienePermiso('proveedores')) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <Truck className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No tenés acceso al módulo de Proveedores</p>
        <p className="text-xs">Pedí el permiso «proveedores» al administrador.</p>
      </div>
    )
  }

  if (vista.tipo === 'detalle') {
    return <ProveedorDetalle clave={vista.id} nuevo={vista.nuevo} onBack={() => setVista({ tipo: 'lista' })} />
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-muted p-1 text-xs">
        {([
          ['lista', 'Lista', Truck],
          ['dashboard', 'Dashboard', LayoutDashboard],
          ['compras', 'Compras', BarChart3],
          ['precios', 'Precios', TrendingUp],
          ['ranking', 'Ranking', Star],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-bold cursor-pointer transition-all ${tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'lista' && <Lista onAbrir={(id) => setVista({ tipo: 'detalle', id })} onNuevo={() => setVista({ tipo: 'detalle', nuevo: true })} />}
      {tab === 'dashboard' && <DashboardProveedores />}
      {tab === 'compras' && <ComprasPorProveedor />}
      {tab === 'precios' && <EvolucionPrecios />}
      {tab === 'ranking' && <RankingConfiabilidad />}
    </div>
  )
}

function Lista({ onAbrir, onNuevo }: { onAbrir: (id: string) => void; onNuevo: () => void }) {
  const { config: cfg } = useConfiguracion()
  const [busqueda, setBusqueda] = React.useState('')
  const [proveedores, setProveedores] = React.useState<Proveedor[]>([])
  const [cargando, setCargando] = React.useState(false)
  const [soloInactivos, setSoloInactivos] = React.useState(false)

  React.useEffect(() => {
    if (busqueda.trim().length < 1) {
      setProveedores([])
      return
    }
    setCargando(true)
    const t = setTimeout(async () => {
      let results = await buscarProveedores(busqueda)
      if (soloInactivos) results = results.filter((p) => p.activo === false)
      else results = results.filter((p) => p.activo !== false)
      setProveedores(results)
      setCargando(false)
    }, 300)
    return () => clearTimeout(t)
  }, [busqueda, soloInactivos])

  async function cargarTodos() {
    setCargando(true)
    const todos = await cargarProveedores()
    const filtrados = soloInactivos ? todos.filter((p) => p.activo === false) : todos.filter((p) => p.activo !== false)
    setProveedores(filtrados)
    setCargando(false)
  }

  async function exportarExcelProveedores() {
    if (proveedores.length === 0) return
    const headers = ['Tipo Doc', 'N° Documento', 'Nombre', 'Dirección', 'Teléfono', 'Email', 'Estado']
    const rows = proveedores.map((p) => [
      p.tipoDocumento ?? '',
      p.documento ?? '',
      p.nombre ?? '',
      p.direccion ?? '',
      p.telefono ?? '',
      p.correo ?? '',
      p.activo !== false ? 'Activo' : 'Inactivo',
    ])
    await exportarExcel([{ name: 'Proveedores', headers, rows }], `Proveedores_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`, { empresa: cfg?.nombre || 'JorFel', titulo: 'Registro de Proveedores' })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-extrabold">Proveedores</h1>
        <div className="ml-auto flex gap-2">
          {proveedores.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportarExcelProveedores}><Download className="h-4 w-4" /> Excel</Button>
          )}
          <Button variant="outline" size="sm" onClick={cargarTodos} disabled={cargando}>
            {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Todos
          </Button>
          <Button onClick={onNuevo}><Plus className="h-4 w-4" /> Nuevo</Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por nombre o RUC/DNI…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="pl-10" />
          {busqueda && (
            <button onClick={() => setBusqueda('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Limpiar">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={soloInactivos}
            onChange={(e) => setSoloInactivos(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 accent-orange-500"
          />
          <span className="whitespace-nowrap text-muted-foreground">Inactivos</span>
        </label>
      </div>

      {cargando && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
        </div>
      )}

      {!cargando && busqueda.trim().length < 1 && (
        <div className="py-16 text-center text-muted-foreground">
          <Truck className="mx-auto mb-2 h-9 w-9 text-muted-foreground/40" />
          <p className="text-sm font-medium">Buscar proveedores</p>
          <p className="text-xs text-muted-foreground/70">Escribí un nombre o RUC/DNI para buscar</p>
        </div>
      )}

      {!cargando && busqueda.trim().length >= 1 && proveedores.length === 0 && (
        <div className="py-16 text-center text-muted-foreground">
          <Search className="mx-auto mb-2 h-9 w-9 text-muted-foreground/40" />
          <p className="text-sm font-medium">Sin resultados</p>
          <p className="text-xs text-muted-foreground/70">No encontramos proveedores con ese criterio</p>
        </div>
      )}

      <div className="space-y-2.5">
        {proveedores.map((item) => (
          <ProveedorRow key={item.id} item={item} onAbrir={onAbrir} />
        ))}
      </div>
    </div>
  )
}

function ProveedorRow({ item, onAbrir }: { item: Proveedor; onAbrir: (id: string) => void }) {
  const avatarColor = getAvatarColor(item.nombre)
  const activo = item.activo !== false

  return (
    <button onClick={() => onAbrir(item.id || '')} className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3.5 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lg cursor-pointer">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: avatarColor + '18' }}>
        <span className="text-sm font-bold" style={{ color: avatarColor }}>{getInitials(item.nombre)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-bold">{item.nombre || 'Sin nombre'}</span>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${activo ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'}`}>
            {activo ? 'Activo' : 'Inactivo'}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">{item.tipoDocumento}: {item.documento}</div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{item.direccion || 'Sin dirección'}</span>
          {item.telefono && <span className="shrink-0 text-[11px] text-muted-foreground">📱 {item.telefono}</span>}
        </div>
      </div>
    </button>
  )
}
