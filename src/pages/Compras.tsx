import { CalendarDays, ChevronLeft, ChevronRight, Download, Loader2, ShoppingBag, XCircle } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { usePermisos } from '@/context/permisos'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { anularCompraCompleta, anularMovimientoCompra, obtenerComprasPorRango } from '@/services/reportes'
import { useNotifications } from '@/components/notifications'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { exportarExcel } from '@/lib/excel'

const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)

type CompraItem = {
  id: string
  productoId: string
  productoCodigo?: string
  productoNombre: string
  cantidad: number
  presentacionUsada?: string
  cantidadPresentacion?: number
  precioUnitario: number
  subtotal: number
  stockAnterior?: number
  stockNuevo?: number
}

type CompraGrupo = {
  compraId: string
  isLegacy: boolean
  proveedor: string
  totalPagado: number
  nota: string
  fecha: string
  items: CompraItem[]
  puedeAnular: boolean
}

type ReporteCompras = {
  fecha: string
  totalCompras: number
  totalProductosComprados: number
  totalGeneral: number
  compras: CompraGrupo[]
}

const formatearFecha = (f: Date) => {
  const d = f.getDate().toString().padStart(2, '0')
  const m = (f.getMonth() + 1).toString().padStart(2, '0')
  return `${d}/${m}/${f.getFullYear()}`
}

