import { AlertTriangle, CheckCircle2, CreditCard, Loader2 } from 'lucide-react'
import { evaluarVentaCredito, type EstadoCredito } from '@/lib/credito'

const fmt = (n: number) => 'S/ ' + n.toFixed(2)

/**
 * Muestra el estado de crédito del cliente **antes** de confirmar la venta, para
 * que el cajero sepa con cuánto cuenta. Usa la misma regla que el bloqueo
 * (`lib/credito.ts`): así lo que se ve y lo que se permite nunca se contradicen.
 */
export function CreditoPanel({ dni, estado, total, cargando }: { dni: string; estado: EstadoCredito | null; total: number; cargando: boolean }) {
  if (cargando) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando crédito del cliente…
      </div>
    )
  }
  if (!dni || !estado) return null

  const evaluacion = evaluarVentaCredito({ total, estado })
  const sinLimite = estado.limite <= 0

  return (
    <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${evaluacion.permitido ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
      <div className="flex items-center gap-1.5 font-bold">
        {evaluacion.permitido ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        <CreditCard className="h-3.5 w-3.5" /> Crédito {estado.activo ? 'activo' : 'inactivo'}
      </div>
      <div className="mt-1 space-y-0.5">
        <p>
          Debe <span className="font-bold">{fmt(estado.saldo)}</span>
          {sinLimite ? ' · sin límite configurado' : ` · límite ${fmt(estado.limite)} · disponible ${fmt(Math.max(0, evaluacion.disponible))}`}
        </p>
        {total > 0 && (
          <p>
            Esta venta lo dejaría en <span className="font-bold">{fmt(evaluacion.saldoDespues)}</span>
            {evaluacion.excedente > 0 && ` (se pasa por ${fmt(evaluacion.excedente)})`}
          </p>
        )}
        {!evaluacion.permitido && <p className="font-semibold">{evaluacion.motivo}</p>}
      </div>
    </div>
  )
}
