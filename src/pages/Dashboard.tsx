import { Clock, DollarSign, RefreshCw, ShoppingCart, TrendingUp, Users } from 'lucide-react'
import * as React from 'react'
import { collection, query, onSnapshot, orderBy, limit, getDocs, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { cn } from '@/lib/utils'
import { ModalDetalleVenta } from '@/components/ModalDetalleVenta'
import { PanelAlertas } from '@/components/PanelAlertas'
import { VentasAnioWidget } from '@/components/dashboard/VentasAnioWidget'
import { PuntoEquilibrioWidget } from '@/components/dashboard/PuntoEquilibrioWidget'

const fmt = (n: number) => 'S/ ' + n.toFixed(2)

type VentaReciente = {
  id: string
  fecha: string
  fechaCompleta: string
  total: number
  metodoPago: string
  cliente: string
  items: number
  serieNumero?: string
  tipoDoc?: string
  venta?: any
}

type ProductoTop = {
  nombre: string
  cantidad: number
  total: number
}

type MetodosPago = {
  efectivo: number
  yape: number
  plin: number
  transferencia: number
  credito: number
  otros: number
}

export function Dashboard({ onNavigate }: { onNavigate?: (seccion: string) => void } = {}) {
  const [ventasHoy, setVentasHoy] = React.useState(0)
  const [transacciones, setTransacciones] = React.useState(0)
  const [ventasRecientes, setVentasRecientes] = React.useState<VentaReciente[]>([])
  const [topProductos, setTopProductos] = React.useState<ProductoTop[]>([])
  const [metodosPago, setMetodosPago] = React.useState<MetodosPago>({ efectivo: 0, yape: 0, plin: 0, transferencia: 0, credito: 0, otros: 0 })
  const [ventasPorHora, setVentasPorHora] = React.useState<Record<number, number>>({})
  const [cargando, setCargando] = React.useState(true)
  const [ultimaActualizacion, setUltimaActualizacion] = React.useState(new Date())
  const [ventaSeleccionada, setVentaSeleccionada] = React.useState<VentaReciente | null>(null)

  React.useEffect(() => {
    const q = query(
      collection(db, COL.TURNOS),
      orderBy('fechaApertura', 'desc'),
      limit(1)
    )

    const unsub = onSnapshot(q, async (snap) => {
      let total = 0
      let count = 0
      const productosMap = new Map<string, { nombre: string; cantidad: number; total: number }>()
      const metodos: MetodosPago = { efectivo: 0, yape: 0, plin: 0, transferencia: 0, credito: 0, otros: 0 }
      const porHora: Record<number, number> = {}
      const recientes: VentaReciente[] = []

      for (const doc of snap.docs) {
        const data = doc.data()
        const ventas = data.ventasDelTurno || []

        total = data.totalVentas || 0
        metodos.efectivo = data.totalEfectivo || 0
        metodos.transferencia = data.totalTransferencia || 0
        count = ventas.filter((v: any) => v.estado !== 'anulada').length

        for (const venta of ventas) {
          if (venta.estado === 'anulada') continue
          if (venta.consolidado || venta.sunat?.consolidado) continue

          const monto = venta.total || 0

          const fechaRaw = venta.fecha
          const fecha = fechaRaw?.toDate ? fechaRaw.toDate() : fechaRaw ? new Date(fechaRaw) : new Date()
          const hora = fecha.getHours()
          porHora[hora] = (porHora[hora] || 0) + monto

          const items = venta.items || []
          for (const item of items) {
            const nombre = item.nombre || 'Producto'
            const cant = item.cantidad || 1
            const sub = item.subtotal || 0
            const existing = productosMap.get(nombre) || { nombre, cantidad: 0, total: 0 }
            existing.cantidad += cant
            existing.total += sub
            productosMap.set(nombre, existing)
          }

          if (recientes.length < 5) {
            const tipo = (venta.tipoPago || 'efectivo').toLowerCase()
            let metodoDisplay = tipo === 'transferencia' ? '📲 TRANSF' : tipo === 'credito' ? '💳 Crédito' : '💵 Efectivo'

            if (tipo === 'transferencia' && venta.serie_numero) {
              try {
                const docSnap = await getDocs(query(collection(db, COL.DOCUMENTOS), where('serie_numero', '==', venta.serie_numero), limit(1)))
                if (!docSnap.empty) {
                  const docData = docSnap.docs[0].data()
                  const inner = docData.venta || docData
                  const ref = (inner.referencia || docData.referencia || '').toLowerCase()
                  if (ref.includes('yape')) metodoDisplay = '📱 Yape'
                  else if (ref.includes('plin')) metodoDisplay = '📱 Plin'
                }
              } catch {}
            }

            recientes.push({
              id: venta.serie_numero || doc.id,
              fecha: fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
              fechaCompleta: fecha.toISOString(),
              total: monto,
              metodoPago: metodoDisplay,
              cliente: venta.cliente_nombre || 'Cliente',
              items: items.length,
              serieNumero: venta.serie_numero || '',
              tipoDoc: venta.tipoDoc || 'NV',
              venta: venta,
            })
          }
        }
      }

      setVentasHoy(total)
      setTransacciones(count)
      setVentasRecientes(recientes)
      setTopProductos([...productosMap.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 5))
      setMetodosPago(metodos)
      setVentasPorHora(porHora)
      setUltimaActualizacion(new Date())
      setCargando(false)
    })

    return () => unsub()
  }, [])

  const ticketPromedio = transacciones > 0 ? ventasHoy / transacciones : 0
  const horaActual = new Date().getHours()
  const maxHora = Math.max(...Object.values(ventasPorHora), 1)

  if (cargando) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <RefreshCw className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando dashboard…</span>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Dashboard Gerencial</h2>
          <p className="text-xs text-muted-foreground">
            <Clock className="inline h-3 w-3 mr-1" />
            Actualizado: {ultimaActualizacion.toLocaleTimeString('es-PE')}
          </p>
        </div>
      </div>

      {/* Alertas proactivas: lo que ya está mal, primero y sin tener que ir a buscarlo.
          ⚠️ Va arriba de los números a propósito: un total de ventas no dice que el puente de Yape
          esté caído (la plata entró y el PDV no lo sabe) ni que haya un turno de ayer sin cerrar. */}
      <PanelAlertas onIr={onNavigate} />

      {/* Tarjetas principales */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            Ventas Hoy
          </div>
          <div className="mt-1 text-xl font-bold num">{fmt(ventasHoy)}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShoppingCart className="h-4 w-4" />
            Transacciones
          </div>
          <div className="mt-1 text-xl font-bold">{transacciones}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            Ticket Promedio
          </div>
          <div className="mt-1 text-xl font-bold num">{fmt(ticketPromedio)}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-4 w-4" />
            Top Producto
          </div>
          <div className="mt-1 text-sm font-bold truncate">{topProductos[0]?.nombre || '-'}</div>
          <div className="text-xs text-muted-foreground">{topProductos[0]?.cantidad || 0} uds</div>
        </div>
      </div>

      {/* La mirada larga: los 12 meses del año elegido. Va antes de “Ventas por Hora” porque
          responde la pregunta del gerente (“¿cómo viene el año?”) y no la del turno. */}
      <VentasAnioWidget />

      {/* ¿Alcanza lo que vendí? Los costos fijos del mes contra el margen de los últimos 3 meses. */}
      <PuntoEquilibrioWidget />

      {/* Ventas por hora */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="border-b px-4 py-3 text-sm font-bold">Ventas por Hora</div>
        <div className="p-4">
          {Object.keys(ventasPorHora).length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Sin ventas hoy</div>
          ) : (
            <div className="space-y-2">
              {Object.entries(ventasPorHora)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([hora, monto]) => (
                  <div key={hora} className="flex items-center gap-2">
                    <div className="w-8 text-right text-xs text-muted-foreground">{hora}h</div>
                    <div className="flex-1">
                      <div
                        className={cn(
                          'h-5 rounded-sm transition-all',
                          Number(hora) === horaActual ? 'bg-primary' : 'bg-primary/60'
                        )}
                        style={{ width: `${(monto / maxHora) * 100}%`, minWidth: monto > 0 ? '4px' : '0' }}
                      />
                    </div>
                    <div className="w-20 text-right text-xs font-bold num">{fmt(monto)}</div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Top productos */}
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="border-b px-4 py-3 text-sm font-bold">Top 5 Productos</div>
          {topProductos.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Sin ventas hoy</div>
          ) : (
            <div className="divide-y">
              {topProductos.map((p, i) => (
                <div key={p.nombre} className="flex items-center gap-3 px-4 py-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.nombre}</div>
                    <div className="text-xs text-muted-foreground">{p.cantidad} unidades</div>
                  </div>
                  <div className="text-sm font-bold num">{fmt(p.total)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Métodos de pago */}
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="border-b px-4 py-3 text-sm font-bold">Métodos de Pago</div>
          <div className="p-4">
            {ventasHoy === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Sin ventas hoy</div>
            ) : (
              <div className="space-y-3">
                {([
                  { key: 'efectivo', label: 'Efectivo', color: 'bg-emerald-500' },
                  { key: 'yape', label: 'Yape', color: 'bg-purple-500' },
                  { key: 'plin', label: 'Plin', color: 'bg-sky-500' },
                  { key: 'transferencia', label: 'Transferencia', color: 'bg-amber-500' },
                  { key: 'credito', label: 'Crédito', color: 'bg-red-500' },
                  { key: 'otros', label: 'Otros', color: 'bg-gray-400' },
                ] as const).filter(({ key }) => metodosPago[key] > 0).map(({ key, label, color }) => {
                  const monto = metodosPago[key]
                  const porcentaje = ventasHoy > 0 ? (monto / ventasHoy) * 100 : 0
                  return (
                    <div key={key}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium">{label}</span>
                        <span className="num">{fmt(monto)} ({porcentaje.toFixed(0)}%)</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${porcentaje}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Ventas recientes */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="border-b px-4 py-3 text-sm font-bold">Ventas Recientes</div>
        {ventasRecientes.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Sin ventas hoy</div>
        ) : (
          <div className="divide-y">
            {ventasRecientes.map((v) => (
              <div key={v.id} className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setVentaSeleccionada(v)}>
                <div className="text-xs text-muted-foreground">{v.fecha}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{v.cliente}</div>
                  <div className="text-xs text-muted-foreground">{v.serieNumero || v.id} · {v.items} producto{v.items !== 1 ? 's' : ''}</div>
                </div>
                <div className="text-sm font-bold num">{fmt(v.total)}</div>
                <div className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  v.metodoPago.includes('Yape') ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' :
                  v.metodoPago.includes('Plin') ? 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300' :
                  v.metodoPago.includes('TRANSF') ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' :
                  v.metodoPago.includes('Crédito') ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
                )}>
                  {v.metodoPago.includes('Yape') ? '📱 Yape' : 
                   v.metodoPago.includes('Plin') ? '📱 Plin' : 
                   v.metodoPago.includes('TRANSF') ? '📲 TRANSF' :
                   v.metodoPago.includes('Crédito') ? '💳 Crédito' : '💵 Efectivo'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {ventaSeleccionada && (
        <ModalDetalleVenta
          venta={ventaSeleccionada.venta}
          serieNumero={ventaSeleccionada.serieNumero}
          fecha={ventaSeleccionada.fechaCompleta}
          tipoDoc={ventaSeleccionada.tipoDoc}
          onClose={() => setVentaSeleccionada(null)}
        />
      )}
    </div>
  )
}

export default Dashboard
