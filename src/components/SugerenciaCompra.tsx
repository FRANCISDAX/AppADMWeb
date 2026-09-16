import { Loader2, ShoppingCart, AlertTriangle } from 'lucide-react'
import * as React from 'react'
import { useProductos, type Producto } from '@/hooks/use-productos'

type Sugerencia = {
  producto: Producto
  stockActual: number
  stockMinimo: number
  faltante: number
}

export function SugerenciaCompra({ onCrearCompra }: { onCrearCompra: (productos: string[]) => void }) {
  const { productos, loading } = useProductos()
  const [seleccionados, setSeleccionados] = React.useState<Set<string>>(new Set())

  const sugerencias = React.useMemo(() => {
    const result: Sugerencia[] = []
    for (const p of productos) {
      if (p.activo === false) continue
      const stock = p.stock ?? 0
      const min = p.minStock ?? 0
      if (min > 0 && stock <= min) {
        result.push({ producto: p, stockActual: stock, stockMinimo: min, faltante: min - stock + 1 })
      }
    }
    return result.sort((a, b) => a.faltante - b.faltante)
  }, [productos])

  function toggle(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (seleccionados.size === sugerencias.length) {
      setSeleccionados(new Set())
    } else {
      setSeleccionados(new Set(sugerencias.map((s) => s.producto.id)))
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  }

  if (sugerencias.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <ShoppingCart className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">Todo bien</p>
        <p className="text-xs">No hay productos con stock bajo</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-bold">{sugerencias.length} producto{sugerencias.length !== 1 ? 's' : ''} bajo stock</span>
        </div>
        <div className="flex gap-2">
          <button onClick={toggleAll} className="text-xs font-semibold text-primary cursor-pointer">
            {seleccionados.size === sugerencias.length ? 'Desmarcar todo' : 'Marcar todo'}
          </button>
          {seleccionados.size > 0 && (
            <button onClick={() => onCrearCompra(Array.from(seleccionados))} className="rounded-lg bg-primary px-3 py-1 text-xs font-bold text-white cursor-pointer">
              Crear compra ({seleccionados.size})
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {sugerencias.map((s) => (
          <button
            key={s.producto.id}
            onClick={() => toggle(s.producto.id)}
            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer ${seleccionados.has(s.producto.id) ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}
          >
            <input
              type="checkbox"
              checked={seleccionados.has(s.producto.id)}
              onChange={() => toggle(s.producto.id)}
              className="h-4 w-4 accent-primary"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{s.producto.nombre}</p>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>Stock: <strong className="text-red-600">{s.stockActual}</strong></span>
                <span>Mín: {s.stockMinimo}</span>
                {s.producto.proveedorNombre && <span>→ {s.producto.proveedorNombre}</span>}
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              Faltan {s.faltante}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
