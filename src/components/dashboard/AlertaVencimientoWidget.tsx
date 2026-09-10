import { Clock, ChevronRight } from 'lucide-react'
import { estadoVencimiento } from '@/lib/ui-utils'
import { cn } from '@/lib/utils'

type ProductoVencimiento = { id: string; nombre: string; fechaVencimiento: string }

type Props = {
  proximosAVencer: ProductoVencimiento[]
  tienePermiso: (perm: string) => boolean
  onNavigate: (seccion: string) => void
}

export function AlertaVencimientoWidget({ proximosAVencer, tienePermiso, onNavigate }: Props) {
  if (proximosAVencer.length <= 0 || !tienePermiso('inventario')) return null

  const vencidos = proximosAVencer.filter((p) => {
    const d = estadoVencimiento(p.fechaVencimiento).dias
    return d != null && d < 0
  }).length

  const porVencer = proximosAVencer.length - vencidos

  return (
    <div className="rounded-2xl border bg-card shadow-card overflow-hidden">
      <button
        onClick={() => onNavigate('inventario')}
        className="flex w-full items-center gap-2 bg-amber-500 p-3.5 text-sm font-medium text-white transition-all hover:bg-amber-600 cursor-pointer"
      >
        <Clock className="h-5 w-5" />
        <span className="flex-1 text-left">
          {vencidos > 0 && `${vencidos} vencido${vencidos !== 1 ? 's' : ''}`}
          {vencidos > 0 && porVencer > 0 && ' · '}
          {porVencer > 0 && `${porVencer} por vencer`}
        </span>
        <ChevronRight className="h-4 w-4" />
      </button>
      <div className="divide-y max-h-48 overflow-y-auto">
        {proximosAVencer.slice(0, 8).map((p) => {
          const ev = estadoVencimiento(p.fechaVencimiento)
          return (
            <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="truncate font-medium">{p.nombre}</span>
              <span className={cn(
                'shrink-0 ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold',
                ev.variant === 'destructive'
                  ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
              )}>
                {ev.label}
              </span>
            </div>
          )
        })}
        {proximosAVencer.length > 8 && (
          <div className="px-4 py-2 text-center text-xs text-muted-foreground">
            +{proximosAVencer.length - 8} más…
          </div>
        )}
      </div>
    </div>
  )
}
