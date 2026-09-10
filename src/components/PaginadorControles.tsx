import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (Number(n) || 0).toFixed(2)

// Controles de paginación (contador + flechas) para listas paginadas en Firestore.
export function PaginadorControles({
  total,
  pagina,
  totalPaginas,
  pageSize,
  onPagina,
  sum,
  className,
}: {
  total: number
  pagina: number
  totalPaginas: number
  pageSize: number
  onPagina: (p: number) => void
  sum?: number
  className?: string
}) {
  const inicio = total === 0 ? 0 : pagina * pageSize + 1
  const fin = Math.min((pagina + 1) * pageSize, total)
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 px-4 py-2.5', className)}>
      <span className="text-xs text-muted-foreground">
        Mostrando {inicio}–{fin} de {total}
        {sum !== undefined ? ` · ${fmt(sum)}` : ''}
      </span>
      {totalPaginas > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => onPagina(Math.max(0, pagina - 1))} disabled={pagina === 0} aria-label="Anterior">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs font-semibold text-muted-foreground">Página {pagina + 1} de {totalPaginas}</span>
          <Button variant="outline" size="icon" onClick={() => onPagina(Math.min(totalPaginas - 1, pagina + 1))} disabled={pagina >= totalPaginas - 1} aria-label="Siguiente">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
