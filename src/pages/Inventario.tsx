import { collection, deleteDoc, deleteField, doc, getDocs, limit, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, BarChart3, ClipboardCheck, Download, FileText, Loader2, Package, Pencil, Plus, Printer, RefreshCw, Search, ShoppingCart, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/components/notifications'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InfiniteScroll } from '@/components/ui/infinite-scroll'
import { ModalReportes } from '@/components/ModalReportes'
import { ModalCompra } from '@/components/ModalCompra'
import { usePermisos } from '@/context/permisos'
import { useAuth } from '@/context/auth'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { useProductos, type Producto } from '@/hooks/use-productos'
import { AFECTACION_POR_DEFECTO, TIPO_AFECTACION } from '@/constants/tributario'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { fmt, useToast, estadoVencimiento, esc } from '@/lib/ui-utils'
import { exportarExcel } from '@/lib/excel'
import { logActividad } from '@/lib/audit'
import { registrarCambioPrecio, obtenerHistorialPrecios } from '@/services/historial-precios'

type PresForm = { nombre: string; factor: string; esVenta: boolean; esCompra: boolean }
type KitItemForm = { productoId: string; cantidad: string }
type FormState = {
  nombre: string
  codigo: string
  categoria: string
  precioCompra: string
  precioVenta: string
  precioEspecial: string
  stock: string
  minStock: string
  activo: boolean
  imagen: string
  tipoAfectacion: string
  unidadBase: string
  fechaVencimiento: string
  isKit: boolean
  kitItems: KitItemForm[]
  presentaciones: PresForm[]
}

const VACIO: FormState = {
  nombre: '', codigo: '', categoria: 'Productos', precioCompra: '', precioVenta: '', precioEspecial: '', stock: '', minStock: '',
  activo: true, imagen: '', tipoAfectacion: AFECTACION_POR_DEFECTO, unidadBase: 'unidad', fechaVencimiento: '', isKit: false, kitItems: [], presentaciones: [],
}

function toForm(p: Producto): FormState {
  return {
    nombre: p.nombre ?? '', codigo: p.codigo ?? '', categoria: p.categoria ?? 'Productos',
    precioCompra: String(p.precioCompra ?? ''), precioVenta: String(p.precioVenta ?? ''), precioEspecial: String(p.precioEspecial ?? ''),
    stock: String(p.stock ?? ''), minStock: String(p.minStock ?? ''), activo: p.activo !== false,
    imagen: p.imagen ?? '', tipoAfectacion: p.tipoAfectacion ?? AFECTACION_POR_DEFECTO,
    unidadBase: p.unidadBase ?? 'unidad', fechaVencimiento: p.fechaVencimiento ?? '',
    isKit: p.isKit === true,
    kitItems: (p.kitItems ?? []).map((ki) => ({ productoId: ki.productoId, cantidad: String(ki.cantidad) })),
    presentaciones: (p.presentaciones ?? []).map((pr) => ({
      nombre: pr.nombre ?? '', factor: String(pr.factor ?? 1), esVenta: pr.esVenta !== false, esCompra: pr.esCompra !== false,
    })),
  }
}

// Lee un archivo de imagen y lo convierte a data-URL JPEG (cuadrado, máx 600px,
// calidad 0.75) — igual criterio que la app RN (calidad 0.5 + recorte 1:1).
function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const MAX = 600
        const min = Math.min(img.width, img.height)
        const size = Math.min(MAX, min)
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas no disponible'))
        // recorte cuadrado centrado
        const sx = (img.width - min) / 2
        const sy = (img.height - min) / 2
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      }
      img.onerror = () => reject(new Error('Imagen inválida'))
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

