import * as React from 'react'
import { Gift, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { useNotifications } from '@/components/notifications'
import { buscarTurnoAbierto } from '@/services/turnos'
import { registrarRetiro, type VentaItem } from '@/services/ventas'
import {
  MOTIVOS_RETIRO,
  TIPOS_COMPROBANTE_RETIRO,
  claseInfo,
  comprobanteSugeridoParaRetiro,
  documentoDelReceptor,
  motivoDe,
  textoRetiro,
  valorReferencialDe,
  type MotivoRetiro,
  type TipoComprobanteRetiro,
} from '@/lib/retiro'
import { fmt } from '@/lib/ui-utils'
import { cn } from '@/lib/utils'

/**
 * **Retirar sin cobrar** (cortesía / uso propio / muestra) — la puerta del PDV.
 *
 * 🔑 Lo decide el dueño y lo hace **gerencia**: por eso el botón solo aparece con el permiso
 * `retiroGratuito` (ADMIN y GERENTE; se prende por usuario en `Usuarios`).
 *
 * ⚠️ **No es una venta con descuento del 100%**: es una **transferencia gratuita**, se documenta con
 * **Boleta o Factura** (⚠️ **nunca Nota de Venta**: no es comprobante de pago y además entraría al
 * consolidado del día como si fuera una venta), lleva la **leyenda del motivo** y el **valor
 * referencial**, y **la plata NO se mueve** (no hay forma de pago ⇒ el arqueo no cambia). Lo que sí se
 * mueve es el **stock**, que sale del inventario con su movimiento `retiro`.
 *
 * La regla fiscal vive en `lib/retiro.ts` y el guardado en `services/ventas.ts` (`registrarRetiro`):
 * acá solo se elige el motivo, el comprobante y el receptor.
 */
export function RetiroModal({
  items,
  config,
  cajaId,
  clienteInicial,
  onCerrar,
  onRegistrado,
}: {
  /** Ítems del carrito que **sí son mercadería** (`quantity` en unidades base, `precioVenta` por unidad base). */
  items: VentaItem[]
  config: Record<string, unknown>
  cajaId?: string | null
  /**
   * 🔑 **El cliente que ya se cargó en la venta** (DNI/RUC, nombre y dirección del panel *Cliente* del PDV):
   * el retiro es de la MISMA persona, así que se trae puesto y no se digita dos veces. Se puede cambiar acá.
   */
  clienteInicial?: { documento?: string | null; nombre?: string | null; direccion?: string | null } | null
  onCerrar: () => void
  onRegistrado: (r: { documentoId: string; valorReferencial: number; leyenda: string }) => void
}) {
  const { user } = useAuth()
  const { nombre: nombreUsuario, tienePermiso } = usePermisos()
  const { toast } = useNotifications()

  /**
   * Lo que llega de la venta, ya pasado por las mismas reglas: si el documento es un RUC (11) el comprobante
   * arranca en **Factura**; un documento a medio tipear **no** se precarga (el backend lo rechazaría).
   * ⚠️ Se lee al montar: la modal se monta cada vez que se abre, así que siempre trae lo último del PDV.
   */
  const tipoSugerido = comprobanteSugeridoParaRetiro(clienteInicial?.documento)
  const receptorInicial = documentoDelReceptor(tipoSugerido, clienteInicial?.documento)
  const docInicial = receptorInicial.ok ? receptorInicial.doc : ''
  const nombreInicial = String(clienteInicial?.nombre ?? '').trim()
  const direccionInicial = String(clienteInicial?.direccion ?? '').trim()
  const traeCliente = Boolean(docInicial || nombreInicial)

  const [motivo, setMotivo] = React.useState<MotivoRetiro | ''>('')
  const [tipoDoc, setTipoDoc] = React.useState<TipoComprobanteRetiro>(tipoSugerido)
  const [documento, setDocumento] = React.useState(docInicial)
  const [nombre, setNombre] = React.useState(nombreInicial)
  const [guardando, setGuardando] = React.useState(false)
  const [error, setError] = React.useState('')

  const valorReferencial = React.useMemo(() => valorReferencialDe(items), [items])
  const elegido = motivoDe(motivo)
  const esFactura = tipoDoc === 'FACTURA'

  async function registrar() {
    if (!elegido) return setError('Elegí el motivo del retiro.')
    if (items.length === 0) return setError('No hay mercadería del catálogo en el carrito (el embalaje y otros no tienen stock).')
    // Un DNI a medio tipear deja el comprobante **sin poder mandarse** (el backend exige 8-11 caracteres).
    const receptor = documentoDelReceptor(tipoDoc, documento)
    if (!receptor.ok) return setError(receptor.error || 'El documento del receptor no es válido.')
    if (esFactura && !nombre.trim()) return setError('La Factura necesita la razón social del receptor.')

    setError('')
    setGuardando(true)
    try {
      if (!tienePermiso('retiroGratuito')) throw new Error('Tu usuario no tiene el permiso «Retirar sin cobrar».')
      const turno = await buscarTurnoAbierto(user?.uid, tienePermiso('verTodo'))
      const res = await registrarRetiro({
        items,
        motivo: elegido.id,
        tipoDoc,
        clienteDni: receptor.doc,
        clienteNombre: nombre.trim(),
        clienteDireccion: direccionInicial,
        cajero: user?.uid || '',
        cajeroNombre: nombreUsuario || user?.email || 'sistema',
        turnoId: turno?.id || '',
        cajaId: cajaId || undefined,
        config,
      })
      if (!res.success) throw new Error(res.error || 'No se pudo registrar el retiro')
      toast(`✅ Retiro ${res.correlativo || ''} registrado · ${fmt(res.valorReferencial ?? valorReferencial)} de valor referencial`)
      onRegistrado({ documentoId: res.documentoId || '', valorReferencial: res.valorReferencial ?? valorReferencial, leyenda: elegido.leyenda })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !guardando && onCerrar()}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-pink-600 px-5 py-4 text-white">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/20">
            <Gift className="h-6 w-6" />
          </div>
          <p className="text-center text-lg font-bold">Retirar sin cobrar</p>
          <p className="text-center text-sm opacity-90">Cortesía, uso propio o muestra</p>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
          <div className="rounded-lg bg-pink-50 p-2.5 text-[11px] leading-snug text-pink-800 dark:bg-pink-500/10 dark:text-pink-300">
            <p className="font-bold">Es una transferencia gratuita, no una venta con descuento.</p>
            <p>
              Se documenta con <strong>Boleta o Factura</strong>: el comprobante declara el <strong>valor
              referencial</strong> y la leyenda del motivo, que es lo que el contador informa. <strong>La caja no se
              mueve</strong>: no hay pago, así que el arqueo queda igual.
            </p>
          </div>

          {/* Qué sale */}
          <div className="space-y-1 rounded-lg border p-2.5 text-xs">
            {items.map((it, i) => (
              <div key={`${it.id}-${i}`} className="flex justify-between gap-2">
                <span className="truncate">{it.nombre}</span>
                <span className="num shrink-0 text-muted-foreground">
                  {it.quantity} × {fmt(it.precioVenta ?? 0)}
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-1 font-bold">
              <span>Valor referencial</span>
              <span className="num">{fmt(valorReferencial)}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              No se cobra: es el importe que declara el comprobante (lo que la mercadería habría costado).
            </p>
          </div>

          {/* Motivo */}
          <div className="space-y-1">
            <Label htmlFor="retiro-motivo" className="text-xs">Motivo</Label>
            <select
              id="retiro-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value as MotivoRetiro | '')}
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
            >
              <option value="">Elegí el motivo…</option>
              {MOTIVOS_RETIRO.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground">
              Se imprime como leyenda <strong>«{elegido?.leyenda ?? '…'}»</strong> en el comprobante.
            </p>
            {elegido && (
              // 🔑 Las dos clases de operación (SUNAT las distingue): transferencia gratuita a un cliente
              // contra retiro de bienes para uso propio. Acá solo informa; en los reportes las separa.
              <p className="text-[10px] text-pink-700 dark:text-pink-300">
                Clase: <strong>{claseInfo(elegido.clase)?.label}</strong> — {claseInfo(elegido.clase)?.detalle}
              </p>
            )}
          </div>

          {/* Comprobante: nunca NV */}
          <div className="space-y-1">
            <Label className="text-xs">Comprobante</Label>
            <div className="grid grid-cols-2 gap-2">
              {TIPOS_COMPROBANTE_RETIRO.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipoDoc(t)}
                  className={cn(
                    'h-9 rounded-lg border text-xs font-semibold',
                    tipoDoc === t ? 'border-pink-600 bg-pink-50 text-pink-700 dark:bg-pink-500/10 dark:text-pink-300' : 'bg-background',
                  )}
                >
                  {t === 'BOLETA' ? 'Boleta' : 'Factura'}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              La <strong>nota de venta no sirve</strong> para un retiro: no es comprobante de pago.
            </p>
          </div>

          {/* Receptor */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="retiro-doc" className="text-xs">{esFactura ? 'RUC del receptor' : 'DNI (opcional)'}</Label>
              <Input
                id="retiro-doc"
                inputMode="numeric"
                value={documento}
                onChange={(e) => setDocumento(e.target.value.replace(/\D/g, '').slice(0, esFactura ? 11 : 8))}
                placeholder={esFactura ? '11 dígitos' : '8 dígitos'}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="retiro-nombre" className="text-xs">{esFactura ? 'Razón social' : 'Nombre (opcional)'}</Label>
              <Input
                id="retiro-nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder={esFactura ? 'Requerido' : 'Consumidor final'}
                className="h-9 text-sm"
              />
            </div>
          </div>
          {/* 🔑 Los datos NO se vuelven a digitar: vienen del panel *Cliente* de la venta (mismo cliente). */}
          {traeCliente && (
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
              ✅ Cliente tomado de la venta ({docInicial || 'sin documento'}). Podés cambiarlo acá.
            </p>
          )}

          {elegido && (
            <p className="rounded-lg border border-dashed p-2 text-[11px] text-muted-foreground">
              Se va a registrar: <strong>{textoRetiro({ leyenda: elegido.leyenda, valorReferencial })}</strong>
            </p>
          )}

          {error && (
            <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2 text-[11px] font-semibold text-destructive">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t p-4">
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button className="bg-pink-600 hover:bg-pink-700" onClick={registrar} disabled={guardando}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
            {guardando ? 'Registrando…' : 'Registrar retiro'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default RetiroModal
