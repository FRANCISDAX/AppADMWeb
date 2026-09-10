import { BookOpen, Loader2, Search } from 'lucide-react'
import * as React from 'react'
import { usePermisos } from '@/context/permisos'
import { useProductos } from '@/hooks/use-productos'
import { consultarKardex } from '@/services/kardex'
import { useNotifications } from '@/components/notifications'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const TIPO_LABEL: Record<string, string> = {
  compra: 'Compra',
  venta: 'Venta',
  ajuste_entrada: 'Ajuste entrada',
  ajuste_salida: 'Ajuste salida',
  inventario_fisico_entrada: 'Inventario físico (+)',
  inventario_fisico_salida: 'Inventario físico (-)',
  anulacion_venta: 'Anulación de venta',
  nota_credito: 'Nota de crédito',
}
const TIPO_COLOR: Record<string, string> = {
  compra: '#4CAF50',
  venta: '#FF6B35',
  ajuste_entrada: '#2196F3',
  ajuste_salida: '#F44336',
  inventario_fisico_entrada: '#9C27B0',
  inventario_fisico_salida: '#9C27B0',
  anulacion_venta: '#607D8B',
  nota_credito: '#FF9800',
}

const hoyISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fmtFecha = (iso?: string) => (iso ? new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-')

type Fila = { id: string; tipoMovimiento: string; cantidad: number; cantidadReal: number; stockCorriente: number; fecha: string; stockAnterior?: number; stockNuevo?: number; motivo?: string; usuario?: string }
type KardexData = { producto: any; stockInicial: number; stockFinal: number; totalEntradas: number; totalSalidas: number; filas: Fila[] }

export function Kardex() {
  const { tienePermiso } = usePermisos()
  const { productos } = useProductos()
  const { toast } = useNotifications()
  const [productoId, setProductoId] = React.useState('')
  const [desde, setDesde] = React.useState(hoyISO())
  const [hasta, setHasta] = React.useState(hoyISO())
  const [cargando, setCargando] = React.useState(false)
  const [kardex, setKardex] = React.useState<KardexData | null>(null)
  const [q, setQ] = React.useState('')

  if (!tienePermiso('kardex')) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <BookOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No tenés acceso al Kardex por Producto</p>
        <p className="text-xs">Pedí el permiso «kardex» al administrador.</p>
      </div>
    )
  }

  const opciones = productos.filter((p) => p.activo !== false).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))

  async function consultar() {
    const producto = productos.find((p) => p.id === productoId)
    if (!producto) { toast('Seleccioná un producto.', 'warning'); return }
    if (!desde || !hasta) { toast('Seleccioná el rango de fechas.', 'warning'); return }
    setCargando(true)
    setKardex(null)
    try {
      const r = await consultarKardex(producto, new Date(desde), new Date(hasta))
      setKardex(r)
    } catch (e) {
      console.error('❌ Error consultando kardex:', e)
      toast('No se pudo consultar el kardex. Verificá los índices de Firestore.', 'error')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold">Kardex por Producto</h1>
      </div>

      {/* Selector */}
      <div className="rounded-2xl border bg-card p-5 shadow-card">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label className="mb-1 block">Producto</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto…" className="pl-10" />
              </div>
              <select value={productoId} onChange={(e) => setProductoId(e.target.value)} className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">— Seleccionar producto —</option>
                {opciones.filter((p) => !q || p.nombre?.toLowerCase().includes(q.toLowerCase()) || p.codigo?.toLowerCase().includes(q.toLowerCase())).map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}{p.codigo ? ` · #${p.codigo}` : ''}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label className="mb-1 block">Desde</Label>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1 block">Hasta</Label>
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </div>
        <Button className="mt-4 w-full" onClick={consultar} disabled={cargando}>
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
          {cargando ? 'Consultando…' : 'Consultar Kardex'}
        </Button>
      </div>

      {kardex && (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-card p-5 shadow-card">
            <h2 className="font-bold">{kardex.producto.nombre}</h2>
            {kardex.producto.codigo && <p className="text-xs text-muted-foreground"># {kardex.producto.codigo}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-muted/60 p-3"><div className="text-[11px] text-muted-foreground">Stock inicial</div><div className="font-bold">{kardex.stockInicial}</div></div>
              <div className="rounded-xl bg-emerald-50 p-3"><div className="text-[11px] text-muted-foreground">Entradas</div><div className="font-bold text-emerald-700">+{kardex.totalEntradas}</div></div>
              <div className="rounded-xl bg-red-50 p-3"><div className="text-[11px] text-muted-foreground">Salidas</div><div className="font-bold text-red-700">-{kardex.totalSalidas}</div></div>
              <div className="rounded-xl bg-primary/10 p-3"><div className="text-[11px] text-muted-foreground">Stock final</div><div className="font-bold text-primary">{kardex.stockFinal}</div></div>
            </div>
          </div>

          {kardex.filas.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Sin movimientos en el rango</p>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-[11px] uppercase text-muted-foreground">
                      <th className="px-4 py-3 font-semibold">Fecha</th>
                      <th className="px-4 py-3 font-semibold">Tipo</th>
                      <th className="px-4 py-3 font-semibold">Cantidad</th>
                      <th className="px-4 py-3 font-semibold">Stock corr.</th>
                      <th className="px-4 py-3 font-semibold">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kardex.filas.map((m) => {
                      const entrada = m.cantidadReal >= 0
                      const color = TIPO_COLOR[m.tipoMovimiento] || '#999'
                      return (
                        <tr key={m.id} className="border-b last:border-0">
                          <td className="px-4 py-2.5">{fmtFecha(m.fecha)}</td>
                          <td className="px-4 py-2.5">
                            <Badge className="text-[10px]" style={{ backgroundColor: color + '1a', color }}>{TIPO_LABEL[m.tipoMovimiento] || m.tipoMovimiento}</Badge>
                          </td>
                          <td className={cn('px-4 py-2.5 font-bold', entrada ? 'text-emerald-600' : 'text-red-600')}>{entrada ? '+' : '-'}{m.cantidad}</td>
                          <td className="px-4 py-2.5 font-semibold">{m.stockCorriente}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{m.motivo || m.usuario || '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
