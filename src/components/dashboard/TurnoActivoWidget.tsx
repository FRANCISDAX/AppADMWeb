import { Clock } from 'lucide-react'
import type { Turno } from '@/services/turnos'
import { Button } from '@/components/ui/button'
import { gastosDelTurno } from '@/lib/arqueo'

const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)

type Props = {
  activeTurno: Turno | null
  tienePermiso: (perm: string) => boolean
  onNavigate: (seccion: string) => void
}

export function TurnoActivoWidget({ activeTurno, tienePermiso, onNavigate }: Props) {
  if (!activeTurno) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center shadow-card">
        <Clock className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No hay turno activo</p>
        {tienePermiso('abrirTurno') && (
          <Button className="brand-grad" onClick={() => onNavigate('turnos')}>Abrir Turno</Button>
        )}
      </div>
    )
  }

  /**
   * 🔑 **«Gastos» acá significa «lo que salió del cajón», y nada más** (decisión del usuario, 03/11/2026):
   * `turno.totalGastos` suma también los egresos pagados **por transferencia** y los de `tipoPago: 'otro'`,
   * así que mostrarlo al lado de «Vendido» y del efectivo/transferencia de las ventas hacía creer que ese
   * monto había salido de la caja. La regla única es `gastosDelTurno()` (`lib/arqueo.ts`), y `caja` es
   * exactamente lo que resta el arqueo.
   * ⚠️ **Los gastos que no salieron del cajón no se esconden**: van abajo, con su nombre.
   */
  const gastos = gastosDelTurno(activeTurno)
  const netoCaja = (activeTurno.totalVentas || 0) - gastos.caja

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <span className="font-bold text-primary">Turno {activeTurno.tipoTurno === 'mañana' ? 'Mañana' : 'Tarde'}</span>
        </div>
        <span className="rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-bold text-white">CiberSoft</span>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">Cajero: {activeTurno.usuarioNombre || '-'}</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-bold">{fmt(activeTurno.totalVentas || 0)}</div>
          <div className="text-[11px] text-muted-foreground">Vendido</div>
        </div>
        <div>
          <div className="text-lg font-bold" title="Lo que salió del cajón (cierra con el arqueo)">{fmt(gastos.caja)}</div>
          <div className="text-[11px] text-muted-foreground">Gastos de caja</div>
        </div>
        <div>
          <div className="text-lg font-bold text-emerald-600" title="Vendido menos lo que salió del cajón">{fmt(netoCaja)}</div>
          <div className="text-[11px] text-muted-foreground">Neto de caja</div>
        </div>
      </div>
      <div className="mt-3 flex justify-between border-t pt-3 text-xs text-muted-foreground">
        <span>Efectivo: {fmt(activeTurno.totalEfectivo || 0)}</span>
        <span>Transferencia: {fmt(activeTurno.totalTransferencia || 0)}</span>
      </div>
      {/* Lo que se pagó sin tocar el efectivo: se muestra, pero separado y con su nombre. */}
      {gastos.transferencia > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">
          Gastos por <strong>transferencia</strong>: <span className="num">{fmt(gastos.transferencia)}</span>{' '}
          <span className="opacity-70">(no salieron del cajón)</span>
        </div>
      )}
      {gastos.otro > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">
          Otros gastos del turno: <span className="num">{fmt(gastos.otro)}</span>{' '}
          <span className="opacity-70">(medio sin detalle)</span>
        </div>
      )}
    </div>
  )
}
