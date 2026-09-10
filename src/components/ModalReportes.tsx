import { AlertTriangle, ArrowLeft, BarChart3, Boxes, CircleDollarSign, ClipboardList, TrendingUp, X } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { generarReporte } from '@/lib/inventario-reportes'
import type { Producto } from '@/hooks/use-productos'

type Ctx = { nombre?: string; categoria?: string; stock?: number; minStock?: number; precioCompra?: number; precioVenta?: number; inversionTotal?: number; costoUnitario?: number; utilidadUnidad?: number; margen?: number; utilidadTotal?: number }

const OPCIONES = [
  { tipo: 'general', titulo: 'Reporte General', desc: 'Resumen global del inventario', icono: BarChart3, color: '#FF6B35' },
  { tipo: 'stockBajo', titulo: 'Stock Bajo', desc: 'Productos con stock por debajo del mínimo', icono: AlertTriangle, color: '#E53935' },
  { tipo: 'mayorInversion', titulo: 'Mayor Inversión', desc: 'Productos con mayor valor en stock', icono: TrendingUp, color: '#4CAF50' },
  { tipo: 'porCategoria', titulo: 'Por Categoría', desc: 'Resumen agrupado por categoría', icono: Boxes, color: '#2196F3' },
  { tipo: 'stockGeneral', titulo: 'Stock General / Final', desc: 'Lista completa de productos con stock actual', icono: ClipboardList, color: '#795548' },
  { tipo: 'utilidad', titulo: 'Utilidad', desc: 'Utilidad general y por producto (venta - costo)', icono: CircleDollarSign, color: '#8BC34A' },
]

const fmt = (n: any) => 'S/ ' + (Number(n) || 0).toFixed(2)

function Stat({ label, value, big, danger }: { label: string; value: string; big?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 font-bold', big && 'text-lg', danger && 'text-destructive')}>{value}</div>
    </div>
  )
}

