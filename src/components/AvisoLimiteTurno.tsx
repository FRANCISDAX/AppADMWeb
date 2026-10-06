/**
 * **«Este turno ya tiene demasiadas ventas»**: el aviso que pide cerrar el turno antes de llegar al límite.
 *
 * 🔑 **Por qué**: el turno guarda **el detalle completo de cada venta** y lo reescribe entero en cada
 * cobro; el documento no puede pasar de **1 MiB** (ver `lib/turno-limite.ts`, con la medición real). Este
 * aviso es la parte visible de esa regla: **una sola implementación**, montada en la pantalla de Turnos y
 * en el PDV.
 *
 * ⚠️ **Informa, no bloquea**: la venta se puede seguir cobrando (el bloqueo lo pone Firestore al llegar al
 * límite, no la app). Si no hay nada que avisar, el componente **no dibuja nada** — así se puede montar
 * siempre, sin preguntar antes por el nivel.
 */
import { AlertTriangle } from 'lucide-react'

import { limiteDeTurno } from '@/lib/turno-limite'
import { cn } from '@/lib/utils'

export function AvisoLimiteTurno({ ventas, className }: { ventas: number | null | undefined; className?: string }) {
  const limite = limiteDeTurno(ventas)
  if (limite.nivel === 'ok') return null

  const urgente = limite.cerrarAhora
  const colorTexto = urgente ? 'text-destructive' : 'text-amber-800 dark:text-amber-300'

  return (
    <div
      className={cn(
        'rounded-xl border p-3 text-xs',
        urgente ? 'border-destructive/40 bg-destructive/10' : 'border-amber-300 bg-amber-50 dark:bg-amber-500/10',
        className,
      )}
      role="status"
    >
      <p className={cn('flex items-start gap-1.5 font-bold', colorTexto)}>
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {limite.titulo}
      </p>
      <p className={cn('mt-1', colorTexto)}>{limite.detalle}</p>
      <p className={cn('mt-1 text-[10px] opacity-80', colorTexto)}>
        El documento del turno va por ~{limite.kb} KB de 1.024 KB ({limite.pct} % del máximo de Firestore).
      </p>
    </div>
  )
}

export default AvisoLimiteTurno
