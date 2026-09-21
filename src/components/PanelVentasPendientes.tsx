import { Check, Clock, Loader2, Trash2, User } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/components/notifications'
import { usePermisos } from '@/context/permisos'
import { useAuth } from '@/context/auth'
import { fmt } from '@/lib/ui-utils'
import { nombreCaja, repartirPedidos } from '@/lib/pedidos'
import { obtenerVentasPendientes, suscribirVentasPendientes, cancelarVentaPendiente, type DocumentoVenta } from '@/services/ventas'

function tiempoTranscurrido(fechaIso: string): string {
  const diff = Date.now() - new Date(fechaIso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m`
  const dias = Math.floor(hrs / 24)
  return `${dias}d ${hrs % 24}h`
}

/**
 * Pedidos esperando cobro, tal como los ve el cajero dentro del PDV.
 *
 * **Acá no se cobra**: *Cobrar pedido* se lo pasa al PDV, que carga el pedido en el carrito y lo
 * cobra con la misma UI y las mismas validaciones que una venta normal (`cobrarVentaPendiente`).
 * Antes esta tarjeta tenía su propia copia del cobro (comprobante, formas de pago, validaciones de
 * RUC/DNI) y el cajero veía **dos lugares** para lo mismo.
 *
 * El reparto **mío / de otra caja** lo hace `repartirPedidos()` (`lib/pedidos.ts`, puro y testeado).
 */
export function PanelVentasPendientes({
  onCobrarPedido,
}: {
  /** El PDV trae el pedido al carrito para cobrarlo. */
  onCobrarPedido: (pedido: DocumentoVenta) => void
}) {
  const { user } = useAuth()
  const { cajaId, nombre: nombreUsuario, tienePermiso } = usePermisos()
  const { toast, confirm } = useNotifications()
  const [ventas, setVentas] = React.useState<DocumentoVenta[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [cancelandoId, setCancelandoId] = React.useState<string | null>(null)
  const [motivoCancel, setMotivoCancel] = React.useState('')

  // Se traen TODOS los pedidos y el reparto lo hace `repartirPedidos` (regla pura y testeada):
  // filtrar en la consulta dejaba la lista ciega por configuración de caja.
  const cargar = React.useCallback(async () => {
    const lista = await obtenerVentasPendientes()
    setVentas(lista)
    setCargando(false)
  }, [])

  const { mios, otrasCajas } = React.useMemo(() => repartirPedidos(ventas, cajaId), [ventas, cajaId])

  React.useEffect(() => {
    // 🔑 La lista se escucha **en vivo** (`onSnapshot`): un pedido que se cobra o se elimina sale al
    // instante, acá o desde otra caja. Antes se refrescaba cada 30 s y el pedido ya procesado podía
    // seguir a la vista, pareciendo pendiente. Si el canal se corta, se cae al refresco periódico
    // para que la lista nunca quede congelada.
    let timer: ReturnType<typeof setInterval> | null = null
    const soltar = suscribirVentasPendientes(
      (lista) => {
        setVentas(lista)
        setCargando(false)
      },
      () => {
        console.warn('⚠️ Se perdió el canal en vivo de pedidos: se refresca cada 30 s')
        cargar()
        timer = setInterval(() => { cargar() }, 30000)
      },
    )
    return () => {
      soltar()
      if (timer) clearInterval(timer)
    }
  }, [cargar])

  function cancelar(v: DocumentoVenta) {
    if (!tienePermiso('cancelarVentaPendiente')) return toast('🚫 No tenés permiso para eliminar', 'error')
    setCancelandoId(v.id)
    setMotivoCancel('')
  }

  async function confirmarCancelacion(v: DocumentoVenta) {
    if (!motivoCancel.trim()) return toast('⚠️ Ingresá un motivo')
    const ok = await confirm({
      title: '¿Eliminar esta venta?',
      message: '⚠️ El pedido NO se borra: queda registrado como eliminado, con tu motivo y quién lo eliminó (queda el rastro en Auditoría). No hay comprobante que anular y el stock nunca se tocó.',
      okText: 'Eliminar venta',
    })
    if (!ok) return

    try {
      const res = await cancelarVentaPendiente({
        documentoId: v.id,
        motivo: motivoCancel.trim(),
        usuario: nombreUsuario || user?.email || 'sistema',
      })
      if (res.success) {
        toast('Venta eliminada · el stock no se tocó')
        setVentas((prev) => prev.filter((x) => x.id !== v.id))
        setCancelandoId(null)
        setMotivoCancel('')
      } else {
        toast(`❌ ${res.error || 'Error al eliminar'}`, 'error')
      }
    } catch (e) {
      toast(`❌ ${(e as Error).message}`, 'error')
    }
  }

  /** Tarjeta de un pedido: una sola implementación para los dos grupos (míos y de otra caja). */
  function tarjeta(v: DocumentoVenta) {
    const total = (v.venta as Record<string, unknown>)?.total as number ?? 0
    const items = (v.venta as Record<string, unknown>)?.items as { nombre: string; quantity: number }[] | undefined
    const itemCount = items?.length ?? 0
    const cancelando = cancelandoId === v.id
    // La caja solo se aclara cuando aporta (usuario sin caja, o caja distinta de la suya).
    const otraCaja = Boolean(v.cajaId) && v.cajaId !== cajaId

    return (
      <div key={v.id} className="rounded-xl border bg-card p-3 space-y-2">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold">{v.serieNumero}</span>
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Pendiente</span>
              {otraCaja && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {nombreCaja(v.cajaId)}
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">Pedido sin comprobante · el stock se descuenta al cobrar</p>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
              <User className="h-3 w-3" />
              <span>{v.vendedorNombre || '—'}</span>
              <span>·</span>
              <span>{itemCount} item(s)</span>
              <span>·</span>
              <Clock className="h-3 w-3" />
              <span>{v.fecha ? tiempoTranscurrido(v.fecha) : ''}</span>
            </div>
          </div>
          <span className="text-sm font-extrabold">{fmt(total)}</span>
        </div>

        {cancelando ? (
          <div className="space-y-2">
            <input
              value={motivoCancel}
              onChange={(e) => setMotivoCancel(e.target.value)}
              placeholder="Motivo de la eliminación…"
              className="w-full rounded-lg border bg-background px-3 py-1.5 text-xs"
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground">
              No hay comprobante que anular y el stock aún no se descontó: se descuenta al cobrar.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => setCancelandoId(null)}>Volver</Button>
              <Button size="sm" variant="destructive" className="flex-1" onClick={() => confirmarCancelacion(v)} disabled={!motivoCancel.trim()}>
                Confirmar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            {tienePermiso('cobrarVenta') && (
              // ⚠️ "Cobrar pedido", no "Cobrar": el PDV tiene abajo el "Cobrar" del carrito y dos
              // botones con el mismo nombre en la misma columna significan cosas distintas.
              <Button size="sm" className="flex-1" onClick={() => onCobrarPedido(v)}>
                <Check className="h-3.5 w-3.5" />
                Cobrar pedido
              </Button>
            )}
            {tienePermiso('cancelarVentaPendiente') && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => cancelar(v)}
                title="Eliminar la venta (el stock no se toca: se descuenta al cobrar)"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Eliminar
              </Button>
            )}
          </div>
        )}
      </div>
    )
  }

  // ⚠️ Acá NO va un `if (!cajaId) return null`: era justamente lo que dejaba al cajero sin caja
  // viendo un panel vacío mientras el pedido esperaba. El caso "sin caja" se avisa dentro.
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Ventas Pendientes</h3>
        {ventas.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">{ventas.length}</span>
        )}
      </div>

      {cargando ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : ventas.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {cajaId ? `No hay ventas pendientes para la ${nombreCaja(cajaId)}` : 'No hay ventas pendientes'}
        </p>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {!cajaId && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Tu usuario no tiene una caja asignada: se muestran los pedidos de <strong>todas las cajas</strong>. Pedile al administrador que te asigne una en <em>Usuarios → Editar</em> para que las series del comprobante sean las de tu caja.
            </p>
          )}

          {mios.map((v) => tarjeta(v))}

          {otrasCajas.length > 0 && (
            <div className="space-y-2 rounded-xl border border-dashed border-slate-300 p-2 dark:border-slate-700">
              <p className="text-[10px] text-muted-foreground">
                <strong>Pedidos de otra caja</strong> ({otrasCajas.length}): se pueden cobrar igual, pero el comprobante sale con la serie de tu {nombreCaja(cajaId)}. Si esa caja no va a volver, el administrador puede transferirlos en <em>Configuración → Cajas</em>.
              </p>
              {otrasCajas.map((v) => tarjeta(v))}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
