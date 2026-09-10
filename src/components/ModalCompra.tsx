import { FileSearch, Loader2, Plus, Search, ShoppingCart, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useProductos, type Producto } from '@/hooks/use-productos'
import { registrarCompra } from '@/services/compras'
import { cargarProveedores, consultarProveedor, guardarProveedor, type Proveedor } from '@/services/proveedores'
import { useNotifications } from '@/components/notifications'
import { cn } from '@/lib/utils'
import { buscarTurnoAbierto } from '@/services/turnos'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'

const fmt = (n: number) => 'S/ ' + (Number(n) || 0).toFixed(2)

// Parsea un decimal aceptando coma o punto como separador ("12,50" → 12.50).
const parseDecimal = (s: string) => parseFloat(String(s).replace(',', '.')) || 0

type Presentacion = { id: string; nombre: string; factor: number }
type DocProveedor = Proveedor & { confirmado: boolean }
// `costoTexto` guarda el texto crudo del precio para permitir escribir decimales
// sin que se "coman" al parsear; el valor numérico se deriva con parseDecimal.
type CartItem = { id: string; nombre: string; cantidad: number; costoTexto: string; factor: number; presentacionId: string; presentacionNombre: string }

// Presentaciones de compra de un producto. Si no tiene, devuelve la unidad base (factor 1).
const getPresCompra = (p: Producto): Presentacion[] => {
  const pres = (p.presentaciones || []).filter((x) => x.esCompra !== false)
  if (pres.length > 0) return pres.map((x) => ({ id: x.id || x.nombre || 'unidad', nombre: x.nombre || (p.unidadBase || 'Unidad'), factor: x.factor || 1 }))
  return [{ id: 'unidad', nombre: p.unidadBase || 'Unidad', factor: 1 }]
}

const PROV_INICIAL: DocProveedor = { nombre: '', documento: '', tipoDocumento: 'RUC', direccion: '', confirmado: false }