export function Inventario() {
  const { productos, loading, error } = useProductos()
  const { tienePermiso } = usePermisos()
  const { user } = useAuth()
  const { config: cfg } = useConfiguracion()
  const { confirm } = useNotifications()
  const [q, setQ] = React.useState('')
  const [catActiva, setCatActiva] = React.useState('Todos')
  const [verActivos, setVerActivos] = React.useState(true)
  const [soloStockBajo, setSoloStockBajo] = React.useState(false)
  const [sort, setSort] = React.useState<{ key: 'nombre' | 'categoria' | 'precioVenta' | 'stock'; dir: 'asc' | 'desc' }>({ key: 'nombre', dir: 'asc' })
  const [editando, setEditando] = React.useState<Producto | null>(null)
  const [modal, setModal] = React.useState(false)
  const [form, setForm] = React.useState<FormState>(VACIO)
  const [saving, setSaving] = React.useState(false)
  const { toast, setToast } = useToast()
  const [reportesAbierto, setReportesAbierto] = React.useState(false)
  const [compraAbierta, setCompraAbierta] = React.useState(false)
  const [ajusteAbierto, setAjusteAbierto] = React.useState(false)
  const [ajusteProductoId, setAjusteProductoId] = React.useState('')
  const [ajusteCantidad, setAjusteCantidad] = React.useState('')
  const [ajusteTipo, setAjusteTipo] = React.useState<'entrada' | 'salida'>('salida')
  const [ajusteMotivo, setAjusteMotivo] = React.useState('merma')
  const [ajusteNota, setAjusteNota] = React.useState('')
  const [ajusteGuardando, setAjusteGuardando] = React.useState(false)
  const [tomaAbierto, setTomaAbierto] = React.useState(false)
  const [tomaConteos, setTomaConteos] = React.useState<Record<string, string>>({})
  const [tomaBusqueda, setTomaBusqueda] = React.useState('')
  const [tomaGuardando, setTomaGuardando] = React.useState(false)
  const [tomaCategoria, setTomaCategoria] = React.useState('Todas')
  const [historialAbierto, setHistorialAbierto] = React.useState(false)
  const [historialData, setHistorialData] = React.useState<import('@/services/historial-precios').HistorialPrecio[]>([])
  const [historialCargando, setHistorialCargando] = React.useState(false)
  const [visibles, setVisibles] = React.useState(25)
  const PAGE = 25

  const puedeCrear = tienePermiso('crearProducto')
  const puedeEditar = tienePermiso('editarProducto')
  const puedeEliminar = tienePermiso('eliminarProducto')
  const puedeVerCostos = tienePermiso('verCostos')

  React.useEffect(() => setVisibles(PAGE), [q, catActiva, soloStockBajo])

  const categoria = React.useMemo(() => {
    const s = new Set<string>()
    productos.forEach((p) => p.categoria && s.add(p.categoria))
    return Array.from(s)
  }, [productos])

  const lista = React.useMemo(() => {
    const t = q.trim().toLowerCase()
    const filt = productos.filter(
      (p) =>
        (verActivos ? p.activo !== false : true) &&
        (catActiva === 'Todos' || p.categoria === catActiva) &&
        (!t || p.nombre?.toLowerCase().includes(t) || p.codigo?.toLowerCase().includes(t)) &&
        (!soloStockBajo || (p.stock != null && p.stock > 0 && p.minStock != null && p.stock <= p.minStock) || p.stock === 0)
    )
    const val = (p: Producto): string | number => {
      if (sort.key === 'categoria') return p.categoria ?? ''
      if (sort.key === 'precioVenta') return p.precioVenta ?? 0
      if (sort.key === 'stock') return p.stock ?? 0
      return p.nombre ?? ''
    }
    return filt.sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [productos, q, catActiva, sort, verActivos, soloStockBajo])

  const hayMas = visibles < lista.length
  const paginados = lista.slice(0, visibles)

  async function exportarExcelInv() {
    if (lista.length === 0) { setToast('No hay productos para exportar'); return }
    const headers = ['Código', 'Nombre', 'Categoría', 'Stock', 'Mín.', 'Precio Compra', 'Precio Venta', 'Precio Especial', 'Estado', 'Vencimiento']
    const rows = lista.map((p) => {
      const est = (() => {
        if ((p.stock ?? 0) === 0) return 'AGOTADO'
        if (p.minStock != null && p.minStock > 0 && (p.stock ?? 0) <= p.minStock) return 'BAJO'
        return 'OK'
      })()
      return [
        p.codigo ?? '',
        p.nombre ?? '',
        p.categoria ?? '',
        p.stock ?? 0,
        p.minStock ?? '',
        p.precioCompra ?? 0,
        p.precioVenta ?? 0,
        p.precioEspecial ?? '',
        est,
        p.fechaVencimiento ?? '',
      ]
    })
    await exportarExcel([{ name: 'Inventario', headers, rows }], `Inventario_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`, { empresa: cfg?.nombre || 'AppADM', titulo: 'Inventario de Productos' })
    setToast('Excel exportado')
  }

  const cargarMas = React.useCallback(() => {
    setVisibles((prev) => prev + PAGE)
  }, [])

  function toggleSort(key: 'nombre' | 'categoria' | 'precioVenta' | 'stock') {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  const sortHeader = (k: 'nombre' | 'categoria' | 'precioVenta' | 'stock', label: string) => (
    <button onClick={() => toggleSort(k)} className="flex items-center gap-1 font-semibold hover:text-foreground cursor-pointer">
      {label}
      {sort.key === k ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
    </button>
  )

  function abrirNuevo() {
    if (!puedeCrear) return setToast('🚫 No tienes permiso para crear productos')
    setEditando(null)
    setForm(VACIO)
    setModal(true)
  }
  function abrirEditar(p: Producto) {
    if (!puedeEditar) return setToast('🚫 No tienes permiso para editar productos')
    setEditando(p)
    setForm(toForm(p))
    setModal(true)
  }
  async function eliminar(p: Producto) {
    if (!puedeEliminar) return setToast('🚫 No tienes permiso para eliminar productos')
    try {
      // Verificar movimientos directos del producto
      const movSnap = await getDocs(query(collection(db, 'tblMovimientos'), where('productoId', '==', p.id), limit(1)))
      if (!movSnap.empty) {
        setToast('⚠️ Este producto tiene movimientos registrados (ventas/compras) y no se puede eliminar.')
        return
      }
      // Si es kit, verificar que no haya ventas donde fue vendido como combo
      if (p.isKit) {
        const kitMovSnap = await getDocs(query(collection(db, 'tblMovimientos'), where('metadata.kitId', '==', p.id), limit(1)))
        if (!kitMovSnap.empty) {
          setToast('⚠️ Este kit/combo ya fue vendido y no se puede eliminar.')
          return
        }
      }
    } catch (e) {
      setToast('❌ No se pudo verificar movimientos: ' + (e as Error).message)
      return
    }
    const ok = await confirm({ title: 'Eliminar producto', message: `¿Eliminar "${p.nombre}"?`, okText: 'Eliminar', destructive: true })
    if (!ok) return
    deleteDoc(doc(db, 'tblProductos', p.id))
      .then(() => {
        logActividad({ accion: 'eliminar_producto', entidad: 'tblProductos', entidadId: p.id, detalle: { nombre: p.nombre, codigo: p.codigo } })
        setToast('🗑️ Producto eliminado')
      })
      .catch((e) => setToast('❌ Error: ' + (e as Error).message))
  }

  function abrirAjuste(p: Producto) {
    setAjusteProductoId(p.id)
    setAjusteCantidad('')
    setAjusteTipo('salida')
    setAjusteMotivo('merma')
    setAjusteNota('')
    setAjusteAbierto(true)
  }

  async function guardarAjuste() {
    const prod = productos.find((p) => p.id === ajusteProductoId)
    if (!prod) return setToast('⚠️ Seleccioná un producto')
    const cant = parseInt(ajusteCantidad)
    if (!cant || cant <= 0) return setToast('⚠️ Ingresá una cantidad válida')
    const stockActual = prod.stock ?? 0
    if (ajusteTipo === 'salida' && cant > stockActual) return setToast('⚠️ No podés sacar más de lo que hay en stock')
    setAjusteGuardando(true)
    try {
      const nuevoStock = ajusteTipo === 'entrada' ? stockActual + cant : stockActual - cant
      const f = new Date().toISOString()
      const batch = writeBatch(db)
      batch.update(doc(db, 'tblProductos', prod.id), { stock: nuevoStock, ultimaActualizacion: f, updatedAt: f })
      batch.set(doc(collection(db, 'tblMovimientos')), {
        productoId: prod.id,
        productoCodigo: prod.codigo || prod.id,
        productoNombre: prod.nombre,
        tipoMovimiento: ajusteTipo === 'entrada' ? 'ajuste_entrada' : 'ajuste_salida',
        cantidad: cant,
        stockAnterior: stockActual,
        stockNuevo: nuevoStock,
        motivo: ajusteMotivo,
        nota: ajusteNota.trim(),
        usuario: user?.displayName || user?.email || 'sistema',
        fecha: f,
        timestamp: Date.now(),
      })
      await batch.commit()
      logActividad({ accion: 'ajuste_stock', entidad: 'tblProductos', entidadId: prod.id, detalle: { nombre: prod.nombre, tipo: ajusteTipo, cantidad: cant, motivo: ajusteMotivo, stockAnterior: stockActual, stockNuevo: nuevoStock } })
      setToast(`✅ Ajuste registrado: ${ajusteTipo === 'entrada' ? '+' : '-'}${cant} "${prod.nombre}"`)
      setAjusteAbierto(false)
    } catch (e) {
      setToast('❌ Error: ' + (e as Error).message)
    } finally {
      setAjusteGuardando(false)
    }
  }

  const tomaCategorias = React.useMemo(() => {
    const s = new Set<string>(['Todas'])
    productos.forEach((p) => p.categoria && s.add(p.categoria))
    return Array.from(s)
  }, [productos])

  const tomaLista = React.useMemo(() => {
    const t = tomaBusqueda.trim().toLowerCase()
    return productos
      .filter((p) => p.activo !== false)
      .filter((p) => tomaCategoria === 'Todas' || p.categoria === tomaCategoria)
      .filter((p) => !t || p.nombre?.toLowerCase().includes(t) || p.codigo?.toLowerCase().includes(t))
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
  }, [productos, tomaBusqueda, tomaCategoria])

  const tomaStats = React.useMemo(() => {
    let contados = 0, sobrantes = 0, faltantes = 0, ok = 0
    tomaLista.forEach((p) => {
      const raw = tomaConteos[p.id]
      if (raw === '' || raw == null) return
      const fisico = parseInt(raw)
      if (isNaN(fisico)) return
      contados++
      const diff = fisico - (p.stock ?? 0)
      if (diff > 0) sobrantes++
      else if (diff < 0) faltantes++
      else ok++
    })
    return { contados, sobrantes, faltantes, ok }
  }, [tomaLista, tomaConteos])

  function abrirToma() {
    setTomaConteos({})
    setTomaBusqueda('')
    setTomaCategoria('Todas')
    setTomaAbierto(true)
  }

  function imprimirToma() {
    const fecha = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const hora = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
    const filas = tomaLista.map((p) => {
      const raw = tomaConteos[p.id] ?? ''
      const fisico = raw !== '' ? parseInt(raw) : NaN
      const stock = p.stock ?? 0
      const diff = !isNaN(fisico) ? fisico - stock : null
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-weight:500">${esc(p.nombre)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-family:monospace">${esc(p.codigo || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-family:monospace;font-weight:600">${stock}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-family:monospace">${!isNaN(fisico) ? fisico : '—'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-family:monospace;font-weight:700;color:${diff !== null ? (diff === 0 ? '#059669' : diff > 0 ? '#2563eb' : '#dc2626') : '#9ca3af'}">${diff !== null ? (diff > 0 ? '+' : '') + diff : '—'}</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html><head><title>Toma de Inventario</title>
<style>
  @media print { @page { margin: 15mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; color: #1a1a2e; }
  .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #1a1a2e; padding-bottom: 15px; }
  .header h1 { margin: 0; font-size: 22px; }
  .header p { margin: 4px 0 0; font-size: 12px; color: #666; }
  .stats { display: flex; gap: 20px; justify-content: center; margin: 15px 0; font-size: 13px; }
  .stats span { padding: 4px 12px; border-radius: 6px; background: #f3f4f6; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #1a1a2e; color: white; padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase; }
  .footer { margin-top: 20px; text-align: center; font-size: 11px; color: #999; border-top: 1px solid #e5e7eb; padding-top: 10px; }
  .firma { display: flex; justify-content: space-between; margin-top: 40px; padding: 0 40px; }
  .firma div { text-align: center; font-size: 12px; }
  .firma .linea { border-top: 1px solid #333; width: 150px; margin: 0 auto 4px; }
</style></head><body>
  <div class="header">
    <h1>Toma de Inventario</h1>
    <p>Fecha: ${fecha} &nbsp;|&nbsp; Hora: ${hora}</p>
  </div>
  <div class="stats">
    <span>Total: <strong>${tomaLista.length}</strong></span>
    <span>Contados: <strong>${tomaStats.contados}</strong></span>
    ${tomaStats.ok > 0 ? `<span style="color:#059669">OK: <strong>${tomaStats.ok}</strong></span>` : ''}
    ${tomaStats.sobrantes > 0 ? `<span style="color:#2563eb">Sobrantes: <strong>${tomaStats.sobrantes}</strong></span>` : ''}
    ${tomaStats.faltantes > 0 ? `<span style="color:#dc2626">Faltantes: <strong>${tomaStats.faltantes}</strong></span>` : ''}
  </div>
  <table>
    <thead><tr>
      <th>Producto</th><th style="text-align:center">Código</th><th style="text-align:center">Stock Sistema</th><th style="text-align:center">Conteo Físico</th><th style="text-align:center">Diferencia</th>
    </tr></thead>
    <tbody>${filas}</tbody>
  </table>
  <div class="firma">
    <div><div class="linea"></div>Responsable de Inventario</div>
    <div><div class="linea"></div>Supervisor</div>
  </div>
  <div class="footer">Documento generado por AppADM — ${fecha} ${hora}</div>
</body></html>`

    const win = window.open('', '_blank')
    if (win) {
      win.document.write(html)
      win.document.close()
      win.focus()
      setTimeout(() => win.print(), 300)
    }
  }

  function imprimirPlantilla() {
    const fecha = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const hora = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
    const filas = tomaLista.map((p, i) => {
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #d1d5db;font-size:12px">${i + 1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #d1d5db;font-weight:500;font-size:12px">${esc(p.nombre)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #d1d5db;text-align:center;font-family:monospace;font-size:12px">${esc(p.codigo || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #d1d5db;text-align:center;font-family:monospace;font-size:12px">${esc(p.unidadBase || 'Unidad')}</td>
        <td style="padding:8px;border-bottom:1px solid #d1d5db;text-align:center;font-family:monospace"></td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html><head><title>Plantilla Toma de Inventario</title>
<style>
  @media print { @page { margin: 12mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; color: #1a1a2e; }
  .header { text-align: center; margin-bottom: 16px; border-bottom: 2px solid #1a1a2e; padding-bottom: 12px; }
  .header h1 { margin: 0; font-size: 20px; }
  .header p { margin: 4px 0 0; font-size: 12px; color: #666; }
  .legend { text-align: center; margin: 10px 0; font-size: 11px; color: #666; background: #f9fafb; padding: 6px 12px; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #1a1a2e; color: white; padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase; }
  .count-col { width: 100px; }
  .footer { margin-top: 16px; text-align: center; font-size: 11px; color: #999; border-top: 1px solid #e5e7eb; padding-top: 10px; }
  .firma { display: flex; justify-content: space-between; margin-top: 30px; padding: 0 40px; }
  .firma div { text-align: center; font-size: 12px; }
  .firma .linea { border-top: 1px solid #333; width: 150px; margin: 0 auto 4px; }
</style></head><body>
  <div class="header">
    <h1>Plantilla — Toma de Inventario</h1>
    <p>Fecha: ${fecha} &nbsp;|&nbsp; Hora: ${hora}</p>
  </div>
  <div class="legend">✍️ Completar la columna "Conteo Físico" con la cantidad contada en almacén. Luego ingresar los datos en el sistema.</div>
  <table>
    <thead><tr>
      <th style="width:40px">#</th><th>Producto</th><th style="text-align:center">Código</th><th style="text-align:center">Unidad</th><th class="count-col" style="text-align:center">Conteo Físico</th>
    </tr></thead>
    <tbody>${filas}</tbody>
  </table>
  <div class="firma">
    <div><div class="linea"></div>Responsable de Inventario</div>
    <div><div class="linea"></div>Supervisor</div>
  </div>
  <div class="footer">Plantilla generada por AppADM — ${fecha} ${hora} — Total: ${tomaLista.length} productos</div>
</body></html>`

    const win = window.open('', '_blank')
    if (win) {
      win.document.write(html)
      win.document.close()
      win.focus()
      setTimeout(() => win.print(), 300)
    }
  }

  async function aplicarToma() {
    const productosConConteo = tomaLista.filter((p) => {
      const raw = tomaConteos[p.id]
      return raw !== '' && raw != null && !isNaN(parseInt(raw))
    })
    if (productosConConteo.length === 0) return setToast('⚠️ Ingresá al menos un conteo')
    const conDiferencia = productosConConteo.filter((p) => {
      const fisico = parseInt(tomaConteos[p.id])
      return fisico !== (p.stock ?? 0)
    })
    if (conDiferencia.length === 0) return setToast('✅ Todos los stocks coinciden — no hay ajustes')
    const ok = await confirm({
      title: 'Aplicar toma de inventario',
      message: `Se ajustarán ${conDiferencia.length} producto${conDiferencia.length !== 1 ? 's' : ''}:\n\n${conDiferencia.slice(0, 8).map((p) => {
        const fisico = parseInt(tomaConteos[p.id])
        const diff = fisico - (p.stock ?? 0)
        return `${diff > 0 ? '+' : ''}${diff} ${p.nombre}`
      }).join('\n')}${conDiferencia.length > 8 ? `\n… y ${conDiferencia.length - 8} más` : ''}`,
      okText: 'Aplicar',
    })
    if (!ok) return
    setTomaGuardando(true)
    try {
      const f = new Date().toISOString()
      const usuario = user?.displayName || user?.email || 'sistema'
      const batch = writeBatch(db)
      for (const p of conDiferencia) {
        const fisico = parseInt(tomaConteos[p.id])
        const stockAnterior = p.stock ?? 0
        batch.update(doc(db, 'tblProductos', p.id), { stock: fisico, ultimaActualizacion: f, updatedAt: f })
        batch.set(doc(collection(db, 'tblMovimientos')), {
          productoId: p.id,
          productoCodigo: p.codigo || p.id,
          productoNombre: p.nombre,
          tipoMovimiento: fisico > stockAnterior ? 'ajuste_entrada' : 'ajuste_salida',
          cantidad: Math.abs(fisico - stockAnterior),
          stockAnterior,
          stockNuevo: fisico,
          motivo: 'toma_inventario',
          nota: 'Toma de inventario',
          usuario,
          fecha: f,
          timestamp: Date.now(),
        })
      }
      await batch.commit()
      logActividad({ accion: 'toma_inventario', entidad: 'tblProductos', entidadId: 'lote', detalle: { productos: conDiferencia.length, items: conDiferencia.map((p) => ({ nombre: p.nombre, stockAnterior: p.stock ?? 0, stockNuevo: parseInt(tomaConteos[p.id]) })) } })
      setToast(`✅ Toma aplicada: ${conDiferencia.length} ajuste${conDiferencia.length !== 1 ? 's' : ''}`)
      setTomaAbierto(false)
    } catch (e) {
      setToast('❌ Error: ' + (e as Error).message)
    } finally {
      setTomaGuardando(false)
    }
  }

  function validar(): string | null {
    if (!form.nombre.trim()) return 'El nombre es obligatorio'
    if (!(parseFloat(form.precioVenta) > 0)) return 'El precio de venta es obligatorio'
    if (!form.categoria.trim()) return 'La categoría es obligatoria'
    const nombreDup = productos.some((p) => p.id !== editando?.id && p.nombre?.toLowerCase() === form.nombre.trim().toLowerCase())
    if (nombreDup) return `El nombre "${form.nombre.trim()}" ya existe`
    if (!editando && form.codigo.trim()) {
      const codDup = productos.some((p) => p.codigo?.toLowerCase() === form.codigo.trim().toLowerCase())
      if (codDup) return `El código "${form.codigo.trim()}" ya existe`
    }
    return null
  }

  async function guardar() {
    const err = validar()
    if (err) return setToast('⚠️ ' + err)
    setSaving(true)
    const precioEspecialVal = parseFloat(form.precioEspecial)
    const raw: Record<string, unknown> = {
      nombre: form.nombre.trim(),
      categoria: form.categoria.trim() || 'Productos',
      codigo: form.codigo.trim(),
      precioCompra: parseFloat(form.precioCompra) || 0,
      precioVenta: parseFloat(form.precioVenta) || 0,
      stock: parseInt(form.stock) || 0,
      minStock: parseInt(form.minStock) || 0,
      activo: form.activo,
      imagen: form.imagen,
      tipoAfectacion: form.tipoAfectacion || AFECTACION_POR_DEFECTO,
      unidadBase: form.unidadBase.trim() || 'unidad',
      presentaciones: form.presentaciones
        .filter((p) => p.nombre.trim() && parseFloat(p.factor) > 0)
        .map((p) => ({
          id: p.nombre.trim().toLowerCase().replace(/\s+/g, '_'),
          nombre: p.nombre.trim(),
          factor: parseFloat(p.factor),
          esVenta: p.esVenta,
          esCompra: p.esCompra,
        })),
    }
    if (precioEspecialVal > 0) raw.precioEspecial = precioEspecialVal
    if (form.fechaVencimiento) raw.fechaVencimiento = form.fechaVencimiento
    if (form.isKit) {
      raw.isKit = true
      const validKitItems = form.kitItems
        .filter((ki) => ki.productoId && parseInt(ki.cantidad) > 0)
        .map((ki) => ({ productoId: ki.productoId, cantidad: parseInt(ki.cantidad) }))
      raw.kitItems = validKitItems.length > 0 ? validKitItems : undefined
      if (!raw.kitItems) raw.isKit = undefined
    }
    const data = raw
    const dataUpdate: Record<string, unknown> = { ...raw }
    if (editando) {
      if (!form.fechaVencimiento) dataUpdate.fechaVencimiento = deleteField()
      if (!form.isKit) {
        dataUpdate.isKit = deleteField()
        dataUpdate.kitItems = deleteField()
      }
    }
    try {
      if (editando) {
        await updateDoc(doc(db, 'tblProductos', editando.id), dataUpdate)
        logActividad({ accion: 'editar_producto', entidad: 'tblProductos', entidadId: editando.id, detalle: { nombre: data.nombre, codigo: data.codigo } })
        const oldCompra = editando.precioCompra || 0
        const oldVenta = editando.precioVenta || 0
        const newCompra = data.precioCompra as number
        const newVenta = data.precioVenta as number
        const userName = user?.displayName || user?.email?.split('@')[0] || 'sistema'
        if (oldCompra !== newCompra) registrarCambioPrecio({ productoId: editando.id, productoNombre: data.nombre as string, campo: 'precioCompra', valorAnterior: oldCompra, valorNuevo: newCompra, usuario: userName })
        if (oldVenta !== newVenta) registrarCambioPrecio({ productoId: editando.id, productoNombre: data.nombre as string, campo: 'precioVenta', valorAnterior: oldVenta, valorNuevo: newVenta, usuario: userName })
        setToast('✅ Producto actualizado')
      } else {
        // Código "auto": si el campo quedó vacío, generamos un número de producto
        // y lo guardamos también como `codigo` para que aparezca en el listado.
        const codigo = form.codigo.trim()
        const id = codigo || `P-${Date.now()}`
        await setDoc(doc(db, 'tblProductos', id), { ...data, codigo: codigo || id }, { merge: true })
        logActividad({ accion: 'crear_producto', entidad: 'tblProductos', entidadId: id, detalle: { nombre: data.nombre, codigo: codigo || id } })
        setToast('✅ Producto creado')
      }
      setModal(false)
    } catch (e) {
      setToast('❌ Error: ' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!tienePermiso('inventario')) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <Package className="mx-auto mb-2 h-9 w-9 text-muted-foreground/40" />
        <p className="text-sm font-medium">No tenés acceso al módulo de Inventario</p>
        <p className="text-xs">Pedí el permiso «inventario» al administrador.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10 pr-8" />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {puedeCrear && (
          <Button onClick={abrirNuevo}>
            <Plus className="h-4 w-4" /> Nuevo Producto
          </Button>
        )}
        {tienePermiso('compras') && (
          <Button variant="outline" onClick={() => setCompraAbierta(true)}>
            <ShoppingCart className="h-4 w-4" /> Ingreso / Compra
          </Button>
        )}
        {tienePermiso('editarProducto') && (
          <Button variant="outline" onClick={() => setAjusteAbierto(true)}>
            <RefreshCw className="h-4 w-4" /> Ajustar Stock
          </Button>
        )}
        {tienePermiso('editarProducto') && (
          <Button variant="outline" onClick={abrirToma}>
            <ClipboardCheck className="h-4 w-4" /> Toma de Inventario
          </Button>
        )}
        <Button variant="outline" onClick={exportarExcelInv} disabled={lista.length === 0}>
          <Download className="h-4 w-4" /> Excel
        </Button>
        <Button variant="outline" onClick={() => setReportesAbierto(true)}>
          <BarChart3 className="h-4 w-4" /> Reportes
        </Button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {['Todos', ...categoria].map((c) => (
          <button
            key={c}
            onClick={() => setCatActiva(c)}
            className={cn(
              'shrink-0 rounded-full px-3.5 h-9 text-xs font-bold transition-colors cursor-pointer',
              catActiva === c ? 'bg-primary text-white' : 'bg-background border hover:bg-accent'
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={!verActivos} onChange={(e) => setVerActivos(!e.target.checked)} className="h-4 w-4 accent-primary" />
          Mostrar desactivados
        </label>
        <label className="flex w-fit items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={soloStockBajo} onChange={(e) => setSoloStockBajo(e.target.checked)} className="h-4 w-4 accent-amber-500" />
          <span className="flex items-center gap-1.5 text-amber-600 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            Solo stock bajo
          </span>
        </label>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">{error}</div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          {lista.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
              <span className="text-xs text-muted-foreground">
                Mostrando {Math.min(visibles, lista.length)} de {lista.length}
              </span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">{sortHeader('nombre', 'Producto')}</th>
                  <th className="px-4 py-3 font-semibold">{sortHeader('categoria', 'Categoría')}</th>
                  {puedeVerCostos && <th className="px-4 py-3 font-semibold">Costo</th>}
                  <th className="px-4 py-3 font-semibold">{sortHeader('precioVenta', 'Precio')}</th>
                  <th className="px-4 py-3 font-semibold">{sortHeader('stock', 'Stock')}</th>
                  <th className="px-4 py-3 font-semibold">Vence</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {paginados.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 odd:bg-muted/20 hover:bg-primary/5">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.imagen ? (
                          <img src={p.imagen} alt={p.nombre} className="h-11 w-11 rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <Package className="h-5 w-5" />
                          </div>
                        )}
                        <div className="max-w-[240px]">
                          <div className="line-clamp-2 font-semibold leading-snug">{p.nombre}</div>
                          <div className="text-xs text-muted-foreground">#{p.codigo || p.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.categoria ?? '—'}</td>
                    {puedeVerCostos && <td className="num px-4 py-3 text-muted-foreground">{fmt(p.precioCompra ?? 0)}</td>}
                    <td className="num px-4 py-3 font-bold">
                      {(p.precioEspecial != null && p.precioEspecial > 0) ? (
                        <span className="flex items-center gap-1.5">
                          <span className="text-red-600">{fmt(p.precioEspecial)}</span>
                          <span className="text-[10px] text-muted-foreground line-through">{fmt(p.precioVenta ?? 0)}</span>
                          <span className="rounded bg-red-600/10 px-1 py-0.5 text-[9px] font-bold uppercase text-red-600">Promo</span>
                        </span>
                      ) : (
                        fmt(p.precioVenta ?? 0)
                      )}
                    </td>
                    <td className="num px-4 py-3">
                      <span className={cn('font-semibold', (p.stock ?? 0) <= (p.minStock ?? 0) ? 'text-amber-600' : '')}>{p.stock ?? 0}</span>
                    </td>
                    <td className="px-4 py-3">
                      {p.fechaVencimiento ? (() => {
                        const ev = estadoVencimiento(p.fechaVencimiento)
                        return ev.variant ? (
                          <Badge variant={ev.variant}>{ev.label}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">{new Date(p.fechaVencimiento + 'T00:00:00').toLocaleDateString('es-PE')}</span>
                        )
                      })() : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={(p.stock ?? 0) <= 0 ? 'destructive' : (p.stock ?? 0) <= (p.minStock ?? 0) ? 'warning' : 'success'}>
                        {(p.stock ?? 0) <= 0 ? 'AGOTADO' : (p.stock ?? 0) <= (p.minStock ?? 0) ? 'BAJO' : 'OK'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {puedeEditar && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600" onClick={() => abrirAjuste(p)} title="Ajustar stock">
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                        {puedeEditar && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEditar(p)} aria-label="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {puedeEliminar && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => eliminar(p)} aria-label="Eliminar">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lista.length === 0 && (
              <div className="py-16 text-center text-muted-foreground">
                <Package className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium">Sin productos</p>
              </div>
            )}
          </div>
          {lista.length > 0 && (
            <InfiniteScroll hayMas={hayMas} cargandoMas={false} onCargarMas={cargarMas} className="border-t">
              <div />
            </InfiniteScroll>
          )}
        </div>
      )}

      {/* Modal form */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-card p-6 shadow-xl animate-slide-up">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{editando ? 'Editar Producto' : 'Nuevo Producto'}</h2>
              <button onClick={() => setModal(false)} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Nombre *</Label>
                <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              </div>
              <div>
                <Label>Imagen</Label>
                {form.imagen ? (
                  <div className="relative inline-block">
                    <img src={form.imagen} alt="producto" className="h-24 w-24 rounded-lg object-cover" />
                    <button
                      onClick={() => setForm({ ...form, imagen: '' })}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-background text-destructive shadow cursor-pointer"
                      aria-label="Quitar imagen"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-lg border border-dashed text-center text-xs text-muted-foreground hover:bg-accent">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0]
                        if (!f) return
                        try {
                          const url = await readImageAsDataUrl(f)
                          setForm((prev) => ({ ...prev, imagen: url }))
                        } catch (err) {
                          setToast('❌ ' + (err as Error).message)
                        }
                      }}
                    />
                    <Plus className="mb-1 h-4 w-4" />
                    <span>Imagen</span>
                  </label>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Código</Label>
                  <Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="Auto" />
                </div>
                <div>
                  <Label>Unidad base</Label>
                  <Input value={form.unidadBase} onChange={(e) => setForm({ ...form, unidadBase: e.target.value })} placeholder="unidad" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Precio Compra</Label>
                  <Input type="number" inputMode="decimal" value={form.precioCompra} onChange={(e) => setForm({ ...form, precioCompra: e.target.value })} placeholder="0.00" />
                </div>
                <div>
                  <Label>Precio Venta *</Label>
                  <Input type="number" inputMode="decimal" value={form.precioVenta} onChange={(e) => setForm({ ...form, precioVenta: e.target.value })} placeholder="0.00" />
                </div>
              </div>
              {editando && (
                <button type="button" onClick={async () => {
                  setHistorialAbierto(true)
                  setHistorialCargando(true)
                  const data = await obtenerHistorialPrecios(editando.id)
                  setHistorialData(data)
                  setHistorialCargando(false)
                }} className="text-xs font-semibold text-primary hover:underline cursor-pointer">
                  📊 Ver historial de precios
                </button>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <Label>Precio Especial (promo)</Label>
                  {form.precioEspecial && parseFloat(form.precioEspecial) > 0 && (
                    <span className="rounded bg-red-600/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-600">Activo en el PDV</span>
                  )}
                </div>
                <Input type="number" inputMode="decimal" value={form.precioEspecial} onChange={(e) => setForm({ ...form, precioEspecial: e.target.value })} placeholder="Vacío = sin promo" />
                <p className="mt-1 text-[11px] text-muted-foreground">Este precio se usa en el punto de venta para promociones. Si está definido, se cobra este monto sin cambiar el precio de venta real.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Stock</Label>
                  <Input type="number" inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
                </div>
                <div>
                  <Label>Stock mínimo</Label>
                  <Input type="number" inputMode="numeric" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Fecha de vencimiento</Label>
                <Input type="date" value={form.fechaVencimiento} onChange={(e) => setForm({ ...form, fechaVencimiento: e.target.value })} />
                {form.fechaVencimiento && (
                  <p className="mt-1 text-[11px] text-muted-foreground">Opcional. Se muestra alerta cuando está próximo a vencer.</p>
                )}
              </div>
              <div>
                <Label>Categoría *</Label>
                <Input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {categoria.map((c) => (
                    <button
                      key={c}
                      onClick={() => setForm({ ...form, categoria: c })}
                      className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold border cursor-pointer', form.categoria === c ? 'bg-primary text-white border-primary' : 'bg-background hover:bg-accent')}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Tipo de Afectación IGV</Label>
                <select
                  value={form.tipoAfectacion}
                  onChange={(e) => setForm({ ...form, tipoAfectacion: e.target.value })}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  {TIPO_AFECTACION.map((a) => (
                    <option key={a.codigo} value={a.codigo}>{a.codigo} · {a.label}</option>
                  ))}
                </select>
              </div>

              {/* Presentaciones */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <Label>Presentaciones</Label>
                  <Button variant="outline" size="sm" onClick={() => setForm({ ...form, presentaciones: [...form.presentaciones, { nombre: '', factor: '1', esVenta: true, esCompra: true }] })}>
                    <Plus className="h-3.5 w-3.5" /> Agregar
                  </Button>
                </div>
                {form.presentaciones.length === 0 && (
                  <p className="text-xs text-muted-foreground">Sin presentaciones (usa «unidad»).</p>
                )}
                <div className="space-y-2">
                  {form.presentaciones.map((p, i) => (
                    <div key={i} className="rounded-lg border p-2">
                      <div className="flex gap-2">
                        <Input
                          value={p.nombre}
                          onChange={(e) => setForm({ ...form, presentaciones: form.presentaciones.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)) })}
                          placeholder="Nombre (ej: 6 pack)"
                          className="flex-1"
                        />
                        <Input
                          value={p.factor}
                          inputMode="numeric"
                          onChange={(e) => setForm({ ...form, presentaciones: form.presentaciones.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)) })}
                          placeholder="Factor"
                          className="w-20"
                        />
                        <button
                          onClick={() => setForm({ ...form, presentaciones: form.presentaciones.filter((_, j) => j !== i) })}
                          className="text-muted-foreground hover:text-destructive cursor-pointer"
                          aria-label="Quitar presentación"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-1.5 flex gap-4">
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={p.esCompra} onChange={(e) => setForm({ ...form, presentaciones: form.presentaciones.map((x, j) => (j === i ? { ...x, esCompra: e.target.checked } : x)) })} className="h-3.5 w-3.5 accent-primary" />
                          Compra
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={p.esVenta} onChange={(e) => setForm({ ...form, presentaciones: form.presentaciones.map((x, j) => (j === i ? { ...x, esVenta: e.target.checked } : x)) })} className="h-3.5 w-3.5 accent-primary" />
                          Venta
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} className="h-4 w-4 accent-primary" />
                Producto activo
              </label>

              <div className="rounded-xl border p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.isKit} onChange={(e) => setForm({ ...form, isKit: e.target.checked })} className="h-4 w-4 accent-primary" />
                  <span className="font-semibold">Es Kit / Combo</span>
                </label>
                {form.isKit && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] text-muted-foreground">Agregá los productos que componen el kit. El stock del kit se calcula automáticamente desde los componentes.</p>
                    {form.kitItems.map((ki, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select
                          value={ki.productoId}
                          onChange={(e) => {
                            const updated = [...form.kitItems]
                            updated[idx] = { ...updated[idx], productoId: e.target.value }
                            setForm({ ...form, kitItems: updated })
                          }}
                          className="h-9 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
                        >
                          <option value="">Seleccionar…</option>
                          {productos.filter((p) => p.id !== editando?.id && p.activo !== false && !p.isKit).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')).map((p) => (
                            <option key={p.id} value={p.id}>{p.nombre} (stock: {p.stock ?? 0})</option>
                          ))}
                        </select>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          placeholder=" Cant."
                          value={ki.cantidad}
                          onChange={(e) => {
                            const updated = [...form.kitItems]
                            updated[idx] = { ...updated[idx], cantidad: e.target.value }
                            setForm({ ...form, kitItems: updated })
                          }}
                          className="num h-9 w-20"
                        />
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                          setForm({ ...form, kitItems: form.kitItems.filter((_, i) => i !== idx) })
                        }} title="Quitar">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={() => setForm({ ...form, kitItems: [...form.kitItems, { productoId: '', cantidad: '1' }] })}>
                      <Plus className="h-3.5 w-3.5" /> Agregar componente
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={guardar} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {saving ? 'Guardando…' : editando ? 'Guardar' : 'Crear'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className={cn('pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transition-opacity', toast ? 'opacity-100' : 'opacity-0')}>
        <div className="rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-white shadow-lg">{toast}</div>
      </div>

      {reportesAbierto && <ModalReportes productos={productos} puedeVerCostos={puedeVerCostos} onClose={() => setReportesAbierto(false)} />}
      {compraAbierta && <ModalCompra onClose={() => setCompraAbierta(false)} onGuardado={() => { setCompraAbierta(false) }} />}

      {/* Modal Ajustar Stock */}
      {ajusteAbierto && (() => {
        const prod = productos.find((p) => p.id === ajusteProductoId)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-bold">Ajustar Stock</h2>
                <button onClick={() => setAjusteAbierto(false)} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cerrar">✕</button>
              </div>
              <div className="space-y-3">
                <div>
                  <Label>Producto</Label>
                  <select
                    value={ajusteProductoId}
                    onChange={(e) => setAjusteProductoId(e.target.value)}
                    className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Seleccionar producto…</option>
                    {productos.filter((p) => p.activo !== false).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')).map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre} — Stock: {p.stock ?? 0}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label>Tipo de ajuste</Label>
                  <div className="mt-1 flex gap-1.5 rounded-xl bg-muted p-1">
                    <button onClick={() => setAjusteTipo('salida')} className={cn('flex-1 rounded-lg py-2 text-sm font-bold cursor-pointer', ajusteTipo === 'salida' ? 'bg-red-500 text-white' : 'text-muted-foreground')}>
                      ↓ Salida (merma, daño)
                    </button>
                    <button onClick={() => setAjusteTipo('entrada')} className={cn('flex-1 rounded-lg py-2 text-sm font-bold cursor-pointer', ajusteTipo === 'entrada' ? 'bg-emerald-500 text-white' : 'text-muted-foreground')}>
                      ↑ Entrada (corrección)
                    </button>
                  </div>
                </div>

                <div>
                  <Label>Cantidad</Label>
                  <Input type="number" inputMode="numeric" min="1" placeholder="0" value={ajusteCantidad} onChange={(e) => setAjusteCantidad(e.target.value)} className="num mt-1" />
                  {prod && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Stock actual: {prod.stock ?? 0} → Stock nuevo: {ajusteTipo === 'entrada' ? (prod.stock ?? 0) + (parseInt(ajusteCantidad) || 0) : Math.max(0, (prod.stock ?? 0) - (parseInt(ajusteCantidad) || 0))}
                    </p>
                  )}
                </div>

                <div>
                  <Label>Motivo</Label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {['merma', 'daño', 'robo', 'corrección', 'vencimiento', 'otro'].map((m) => (
                      <button key={m} onClick={() => setAjusteMotivo(m)} className={cn('rounded-full px-3 py-1.5 text-xs font-bold border cursor-pointer', ajusteMotivo === m ? 'bg-primary text-white border-primary' : 'bg-background hover:bg-accent')}>
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label>Nota (opcional)</Label>
                  <Input placeholder="Detalle adicional…" value={ajusteNota} onChange={(e) => setAjusteNota(e.target.value)} className="mt-1" />
                </div>
              </div>
              <div className="mt-5 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setAjusteAbierto(false)}>Cancelar</Button>
                <Button className="flex-1" onClick={guardarAjuste} disabled={ajusteGuardando || !ajusteProductoId || !ajusteCantidad}>
                  {ajusteGuardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {ajusteGuardando ? 'Guardando…' : 'Aplicar Ajuste'}
                </Button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal Toma de Inventario */}
      {tomaAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="font-bold">Toma de Inventario</h2>
                <p className="text-xs text-muted-foreground">Ingresá la cantidad física de cada producto</p>
              </div>
              <button onClick={() => setTomaAbierto(false)} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cerrar">✕</button>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar producto…" value={tomaBusqueda} onChange={(e) => setTomaBusqueda(e.target.value)} className="pl-9" />
              </div>
              <div className="flex gap-1.5 overflow-x-auto">
                {tomaCategorias.map((c) => (
                  <button key={c} onClick={() => setTomaCategoria(c)} className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs font-bold border cursor-pointer', tomaCategoria === c ? 'bg-primary text-white border-primary' : 'bg-background hover:bg-accent')}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-2">
              {tomaLista.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Sin productos</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2.5 font-semibold">Producto</th>
                      <th className="py-2.5 font-semibold text-center">Stock Sistema</th>
                      <th className="py-2.5 font-semibold text-center">Conteo Físico</th>
                      <th className="py-2.5 font-semibold text-center">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tomaLista.map((p) => {
                      const raw = tomaConteos[p.id] ?? ''
                      const fisico = raw !== '' ? parseInt(raw) : NaN
                      const stock = p.stock ?? 0
                      const diff = !isNaN(fisico) ? fisico - stock : null
                      return (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="py-2 pr-3">
                            <div className="truncate font-medium">{p.nombre}</div>
                            {p.codigo && <div className="text-[11px] text-muted-foreground">{p.codigo}</div>}
                          </td>
                          <td className="py-2 text-center num font-semibold">{stock}</td>
                          <td className="py-2 text-center">
                            <Input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              placeholder="—"
                              value={raw}
                              onChange={(e) => setTomaConteos((c) => ({ ...c, [p.id]: e.target.value }))}
                              className="num mx-auto h-8 w-20 text-center text-xs"
                            />
                          </td>
                          <td className="py-2 text-center">
                            {diff !== null ? (
                              <span className={cn('num inline-block rounded-full px-2 py-0.5 text-xs font-bold', diff === 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : diff > 0 ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400')}>
                                {diff > 0 ? '+' : ''}{diff}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3">
              <div className="flex gap-3 text-xs">
                <span className="text-muted-foreground">Contados: <strong className="num">{tomaStats.contados}</strong></span>
                {tomaStats.ok > 0 && <span className="text-emerald-600">OK: <strong className="num">{tomaStats.ok}</strong></span>}
                {tomaStats.sobrantes > 0 && <span className="text-blue-600">Sobrantes: <strong className="num">{tomaStats.sobrantes}</strong></span>}
                {tomaStats.faltantes > 0 && <span className="text-red-600">Faltantes: <strong className="num">{tomaStats.faltantes}</strong></span>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setTomaAbierto(false)}>Cancelar</Button>
                <Button variant="outline" onClick={imprimirPlantilla} disabled={tomaLista.length === 0}>
                  <FileText className="h-4 w-4" /> Plantilla
                </Button>
                <Button variant="outline" onClick={imprimirToma} disabled={tomaStats.contados === 0}>
                  <Printer className="h-4 w-4" /> Imprimir
                </Button>
                <Button onClick={aplicarToma} disabled={tomaGuardando || tomaStats.contados === 0}>
                  {tomaGuardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                  {tomaGuardando ? 'Aplicando…' : 'Aplicar Ajustes'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {historialAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-card shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-lg font-bold">Historial de Precios</h2>
              <button onClick={() => setHistorialAbierto(false)} className="rounded-full p-1 hover:bg-muted cursor-pointer"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto p-5">
              {historialCargando ? (
                <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : historialData.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Sin cambios de precio registrados.</p>
              ) : (
                <div className="divide-y">
                  {historialData.map((h) => (
                    <div key={h.id} className="flex items-center gap-3 py-3">
                      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold', h.campo === 'precioCompra' ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400')}>
                        {h.campo === 'precioCompra' ? 'C' : 'V'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{h.campo === 'precioCompra' ? 'Precio Compra' : 'Precio Venta'}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmt(h.valorAnterior)} → {fmt(h.valorNuevo)} · {h.usuario}
                        </div>
                      </div>
                      <div className="text-right text-[11px] text-muted-foreground">
                        {new Date(h.fecha).toLocaleDateString('es-PE')}<br />
                        {new Date(h.fecha).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
