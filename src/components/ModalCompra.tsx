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
import { costoPorUnidadBase } from '@/lib/valorizacion'
import { costoDeCompra } from '@/lib/precio-venta'
import { esGravado } from '@/lib/sunat-importes'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { TIPOS_COMPROBANTE_COMPRA, documentoDeProveedor } from '@/lib/registro-compras'
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
type CartItem = { id: string; nombre: string; cantidad: number; costoTexto: string; factor: number; presentacionId: string; presentacionNombre: string; /** ¿El comprobante del proveedor trae IGV? (dato del PAPEL, no del producto). */ traeIgv?: boolean }

// Presentaciones de compra de un producto. Si no tiene, devuelve la unidad base (factor 1).
const getPresCompra = (p: Producto): Presentacion[] => {
  const pres = (p.presentaciones || []).filter((x) => x.esCompra !== false)
  if (pres.length > 0) return pres.map((x) => ({ id: x.id || x.nombre || 'unidad', nombre: x.nombre || (p.unidadBase || 'Unidad'), factor: x.factor || 1 }))
  return [{ id: 'unidad', nombre: p.unidadBase || 'Unidad', factor: 1 }]
}

const PROV_INICIAL: DocProveedor = { nombre: '', documento: '', tipoDocumento: 'RUC', direccion: '', confirmado: false }