function TablaProductos({ productos, puedeVerCostos, modo }: { productos: Ctx[]; puedeVerCostos: boolean; modo: 'stock' | 'utilidad' }) {
  const inver = modo === 'utilidad'
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-[11px] uppercase text-muted-foreground">
            <th className="px-3 py-2">Producto</th>
            <th className="px-3 py-2">Stock</th>
            {puedeVerCostos && <th className="px-3 py-2 text-right">{inver ? 'Costo' : 'Costo'}</th>}
            {puedeVerCostos && <th className="px-3 py-2 text-right">Valor</th>}
            {puedeVerCostos && inver && <th className="px-3 py-2 text-right">Utilidad</th>}
            {puedeVerCostos && inver && <th className="px-3 py-2 text-right">Margen</th>}
          </tr>
        </thead>
        <tbody>
          {productos.map((p, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="px-3 py-2 font-semibold">{p.nombre}</td>
              <td className="px-3 py-2">{p.stock ?? 0}</td>
              {puedeVerCostos && <td className="px-3 py-2 text-right">{inver ? fmt(p.costoUnitario ?? 0) : fmt(p.precioCompra ?? 0)}</td>}
              {puedeVerCostos && <td className="px-3 py-2 text-right">{inver ? fmt(p.precioVenta ?? 0) : fmt(p.inversionTotal ?? p.precioVenta ?? 0)}</td>}
              {puedeVerCostos && inver && <td className={cn('px-3 py-2 text-right font-bold', (p.utilidadTotal ?? 0) < 0 && 'text-destructive')}>{fmt(p.utilidadTotal ?? 0)}</td>}
              {puedeVerCostos && inver && <td className="px-3 py-2 text-right text-muted-foreground">{((p.margen ?? 0)).toFixed(1)}%</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ModalReportes({ productos, puedeVerCostos, onClose }: { productos: Producto[]; puedeVerCostos: boolean; onClose: () => void }) {
  const [tipo, setTipo] = React.useState<string | null>(null)
  const data: any = tipo ? generarReporte(tipo, productos) : null

  const cerrar = () => {
    setTipo(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            {tipo && (
              <button onClick={() => setTipo(null)} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Volver">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <h2 className="font-bold">Reportes de Inventario</h2>
          </div>
          <button onClick={cerrar} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!tipo ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {OPCIONES.map((o) => (
                <button key={o.tipo} onClick={() => setTipo(o.tipo)} className="flex items-center gap-3 rounded-xl border p-3 text-left transition-all hover:bg-muted/40 hover:shadow-sm cursor-pointer">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: o.color + '1f' }}>
                    <o.icono className="h-5 w-5" style={{ color: o.color }} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold">{o.titulo}</div>
                    <div className="text-xs text-muted-foreground">{o.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">{data?.titulo}</h3>
                <span className="text-xs text-muted-foreground">{data?.fechaGeneracion}</span>
              </div>

              {tipo === 'general' && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Total productos" value={String(data?.totalProductos ?? 0)} />
                  <Stat label="Total unidades" value={String(data?.totalStock ?? 0)} />
                  <Stat label="Valor (compra)" value={fmt(data?.totalValorCompra ?? 0)} />
                  <Stat label="Valor (venta)" value={fmt(data?.totalValorVenta ?? 0)} />
                  <Stat label="Ganancia potencial" value={fmt(data?.gananciaPotencial ?? 0)} />
                  <Stat label="Margen ganancia" value={`${data?.margenGanancia ?? 0}%`} />
                  <Stat label="Stock bajo mínimo" value={String(data?.productosBajoStock ?? 0)} danger={(data?.productosBajoStock ?? 0) > 0} />
                  <Stat label="Sin stock" value={String(data?.productosSinStock ?? 0)} danger={(data?.productosSinStock ?? 0) > 0} />
                </div>
              )}

              {tipo === 'stockGeneral' && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Total productos" value={String(data?.estadisticas?.totalProductos ?? 0)} />
                    <Stat label="Stock total" value={String(data?.estadisticas?.stockTotal ?? 0)} />
                    <Stat label="Sin stock" value={String(data?.estadisticas?.productosSinStock ?? 0)} />
                    {puedeVerCostos && <Stat label="Valor inventario" value={fmt(data?.estadisticas?.valorTotalInventario ?? 0)} />}
                  </div>
                  <TablaProductos productos={(data?.productos as Ctx[]) ?? []} puedeVerCostos={puedeVerCostos} modo="stock" />
                </>
              )}

              {tipo === 'stockBajo' && (
                <>
                  <p className="text-sm text-muted-foreground">{String(data?.totalProductos ?? 0)} productos con stock por debajo del mínimo</p>
                  <TablaProductos productos={(data?.productos as Ctx[]) ?? []} puedeVerCostos={false} modo="stock" />
                </>
              )}

              {tipo === 'mayorInversion' && (
                <>
                  <p className="text-sm text-muted-foreground">Total invertido: <span className="font-bold">{fmt(data?.totalInventario ?? 0)}</span></p>
                  <TablaProductos productos={(data?.productos as Ctx[]) ?? []} puedeVerCostos={puedeVerCostos} modo="stock" />
                </>
              )}

              {tipo === 'porCategoria' && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Total productos" value={String(data?.totalProductos ?? 0)} />
                    <Stat label="Total stock" value={String(data?.totalStock ?? 0)} />
                    {puedeVerCostos && <Stat label="Valor inventario" value={fmt(data?.totalValorInventario ?? 0)} />}
                  </div>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50 text-left text-[11px] uppercase text-muted-foreground">
                          <th className="px-3 py-2">Categoría</th>
                          <th className="px-3 py-2 text-right">Productos</th>
                          <th className="px-3 py-2 text-right">Stock</th>
                          {puedeVerCostos && <th className="px-3 py-2 text-right">Valor</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(data?.categorias ?? {}).map(([cat, c]: any) => (
                          <tr key={cat} className="border-b last:border-0">
                            <td className="px-3 py-2 font-semibold">{cat}</td>
                            <td className="px-3 py-2 text-right">{c.cantidadProductos}</td>
                            <td className="px-3 py-2 text-right">{c.stockTotal}</td>
                            {puedeVerCostos && <td className="px-3 py-2 text-right">{fmt(c.valorInventario)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {tipo === 'utilidad' && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Utilidad general" value={fmt(data?.utilidadGeneral ?? 0)} />
                    <Stat label="Margen" value={`${data?.margenGeneral ?? 0}%`} />
                    <Stat label="Con ganancia" value={String(data?.productosConGanancia ?? 0)} />
                    <Stat label="En pérdida" value={String(data?.productosPerdida ?? 0)} danger={(data?.productosPerdida ?? 0) > 0} />
                  </div>
                  <TablaProductos productos={(data?.productos as Ctx[]) ?? []} puedeVerCostos={puedeVerCostos} modo="utilidad" />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
