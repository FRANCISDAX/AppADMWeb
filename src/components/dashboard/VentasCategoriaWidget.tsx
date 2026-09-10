import { Tags } from 'lucide-react'

const fmtC = (n: number) => 'S/ ' + (n ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Props = {
  categorias: {
    arr: { nombre: string; total: number }[]
    max: number
  }
}

export function VentasCategoriaWidget({ categorias }: Props) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <Tags className="h-5 w-5 text-primary" />
        <h3 className="font-bold">Ventas por Categoría</h3>
      </div>
      {categorias.arr.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sin ventas en el período</p>
      ) : (
        <div className="space-y-2.5">
          {categorias.arr.slice(0, 8).map((c) => (
            <div key={c.nombre} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-right text-xs text-muted-foreground">{c.nombre}</span>
              <div className="h-2.5 flex-1 rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(c.total / categorias.max) * 100}%` }} />
              </div>
              <span className="w-20 shrink-0 text-right text-xs font-bold">{fmtC(c.total)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
