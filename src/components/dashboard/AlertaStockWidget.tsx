import { AlertTriangle, ChevronRight } from 'lucide-react'

type ProductoBasico = { id: string; nombre: string; stock: number }

type Props = {
  stockBajo: ProductoBasico[]
  stockAgotado: ProductoBasico[]
  totalProblemas: number
  tienePermiso: (perm: string) => boolean
  onNavigate: (seccion: string) => void
}

export function AlertaStockWidget({ stockBajo, stockAgotado, totalProblemas, tienePermiso, onNavigate }: Props) {
  if (totalProblemas <= 0 || !tienePermiso('inventario')) return null

  return (
    <div className="rounded-2xl border bg-card shadow-card overflow-hidden">
      <button
        onClick={() => onNavigate('inventario')}
        className="flex w-full items-center gap-2 bg-red-500 p-3.5 text-sm font-medium text-white transition-all hover:bg-red-600 cursor-pointer"
      >
        <AlertTriangle className="h-5 w-5" />
        <span className="flex-1 text-left">
          {stockAgotado.length > 0 && `${stockAgotado.length} agotado${stockAgotado.length !== 1 ? 's' : ''}`}
          {stockAgotado.length > 0 && stockBajo.length > 0 && ' · '}
          {stockBajo.length > 0 && `${stockBajo.length} stock bajo`}
        </span>
        <ChevronRight className="h-4 w-4" />
      </button>
      <div className="divide-y max-h-48 overflow-y-auto">
        {stockAgotado.slice(0, 5).map((p) => (
          <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="truncate font-medium">{p.nombre}</span>
            <span className="shrink-0 ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-500/15 dark:text-red-300">0 uds</span>
          </div>
        ))}
        {stockBajo.slice(0, 5).map((p) => (
          <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="truncate font-medium">{p.nombre}</span>
            <span className="shrink-0 ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{p.stock} uds</span>
          </div>
        ))}
        {totalProblemas > 10 && (
          <div className="px-4 py-2 text-center text-xs text-muted-foreground">
            +{totalProblemas - 10} más…
          </div>
        )}
      </div>
    </div>
  )
}
