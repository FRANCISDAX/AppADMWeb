import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const fmt = (n: any) => 'S/ ' + (Number(n) || 0).toFixed(2)

type Item = { nombre?: string; cantidad?: number; precioVenta?: number; precio?: number; unidad?: string; presentacionNombre?: string; subtotal?: number }
type Pago = { tipo?: string; monto?: number }

const labelPago = (tipo?: string) =>
  tipo === 'efectivo' ? '💵 Efectivo' : tipo === 'transferencia' ? '📲 Transferencia' : tipo === 'credito' ? '💳 Crédito' : tipo === 'mixto' ? '🪙 Mixto' : (tipo || 'Efectivo')

export function ModalDetalleVenta({ venta, serieNumero, fecha, tipoDoc, onClose }: {
  venta: any
  serieNumero?: string
  fecha?: string
  tipoDoc?: string
  onClose: () => void
}) {
  const items: Item[] = Array.isArray(venta?.items) ? venta.items : []
  const pagos: Pago[] = Array.isArray(venta?.pagos) && venta.pagos.length
    ? venta.pagos
    : (venta?.tipoPago ? [{ tipo: venta.tipoPago, monto: venta.total }] : [])
  const total = venta?.total || 0
  const esAnulada = venta?.estado === 'anulada'
  const cliente = venta?.cliente_nombre || venta?.cliente || '-'
  const clienteDni = venta?.cliente_dni || venta?.clienteDoc || '-'
  const tipoDocLabel = tipoDoc === 'NV' ? 'Nota de Venta' : tipoDoc === 'BOLETA' ? 'Boleta' : tipoDoc === 'FACTURA' ? 'Factura' : (tipoDoc || 'Venta')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-bold">{tipoDocLabel}</h2>
            <div className="text-sm font-semibold text-primary">{serieNumero || venta?.serie_numero || venta?.serieNumero || '-'}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Estado */}
          {esAnulada && (
            <div className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm font-bold text-destructive">🚫 Anulada</div>
          )}

          {/* Fecha / cliente */}
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted/60 p-3">
              <div className="text-[11px] text-muted-foreground">Fecha</div>
              <div className="text-sm font-bold">{fecha ? new Date(fecha).toLocaleString('es-PE') : '-'}</div>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <div className="text-[11px] text-muted-foreground">Cliente</div>
              <div className="truncate text-sm font-bold">{cliente}</div>
              <div className="text-[11px] text-muted-foreground">{clienteDni !== '-' ? clienteDni : 'Documento: -'}</div>
            </div>
          </div>

          {/* Items */}
          <div className="mb-4 overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-[11px] uppercase text-muted-foreground">
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-center">Cant.</th>
                  <th className="px-3 py-2 text-right">P. Unit</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td className="px-3 py-3 text-center text-muted-foreground" colSpan={4}>Sin detalle de items</td></tr>
                ) : items.map((it, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-2 font-semibold">{it.nombre}</td>
                    <td className="px-3 py-2 text-center">{it.cantidad ?? 0} {it.unidad || it.presentacionNombre || ''}</td>
                    <td className="px-3 py-2 text-right">{fmt(it.precioVenta ?? it.precio ?? 0)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmt(it.subtotal ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Desglose de pago */}
          <div className="mb-4 space-y-1.5 rounded-xl bg-muted/40 p-3 text-sm">
            {pagos.map((p, i) => (
              <div key={i} className="flex items-center justify-between">
                <span>{labelPago(p.tipo)}</span>
                <span className="font-bold">{fmt(p.monto ?? 0)}</span>
              </div>
            ))}
            {venta?.montoRecibido != null && venta?.montoRecibido > 0 && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Recibido</span><span>{fmt(venta.montoRecibido)}</span>
              </div>
            )}
            {venta?.cambio != null && venta?.cambio > 0 && (
              <div className="flex items-center justify-between text-emerald-600">
                <span>Vuelto</span><span>{fmt(venta.cambio)}</span>
              </div>
            )}
            {venta?.referencia && (
              <div className="text-[11px] text-muted-foreground">Ref: {venta.referencia}</div>
            )}
          </div>

          {/* Total */}
          <div className={cn('flex items-center justify-between rounded-xl bg-primary/10 px-4 py-3', esAnulada && 'opacity-60')}>
            <span className="font-bold">Total</span>
            <span className="text-lg font-extrabold text-primary">{fmt(total)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
