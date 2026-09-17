import { Check, Clock, Loader2, Trash2, User } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/components/notifications'
import { usePermisos } from '@/context/permisos'
import { useAuth } from '@/context/auth'
import { fmt } from '@/lib/ui-utils'
import { obtenerVentasPendientes, cobrarVentaPendiente, cancelarVentaPendiente, type DocumentoVenta } from '@/services/ventas'

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

export function PanelVentasPendientes() {
  const { user } = useAuth()
  const { cajaId, nombre: nombreUsuario, tienePermiso } = usePermisos()
  const { toast, confirm } = useNotifications()
  const [ventas, setVentas] = React.useState<DocumentoVenta[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [procesandoId, setProcesandoId] = React.useState<string | null>(null)
  const [cancelandoId, setCancelandoId] = React.useState<string | null>(null)
  const [motivoCancel, setMotivoCancel] = React.useState('')

  const cargar = React.useCallback(async () => {
    if (!cajaId) { setCargando(false); return }
    const lista = await obtenerVentasPendientes(cajaId)
    setVentas(lista)
    setCargando(false)
  }, [cajaId])

  React.useEffect(() => { cargar() }, [cargar])

  // Refresco cada 30s
  React.useEffect(() => {
    if (!cajaId) return
    const timer = setInterval(() => { cargar() }, 30000)
    return () => clearInterval(timer)
  }, [cajaId, cargar])

  async function cobrar(v: DocumentoVenta) {
    if (!tienePermiso('cobrarVenta')) return toast('🚫 No tenés permiso para cobrar', 'error')

    // Pedir turno abierto
    const { buscarTurnoAbierto } = await import('@/services/turnos')
    const turno = await buscarTurnoAbierto(user?.uid, tienePermiso('verTodo'))
    if (!turno) return toast('🚫 No hay un turno abierto. Abrí un turno antes de cobrar.', 'error')

    const items = (v.venta as Record<string, unknown>)?.items as { nombre: string; quantity: number }[] | undefined
    const itemCount = items?.length ?? 0
    const total = (v.venta as Record<string, unknown>)?.total as number ?? 0

    const ok = await confirm({
      title: '¿Cobrar esta venta?',
      message: `Vendedor: ${v.vendedorNombre || '—'}\nItems: ${itemCount}\nTotal: ${fmt(total)}\nComprobante: ${v.serieNumero}`,
      okText: 'Cobrar',
    })
    if (!ok) return

    setProcesandoId(v.id)
    try {
      const res = await cobrarVentaPendiente({
        documentoId: v.id,
        turnoId: turno.id || '',
        tipoPago: 'efectivo',
        cajeroId: user?.uid || '',
        cajeroNombre: nombreUsuario || user?.email || 'sistema',
      })
      if (res.success) {
        toast(`✅ Venta ${v.serieNumero} cobrada`)
        setVentas((prev) => prev.filter((x) => x.id !== v.id))
      } else {
        toast(`❌ ${res.error || 'Error al cobrar'}`, 'error')
      }
    } catch (e) {
      toast(`❌ ${(e as Error).message}`, 'error')
    } finally {
      setProcesandoId(null)
    }
  }

  async function cancelar(v: DocumentoVenta) {
    if (!tienePermiso('cancelarVentaPendiente')) return toast('🚫 No tenés permiso para cancelar', 'error')
    setCancelandoId(v.id)
    setMotivoCancel('')
  }

  async function confirmarCancelacion(v: DocumentoVenta) {
    if (!motivoCancel.trim()) return toast('⚠️ Ingresá un motivo')
    const ok = await confirm({ title: '¿Cancelar esta venta?', message: 'Esta acción no se puede deshacer.', okText: 'Cancelar venta' })
    if (!ok) return

    try {
      const res = await cancelarVentaPendiente({
        documentoId: v.id,
        motivo: motivoCancel.trim(),
        usuario: nombreUsuario || user?.email || 'sistema',
      })
      if (res.success) {
        toast('Venta cancelada')
        setVentas((prev) => prev.filter((x) => x.id !== v.id))
        setCancelandoId(null)
        setMotivoCancel('')
      } else {
        toast(`❌ ${res.error || 'Error al cancelar'}`, 'error')
      }
    } catch (e) {
      toast(`❌ ${(e as Error).message}`, 'error')
    }
  }

  if (!cajaId) return null

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
        <p className="py-4 text-center text-xs text-muted-foreground">No hay ventas pendientes en esta caja</p>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {ventas.map((v) => {
            const total = (v.venta as Record<string, unknown>)?.total as number ?? 0
            const items = (v.venta as Record<string, unknown>)?.items as { nombre: string; quantity: number }[] | undefined
            const itemCount = items?.length ?? 0
            const procesando = procesandoId === v.id
            const cancelando = cancelandoId === v.id

            return (
              <div key={v.id} className="rounded-xl border bg-card p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold">{v.serieNumero}</span>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Pendiente</span>
                    </div>
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
                      placeholder="Motivo de cancelación…"
                      className="w-full rounded-lg border bg-background px-3 py-1.5 text-xs"
                      autoFocus
                    />
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
                      <Button size="sm" className="flex-1" onClick={() => cobrar(v)} disabled={procesando}>
                        {procesando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        {procesando ? 'Cobrando…' : 'Cobrar'}
                      </Button>
                    )}
                    {tienePermiso('cancelarVentaPendiente') && (
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => cancelar(v)} disabled={procesando}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