export function ModalCompra({ onClose, onGuardado }: { onClose: () => void; onGuardado: () => void }) {
  const { productos } = useProductos()
  const { user } = useAuth()
  const { tienePermiso } = usePermisos()
  const { toast, confirm } = useNotifications()
  const [q, setQ] = React.useState('')
  const [carrito, setCarrito] = React.useState<CartItem[]>([])
  const [nota, setNota] = React.useState('')
  const [procesando, setProcesando] = React.useState(false)
  const [tipoPago, setTipoPago] = React.useState<'Transferencia' | 'caja'>('Transferencia')
  const [turnoId, setTurnoId] = React.useState<string | null>(null)

  // Proveedor
  const [modoProv, setModoProv] = React.useState<'buscar' | 'manual' | 'seleccionar'>('buscar')
  const [busquedaProv, setBusquedaProv] = React.useState('')
  const [cargandoProv, setCargandoProv] = React.useState(false)
  const [avisoProv, setAvisoProv] = React.useState('')
  const [proveedoresGuardados, setProveedoresGuardados] = React.useState<Proveedor[]>([])
  const [docProv, setDocProv] = React.useState<DocProveedor>(PROV_INICIAL)

  React.useEffect(() => {
    cargarProveedores().then(setProveedoresGuardados)
  }, [])

  // Detectar turno abierto para pago desde caja
  React.useEffect(() => {
    if (!tienePermiso('verTodo')) return
    buscarTurnoAbierto(user?.uid, tienePermiso('verTodo')).then((turno) => {
      if (turno?.id) setTurnoId(turno.id)
    })
  }, [user?.uid, tienePermiso])

  const activos = productos.filter((p) => p.activo !== false).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
  const filtrados = activos.filter((p) => !q || p.nombre?.toLowerCase().includes(q.toLowerCase()) || p.codigo?.toLowerCase().includes(q.toLowerCase()))

  function agregar(p: Producto) {
    const pres = getPresCompra(p)
    const primero = pres[0]
    setCarrito((prev) => {
      const ex = prev.find((i) => i.id === p.id)
      if (ex) return prev.map((i) => (i.id === p.id ? { ...i, cantidad: i.cantidad + 1 } : i))
      return [...prev, { id: p.id, nombre: p.nombre || p.codigo || 'Producto', cantidad: 1, costoTexto: String(p.precioCompra || 0), factor: primero.factor, presentacionId: primero.id, presentacionNombre: primero.nombre }]
    })
  }

  function cambiarPresentacion(itemId: string, pres: Presentacion) {
    setCarrito((prev) => prev.map((i) => (i.id === itemId ? { ...i, factor: pres.factor, presentacionId: pres.id, presentacionNombre: pres.nombre } : i)))
  }

  async function buscarProv() {
    const id = busquedaProv.trim()
    if (id.length < 8) { setAvisoProv('Ingresa un DNI (8 dígitos) o RUC (11 dígitos).'); return }
    setCargandoProv(true)
    setAvisoProv('')
    try {
      const p = await consultarProveedor(id)
      if (p) {
        setDocProv({ ...p, confirmado: true })
      } else {
        setAvisoProv('No se encontró el documento. Revisá el número o ingresá manualmente.')
        setModoProv('manual')
        setDocProv((d) => ({ ...d, documento: id, tipoDocumento: id.length === 11 ? 'RUC' : 'DNI', confirmado: false }))
      }
    } catch (e) {
      console.error('❌ Error consultando proveedor:', e)
      setAvisoProv('No se pudo consultar (¿sin internet?). Ingresá manualmente.')
      setModoProv('manual')
      setDocProv((d) => ({ ...d, documento: id, tipoDocumento: id.length === 11 ? 'RUC' : 'DNI', confirmado: false }))
    }
    setCargandoProv(false)
  }

  function confirmarManual() {
    if (!docProv.nombre.trim()) { setAvisoProv('Completa el nombre del proveedor.'); return }
    setDocProv({ ...docProv, confirmado: true })
    setAvisoProv('')
  }

  function seleccionarGuardado(p: Proveedor) {
    setDocProv({ nombre: p.nombre || '', documento: p.documento || '', tipoDocumento: p.tipoDocumento || 'RUC', direccion: p.direccion || '', telefono: p.telefono, correo: p.correo, confirmado: true })
    setAvisoProv('')
  }

  const total = carrito.reduce((s, i) => s + parseDecimal(i.costoTexto) * i.cantidad, 0)

  async function guardar() {
    if (carrito.length === 0) { toast('Selecciona al menos un producto.', 'warning'); return }
    if (!docProv.confirmado || !docProv.nombre.trim()) { toast('Completa y confirma el proveedor.', 'warning'); return }
    if (total <= 0) { toast('El total de la compra debe ser mayor a 0.', 'warning'); return }
    const ok = await confirm({ title: 'Confirmar compra', message: `Proveedor: ${docProv.nombre}\nTotal a pagar: ${fmt(total)}\n\n¿Registrar esta compra?`, okText: 'Registrar' })
    if (!ok) return
    setProcesando(true)
    // Crea/actualiza el proveedor (si no existe lo guarda en la colección Proveedor).
    await guardarProveedor({ nombre: docProv.nombre, documento: docProv.documento, tipoDocumento: docProv.tipoDocumento, direccion: docProv.direccion, telefono: docProv.telefono, correo: docProv.correo })
    const r = await registrarCompra({
      items: carrito.map((i) => ({ productoId: i.id, productoNombre: i.nombre, cantidad: i.cantidad, costoUnitario: parseDecimal(i.costoTexto), factor: i.factor, presentacionId: i.presentacionId, presentacionNombre: i.presentacionNombre })),
      proveedor: docProv.nombre,
      proveedorDireccion: docProv.direccion,
      nota,
      tipoPago,
      turnoId,
    })
    setProcesando(false)
    if (r.success) {
      toast(`Compra registrada. Total pagado: ${fmt(r.totalPagado ?? 0)}`, 'success')
      onGuardado()
      onClose()
    } else {
      toast(r.error || 'Error', 'error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="flex items-center gap-2 font-bold"><ShoppingCart className="h-5 w-5 text-primary" /> Ingreso de Productos (Compra)</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Buscar producto */}
          <div>
            <Label className="mb-1 block">Producto</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto…" className="pl-10" />
            </div>
            <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border">
              {filtrados.length === 0 ? <p className="p-4 text-center text-xs text-muted-foreground">Sin productos</p> : filtrados.map((p) => (
                <button key={p.id} onClick={() => agregar(p)} className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/40 cursor-pointer">
                  <span className="min-w-0 truncate">{p.nombre}{p.codigo ? ` · #${p.codigo}` : ''}{getPresCompra(p).length > 1 ? ' 🎁' : ''}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">costo {fmt(p.precioCompra || 0)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Carrito de compra */}
          <div>
            <Label className="mb-1 block">Productos de la compra</Label>
            {carrito.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">Agregá productos arriba</p>
            ) : (
              <div className="divide-y rounded-xl border">
                {carrito.map((i) => {
                  const prod = activos.find((a) => a.id === i.id)
                  const pres = prod ? getPresCompra(prod) : []
                  const hayPres = pres.length > 1
                  return (
                    <div key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1 basis-40">
                        <div className="truncate font-medium">{i.nombre}</div>
                        {hayPres && (
                          <select
                            value={i.presentacionId}
                            onChange={(e) => {
                              const sel = pres.find((x) => x.id === e.target.value)
                              if (sel) cambiarPresentacion(i.id, sel)
                            }}
                            className="mt-0.5 w-full rounded border bg-transparent px-1 py-0.5 text-xs"
                          >
                            {pres.map((x) => <option key={x.id} value={x.id}>{x.nombre} (×{x.factor})</option>)}
                          </select>
                        )}
                        {i.factor !== 1 && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">= {i.cantidad * i.factor} {i.presentacionNombre} ({i.nombre} base)</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCarrito((p) => p.map((x) => x.id === i.id ? { ...x, cantidad: Math.max(1, x.cantidad - 1) } : x))}>−</Button>
                        <span className="w-7 text-center font-bold">{i.cantidad}</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCarrito((p) => p.map((x) => x.id === i.id ? { ...x, cantidad: x.cantidad + 1 } : x))}><Plus className="h-3.5 w-3.5" /></Button>
                        <input value={i.costoTexto} onChange={(e) => setCarrito((p) => p.map((x) => x.id === i.id ? { ...x, costoTexto: e.target.value } : x))} inputMode="decimal" className="ml-1 h-7 w-20 rounded border px-2 text-right text-xs" />
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setCarrito((p) => p.filter((x) => x.id !== i.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {carrito.some((i) => i.factor !== 1) && (
              <p className="mt-1 text-[11px] text-muted-foreground">La cantidad de productos con presentación se suma al stock en unidad base (cant. × factor).</p>
            )}
          </div>

          {/* Proveedor */}
          <div>
            <Label className="mb-1 block">Proveedor *</Label>
            {docProv.confirmado ? (
              <div className="flex items-center gap-2 rounded-xl border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{docProv.nombre}</div>
                  <div className="text-xs text-muted-foreground">
                    {docProv.tipoDocumento} {docProv.documento}
                    {docProv.direccion ? ` · ${docProv.direccion}` : ''}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setDocProv({ ...docProv, confirmado: false })} className="shrink-0">Cambiar</Button>
              </div>
            ) : (
              <>
                <div className="mb-2 flex gap-1 rounded-xl bg-muted p-1 text-sm">
                  {(['buscar', 'manual', 'seleccionar'] as const).map((m) => (
                    <button key={m} onClick={() => { setModoProv(m); setAvisoProv('') }} className={cn('flex-1 rounded-lg px-2 py-1.5 text-center cursor-pointer', modoProv === m ? 'bg-background shadow-sm font-semibold' : 'text-muted-foreground hover:text-foreground')}>
                      {m === 'buscar' ? 'Buscar RUC/DNI' : m === 'manual' ? 'Manual' : 'Guardados'}
                    </button>
                  ))}
                </div>

                {modoProv === 'buscar' && (
                  <div className="flex gap-2">
                    <Input value={busquedaProv} onChange={(e) => setBusquedaProv(e.target.value)} placeholder="RUC (11) o DNI (8)" inputMode="numeric" className="flex-1" />
                    <Button onClick={buscarProv} disabled={cargandoProv} type="button">{cargandoProv ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />} Buscar</Button>
                  </div>
                )}

                {modoProv === 'manual' && (
                  <div className="grid gap-2">
                    <Input value={docProv.nombre} onChange={(e) => setDocProv((d) => ({ ...d, nombre: e.target.value }))} placeholder="Nombre del proveedor" />
                    <Input value={docProv.direccion} onChange={(e) => setDocProv((d) => ({ ...d, direccion: e.target.value }))} placeholder="Dirección (opcional)" />
                    <Button onClick={confirmarManual} type="button" variant="outline">Usar este proveedor</Button>
                  </div>
                )}

                {modoProv === 'seleccionar' && (
                  <div className="max-h-40 overflow-y-auto rounded-xl border">
                    {proveedoresGuardados.length === 0 ? (
                      <p className="p-4 text-center text-xs text-muted-foreground">No hay proveedores guardados aún</p>
                    ) : proveedoresGuardados.map((p) => (
                      <button key={p.id} onClick={() => seleccionarGuardado(p)} className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/40 cursor-pointer">
                        <span className="min-w-0 truncate">{p.nombre}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{p.tipoDocumento} {p.documento}</span>
                      </button>
                    ))}
                  </div>
                )}

                {avisoProv && <p className="mt-1 text-xs text-muted-foreground">{avisoProv}</p>}
              </>
            )}
          </div>

          {/* Nota */}
          <div>
            <Label className="mb-1 block">Nota (opcional)</Label>
            <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="N° de factura / observación" />
          </div>

          {/* Tipo de pago */}
          {turnoId && (
            <div>
              <Label className="mb-1 block">Medio de pago</Label>
              <div className="flex gap-1 rounded-xl bg-muted p-1 text-sm">
                {(['Transferencia', 'caja'] as const).map((tp) => (
                  <button key={tp} onClick={() => setTipoPago(tp)} type="button" className={cn('flex-1 rounded-lg px-3 py-1.5 text-center cursor-pointer transition-all', tipoPago === tp ? 'bg-background shadow-sm font-semibold' : 'text-muted-foreground hover:text-foreground')}>
                    {tp === 'caja' ? '💵 Efectivo (Caja)' : '🏦 Transferencia'}
                  </button>
                ))}
              </div>
              {tipoPago === 'caja' && <p className="mt-1 text-xs text-muted-foreground">Se descontará del efectivo del turno actual.</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-4">
          <span className="text-sm text-muted-foreground">Total a pagar</span>
          <span className="num text-2xl font-extrabold">{fmt(total)}</span>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={guardar} disabled={procesando || carrito.length === 0}>
              {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {procesando ? 'Registrando…' : 'Registrar Compra'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
