import { Loader2, DollarSign, AlertTriangle, ShoppingCart, Package } from 'lucide-react'
import * as React from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { cargarProveedores, type Proveedor } from '@/services/proveedores'
import { useProductos } from '@/hooks/use-productos'

const fmt = (n: number) => 'S/ ' + (Number(n) || 0).toFixed(2)

type Periodo = 'mes' | 'trimestre' | 'anio' | 'todo'

function filtrarPorPeriodo(fecha: string, periodo: Periodo): boolean {
  if (periodo === 'todo') return true
  const d = new Date(fecha)
  if (isNaN(d.getTime())) return false
  const ahora = new Date()
  if (periodo === 'mes') {
    return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear()
  }
  if (periodo === 'trimestre') {
    const inicio = new Date(ahora)
    inicio.setMonth(inicio.getMonth() - 3, 1)
    inicio.setHours(0, 0, 0, 0)
    return d >= inicio
  }
  if (periodo === 'anio') {
    return d.getFullYear() === ahora.getFullYear()
  }
  return true
}

type ProveedorStats = {
  id: string
  nombre: string
  totalGastado: number
  numCompras: number
  saldoPendiente: number
}

type CompraBruta = { provId: string; provNombre: string; fecha: string; totalPagado: number }

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ')
}

function calcularStats(provs: Proveedor[], todasLasCompras: CompraBruta[], per: Periodo): ProveedorStats[] {
  const comprasFiltradas = per === 'todo' ? todasLasCompras : todasLasCompras.filter((c) => filtrarPorPeriodo(c.fecha, per))

  const nombreMap = new Map(provs.map((p) => [p.id, p.nombre]))
  const idMap = new Map<string, ProveedorStats>()
  const nombreIdx = new Map<string, ProveedorStats>()

  for (const p of provs) {
    if (!p.id) continue
    const st: ProveedorStats = { id: p.id, nombre: p.nombre, totalGastado: 0, numCompras: 0, saldoPendiente: p.saldoPendiente || 0 }
    idMap.set(p.id, st)
    nombreIdx.set(norm(p.nombre), st)
  }

  for (const compra of comprasFiltradas) {
    const provId = compra.provId || ''
    const provNombre = compra.provNombre || nombreMap.get(provId) || provId || 'Sin proveedor'
    let st = (provId && idMap.get(provId)) || (provNombre && nombreIdx.get(norm(provNombre))) || null
    if (!st) {
      const key = provId || norm(provNombre) || 'sin_proveedor'
      st = { id: key, nombre: provNombre || 'Sin proveedor', totalGastado: 0, numCompras: 0, saldoPendiente: 0 }
      idMap.set(key, st)
    }
    st.totalGastado += compra.totalPagado
    st.numCompras++
  }

  return [...idMap.values()].sort((a, b) => b.totalGastado - a.totalGastado)
}

