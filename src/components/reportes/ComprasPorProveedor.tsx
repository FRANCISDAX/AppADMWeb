import { Loader2 } from 'lucide-react'
import * as React from 'react'
import { collection, getDocs, query, orderBy, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { cargarProveedores, type Proveedor } from '@/services/proveedores'

const fmt = (n: number) => 'S/ ' + (Number(n) || 0).toFixed(2)

type CompraResumen = {
  proveedorNombre: string
  total: number
  compras: number
  productos: Set<string>
  primeraCompra: string
  ultimaCompra: string
}

type Periodo = 'mes' | 'trimestre' | 'anio' | 'todo'

function filtrarPorPeriodo(fecha: string, periodo: Periodo): boolean {
  if (periodo === 'todo') return true
  const d = new Date(fecha)
  const ahora = new Date()
  const diffMs = ahora.getTime() - d.getTime()
  const diffDias = diffMs / (1000 * 60 * 60 * 24)
  if (periodo === 'mes') return diffDias <= 30
  if (periodo === 'trimestre') return diffDias <= 90
  if (periodo === 'anio') return diffDias <= 365
  return true
}

export function ComprasPorProveedor() {
  const [proveedores, setProveedores] = React.useState<Proveedor[]>([])
  const [resumenes, setResumenes] = React.useState<CompraResumen[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [periodo, setPeriodo] = React.useState<Periodo>('todo')
  const [ordenar, setOrdenar] = React.useState<'total' | 'compras' | 'productos'>('total')

  React.useEffect(() => {
    cargarProveedores().then(setProveedores)
  }, [])

  React.useEffect(() => {
    if (proveedores.length === 0) return
    setCargando(true)
    const q = query(collection(db, COL.MOVIMIENTOS), where('tipoMovimiento', '==', 'compra'), orderBy('fecha', 'desc'))
    getDocs(q).then((snap) => {
      const mapa: Record<string, CompraResumen> = {}
      const nombreMap = new Map(proveedores.map((p) => [p.id, p.nombre]))

      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>
        const fecha = (data.fecha as string) || ''
        if (!filtrarPorPeriodo(fecha, periodo)) continue

        const meta = (data.metadata || {}) as Record<string, unknown>
        const provId = (meta.proveedorId as string) || ''
        const provNombre = (meta.proveedor as string) || nombreMap.get(provId) || provId
        if (!provId && !provNombre) continue

        const key = provNombre.toLowerCase().trim()
        if (!mapa[key]) {
          mapa[key] = { proveedorNombre: provNombre, total: 0, compras: 0, productos: new Set(), primeraCompra: fecha, ultimaCompra: fecha }
        }
        const m = mapa[key]
        m.total += (meta.totalPagado as number) || 0
        m.compras++
        if ((data.productoNombre as string)) m.productos.add(data.productoNombre as string)
        if (fecha < m.primeraCompra) m.primeraCompra = fecha
        if (fecha > m.ultimaCompra) m.ultimaCompra = fecha
      }

      const arr = Object.values(mapa).sort((a, b) => {
        if (ordenar === 'total') return b.total - a.total
        if (ordenar === 'compras') return b.compras - a.compras
        return b.productos.size - a.productos.size
      })
      setResumenes(arr)
    }).catch(() => setResumenes([])).finally(() => setCargando(false))
  }, [proveedores, periodo, ordenar])

  const totalGeneral = resumenes.reduce((s, r) => s + r.total, 0)
  const totalCompras = resumenes.reduce((s, r) => s + r.compras, 0)
  const promedio = resumenes.length > 0 ? totalGeneral / resumenes.length : 0

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1 rounded-xl bg-muted p-1 text-xs">
          {(['mes', 'trimestre', 'anio', 'todo'] as Periodo[]).map((p) => (
            <button key={p} onClick={() => setPeriodo(p)} className={`rounded-lg px-3 py-1.5 font-bold cursor-pointer ${periodo === p ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>
              {p === 'mes' ? 'Mes' : p === 'trimestre' ? '3 meses' : p === 'anio' ? 'Año' : 'Todo'}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-xl bg-muted p-1 text-xs">
          {([['total', 'Monto'], ['compras', 'Compras'], ['productos', 'Variedad']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setOrdenar(k)} className={`rounded-lg px-3 py-1.5 font-bold cursor-pointer ${ordenar === k ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border bg-card p-3 text-center">
          <p className="text-[10px] text-muted-foreground">Total gastado</p>
          <p className="text-sm font-extrabold">{fmt(totalGeneral)}</p>
        </div>
        <div className="rounded-xl border bg-card p-3 text-center">
          <p className="text-[10px] text-muted-foreground">Promedio/proveedor</p>
          <p className="text-sm font-extrabold">{fmt(promedio)}</p>
        </div>
        <div className="rounded-xl border bg-card p-3 text-center">
          <p className="text-[10px] text-muted-foreground">Total compras</p>
          <p className="text-sm font-extrabold">{totalCompras}</p>
        </div>
      </div>

      {/* Ranking */}
      {cargando ? (
        <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : resumenes.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Sin datos de compras</p>
      ) : (
        <div className="space-y-2">
          {resumenes.map((r, idx) => {
            const pct = totalGeneral > 0 ? (r.total / totalGeneral) * 100 : 0
            const promMensual = (() => {
              const inicio = new Date(r.primeraCompra)
              const fin = new Date(r.ultimaCompra)
              const meses = Math.max(1, Math.ceil((fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24 * 30)))
              return r.total / meses
            })()
            return (
              <div key={r.proveedorNombre} className="rounded-xl border bg-card p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-extrabold text-primary">
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{r.proveedorNombre}</p>
                    <p className="text-[11px] text-muted-foreground">{r.compras} compra{r.compras !== 1 ? 's' : ''} · {r.productos.size} producto{r.productos.size !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-extrabold">{fmt(r.total)}</p>
                    <p className="text-[10px] text-muted-foreground">~{fmt(promMensual)}/mes</p>
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
