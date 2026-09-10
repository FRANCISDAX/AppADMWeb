import { ArrowLeft, ArrowRight } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Lista genérica con paginación (flechas + contador, arriba y abajo).
// Se resetea a la página 1 cuando cambia la referencia de `items`.
export function ListaPaginada<T>({
  items,
  renderItem,
  empty,
  pageSize = 25,
}: {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  empty?: React.ReactNode
  pageSize?: number
}) {
  const [pagina, setPagina] = React.useState(0)
  React.useEffect(() => setPagina(0), [items])

  const totalPaginas = Math.max(1, Math.ceil(items.length / pageSize))
  const paginaActual = Math.min(pagina, totalPaginas - 1)
  const inicio = paginaActual * pageSize
  const paginados = items.slice(inicio, inicio + pageSize)

  const paginador = (className?: string) => (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 px-4 py-2.5', className)}>
      <span className="text-xs text-muted-foreground">
        Mostrando {items.length === 0 ? 0 : inicio + 1}–{Math.min(inicio + pageSize, items.length)} de {items.length}
      </span>
      {totalPaginas > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={paginaActual === 0} aria-label="Anterior">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs font-semibold text-muted-foreground">Página {paginaActual + 1} de {totalPaginas}</span>
          <Button variant="outline" size="icon" onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))} disabled={paginaActual >= totalPaginas - 1} aria-label="Siguiente">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <React.Fragment>
      {items.length > 0 && paginador('border-b bg-muted/30')}
      <div className="divide-y">
        {items.length === 0 ? (empty ?? <p className="py-16 text-center text-sm text-muted-foreground">Sin datos</p>) : paginados.map((item, i) => renderItem(item, i))}
      </div>
      {items.length > pageSize && paginador('border-t')}
    </React.Fragment>
  )
}
