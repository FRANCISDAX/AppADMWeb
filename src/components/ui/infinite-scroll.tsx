import { useInView } from 'react-intersection-observer'
import { Loader2 } from 'lucide-react'
import * as React from 'react'

type InfiniteScrollProps = {
  hayMas: boolean
  cargandoMas: boolean
  onCargarMas: () => void
  children: React.ReactNode
  className?: string
}

export function InfiniteScroll({ hayMas, cargandoMas, onCargarMas, children, className }: InfiniteScrollProps) {
  const { ref, inView } = useInView({ threshold: 0 })

  React.useEffect(() => {
    if (inView && hayMas && !cargandoMas) {
      onCargarMas()
    }
  }, [inView, hayMas, cargandoMas, onCargarMas])

  return (
    <div className={className}>
      {children}
      <div ref={ref} className="flex items-center justify-center py-4">
        {cargandoMas && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando más…
          </div>
        )}
        {!hayMas && !cargandoMas && (
          <p className="text-xs text-muted-foreground/60">No hay más resultados</p>
        )}
      </div>
    </div>
  )
}
