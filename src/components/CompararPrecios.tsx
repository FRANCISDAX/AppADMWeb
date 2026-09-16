import { Loader2 } from 'lucide-react'
import * as React from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { useProductos } from '@/hooks/use-productos'

const fmt = (n: number) => 'S/ ' + (Number(n) || 0).toFixed(2)

type PrecioProveedor = {
  proveedorId: string
  proveedorNombre: string
  precio: number
  fecha: string
}

export function CompararPrecios({ productoId }: { productoId?: string }) {
  const { productos } = useProductos()
  const [precios, setPrecios] = React.useState<PrecioProveedor[]>([])
  const [cargando, setCargando] = React.useState(false)
  const [productoSel, setProductoSel] = React.useState(productoId || '')

  React.useEffect(() => {
    if (!productoSel) { setPrecios([]); return }
    setCargando(true)
    // Buscar compras de este producto y extraer proveedor + precio
    const q = query(collection(db, COL.MOVIMIENTOS), where('productoId', '==', productoSel), where('tipoMovimiento', '==', 'compra'))
    getDocs(q).then((snap) => {
      const porProv: Record<string, PrecioProveedor> = {}
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>
        const meta = (data.metadata || {}) as Record<string, unknown>
        const provId = (meta.proveedorId as string) || ''
        const provNombre = (meta.proveedor as string) || ''
        const precio = (meta.precioUnitario as number) || 0
        const fecha = (data.fecha as string) || ''
        if (provId && precio > 0) {
          // Keep the most recent price per provider
          if (!porProv[provId] || fecha > porProv[provId].fecha) {
            porProv[provId] = { proveedorId: provId, proveedorNombre: provNombre, precio, fecha }
          }
        }
      }
      setPrecios(Object.values(porProv).sort((a, b) => a.precio - b.precio))
    }).catch(() => setPrecios([])).finally(() => setCargando(false))
  }, [productoSel])

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-bold text-muted-foreground">Producto</label>
        <select
          value={productoSel}
          onChange={(e) => setProductoSel(e.target.value)}
          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-2 text-sm"
        >
          <option value="">Seleccionar producto…</option>
          {productos.filter((p) => p.activo !== false).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')).map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </div>

      {cargando && (
        <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      )}

      {!cargando && productoSel && precios.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">Sin datos de compra para este producto</p>
      )}

      {!cargando && precios.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground">Precios por proveedor (más bajo arriba)</p>
          {precios.map((p, idx) => (
            <div key={p.proveedorId} className="flex items-center gap-3 rounded-xl border p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                {idx + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{p.proveedorNombre || 'Sin nombre'}</p>
                <p className="text-[11px] text-muted-foreground">Última compra: {p.fecha ? new Date(p.fecha).toLocaleDateString('es-PE') : '-'}</p>
              </div>
              <span className={`text-sm font-extrabold ${idx === 0 ? 'text-emerald-600' : 'text-foreground'}`}>{fmt(p.precio)}</span>
            </div>
          ))}
          {precios.length >= 2 && (
            <div className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
              💡 El proveedor más barato es <strong>{precios[0].proveedorNombre}</strong> con {fmt(precios[0].precio)}
              {precios.length > 1 && <> (ahorro de {fmt(precios[precios.length - 1].precio - precios[0].precio)} vs el más caro)</>}
            </div>
          )}
        </div>
      )}

      {/* Productos con proveedor preferido */}
      {!productoSel && (
        <div>
          <p className="text-xs font-bold text-muted-foreground mb-2">Productos con proveedor preferido</p>
          <div className="space-y-1.5">
            {productos.filter((p) => p.activo !== false && p.proveedorId).slice(0, 10).map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                <span className="truncate font-medium">{p.nombre}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{p.proveedorNombre}</span>
              </div>
            ))}
            {productos.filter((p) => p.activo !== false && p.proveedorId).length === 0 && (
              <p className="text-xs text-muted-foreground">No hay productos con proveedor asignado</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
