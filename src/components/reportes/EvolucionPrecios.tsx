import { Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import * as React from 'react'
import { collection, getDocs, query, orderBy, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { useProductos } from '@/hooks/use-productos'

const fmt = (n: number) => 'S/ ' + (Number(n) || 0).toFixed(2)

type PuntoHistorial = {
  fecha: string
  precio: number
  proveedor: string
  cantidad: number
}

export function EvolucionPrecios() {
  const { productos } = useProductos()
  const [productoSel, setProductoSel] = React.useState('')
  const [historial, setHistorial] = React.useState<PuntoHistorial[]>([])
  const [cargando, setCargando] = React.useState(false)

  React.useEffect(() => {
    if (!productoSel) { setHistorial([]); return }
    setCargando(true)
    const q = query(collection(db, COL.MOVIMIENTOS), where('tipoMovimiento', '==', 'compra'), orderBy('fecha', 'desc'))
    getDocs(q).then((snap) => {
      const puntos: PuntoHistorial[] = []
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>
        if ((data.productoId as string) !== productoSel) continue
        const meta = (data.metadata || {}) as Record<string, unknown>
        const precio = (meta.precioUnitario as number) || 0
        if (precio <= 0) continue
        puntos.push({
          fecha: (data.fecha as string) || '',
          precio,
          proveedor: (meta.proveedor as string) || '',
          cantidad: (meta.cantidadPresentacion as number) || (data.cantidad as number) || 0,
        })
      }
      setHistorial(puntos)
    }).catch(() => setHistorial([])).finally(() => setCargando(false))
  }, [productoSel])

  const precios = historial.map((h) => h.precio)
  const precioMin = precios.length > 0 ? Math.min(...precios) : 0
  const precioMax = precios.length > 0 ? Math.max(...precios) : 0
  const precioPromedio = precios.length > 0 ? precios.reduce((s, p) => s + p, 0) / precios.length : 0
  const tendencia = precios.length >= 2 ? precios[0] - precios[precios.length - 1] : 0

  // Calcular puntos para la gráfica SVG
  const chartW = 400
  const chartH = 120
  const chartPoints = React.useMemo(() => {
    if (historial.length < 2) return []
    const reversed = [...historial].reverse()
    const minY = precioMin * 0.9
    const maxY = precioMax * 1.1 || 1
    return reversed.map((p, i) => ({
      x: (i / (reversed.length - 1)) * chartW,
      y: chartH - ((p.precio - minY) / (maxY - minY)) * chartH,
      precio: p.precio,
      fecha: p.fecha,
      proveedor: p.proveedor,
    }))
  }, [historial, precioMin, precioMax])

  // Agrupar por proveedor
  const porProveedor = React.useMemo(() => {
    const mapa: Record<string, { compras: number; precioPromedio: number; precioMin: number; precioMax: number; ultimoPrecio: number }> = {}
    for (const h of historial) {
      const key = h.proveedor || 'Desconocido'
      if (!mapa[key]) mapa[key] = { compras: 0, precioPromedio: 0, precioMin: Infinity, precioMax: 0, ultimoPrecio: 0 }
      const m = mapa[key]
      m.compras++
      m.precioPromedio += h.precio
      m.precioMin = Math.min(m.precioMin, h.precio)
      m.precioMax = Math.max(m.precioMax, h.precio)
      m.ultimoPrecio = h.precio
    }
    for (const k of Object.keys(mapa)) {
      mapa[k].precioPromedio = mapa[k].precioPromedio / mapa[k].compras
    }
    return Object.entries(mapa).sort((a, b) => a[1].precioPromedio - b[1].precioPromedio)
  }, [historial])

  return (
    <div className="space-y-4">
      {/* Selector de producto */}
      <div>
        <label className="text-xs font-bold text-muted-foreground">Producto</label>
        <select value={productoSel} onChange={(e) => setProductoSel(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-2 text-sm">
          <option value="">Seleccionar producto…</option>
          {productos.filter((p) => p.activo !== false).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')).map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </div>

      {cargando && (
        <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      )}

      {!cargando && productoSel && historial.length === 0 && (
        <p className="py-6 text-center text-xs text-muted-foreground">Sin datos de compra para este producto</p>
      )}

      {!cargando && historial.length > 0 && (
        <>
          {/* Métricas */}
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-xl border bg-card p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Mínimo</p>
              <p className="text-sm font-extrabold text-emerald-600">{fmt(precioMin)}</p>
            </div>
            <div className="rounded-xl border bg-card p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Promedio</p>
              <p className="text-sm font-extrabold">{fmt(precioPromedio)}</p>
            </div>
            <div className="rounded-xl border bg-card p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Máximo</p>
              <p className="text-sm font-extrabold text-red-600">{fmt(precioMax)}</p>
            </div>
            <div className="rounded-xl border bg-card p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Tendencia</p>
              <div className="flex items-center justify-center gap-1">
                {tendencia > 0 ? <TrendingUp className="h-3.5 w-3.5 text-red-500" /> : tendencia < 0 ? <TrendingDown className="h-3.5 w-3.5 text-emerald-500" /> : <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className={`text-sm font-extrabold ${tendencia > 0 ? 'text-red-600' : tendencia < 0 ? 'text-emerald-600' : ''}`}>
                  {tendencia > 0 ? '+' : ''}{fmt(tendencia)}
                </span>
              </div>
            </div>
          </div>

          {/* Gráfica */}
          {chartPoints.length >= 2 && (
            <div className="rounded-xl border bg-card p-3">
              <p className="mb-2 text-xs font-bold text-muted-foreground">Evolución del precio</p>
              <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-auto">
                <polyline fill="none" stroke="hsl(var(--primary))" strokeWidth="2" points={chartPoints.map((p) => `${p.x},${p.y}`).join(' ')} />
                {chartPoints.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r="3" fill="hsl(var(--primary))" />
                ))}
              </svg>
            </div>
          )}

          {/* Por proveedor */}
          {porProveedor.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-muted-foreground">Comparativa por proveedor</p>
              {porProveedor.map(([nombre, stats]) => (
                <div key={nombre} className="rounded-xl border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{nombre}</span>
                    <span className="text-xs text-muted-foreground">{stats.compras} compra{stats.compras !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Mín</p>
                      <p className="text-xs font-bold text-emerald-600">{fmt(stats.precioMin)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Promedio</p>
                      <p className="text-xs font-bold">{fmt(stats.precioPromedio)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Último</p>
                      <p className="text-xs font-bold">{fmt(stats.ultimoPrecio)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Productos con precio */}
      {!productoSel && (
        <div>
          <p className="text-xs font-bold text-muted-foreground mb-2">Productos con precio registrado</p>
          <div className="space-y-1.5">
            {productos.filter((p) => p.activo !== false && (p.precioCompra || 0) > 0).sort((a, b) => (b.precioCompra || 0) - (a.precioCompra || 0)).slice(0, 10).map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                <span className="truncate font-medium">{p.nombre}</span>
                <span className="shrink-0 font-bold">{fmt(p.precioCompra || 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
