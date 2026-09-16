import { Loader2, DollarSign, AlertTriangle, ShoppingCart, Package } from 'lucide-react'
import * as React from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { cargarProveedores, type Proveedor } from '@/services/proveedores'
import { useProductos } from '@/hooks/use-productos'

const fmt = (n: number) => 'S/ ' + (Number(n) || 0).toFixed(2)

type ProveedorStats = {
  id: string
  nombre: string
  totalGastado: number
  numCompras: number
  saldoPendiente: number
}

export function DashboardProveedores() {
  const [proveedores, setProveedores] = React.useState<Proveedor[]>([])
  const [stats, setStats] = React.useState<ProveedorStats[]>([])
  const [cargando, setCargando] = React.useState(true)
  const { productos } = useProductos()

  React.useEffect(() => {
    Promise.all([
      cargarProveedores(),
      cargarStats(),
    ]).then(([provs, st]) => { setProveedores(provs); setStats(st) }).finally(() => setCargando(false))
  }, [])

  async function cargarStats(): Promise<ProveedorStats[]> {
    const provs = await cargarProveedores()
    const q = query(collection(db, COL.MOVIMIENTOS), where('tipoMovimiento', '==', 'compra'), orderBy('fecha', 'desc'))
    const snap = await getDocs(q)

    const mapa: Record<string, ProveedorStats> = {}
    for (const p of provs) {
      if (!p.id) continue
      mapa[p.id] = { id: p.id, nombre: p.nombre, totalGastado: 0, numCompras: 0, saldoPendiente: p.saldoPendiente || 0 }
    }

    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>
      const meta = (data.metadata || {}) as Record<string, unknown>
      const provId = (meta.proveedorId as string) || ''
      if (!mapa[provId]) {
        mapa[provId] = { id: provId, nombre: (meta.proveedor as string) || provId, totalGastado: 0, numCompras: 0, saldoPendiente: 0 }
      }
      mapa[provId].totalGastado += (meta.totalPagado as number) || 0
      mapa[provId].numCompras++
    }

    return Object.values(mapa).sort((a, b) => b.totalGastado - a.totalGastado)
  }

  const totalGastado = stats.reduce((s, r) => s + r.totalGastado, 0)
  const totalDeuda = stats.reduce((s, r) => s + r.saldoPendiente, 0)
  const proveedoresConDeuda = stats.filter((s) => s.saldoPendiente > 0)

  const productosConStockBajo = React.useMemo(() => {
    return productos.filter((p) => p.activo !== false && (p.minStock ?? 0) > 0 && (p.stock ?? 0) <= (p.minStock ?? 0))
  }, [productos])

  const top5 = stats.slice(0, 5)

  if (cargando) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            <span className="text-xs font-bold">Total compras</span>
          </div>
          <p className="mt-1 text-2xl font-extrabold">{fmt(totalGastado)}</p>
          <p className="text-[11px] text-muted-foreground">{stats.length} proveedor{stats.length !== 1 ? 'es' : ''}</p>
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
          <p className="mt-1 text-2xl font-extrabold">{stats.length}</p>
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