export function DashboardProveedores() {
  const [proveedores, setProveedores] = React.useState<Proveedor[]>([])
  const [todasLasCompras, setTodasLasCompras] = React.useState<CompraBruta[]>([])
  const [stats, setStats] = React.useState<ProveedorStats[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [periodo, setPeriodo] = React.useState<Periodo>('mes')
  const { productos } = useProductos()

  React.useEffect(() => {
    Promise.all([
      cargarProveedores(),
      cargarTodasLasCompras(),
    ]).then(([provs, compras]) => {
      setProveedores(provs)
      setTodasLasCompras(compras)
      setStats(calcularStats(provs, compras, 'mes'))
    }).finally(() => setCargando(false))
  }, [])

  React.useEffect(() => {
    if (proveedores.length === 0 || todasLasCompras.length === 0) return
    setStats(calcularStats(proveedores, todasLasCompras, periodo))
  }, [periodo, proveedores, todasLasCompras])

  async function cargarTodasLasCompras(): Promise<CompraBruta[]> {
    const q = query(collection(db, COL.MOVIMIENTOS), where('tipoMovimiento', '==', 'compra'), orderBy('fecha', 'desc'))
    const qEg = query(collection(db, COL.EGRESOS), where('categoria', '==', 'Compras'))
    const [snap, snapEg] = await Promise.all([getDocs(q), getDocs(qEg)])

    const comprasMap: Record<string, CompraBruta> = {}
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>
      const meta = (data.metadata || {}) as Record<string, unknown>
      const compraId = (meta.compraId as string) || d.id
      if (!comprasMap[compraId]) {
        comprasMap[compraId] = {
          provId: (meta.proveedorId as string) || '',
          provNombre: (meta.proveedor as string) || '',
          fecha: (data.fecha as string) || '',
          totalPagado: (meta.totalPagado as number) || 0,
        }
      }
    }

    const todas: CompraBruta[] = Object.values(comprasMap)
    for (const d of snapEg.docs) {
      const data = d.data() as Record<string, unknown>
      todas.push({
        provId: (data.proveedorId as string) || '',
        provNombre: (data.proveedorNombre as string) || '',
        fecha: (data.fecha as string) || '',
        totalPagado: (data.monto as number) || 0,
      })
    }
    return todas
  }

  const totalGastado = stats.reduce((s, r) => s + r.totalGastado, 0)
  const totalDeuda = stats.reduce((s, r) => s + r.saldoPendiente, 0)
  const proveedoresConDeuda = stats.filter((s) => s.saldoPendiente > 0)

  const productosConStockBajo = React.useMemo(() => {
    return productos.filter((p) => p.activo !== false && (p.minStock ?? 0) > 0 && (p.stock ?? 0) <= (p.minStock ?? 0))
  }, [productos])

  const top5 = stats.filter((s) => s.totalGastado > 0).slice(0, 5)

  if (cargando) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-5">
      {/* Filtro período */}
      <div className="flex gap-1 rounded-xl bg-muted p-1 text-xs w-fit">
        {(['mes', 'trimestre', 'anio', 'todo'] as Periodo[]).map((p) => (
          <button key={p} onClick={() => setPeriodo(p)} className={`rounded-lg px-3 py-1.5 font-bold cursor-pointer ${periodo === p ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>
            {p === 'mes' ? 'Mes' : p === 'trimestre' ? '3 meses' : p === 'anio' ? 'Año' : 'Todo'}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            <span className="text-xs font-bold">Total compras</span>
          </div>
          <p className="mt-1 text-2xl font-extrabold">{fmt(totalGastado)}</p>
          <p className="text-[11px] text-muted-foreground">{stats.filter((s) => s.totalGastado > 0).length} proveedor{stats.filter((s) => s.totalGastado > 0).length !== 1 ? 'es' : ''}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-xs font-bold">Deuda total</span>
          </div>
          <p className={`mt-1 text-2xl font-extrabold ${totalDeuda > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmt(totalDeuda)}</p>
          <p className="text-[11px] text-muted-foreground">{proveedoresConDeuda.length} con deuda</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Package className="h-4 w-4" />
            <span className="text-xs font-bold">Stock bajo</span>
          </div>
          <p className={`mt-1 text-2xl font-extrabold ${productosConStockBajo.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{productosConStockBajo.length}</p>
          <p className="text-[11px] text-muted-foreground">productos bajo mínimo</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShoppingCart className="h-4 w-4" />
            <span className="text-xs font-bold">Total proveedores</span>
          </div>
          <p className="mt-1 text-2xl font-extrabold">{proveedores.length}</p>
          <p className="text-[11px] text-muted-foreground">{proveedores.filter((p) => p.activo !== false).length} activos</p>
        </div>
      </div>

      {/* Top 5 */}
      <div>
        <h3 className="mb-2 text-sm font-extrabold">Top 5 proveedores</h3>
        {top5.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Sin datos</p>
        ) : (
          <div className="space-y-2">
            {top5.map((s, idx) => {
              const pct = totalGastado > 0 ? (s.totalGastado / totalGastado) * 100 : 0
              return (
                <div key={s.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-extrabold text-primary">
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{s.nombre}</p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-extrabold">{fmt(s.totalGastado)}</p>
                    <p className="text-[10px] text-muted-foreground">{s.numCompras} compra{s.numCompras !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Stock bajo por proveedor */}
      {productosConStockBajo.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-extrabold">Productos bajo stock (con proveedor)</h3>
          <div className="space-y-1.5">
            {productosConStockBajo.slice(0, 10).map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border bg-card p-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="truncate font-medium">{p.nombre}</span>
                  {p.proveedorNombre && <span className="ml-2 text-[11px] text-muted-foreground">→ {p.proveedorNombre}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 font-bold">{p.stock ?? 0}</span>
                  <span className="text-[10px] text-muted-foreground">/ {p.minStock}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deudas */}
      {proveedoresConDeuda.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-extrabold">Proveedores con deuda</h3>
          <div className="space-y-1.5">
            {proveedoresConDeuda.sort((a, b) => b.saldoPendiente - a.saldoPendiente).map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border bg-card p-2.5 text-sm">
                <span className="truncate font-medium">{s.nombre}</span>
                <span className="text-sm font-extrabold text-red-600">{fmt(s.saldoPendiente)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
