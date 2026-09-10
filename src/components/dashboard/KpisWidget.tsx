import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)

const PRIMARIO = '#FF6B35'
const CAMBIAR = { color: '#FF9800' }
const INVENTARIO = { color: '#4CAF50' }

type Props = {
  totalVentasHoy: number
  numTransacciones: number
  ticketPromedio: number
  totalProblemas: number
}

export function KpisWidget({ totalVentasHoy, numTransacciones, ticketPromedio, totalProblemas }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border bg-card p-4 shadow-card" style={{ borderTop: '3px solid ' + PRIMARIO }}>
        <div className="text-lg font-bold">{fmt(totalVentasHoy)}</div>
        <div className="text-[11px] text-muted-foreground">Ventas Hoy</div>
      </div>
      <div className="rounded-2xl border bg-card p-4 shadow-card" style={{ borderTop: '3px solid ' + CAMBIAR.color }}>
        <div className="text-lg font-bold">{numTransacciones}</div>
        <div className="text-[11px] text-muted-foreground">Transacciones</div>
      </div>
      <div className="rounded-2xl border bg-card p-4 shadow-card" style={{ borderTop: '3px solid ' + INVENTARIO.color }}>
        <div className="text-lg font-bold">{fmt(ticketPromedio)}</div>
        <div className="text-[11px] text-muted-foreground">Ticket Prom.</div>
      </div>
      <div className="rounded-2xl border bg-card p-4 shadow-card" style={{ borderTop: '3px solid ' + (totalProblemas > 0 ? '#F44336' : '#999') }}>
        <div className={cn('text-lg font-bold', totalProblemas > 0 && 'text-red-600')}>{totalProblemas}</div>
        <div className="text-[11px] text-muted-foreground">Stock Bajo</div>
      </div>
    </div>
  )
}