export function ModalCompra({ onClose, onGuardado }: { onClose: () => void; onGuardado: () => void }) {
  const { productos } = useProductos()
  const { config } = useConfiguracion()
  const { user } = useAuth()
  const { tienePermiso } = usePermisos()
  const { toast, confirm } = useNotifications()
  const [q, setQ] = React.useState('')
  const [carrito, setCarrito] = React.useState<CartItem[]>([])
  const [nota, setNota] = React.useState('')
  /**
   * 🔑 **El comprobante del proveedor**: tipo, serie, número y fecha de emisión. Es lo que pide el
   * **Registro de Compras (SUNAT · RCE)** — de acá sale el **CAR** de 27 dígitos (`lib/registro-compras.ts`) —
   * y antes no se capturaba en ningún lado (solo había una nota libre). Es **opcional** para no trabar la
   * carga del día: si falta, el registro lo avisa en vez de inventar el dato.
   */
  const [comprobante, setComprobante] = React.useState({ tipoComprobante: '01', serie: '', numero: '', fechaEmision: new Date().toISOString().slice(0, 10) })
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

  // Aplanar productos con sus presentaciones de compra para la lista
  const itemsBusqueda = React.useMemo(() => {
    const result: { key: string; producto: Producto; presentacion: Presentacion; label: string }[] = []
    for (const p of filtrados) {
      const pres = getPresCompra(p)
      if (pres.length === 1) {
        result.push({ key: p.id, producto: p, presentacion: pres[0], label: p.nombre || p.codigo || 'Producto' })
      } else {
        for (const pr of pres) {
          result.push({ key: `${p.id}__${pr.id}`, producto: p, presentacion: pr, label: `${p.nombre || p.codigo || 'Producto'} — ${pr.nombre} (×${pr.factor})` })
        }
      }
    }
    return result
  }, [filtrados])

  function agregar(p: Producto, pres?: Presentacion) {
    const presList = getPresCompra(p)
    const chosen = pres ?? presList[0]
    const cartKey = `${p.id}__${chosen.id}`
    setCarrito((prev) => {
      const ex = prev.find((i) => i.id === cartKey)
      if (ex) return prev.map((i) => (i.id === cartKey ? { ...i, cantidad: i.cantidad + 1 } : i))
      return [...prev, { id: cartKey, nombre: p.nombre || p.codigo || 'Producto', cantidad: 1, costoTexto: String(p.precioCompra || 0), factor: chosen.factor, presentacionId: chosen.id, presentacionNombre: chosen.nombre }]
    })
  }

  function cambiarPresentacion(itemId: string, pres: Presentacion) {
    const prodId = itemId.split('__')[0]
    const newKey = `${prodId}__${pres.id}`
    setCarrito((prev) => prev.map((i) => {
      if (i.id !== itemId) return i
      return { ...i, id: newKey, factor: pres.factor, presentacionId: pres.id, presentacionNombre: pres.nombre }
    }))
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
        setAvisoProv('No se encontró el documento. Revisa el número o ingresa manualmente.')
        setModoProv('manual')
        setDocProv((d) => ({ ...d, documento: id, tipoDocumento: id.length === 11 ? 'RUC' : 'DNI', confirmado: false }))
      }
    } catch (e) {
      console.error('❌ Error consultando proveedor:', e)
      setAvisoProv('No se pudo consultar (¿sin internet?). Ingresa manualmente.')
      setModoProv('manual')
      setDocProv((d) => ({ ...d, documento: id, tipoDocumento: id.length === 11 ? 'RUC' : 'DNI', confirmado: false }))
    }
    setCargandoProv(false)
  }

  function confirmarManual() {
    if (!docProv.nombre.trim()) { setAvisoProv('Completa el nombre del proveedor.'); return }
    const doc = documentoDeProveedor(docProv.documento)
    if (!doc) {
      setAvisoProv('El RUC tiene 11 dígitos y el DNI 8. Si el proveedor no te dio documento, usá «Sin documento» (el Registro de Compras va a avisarlo).')
      return
    }
    setDocProv({ ...docProv, documento: doc, tipoDocumento: doc.length === 8 ? 'DNI' : 'RUC', confirmado: true })
    setAvisoProv('')
  }

  /** El caso legítimo de un proveedor sin documento (boleta interna, venta de una persona). */
  function confirmarSinDocumento() {
    if (!docProv.nombre.trim()) { setAvisoProv('Completa el nombre del proveedor.'); return }
    setDocProv({ ...docProv, documento: '', confirmado: true })
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
    /**
     * 🔑 **El documento del proveedor es SOLO el RUC/DNI** (nunca el nombre): de acá sale el **CAR** del
     * Registro de Compras, y un nombre convertido en «documento» (el slug `golosinas_iris_…`) hacía que el
     * registro anotara un **CAR inventado** en vez de avisar que faltaba. Si no hay documento, va vacío.
     */
    const docProvDigitos = documentoDeProveedor(docProv.documento)
    const tipoDocProv: 'RUC' | 'DNI' = docProvDigitos.length === 8 ? 'DNI' : 'RUC'
    // Crea/actualiza el proveedor (si no existe lo guarda en la colección Proveedor) **con su RUC**.
    await guardarProveedor({ id: docProvDigitos || undefined, nombre: docProv.nombre, documento: docProvDigitos, tipoDocumento: tipoDocProv, direccion: docProv.direccion, telefono: docProv.telefono, correo: docProv.correo })
    const r = await registrarCompra({
      items: carrito.map((i) => ({ productoId: i.id.split('__')[0], productoNombre: i.nombre, cantidad: i.cantidad, costoUnitario: parseDecimal(i.costoTexto), factor: i.factor, presentacionId: i.presentacionId, presentacionNombre: i.presentacionNombre, traeIgv: i.traeIgv ?? Boolean(config.igvRecuperable) })),
      proveedor: docProv.nombre,
      proveedorId: docProvDigitos,
      proveedorDireccion: docProv.direccion,
      nota,
      tipoPago,
      turnoId,
      igvRecuperable: config.igvRecuperable,
      comprobante,
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
              {itemsBusqueda.length === 0 ? <p className="p-4 text-center text-xs text-muted-foreground">Sin productos</p> : itemsBusqueda.map((item) => (
                <button key={item.key} onClick={() => agregar(item.producto, item.presentacion)} className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/40 cursor-pointer">
                  <span className="min-w-0 truncate">{item.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">costo {fmt(item.producto.precioCompra || 0)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Carrito de compra */}
          <div>
            <Label className="mb-1 block">Productos de la compra</Label>
            {carrito.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">Agrega productos arriba</p>
            ) : (
              <div className="divide-y rounded-xl border">
                {carrito.map((i) => {
                  const prodId = i.id.split('__')[0]
                  const prod = activos.find((a) => a.id === prodId)
                  const pres = prod ? getPresCompra(prod) : []
                  const hayPres = pres.length > 1
                  /** Lo que se escribió en el casillero del costo (por **presentación**). */
                  const costoItem = parseDecimal(i.costoTexto)
                  /** El costo por **unidad base** que se está por guardar (misma cuenta que el servicio). */
                  const costoBaseItem = costoPorUnidadBase(costoItem, i.factor)
                  // 🔑 **¿El comprobante del proveedor trae IGV?** Es un dato del PAPEL, no del producto: acá se
                  // compra en Lima con factura y el mismo producto se puede vender exonerado (`'20'`). Decide
                  // dos cosas: si el costo se guarda sin IGV (cuando el negocio recupera el crédito) y cómo
                  // entra la línea en el **Registro de Compras** (base + IGV, o adquisición no gravada).
                  const traeIgv = i.traeIgv ?? Boolean(config.igvRecuperable)
                  const { costo: costoNeto, igvSeparado } = costoDeCompra(costoBaseItem, {
                    igvRecuperable: config.igvRecuperable,
                    afectacion: String(prod?.tipoAfectacion || ''),
                    yaSinIgv: !traeIgv,
                  })
                  /** ¿Este ítem entra en la lógica de separar el IGV? (negocio que lo recupera + producto gravado). */
                  const aplicaIgv = Boolean(config.igvRecuperable) && esGravado(String(prod?.tipoAfectacion || ''))
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
                      {/* 🔑 **El costo se carga por PRESENTACIÓN y el stock entra en unidad base**: acá se
                          ve la división que hace el sistema (una caja de 12 a S/ 38 → S/ 3.17 por botella).
                          ⚠️ La cuenta la hace `costoPorUnidadBase()` (la misma que usa `registrarCompra`
                          para guardar el costo), así que lo que se lee acá **es** lo que va a quedar. */}
                      {i.factor > 1 && costoItem > 0 && (
                        <div className="w-full text-right text-[10px] text-muted-foreground">
                          {fmt(costoItem)} ÷ {i.factor} = <span className="font-bold text-foreground">{fmt(costoPorUnidadBase(costoItem, i.factor))}</span> por unidad base
                        </div>
                      )}
                      {/* 🔑 **¿La factura del proveedor trae IGV?** Se marca acá y sirve para dos cosas:
                          (1) si el negocio **recupera el crédito fiscal**, el costo que se guarda es el
                          **neto** —acá se ve el mismo número que va a quedar, `costoDeCompra`, la regla que
                          usa `registrarCompra`—; (2) es lo que el **Registro de Compras** necesita para
                          declarar base + IGV en lugar de una adquisición no gravada.
                          ⚠️ Se muestra **siempre** (no solo con el interruptor prendido): una compra en Lima
                          trae IGV aunque el negocio no pueda usarlo como crédito (esta región). */}
                      {costoBaseItem > 0 && (
                        <div className="flex w-full items-center justify-between gap-2 text-[10px] text-muted-foreground">
                          <button
                            type="button"
                            onClick={() => setCarrito((p) => p.map((x) => x.id === i.id ? { ...x, traeIgv: !(x.traeIgv ?? Boolean(config.igvRecuperable)) } : x))}
                            className="cursor-pointer rounded border px-1.5 py-0.5 hover:bg-muted"
                          >
                            {traeIgv ? 'la factura trae IGV' : 'la factura no trae IGV'}
                          </button>
                          <span>
                            {traeIgv ? (
                              aplicaIgv ? (
                                <>{fmt(costoBaseItem)} − IGV {fmt(igvSeparado)} = <span className="font-bold text-foreground">{fmt(costoNeto)}</span> el costo</>
                              ) : (
                                <>con IGV en la factura · el costo queda <span className="font-bold text-foreground">{fmt(costoNeto)}</span> (el IGV no es crédito: es costo)</>
                              )
                            ) : (
                              <>se guarda <span className="font-bold text-foreground">{fmt(costoNeto)}</span> tal cual (sin IGV)</>
                            )}
                          </span>
                        </div>
                      )}
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
                    {docProv.documento ? `${docProv.tipoDocumento} ${docProv.documento}` : 'sin documento (el Registro de Compras lo va a avisar)'}
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
                    <Input value={docProv.documento} onChange={(e) => setDocProv((d) => ({ ...d, documento: e.target.value }))} placeholder="RUC (11 dígitos) o DNI (8)" inputMode="numeric" />
                    <Input value={docProv.direccion} onChange={(e) => setDocProv((d) => ({ ...d, direccion: e.target.value }))} placeholder="Dirección (opcional)" />
                    <p className="text-[11px] text-muted-foreground">
                      El <b>RUC/DNI</b> es lo que identifica al proveedor en el <b>Registro de Compras</b> (de ahí sale el CAR).
                    </p>
                    <div className="flex gap-2">
                      <Button onClick={confirmarManual} type="button" variant="outline" className="flex-1">Usar este proveedor</Button>
                      <Button onClick={confirmarSinDocumento} type="button" variant="ghost" className="text-xs" title="Para un proveedor que no te dio documento: la compra se registra igual y el Registro de Compras lo avisa">Sin documento</Button>
                    </div>
                  </div>
                )}

                {modoProv === 'seleccionar' && (
                  <div className="max-h-40 overflow-y-auto rounded-xl border">
                    {proveedoresGuardados.length === 0 ? (
                      <p className="p-4 text-center text-xs text-muted-foreground">No hay proveedores guardados aún</p>
                    ) : proveedoresGuardados.map((p) => (
                      <button key={p.id} onClick={() => seleccionarGuardado(p)} className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/40 cursor-pointer">
                        <span className="min-w-0 truncate">{p.nombre}</span>
                        <span className={cn('shrink-0 text-xs', p.documento ? 'text-muted-foreground' : 'text-amber-600')}>
                          {p.documento ? `${p.tipoDocumento} ${p.documento}` : 'sin documento'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {avisoProv && <p className="mt-1 text-xs text-muted-foreground">{avisoProv}</p>}
              </>
            )}
          </div>

          {/* Comprobante del proveedor — es lo que pide el Registro de Compras (SUNAT · RCE) */}
          <div className="rounded-xl border p-3">
            <Label className="mb-1 block">Comprobante del proveedor</Label>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Con estos datos se arma el <b>Registro de Compras</b> (Reportes → Registro SIRE → Compras). Si no
              los tenés a mano, la compra se registra igual y el registro te avisa cuál falta.
            </p>
            <div className="mb-2 flex flex-wrap gap-1">
              {TIPOS_COMPROBANTE_COMPRA.map((t) => (
                <button
                  key={t.codigo}
                  type="button"
                  onClick={() => setComprobante((c) => ({ ...c, tipoComprobante: t.codigo }))}
                  className={cn(
                    'cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                    comprobante.tipoComprobante === t.codigo ? 'border-primary bg-primary text-white' : 'bg-background hover:bg-accent',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Input value={comprobante.serie} onChange={(e) => setComprobante((c) => ({ ...c, serie: e.target.value.toUpperCase() }))} placeholder="Serie (F001)" />
              <Input value={comprobante.numero} onChange={(e) => setComprobante((c) => ({ ...c, numero: e.target.value }))} placeholder="Número" inputMode="numeric" />
              <Input type="date" value={comprobante.fechaEmision} onChange={(e) => setComprobante((c) => ({ ...c, fechaEmision: e.target.value }))} />
              <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional)" />
            </div>
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
