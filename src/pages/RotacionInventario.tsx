import { AlertTriangle, Loader2, Package, Search, Trophy, X } from 'lucide-react'
import * as React from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { useProductos } from '@/hooks/use-productos'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'

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

type Vista = 'top' | 'bottom' | 'buscar'

export function RotacionInventario() {
  const { productos, loading: cargandoProductos } = useProductos()
  const [dias, setDias] = React.useState(30)
  const [busqueda, setBusqueda] = React.useState('')
  const [vista, setVista] = React.useState<Vista>('top')
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
      getDocs(query(collection(db, COL.DOCUMENTOS), where('tipoDoc', '==', tipo), where('fecha', '>=', desdeStr)))
    )

    Promise.all(promises)
      .then((snaps) => {
        if (!activo) return
        const ventasMap = new Map<string, number>()

        for (const snap of snaps) {
          for (const doc of snap.docs) {
            const data = doc.data()
            if (data.estado === 'anulada') continue
            const items = data.venta?.items || data.items || data.venta?.venta?.items || []
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
      const rotacionMes = stock > 0 ? (ventaDiaria * 30) / stock : 0

      lista.push({
        id: p.id,
        nombre: p.nombre || 'Sin nombre',
        categoria: p.categoria || 'Sin categoría',
        stock,
        precioVenta: p.precioVenta ?? 0,
        cantidadVendida: vendido,
        ventaDiaria: Number(ventaDiaria.toFixed(2)),
        diasStock: Number(diasStock.toFixed(1)),
        rotacionMensual: Number(rotacionMes.toFixed(2)),
      })
    }

    return lista
  }, [productos, datos, dias])

  const top10 = React.useMemo(() => {
    return [...rotacion]
      .filter((p) => p.cantidadVendida > 0)
      .sort((a, b) => b.rotacionMensual - a.rotacionMensual)
      .slice(0, 10)
  }, [rotacion])

  const bottom10 = React.useMemo(() => {
    return [...rotacion]
      .filter((p) => p.stock > 0)
      .sort((a, b) => a.rotacionMensual - b.rotacionMensual)
      .slice(0, 10)
  }, [rotacion])

  const resultadosBusqueda = React.useMemo(() => {
    if (!busqueda.trim() || vista !== 'buscar') return []
    const q = busqueda.toLowerCase()
    return rotacion
      .filter((p) => p.nombre.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q))
      .slice(0, 20)
  }, [rotacion, busqueda, vista])

  const resumen = React.useMemo(() => {
    const conRotacion = rotacion.filter((p) => p.rotacionMensual >= 1.5)
    const sinVenta = rotacion.filter((p) => p.cantidadVendida === 0 && p.stock > 0)
    const valorTotal = rotacion.reduce((s, p) => s + p.stock * p.precioVenta, 0)
    return { conRotacion: conRotacion.length, sinVenta: sinVenta.length, valorTotal }
  }, [rotacion])

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
          {([
            { d: 7, tip: 'Análisis de los últimos 7 días. Detecta cambios recientes (picos o caídas de la semana).' },
            { d: 15, tip: 'Análisis de los últimos 15 días. Balance entre tendencia reciente y estable.' },
            { d: 30, tip: 'Análisis de 30 días. El más confiable para planificar compras.' },
            { d: 60, tip: 'Análisis de 60 días. Útil para productos de rotación lenta.' },
            { d: 90, tip: 'Análisis de 3 meses. Detecta estacionalidad y tendencias a largo plazo.' },
          ] as const).map(({ d, tip }) => (
            <Tooltip key={d} content={<span className="text-center">{tip}</span>} side="bottom">
              <button
                onClick={() => setDias(d)}
                className={cn('rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer', dias === d ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}
              >
                {d}d
              </button>
            </Tooltip>
          ))}
        </div>
        <div className="flex items-center gap-1.5 rounded-xl bg-muted p-1">
          {([
            { key: 'top', label: '🏆 Top 10', icon: Trophy, tip: 'Los 10 productos que más rotan. Son los que más se venden y generan movimiento.' },
            { key: 'bottom', label: '⚠️ Bottom 10', icon: AlertTriangle, tip: 'Los 10 productos que menos rotan. Podrían estar estancados o próximos a vencer.' },
            { key: 'buscar', label: '🔍 Buscar', icon: Search, tip: 'Buscá cualquier producto por nombre o categoría para ver su rotación específica.' },
          ] as const).map((v) => (
            <Tooltip key={v.key} content={<span className="text-center">{v.tip}</span>} side="bottom">
              <button
                onClick={() => setVista(v.key)}
                className={cn('rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer', vista === v.key ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}
              >
                {v.label}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <Tooltip content={<span className="text-center">Productos con rotación {'≥'} 1.5x/mes. Se venden rápido.</span>} side="top">
            <div className="text-xs text-muted-foreground cursor-help">🟢 Alta rotación</div>
          </Tooltip>
          <div className="mt-1 text-2xl font-bold text-emerald-600">{resumen.conRotacion}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <Tooltip content={<span className="text-center">Productos con stock pero que no se vendieron en el período.</span>} side="top">
            <div className="text-xs text-muted-foreground cursor-help">🔴 Sin movimiento</div>
          </Tooltip>
          <div className="mt-1 text-2xl font-bold text-red-600">{resumen.sinVenta}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <Tooltip content={<span className="text-center">Valor total del inventario a precios de venta.</span>} side="top">
            <div className="text-xs text-muted-foreground cursor-help">Valor en stock</div>
          </Tooltip>
          <div className="mt-1 text-lg font-bold num">{fmt(resumen.valorTotal)}</div>
        </div>
      </div>

      {/* Vista: Top 10 */}
      {vista === 'top' && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Trophy className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-bold">Top 10 — Mayor Rotación</span>
            <span className="text-xs text-muted-foreground">(productos que más se venden)</span>
          </div>
          {top10.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Sin ventas en este período</div>
          ) : (
            <div className="divide-y">
              {top10.map((p, i) => (
                <FilaProducto key={p.id} p={p} index={i + 1} icono="🏆" dias={dias} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Vista: Bottom 10 */}
      {vista === 'bottom' && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <span className="text-sm font-bold">Bottom 10 — Menor Rotación</span>
            <span className="text-xs text-muted-foreground">(productos que menos se venden)</span>
          </div>
          {bottom10.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Sin productos con stock</div>
          ) : (
            <div className="divide-y">
              {bottom10.map((p, i) => (
                <FilaProducto key={p.id} p={p} index={i + 1} icono="⚠️" dias={dias} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Vista: Buscar */}
      {vista === 'buscar' && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o categoría…"
              className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm"
              autoFocus
            />
            {busqueda && (
              <button
                onClick={() => setBusqueda('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {busqueda.trim() && resultadosBusqueda.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Package className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              No se encontraron productos
            </div>
          )}
          {resultadosBusqueda.length > 0 && (
            <div className="overflow-hidden rounded-xl border bg-card shadow-card">
              <div className="border-b px-4 py-3 text-sm font-bold">
                Resultados: {resultadosBusqueda.length} producto{resultadosBusqueda.length !== 1 ? 's' : ''}
              </div>
              <div className="divide-y">
                {resultadosBusqueda.map((p, i) => (
                  <FilaProducto key={p.id} p={p} index={i +1} dias={dias} />
                ))}
              </div>
            </div>
          )}
          {!busqueda.trim() && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Escribí el nombre de un producto para ver su rotación
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FilaProducto({ p, index, icono, dias }: { p: ProductoRotacion; index: number; icono?: string; dias: number }) {
  const nivel = p.rotacionMensual >= 1.5 ? 'alta' : p.rotacionMensual >= 0.5 ? 'media' : 'baja'

  const nombreCorto = p.nombre.length > 25 ? p.nombre.slice(0, 25) + '…' : p.nombre

  const tooltipTexto = React.useMemo(() => {
    const lineas: string[] = []
    if (p.cantidadVendida > 0) {
      lineas.push(`Vendió ${p.cantidadVendida} unidades en ${dias} días.`)
    } else {
      lineas.push('No se vendió en este período.')
    }
    if (p.ventaDiaria > 0) {
      lineas.push(`Promedio: ${p.ventaDiaria} u/día.`)
    }
    if (p.diasStock > 999) {
      lineas.push('Stock infinito (sin ventas).')
    } else if (p.diasStock < 7) {
      lineas.push(`⚠️ Alcanza solo ${p.diasStock} días. Comprar ya.`)
    } else if (p.diasStock < 30) {
      lineas.push(`Stock para ${p.diasStock} días. Planificar compra.`)
    } else {
      lineas.push(`Stock para ${p.diasStock} días. OK.`)
    }
    if (p.rotacionMensual >= 1.5) {
      lineas.push(`🟢 Alta rotación (${p.rotacionMensual}x/mes).`)
    } else if (p.rotacionMensual >= 0.5) {
      lineas.push(`🟡 Rotación media (${p.rotacionMensual}x/mes).`)
    } else if (p.rotacionMensual > 0) {
      lineas.push(`🔴 Baja rotación (${p.rotacionMensual}x/mes).`)
    }
    return lineas.join(' ')
  }, [p, dias])

  return (
    <div className="flex items-center gap-2 px-3 py-3 hover:bg-muted/30 sm:gap-3 sm:px-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold sm:h-8 sm:w-8">
        {icono ? `${icono}` : index}
      </div>
      <div className="min-w-0 flex-1">
        <Tooltip content={<span className="text-left leading-relaxed">{tooltipTexto}</span>} side="right">
          <div className="font-semibold cursor-help">{nombreCorto}</div>
        </Tooltip>
        <div className="hidden text-xs text-muted-foreground sm:block">{p.categoria}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-center text-[10px] sm:grid-cols-4 sm:gap-2 sm:text-xs">
        <div>
          <Tooltip content={<span className="text-center">Unidades disponibles en almacén</span>} side="top">
            <div className="text-muted-foreground cursor-help">Stock</div>
          </Tooltip>
          <div className="font-bold">{p.stock}</div>
        </div>
        <div>
          <Tooltip content={<span className="text-center">Promedio de unidades vendidas por día en el período</span>} side="top">
            <div className="text-muted-foreground cursor-help">Vta/día</div>
          </Tooltip>
          <div className="font-bold">{p.ventaDiaria}</div>
        </div>
        <div>
          <Tooltip content={<span className="text-center">Cuántos días alcanza el stock actual al ritmo de venta</span>} side="top">
            <div className="text-muted-foreground cursor-help">Días</div>
          </Tooltip>
          <div className={cn('font-bold', p.diasStock < 7 ? 'text-red-600' : p.diasStock < 30 ? 'text-amber-600' : 'text-emerald-600')}>
            {p.diasStock > 999 ? '∞' : p.diasStock}
          </div>
        </div>
        <div>
          <Tooltip content={<span className="text-center">Cuántas veces se renueva el stock al mes. {'≥'}1.5x = alta, {'<'}0.5x = baja</span>} side="top">
            <div className="text-muted-foreground cursor-help">Rotación</div>
          </Tooltip>
          <div className={cn('font-bold', nivel === 'alta' ? 'text-emerald-600' : nivel === 'media' ? 'text-amber-600' : 'text-red-600')}>
            {p.rotacionMensual}x
          </div>
        </div>
      </div>
    </div>
  )
}

export default RotacionInventario