export function Compras() {
  const { tienePermiso } = usePermisos()
  const { config: cfg } = useConfiguracion()
  const { toast, confirm } = useNotifications()
  const [fechaSel, setFechaSel] = React.useState(new Date())
  const [cargando, setCargando] = React.useState(false)
  const [anulandoId, setAnulandoId] = React.useState<string | null>(null)
  const [reporte, setReporte] = React.useState<ReporteCompras | null>(null)

  const cambiarDia = (delta: number) => {
    setFechaSel(new Date(fechaSel.getFullYear(), fechaSel.getMonth(), fechaSel.getDate() + delta))
    setReporte(null)
  }

  const obtenerComprasPorFecha = async () => {
    setCargando(true)
    try {
      const inicio = new Date(fechaSel)
      inicio.setHours(0, 0, 0, 0)
      const fin = new Date(fechaSel)
      fin.setHours(23, 59, 59, 999)

      const result = await obtenerComprasPorRango(inicio, fin)
      if (!result.success) throw new Error('No se pudieron obtener las compras')
      const compras = result.data
      compras.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

      // Ventas del día: sirve para saber si un producto comprado fue vendido después
      // (si se vendió, no se puede anular la compra).
      const ventasSnap = await getDocs(query(collection(db, COL.MOVIMIENTOS), where('tipoMovimiento', '==', 'venta'), where('fecha', '>=', inicio.toISOString()), where('fecha', '<=', fin.toISOString())))
      const ventas = ventasSnap.docs.map((d) => d.data())

      const comprasMap: Record<string, CompraGrupo> = {}
      let totalGeneral = 0
      let totalProductos = 0

      compras.forEach((c) => {
        const compraId = c.metadata?.compraId || c.id
        const isLegacy = !c.metadata?.compraId

        if (!comprasMap[compraId]) {
          comprasMap[compraId] = {
            compraId,
            isLegacy,
            proveedor: c.metadata?.proveedor || c.proveedor || String(c.motivo || '').replace('Compra a ', '').split(' -')[0] || 'Proveedor desconocido',
            totalPagado: Number(c.metadata?.totalPagado) || 0,
            nota: c.metadata?.nota || c.nota || '',
            fecha: c.fecha,
            items: [],
            puedeAnular: false,
          }
        }

        const precioUnit = c.metadata?.precioUnitario || 0
        const cantPres = c.metadata?.cantidadPresentacion || 0
        const totalItem = precioUnit * cantPres
        comprasMap[compraId].items.push({
          id: c.id,
          productoId: c.productoId,
          productoCodigo: c.productoCodigo,
          productoNombre: c.productoNombre,
          cantidad: c.cantidad,
          presentacionUsada: c.metadata?.presentacionUsada || c.metadata?.presentacionNombre || '',
          cantidadPresentacion: cantPres || c.cantidad,
          precioUnitario: c.precioUnitario || 0,
          subtotal: totalItem,
          stockAnterior: c.stockAnterior,
          stockNuevo: c.stockNuevo,
        })

        totalGeneral += totalItem
        totalProductos += c.cantidad
      })

      const comprasList = Object.values(comprasMap)
        .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
        .map((g) => {
          const dentroDe1Dia = Date.now() - new Date(g.fecha).getTime() <= 24 * 3600 * 1000
          const vendido = g.items.some((it) => ventas.some((v) => v.productoId === it.productoId && new Date(v.fecha).getTime() > new Date(g.fecha).getTime()))
          return { ...g, puedeAnular: dentroDe1Dia && !vendido }
        })

      setReporte({
        fecha: formatearFecha(fechaSel),
        totalCompras: comprasList.length,
        totalProductosComprados: totalProductos,
        totalGeneral,
        compras: comprasList,
      })
    } catch (e) {
      console.error('❌ Error obteniendo compras:', e)
      toast('No se pudieron obtener las compras de la fecha seleccionada', 'error')
    } finally {
      setCargando(false)
    }
  }

  const anularCompra = async (compra: CompraGrupo) => {
    const itemsStr = compra.items.map((i) => `  • ${i.productoNombre} x${i.cantidad}`).join('\n')
    const titulo = compra.isLegacy ? 'Anular compra' : 'Anular compra completa'
    const mensaje = compra.isLegacy
      ? `Anular compra\n\nSe revertirá el stock de:\n\n${itemsStr}\n\nEsta acción no se puede deshacer.`
      : `Anular compra completa\n\nSe revertirá el stock de todos los productos:\n\n${itemsStr}\n\nTotal: ${fmt(compra.totalPagado)}\n\nEsta acción no se puede deshacer.`
    const ok = await confirm({ title: titulo, message: mensaje, okText: 'Anular', destructive: true })
    if (!ok) return

    setAnulandoId(compra.compraId)
    const r = compra.isLegacy
      ? await anularMovimientoCompra({ movimientoId: compra.items[0].id, productoId: compra.items[0].productoId, cantidad: compra.items[0].cantidad, stockAnterior: compra.items[0].stockAnterior || 0 })
      : await anularCompraCompleta(compra.compraId)
    setAnulandoId(null)

    if (r.success) {
      toast(compra.isLegacy ? `Stock de "${compra.items[0].productoNombre}" revertido.` : `${(r as any).total} producto(s) revertido(s).`, 'success')
      obtenerComprasPorFecha()
    } else {
      toast(r.error || 'No se pudo anular', 'error')
    }
  }

  async function exportarExcelCompras() {
    if (!reporte || reporte.compras.length === 0) { toast('No hay compras para exportar', 'warning'); return }
    const headers = ['Fecha', 'Proveedor', 'Producto', 'Cantidad', 'P. Unitario', 'Subtotal', 'Total Compra', 'Nota']
    const rows: (string | number)[][] = []
    for (const c of reporte.compras) {
      for (const it of c.items) {
        rows.push([
          c.fecha ? new Date(c.fecha).toLocaleString('es-PE') : '',
          c.proveedor,
          it.productoNombre,
          it.cantidad,
          it.precioUnitario,
          it.subtotal,
          c.totalPagado,
          c.nota,
        ])
      }
    }
    const fechaStr = formatearFecha(fechaSel).replace(/\//g, '')
    await exportarExcel([{ name: 'Compras', headers, rows }], `Compras_${fechaStr}.xlsx`, { empresa: cfg?.nombre || 'AppADM', titulo: `Compras del ${formatearFecha(fechaSel)}` })
    toast('Excel exportado', 'success')
  }

  if (!tienePermiso('compras')) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <ShoppingBag className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No tenés acceso al módulo de Compras por Fecha</p>
        <p className="text-xs">Pedí el permiso «compras» al administrador.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Selector de fecha */}
      <div className="rounded-2xl border bg-card p-4 shadow-card">
        <div className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">Seleccionar fecha</div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="icon" onClick={() => cambiarDia(-1)} aria-label="Día anterior">
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="flex flex-1 items-center justify-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <span className="text-base font-semibold">{formatearFecha(fechaSel)}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => cambiarDia(1)} aria-label="Día siguiente">
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
        <Button className="mt-3 w-full" onClick={obtenerComprasPorFecha} disabled={cargando}>
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
          {cargando ? 'Buscando…' : 'Buscar compras'}
        </Button>
      </div>

      {cargando ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando compras…</span>
        </div>
      ) : reporte ? (
        reporte.compras.length > 0 ? (
          <div className="rounded-2xl border bg-card p-4 shadow-card">
            <div className="text-center">
              <div className="text-lg font-bold text-primary">Compras del día</div>
              <div className="text-xs text-muted-foreground">{reporte.fecha}</div>
            </div>

            <div className="my-4 flex items-center justify-center gap-4 border-y border-border/60 py-3">
              <div className="text-center">
                <div className="num text-lg font-bold">{reporte.totalCompras}</div>
                <div className="text-[11px] text-muted-foreground">Comprobantes</div>
              </div>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
              <div className="text-center">
                <div className="num text-lg font-bold">{reporte.totalProductosComprados}</div>
                <div className="text-[11px] text-muted-foreground">Productos</div>
              </div>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
              <div className="text-center">
                <div className="num text-lg font-bold text-emerald-600">{fmt(reporte.totalGeneral)}</div>
                <div className="text-[11px] text-muted-foreground">Total S/.</div>
              </div>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
              <Button variant="outline" size="sm" onClick={exportarExcelCompras}>
                <Download className="mr-1 h-3.5 w-3.5" /> Excel
              </Button>
            </div>

            <div className="space-y-4">
              {reporte.compras.map((compra, ci) => (
                <div key={ci} className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2">
                    <span className="h-2 w-2 rounded-full bg-primary" />
                    <span className="flex-1 truncate text-sm font-semibold">{compra.proveedor}</span>
                    <span className="num text-xs font-semibold text-emerald-600">{fmt(compra.totalPagado)}</span>
                  </div>

                  <div className="rounded-lg bg-muted/30 p-2">
                    <div className="mb-1 flex items-center justify-between border-b border-border/60 pb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                      <span>Producto</span>
                      <span className="flex gap-6">
                        <span className="w-10 text-right">Cant</span>
                        <span className="w-14 text-right">Importe</span>
                      </span>
                    </div>
                    {compra.items.map((item, ii) => (
                      <div key={ii} className="flex items-center justify-between py-1 text-sm">
                        <span className="min-w-0 flex-1 truncate">
                          {item.productoNombre}
                          {item.presentacionUsada && item.cantidadPresentacion !== item.cantidad ? (
                            <span className="ml-1 text-[10px] text-muted-foreground">({item.cantidadPresentacion} × {item.presentacionUsada})</span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-6">
                          <span className="num w-10 text-right text-primary">x{item.cantidad}</span>
                          <span className="num w-14 text-right">{fmt(item.subtotal)}</span>
                        </span>
                      </div>
                    ))}
                  </div>

                  {compra.nota ? (
                    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                      📄 {compra.nota}
                    </div>
                  ) : null}

                  {compra.puedeAnular && (
                    <Button
                      variant="destructive"
                      className="mt-2 w-full"
                      onClick={() => anularCompra(compra)}
                      disabled={anulandoId === compra.compraId}
                    >
                      {anulandoId === compra.compraId ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      {anulandoId === compra.compraId ? 'Anulando…' : 'Anular compra completa'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border bg-card py-20 text-center text-muted-foreground shadow-card">
            <ShoppingBag className="mx-auto mb-2 h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm font-medium">Sin compras</p>
            <p className="text-xs">en la fecha seleccionada</p>
          </div>
        )
      ) : (
        <div className="rounded-2xl border bg-card py-20 text-center text-muted-foreground shadow-card">
          <CalendarDays className="mx-auto mb-2 h-9 w-9 text-muted-foreground/30" />
          <p className="text-sm font-medium">Elegí una fecha y buscá las compras</p>
        </div>
      )}
    </div>
  )
}
