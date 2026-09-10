import { Award } from 'lucide-react'
import { cn } from '@/lib/utils'

const fmtC = (n: number) => 'S/ ' + (n ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Props = {
  topProductos: { nombre: string; cantidad: number; total: number }[]
}

export function TopProductosWidget({ topProductos }: Props) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <Award className="h-5 w-5 text-primary" />
        <h3 className="font-bold">Top de Productos</h3>
      </div>
      {topProductos.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sin ventas en el período</p>
      ) : (
        <div className="space-y-2">
          {topProductos.map((p, i) => (
            <div key={p.nombre + i} className="flex items-center gap-2">
              <span className={cn(
                'w-6 shrink-0 text-center text-xs font-bold',
                i === 0 ? 'text-primary' : i === 1 ? 'text-amber-500' : i === 2 ? 'text-amber-700' : 'text-muted-foreground'
              )}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{p.nombre}</div>
                <div className="text-[11px] text-muted-foreground">{p.cantidad} uni · {fmtC(p.total)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
