import * as React from 'react'
import { Loader2, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { fmt } from '@/lib/ui-utils'
import { codigoDePedido, comprobanteDePedido, estadoPedido, pedidosVisiblesPara, textoItemsPedido, type PedidoEnLista } from '@/lib/pedidos'
import { obtenerPedidosDelMes } from '@/services/ventas'

/** Mes actual en el formato del `<input type="month">` (`2026-09`). */
function mesDeHoy(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const ESTADO: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: 'En caja', clase: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  cobrado: { texto: 'Cobrado', clase: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  eliminado: { texto: 'Eliminado', clase: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

/**
 * **Pedidos enviados a caja** — el botón que pidió el vendedor para saber qué mandó y en qué terminó.
 *
 * 🔑 Solo aplica al rol vendedor: el botón se muestra únicamente si el usuario tiene `enviarACaja` y
 * **no** `cobrarVenta` (el PDV lo decide con `esVendedor`). La lista la filtra
 * **`pedidosVisiblesPara()`** (`lib/pedidos.ts`, pura y testeada), así que un vendedor ve **solo sus
 * pedidos** aunque la consulta traiga los del mes.
 */
export function PanelMisPedidos({ onCerrar }: { onCerrar: () => void }) {
  const { user } = useAuth()
  const { tienePermiso } = usePermisos()
  const [mes, setMes] = React.useState(mesDeHoy())
  // El mes cargado viaja CON los datos: así «cargando» se **deriva** (`datos.mes !== mes`) en vez de
  // sincronizarse con un efecto, que es la regla del repo (evita el warning `set-state-in-effect`).
  const [datos, setDatos] = React.useState<{ mes: string; lista: PedidoEnLista[] } | null>(null)

  React.useEffect(() => {
    let activo = true
    const [y, m] = mes.split('-')
    ;(async () => {
      try {
        const delMes = (await obtenerPedidosDelMes(`${y}-${Number(m)}`)) as unknown as PedidoEnLista[]
        if (activo) setDatos({ mes, lista: pedidosVisiblesPara(delMes, { uid: user?.uid, verTodo: tienePermiso('verTodo') }) })
      } catch (e) {
        console.warn('⚠️ No se pudieron cargar tus pedidos:', e)
        if (activo) setDatos({ mes, lista: [] })
      }
    })()
    return () => {
      activo = false
    }
  }, [mes, user?.uid, tienePermiso])

  const cargando = datos?.mes !== mes
  const pedidos = cargando ? [] : datos.lista

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCerrar}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-sm font-bold">Pedidos enviados a caja</p>
            <p className="text-[11px] text-muted-foreground">Lo que mandaste y en qué terminó cada pedido</p>
          </div>
          <div className="flex items-center gap-2">
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="h-8 rounded-lg border px-2 text-xs" />
            <Button variant="ghost" size="sm" onClick={onCerrar} aria-label="Cerrar">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {cargando ? (
            <p className="py-14 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />Cargando tus pedidos…
            </p>
          ) : pedidos.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">No enviaste pedidos en este mes</p>
          ) : (
            <div className="divide-y">
              {pedidos.map((p) => {
                const estado = estadoPedido(p)
                const comprobante = comprobanteDePedido(p)
                const total = Number((p.venta as { total?: unknown } | null | undefined)?.total) || 0
                const items = (p.venta as { items?: unknown } | null | undefined)?.items
                return (
                  <div key={p.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold">{codigoDePedido(p)}</span>
                      <Badge className={ESTADO[estado]?.clase}>
                        {estado === 'cobrado' && comprobante ? `Cobrado · ${comprobante}` : ESTADO[estado]?.texto}
                      </Badge>
                      <span className="num ml-auto text-sm font-bold">{fmt(total)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {p.fecha ? new Date(p.fecha).toLocaleString('es-PE') : ''}
                      {estado === 'cobrado' && p.cajero ? ` · Cobró: ${p.cajero}` : ''}
                    </p>
                    <p className="mt-1 text-xs">{textoItemsPedido(Array.isArray(items) ? (items as never) : [])}</p>
                    {estado === 'eliminado' && p.motivoCancelacion && (
                      <p className="text-[11px] text-destructive">Motivo: {p.motivoCancelacion}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t px-4 py-2">
          <p className="text-[11px] text-muted-foreground">
            {pedidos.length} pedido(s) · «En caja» espera que un cajero lo cobre; «Cobrado» muestra el comprobante emitido.
          </p>
        </div>
      </div>
    </div>
  )
}
