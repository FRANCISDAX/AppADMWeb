import { Check, Clock, Loader2, Trash2, User } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/components/notifications'
import { usePermisos } from '@/context/permisos'
import { useAuth } from '@/context/auth'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { fmt } from '@/lib/ui-utils'
import { MEDIOS, bolsilloDe, infoMedio, tipoPagoDe, type PagoGuardado } from '@/lib/pagos'
import { avisoOtraCaja, nombreCaja, repartirPedidos } from '@/lib/pedidos'
import { obtenerVentasPendientes, cobrarVentaPendiente, cancelarVentaPendiente, type DocumentoVenta } from '@/services/ventas'
import { cn } from '@/lib/utils'

/** Tipos de comprobante que el cajero puede asignar al cobrar una venta pendiente. */
const TIPOS_COMP = [
  { id: 'NV', label: 'Nota de Venta' },
  { id: 'BOLETA', label: 'Boleta' },
  { id: 'FACTURA', label: 'Factura' },
] as const

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
 * El reparto **mío / de otra caja** lo hace `repartirPedidos()` (`lib/pedidos.ts`, puro y testeado);
 * acá solo se pinta. Los de otra caja se muestran en un bloque aparte y se pueden cobrar (rescate
 * cuando esa caja está caída), avisando que el comprobante sale con la serie de **esta** caja.
 */
