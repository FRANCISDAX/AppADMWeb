import { Clock } from 'lucide-react'
import type { Turno } from '@/services/turnos'
import { Button } from '@/components/ui/button'

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
          <div className="text-lg font-bold">{fmt(activeTurno.totalGastos || 0)}</div>
          <div className="text-[11px] text-muted-foreground">Gastos</div>
        </div>
        <div>
          <div className="text-lg font-bold text-emerald-600">{fmt((activeTurno.totalVentas || 0) - (activeTurno.totalGastos || 0))}</div>
          <div className="text-[11px] text-muted-foreground">Neto</div>
        </div>
      </div>
      <div className="mt-3 flex justify-between border-t pt-3 text-xs text-muted-foreground">
        <span>Efectivo: {fmt(activeTurno.totalEfectivo || 0)}</span>
        <span>Transferencia: {fmt(activeTurno.totalTransferencia || 0)}</span>
      </div>
    </div>
  )
}
