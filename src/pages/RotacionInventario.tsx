import { ArrowDown, ArrowUp, Loader2, Package, RotateCcw, Search } from 'lucide-react'
import * as React from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { useProductos } from '@/hooks/use-productos'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + n.toFixed(2)

type ProductoRotacion = {
  id: string
  nombre: string
  categoria: string
  stock: number
  precioVenta: number
  cantidadVendida: number
  ventaDiaria: number
  diasStock: number
  rotacionMensual: number
}

export function RotacionInventario() {
  const { productos, loading: cargandoProductos } = useProductos()
  const [dias, setDias] = React.useState(30)
  const [busqueda, setBusqueda] = React.useState('')
  const [ordenar, setOrdenar] = React.useState<'rotacion' | 'dias' | 'stock' | 'nombre'>('rotacion')
  const [datos, setDatos] = React.useState<Map<string, number>>(new Map())
  const [cargando, setCargando] = React.useState(true)

  React.useEffect(() => {
    let activo = true
    setCargando(true)

    const tipos = ['NV', 'BOLETA', 'FACTURA']
    const desde = new Date()
    desde.setDate(desde.getDate() - dias)
    const desdeStr = desde.toISOString()

    const promises = tipos.map((tipo) =>
      getDocs(query(collection(db, COL.DOCUMENTOS), where('tipoDoc', '==', tipo), where('fecha', '>=', desdeStr), where('estado', '!=', 'anulada')))
    )

    Promise.all(promises)
      .then((snaps) => {
        if (!activo) return
        const ventasMap = new Map<string, number>()

        for (const snap of snaps) {
          for (const doc of snap.docs) {
            const data = doc.data()
            const items = data.venta?.items || data.items || []
            for (const item of items) {
              const pid = item.id || item.productoId
              if (!pid || pid.startsWith('manual-')) continue
              const cant = item.quantity || item.cantidad || 1
              ventasMap.set(pid, (ventasMap.get(pid) || 0) + cant)
            }
          }
        }

        setDatos(ventasMap)
        setCargando(false)
      })
      .catch((e) => {
        console.error('Error cargando ventas:', e)
        if (activo) setCargando(false)
      })

    return () => { activo = false }
  }, [dias])

  const rotacion = React.useMemo(() => {
    const lista: ProductoRotacion[] = []

    for (const p of productos) {
      if (!p.activo && p.activo !== undefined) continue
      const vendido = datos.get(p.id) || 0
      const stock = p.stock ?? 0
      const ventaDiaria = vendido / Math.max(dias, 1)
      const diasStock = ventaDiaria > 0 ? stock / ventaDiaria : stock > 0 ? 999 : 0
      const rotacionMes = ventaDiaria > 0 ? (stock / ventaDiaria) * (30 / dias) : 0

      lista.push({
        id: p.id,
        nombre: p.nombre || 'Sin nombre',
        categoria: p.categoria || 'Sin categoría',
        stock,
        precioVenta: p.precioVenta ?? 0,
        cantidadVendida: vendido,
        ventaDiaria: Number(ventaDiaria.toFixed(2)),
        diasStock: Number(diasStock.toFixed(1)),
        rotacionMensual: Number(rotacionMes.toFixed(1)),
      })
    }

    lista.sort((a, b) => {
      if (ordenar === 'rotacion') return b.rotacionMensual - a.rotacionMensual
      if (ordenar === 'dias') return a.diasStock - b.diasStock
      if (ordenar === 'stock') return b.stock - a.stock
      return a.nombre.localeCompare(b.nombre)
    })

    return lista
  }, [productos, datos, dias, ordenar])

  const filtrados = React.useMemo(() => {
    if (!busqueda.trim()) return rotacion
    const q = busqueda.toLowerCase()
    return rotacion.filter((p) => p.nombre.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q))
  }, [rotacion, busqueda])

  const resumen = React.useMemo(() => {
    const conRotacion = filtrados.filter((p) => p.rotacionMensual >= 8)
    const riesgo = filtrados.filter((p) => p.diasStock > 60 && p.stock > 0)
    const sinVenta = filtrados.filter((p) => p.cantidadVendida === 0 && p.stock > 0)
    const valorTotal = filtrados.reduce((s, p) => s + p.stock * p.precioVenta, 0)
    return { conRotacion: conRotacion.length, riesgo: riesgo.length, sinVenta: sinVenta.length, valorTotal }
  }, [filtrados])

  if (cargandoProductos || cargando) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Calculando rotación…</span>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-xl bg-muted p-1">
          {([7, 15, 30, 60, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={cn('rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer', dias === d ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}
            >
              {d}d
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto o categoría…"
            className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5 rounded-xl bg-muted p-1">
          {([
            { key: 'rotacion', label: 'Rotación' },
            { key: 'dias', label: 'Días stock' },
            { key: 'stock', label: 'Stock' },
          ] as const).map((o) => (
            <button
              key={o.key}
              onClick={() => setOrdenar(o.key)}
              className={cn('rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer', ordenar === o.key ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">Productos analizados</div>
          <div className="mt-1 text-2xl font-bold">{filtrados.length}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">🟢 Rotación alta</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">{resumen.conRotacion}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">🔴 Sin movimiento</div>
          <div className="mt-1 text-2xl font-bold text-red-600">{resumen.sinVenta}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">Valor en stock</div>
          <div className="mt-1 text-lg font-bold num">{fmt(resumen.valorTotal)}</div>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-bold">Rotación de Inventario</span>
          <span className="num text-sm text-muted-foreground">{filtrados.length} productos · Últimos {dias} días</span>
        </div>

        {filtrados.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <Package className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
            <p>Sin productos para mostrar</p>
          </div>
        ) : (
          <div className="divide-y">
            {filtrados.map((p) => {
              const rotacion = p.rotacionMensual
              const nivel = rotacion >= 8 ? 'alta' : rotacion >= 3 ? 'media' : 'baja'
              return (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                  <div className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    nivel === 'alta' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                    nivel === 'media' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  )}>
                    {nivel === 'alta' ? <ArrowUp className="h-4 w-4" /> : nivel === 'media' ? <RotateCcw className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{p.nombre}</div>
                    <div className="text-xs text-muted-foreground">{p.categoria}</div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div>
                      <div className="text-muted-foreground">Stock</div>
                      <div className="font-bold">{p.stock}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Vta/día</div>
                      <div className="font-bold">{p.ventaDiaria}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Días</div>
                      <div className={cn('font-bold', p.diasStock < 7 ? 'text-red-600' : p.diasStock < 30 ? 'text-amber-600' : 'text-emerald-600')}>
                        {p.diasStock > 999 ? '∞' : p.diasStock}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Rotación</div>
                      <div className={cn('font-bold', nivel === 'alta' ? 'text-emerald-600' : nivel === 'media' ? 'text-amber-600' : 'text-red-600')}>
                        {p.rotacionMensual}x
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><span className="text-emerald-600 font-bold">🟢</span> Rotación alta (&gt;8x) — Se vende rápido</span>
        <span><span className="text-amber-600 font-bold">🟡</span> Rotación media (3-8x) — Normal</span>
        <span><span className="text-red-600 font-bold">🔴</span> Rotación baja (&lt;3x) — Riesgo de obsolescencia</span>
      </div>
    </div>
  )
}

export default RotacionInventario