export function PanelVentasPendientes() {
  const { user } = useAuth()
  const { cajaId, nombre: nombreUsuario, tienePermiso, serieBoleta, serieFactura, seriePrefijo } = usePermisos()
  const { config } = useConfiguracion()
  const { toast, confirm } = useNotifications()
  const [ventas, setVentas] = React.useState<DocumentoVenta[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [procesandoId, setProcesandoId] = React.useState<string | null>(null)
  const [cancelandoId, setCancelandoId] = React.useState<string | null>(null)
  const [motivoCancel, setMotivoCancel] = React.useState('')
  // Cobro: el cajero elige el comprobante y la forma de pago (el vendedor no los decide).
  const [cobrandoId, setCobrandoId] = React.useState<string | null>(null)
  const [tipoDocSel, setTipoDocSel] = React.useState<'NV' | 'BOLETA' | 'FACTURA'>('NV')
  const [medioSel, setMedioSel] = React.useState<string>('efectivo')
  const [operacion, setOperacion] = React.useState('')
  const [recibido, setRecibido] = React.useState('')

  // Se traen TODOS los pedidos y el reparto lo hace `repartirPedidos` (regla pura y testeada):
  // filtrar en la consulta dejaba la lista ciega por configuración de caja.
  const cargar = React.useCallback(async () => {
    const lista = await obtenerVentasPendientes()
    setVentas(lista)
    setCargando(false)
  }, [])

  const { mios, otrasCajas } = React.useMemo(() => repartirPedidos(ventas, cajaId), [ventas, cajaId])

  React.useEffect(() => { cargar() }, [cargar])

  // Refresco cada 30s
  React.useEffect(() => {
    const timer = setInterval(() => { cargar() }, 30000)
    return () => clearInterval(timer)
  }, [cargar])

  async function cobrar(v: DocumentoVenta) {
    if (!tienePermiso('cobrarVenta')) return toast('🚫 No tenés permiso para cobrar', 'error')

    // Pedir turno abierto
    const { buscarTurnoAbierto } = await import('@/services/turnos')
    const turno = await buscarTurnoAbierto(user?.uid, tienePermiso('verTodo'))
    if (!turno) return toast('🚫 No hay un turno abierto. Abrí un turno antes de cobrar.', 'error')

    // Pedido de otra caja (rescate: su caja está caída o nadie lo transfirió): se cobra, pero
    // avisando con qué serie sale, porque el comprobante lo emite ESTA caja.
    if (v.cajaId && cajaId && v.cajaId !== cajaId) {
      const ok = await confirm({
        title: 'Pedido de otra caja',
        message: `${avisoOtraCaja(v.cajaId, cajaId)}\nSi lo ideal es que lo cobre la ${nombreCaja(v.cajaId)}, pedile al administrador que transfiera los pedidos en Configuración → Cajas.`,
        okText: 'Cobrar igual',
      })
      if (!ok) return
    }

    const venta = (v.venta || {}) as Record<string, unknown>
    const total = Number(venta.total || 0)
    const docCliente = String(venta.cliente_dni || '').trim()

    // Mismas validaciones que el PDV: Factura exige RUC y Boleta grande exige DNI.
    if (tipoDocSel === 'FACTURA' && !/^\d{11}$/.test(docCliente)) {
      return toast('⚠️ La Factura necesita el RUC (11 dígitos) del cliente en la venta', 'error')
    }
    const tope = Number(config.topeBoletaDni) > 0 ? Number(config.topeBoletaDni) : 700
    if (tipoDocSel === 'BOLETA' && total > tope && !/^\d{8}$/.test(docCliente)) {
      return toast(`⚠️ Boletas mayores a ${fmt(tope)} requieren DNI (8 dígitos) del cliente`, 'error')
    }

    const esEfectivo = medioSel === 'efectivo'
    const recibidoNum = esEfectivo ? (parseFloat(recibido.replace(',', '.')) || total) : total
    if (esEfectivo && recibidoNum < total) {
      return toast(`⚠️ Recibiste ${fmt(recibidoNum)} y el total es ${fmt(total)}`, 'error')
    }
    const info = infoMedio(medioSel)
    const pagos: PagoGuardado[] = [{
      tipo: bolsilloDe(medioSel),
      medio: info.medio,
      monto: total,
      ...(info.pideOperacion && operacion.trim() ? { operacion: operacion.trim() } : {}),
    }]

    setProcesandoId(v.id)
    try {
      const res = await cobrarVentaPendiente({
        documentoId: v.id,
        turnoId: turno.id || '',
        pagos,
        tipoPago: tipoPagoDe(pagos),
        montoRecibido: esEfectivo ? recibidoNum : total,
        cambio: esEfectivo ? Math.max(0, recibidoNum - total) : 0,
        cajeroId: user?.uid || '',
        cajeroNombre: nombreUsuario || user?.email || 'sistema',
        // El comprobante lo define el cajero: puede mantener el que puso el vendedor o cambiarlo.
        tipoDoc: tipoDocSel,
        // Queda registrado que el comprobante lo emitió **esta** caja.
        cajaId: cajaId || undefined,
        // ⚠️ Las series salen de **la caja del cajero** (igual que en el PDV), no solo de la
        // configuración de la empresa: si no, un cajero de la caja 2 emitiría con la serie de la 1.
        config: {
          ...config,
          serieBoleta: serieBoleta || config.serieBoleta,
          serieFactura: serieFactura || config.serieFactura,
          serie_prefijo: seriePrefijo || config.serie_prefijo,
        },
      })
      if (res.success) {
        toast(`✅ Venta ${res.correlativo || v.serieNumero} cobrada (${tipoDocSel})`)
        setVentas((prev) => prev.filter((x) => x.id !== v.id))
        setCobrandoId(null)
      } else {
        toast(`❌ ${res.error || 'Error al cobrar'}`, 'error')
      }
    } catch (e) {
      toast(`❌ ${(e as Error).message}`, 'error')
    } finally {
      setProcesandoId(null)
    }
  }

  function abrirCobro(v: DocumentoVenta) {
    setCobrandoId(v.id)
    // El pedido no tiene tipo fiscal (`PENDIENTE`): el cajero lo elige acá y recién ahí se
    // genera el comprobante. Por defecto, Nota de Venta.
    const t = (v.tipoDoc || v.tipo) as string
    setTipoDocSel(t === 'BOLETA' || t === 'FACTURA' ? t : 'NV')
    setMedioSel('efectivo')
    setOperacion('')
    setRecibido('')
  }

  async function cancelar(v: DocumentoVenta) {
    if (!tienePermiso('cancelarVentaPendiente')) return toast('🚫 No tenés permiso para eliminar', 'error')
    setCancelandoId(v.id)
    setMotivoCancel('')
  }

  async function confirmarCancelacion(v: DocumentoVenta) {
    if (!motivoCancel.trim()) return toast('⚠️ Ingresá un motivo')
    const ok = await confirm({
      title: '¿Eliminar esta venta?',
      message: 'No hay comprobante emitido, así que no se anula nada. El stock nunca se tocó (se descuenta al cobrar), así que los productos quedan como estaban y la venta se registra como eliminada con su motivo.',
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
    const procesando = procesandoId === v.id
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

        {cobrandoId === v.id ? (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
            <div>
              <div className="mb-1 text-[11px] font-bold text-muted-foreground">Comprobante</div>
              <div className="flex flex-wrap gap-1.5">
                {TIPOS_COMP.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTipoDocSel(t.id)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer',
                      tipoDocSel === t.id ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">
                El comprobante se genera recién al cobrar: se asigna la serie de {tipoDocSel} y su correlativo.
              </p>
            </div>

            <div>
              <div className="mb-1 text-[11px] font-bold text-muted-foreground">Forma de pago</div>
              <div className="flex flex-wrap gap-1.5">
                {MEDIOS.map((m) => (
                  <button
                    key={m.medio}
                    onClick={() => setMedioSel(m.medio)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer',
                      medioSel === m.medio ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                    )}
                  >
                    {m.icono} {m.label}
                  </button>
                ))}
              </div>
            </div>

            {infoMedio(medioSel).pideOperacion && (
              <input
                value={operacion}
                onChange={(e) => setOperacion(e.target.value)}
                placeholder="N° de operación (opcional)"
                className="w-full rounded-lg border bg-background px-3 py-1.5 text-xs"
              />
            )}

            {medioSel === 'efectivo' && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Recibí</span>
                <input
                  value={recibido}
                  onChange={(e) => setRecibido(e.target.value)}
                  placeholder={total.toFixed(2)}
                  inputMode="decimal"
                  className="w-24 rounded-lg border bg-background px-2 py-1.5 text-right text-xs"
                />
                {(() => {
                  const r = parseFloat(recibido.replace(',', '.')) || total
                  const cambio = r - total
                  return cambio > 0 ? <span className="text-[11px] font-bold text-primary">Vuelto {fmt(cambio)}</span> : null
                })()}
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => setCobrandoId(null)}>Volver</Button>
              <Button size="sm" className="flex-1" onClick={() => cobrar(v)} disabled={procesando}>
                {procesando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {procesando ? 'Cobrando…' : `Confirmar cobro ${fmt(total)}`}
              </Button>
            </div>
          </div>
        ) : cancelando ? (
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
              <Button size="sm" className="flex-1" onClick={() => abrirCobro(v)} disabled={procesando}>
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
                disabled={procesando}
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
