import * as React from 'react'
import { Loader2, Printer, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/components/notifications'
import { editarClienteDeNotaVenta } from '@/services/ventas'
import { abrirPDFComprobante } from '@/lib/pdf'
import { revisionDocumentoCliente, revisionEdicionCliente } from '@/lib/edicion-cliente'

/**
 * **Cambiarle el cliente a una nota de venta** — la pantalla (09/10/2026).
 *
 * El caso real: el cliente compró sin dar su nombre y después pide *«esa nota pero con mi nombre»*.
 *
 * 🔑 **Por qué es seguro**: la nota de venta no es comprobante de pago y no se declara a SUNAT, y la boleta
 * consolidada del día **no usa** el cliente de cada NV (declara el receptor de la configuración). Por eso
 * se puede corregir el nombre sin tocar nada fiscal — **mientras la nota no se haya consolidado**.
 *
 * ⚠️ La regla (`lib/edicion-cliente.ts`) la aplican la pantalla **y** el servicio: acá se avisa, allá se
 * rechaza. Y lo que **no** resuelve: si el cliente necesita el nombre para sustentar un gasto, la nota no
 * le sirve — hace falta boleta o factura.
 */
export function EditarClienteModal({
  doc,
  config,
  onCerrar,
  onGuardado,
}: {
  doc: Record<string, any>
  config: Record<string, any>
  onCerrar: () => void
  onGuardado: () => void
}) {
  const { toast } = useNotifications()
  const venta = (doc.venta ?? {}) as Record<string, any>
  const revision = revisionEdicionCliente(doc)

  const [nombre, setNombre] = React.useState<string>(() => {
    const n = String(venta.cliente_nombre ?? '').trim()
    return n === 'CLIENTE' || n === '-' ? '' : n
  })
  const [documento, setDocumento] = React.useState<string>(() => {
    const d = String(venta.cliente_dni ?? '').trim()
    return d === '-' ? '' : d
  })
  const [direccion, setDireccion] = React.useState<string>(String(venta.cliente_direccion ?? ''))
  const [telefono, setTelefono] = React.useState<string>(String(venta.cliente_telefono ?? ''))
  const [guardando, setGuardando] = React.useState(false)
  const [error, setError] = React.useState<string>('')

  const validacion = revisionDocumentoCliente(documento, nombre)

  async function guardar({ imprimir }: { imprimir: boolean }) {
    if (!validacion.valido) return setError(validacion.motivo ?? 'Revisá el documento.')
    if (!nombre.trim() && documento.trim()) return setError('Poné el nombre del cliente.')
    setError('')
    setGuardando(true)
    try {
      const r = await editarClienteDeNotaVenta({
        documentoId: String(doc.id),
        clienteNombre: nombre,
        clienteDni: documento,
        clienteDireccion: direccion,
        clienteTelefono: telefono,
      })
      if (!r.success) throw new Error(r.error || 'No se pudo guardar')
      toast(`✅ Cliente actualizado en ${doc.serieNumero ?? 'la nota'}`)
      onGuardado()
      if (imprimir) {
        // El ticket viejo quedó con el nombre anterior: se reimprime con el corregido.
        await abrirPDFComprobante({ ...doc, venta: { ...venta, ...r.cliente } }, config)
      }
      onCerrar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !guardando && onCerrar()}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-primary px-5 py-4 text-white">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/20">
            <UserRound className="h-6 w-6" />
          </div>
          <p className="text-center text-lg font-bold">Cliente de la nota</p>
          <p className="num text-center text-sm opacity-90">{doc.serieNumero ?? ''}</p>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
          {!revision.permitido ? (
            <p className="rounded-lg bg-destructive/10 p-3 text-sm font-semibold text-destructive">{revision.motivo}</p>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="cli-nombre" className="text-xs">Nombre o razón social</Label>
                <Input id="cli-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Consumidor final" className="h-9 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="cli-doc" className="text-xs">DNI / RUC (opcional)</Label>
                  <Input
                    id="cli-doc"
                    inputMode="numeric"
                    value={documento}
                    onChange={(e) => setDocumento(e.target.value.replace(/\D/g, '').slice(0, 11))}
                    placeholder="Vacío = consumidor final"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cli-tel" className="text-xs">Teléfono (opcional)</Label>
                  <Input id="cli-tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} className="h-9 text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cli-dir" className="text-xs">Dirección (opcional)</Label>
                <Input id="cli-dir" value={direccion} onChange={(e) => setDireccion(e.target.value)} className="h-9 text-sm" />
              </div>

              {revision.aviso && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-500/10 dark:text-amber-300">
                  {revision.aviso}
                </p>
              )}
              <div className="rounded-lg bg-muted/60 p-2.5 text-[11px] leading-snug text-muted-foreground">
                La nota de venta <strong>no es comprobante de pago</strong>: el nombre es para el ticket y el
                historial del cliente. Si el cliente necesita sustentar un gasto, hay que emitirle
                <strong> boleta o factura</strong>.
              </div>
              {error && <p className="rounded-lg bg-destructive/10 p-2 text-[11px] font-semibold text-destructive">{error}</p>}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t p-4">
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          {revision.permitido ? (
            <Button onClick={() => guardar({ imprimir: true })} disabled={guardando || !validacion.valido}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              {guardando ? 'Guardando…' : 'Guardar e imprimir'}
            </Button>
          ) : (
            <Button onClick={onCerrar}>Entendido</Button>
          )}
        </div>
        {revision.permitido && (
          <div className="border-t px-4 pb-4">
            <Button variant="ghost" className="w-full text-xs" onClick={() => guardar({ imprimir: false })} disabled={guardando || !validacion.valido}>
              Guardar sin imprimir
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default EditarClienteModal
