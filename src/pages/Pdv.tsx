import {
  Check,
  ChevronDown,
  FileText,
  Landmark,
  Loader2,
  Minus,
  Pause,
  Plus,
  Printer,
  ScanBarcode,
  Search,
  ShoppingCart,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { doc, getDoc } from 'firebase/firestore'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { useNotifications } from '@/components/notifications'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { useProductos, type Producto } from '@/hooks/use-productos'
import { consultarDni, consultarRuc } from '@/lib/consultaSunat'
import { buscarClientes, type Cliente } from '@/services/clientes'
import { db } from '@/lib/firebase'
import { buscarTurnoAbierto } from '@/services/turnos'
import { registrarVenta } from '@/services/ventas'
import { abrirPDFComprobante } from '@/lib/pdf'
import { cn } from '@/lib/utils'
import { fmt, useToast, estadoVencimiento } from '@/lib/ui-utils'
import { listarVentasPausadas, guardarVentaPausada, eliminarVentaPausada, type VentaPausada } from '@/lib/ventas-pausadas'
import { EscanearCodigo } from '@/components/EscanearCodigo'

// Un producto tiene precio especial (promo) si su valor es > 0.
const tienePromo = (p: Producto) => p?.precioEspecial != null && p.precioEspecial > 0

export function Pdv() {
  const { user } = useAuth()
  const { nombre: nombreUsuario, tienePermiso, serieBoleta, serieFactura, seriePrefijo } = usePermisos()
  const { confirm } = useNotifications()
  const { productos, loading, error } = useProductos()
  const { config: cfg } = useConfiguracion()
  const [q, setQ] = React.useState('')
  const [categoria, setCategoria] = React.useState('Todos')
  const [tipoComp, setTipoComp] = React.useState<'nv' | 'boleta' | 'factura'>('boleta')
  const [metodo, setMetodo] = React.useState<'efectivo' | 'transferencia' | 'credito' | 'mixto'>('efectivo')
  const [pagoMixtoEfectivo, setPagoMixtoEfectivo] = React.useState('')
  const [pagoMixtoTransf, setPagoMixtoTransf] = React.useState('')
  const [recibido, setRecibido] = React.useState('')
  const [referencia, setReferencia] = React.useState('')
  const [clienteDni, setClienteDni] = React.useState('')
  const [clienteNombre, setClienteNombre] = React.useState('')
  const [clienteDireccion, setClienteDireccion] = React.useState('')
  const [clienteAbierto, setClienteAbierto] = React.useState(false)
  const [dniConsultado, setDniConsultado] = React.useState(false)
  const [manualCliente, setManualCliente] = React.useState(false)
  const [busquedaCliente, setBusquedaCliente] = React.useState('')
  const [resultadosCliente, setResultadosCliente] = React.useState<Cliente[]>([])
  const [buscandoCliente, setBuscandoCliente] = React.useState(false)
  const [consultando, setConsultando] = React.useState(false)
  const [cart, setCart] = React.useState<Record<string, number>>({})
  const [usarPromo, setUsarPromo] = React.useState<Record<string, boolean>>({})
  const [presentacionesSel, setPresentacionesSel] = React.useState<Record<string, string>>({})
  const [cobrando, setCobrando] = React.useState(false)
  const { toast, setToast } = useToast()
  const [ventaOk, setVentaOk] = React.useState<{ correlativo: string; total: number; vuelto: number; documento: Record<string, unknown> } | null>(null)
  const [imprimiendo, setImprimiendo] = React.useState(false)
  const [manualOpen, setManualOpen] = React.useState(false)
  const [manualNombre, setManualNombre] = React.useState('')
  const [manualPrecio, setManualPrecio] = React.useState('')
  const [manualCantidad, setManualCantidad] = React.useState('1')
  const [manualItems, setManualItems] = React.useState<Record<string, { nombre: string; precio: number; qty: number }>>({})
  const [pausadasAbierto, setPausadasAbierto] = React.useState(false)
  const [pausadasLista, setPausadasLista] = React.useState<VentaPausada[]>([])
  const [scannerOpen, setScannerOpen] = React.useState(false)

  const handleBarcodeDetectado = React.useCallback((codigo: string) => {
    const codigoLimpio = codigo.replace(/[\s\-]/g, '').trim()
    console.log('[Pdv] Barcode detectado:', codigo, '| Limpio:', codigoLimpio)

    const producto = productos.find((p) => {
      const cod = (p.codigo || '').replace(/[\s\-]/g, '').trim()
      return cod === codigoLimpio || cod === codigo || p.id === codigoLimpio || p.id === codigo
    })

    if (!producto) {
      console.warn('[Pdv] Producto no encontrado. Código escaneado:', codigoLimpio)
      console.log('[Pdv] Códigos en BD:', productos.slice(0, 10).map((p) => p.codigo))
      setToast(`⚠️ Código "${codigo}" no encontrado`)
      return
    }
    if (producto.activo === false) {
      setToast('⚠️ Producto inactivo')
      return
    }
    if ((producto.stock ?? 0) <= 0) {
      setToast('⚠️ Sin stock')
      return
    }
    setCart((prev) => ({ ...prev, [producto.id]: (prev[producto.id] || 0) + 1 }))
    setToast(`✅ ${producto.nombre} agregado`)
  }, [productos, setToast])

  const categorias = React.useMemo(() => {
    const set = new Set<string>(['Todos'])
    productos.forEach((p) => p.categoria && set.add(p.categoria))
    return Array.from(set)
  }, [productos])

  const lista = React.useMemo(() => {
    const t = q.trim().toLowerCase()
    return productos.filter(
      (p) =>
        (categoria === 'Todos' || p.categoria === categoria) &&
        (!t || p.nombre?.toLowerCase().includes(t) || p.codigo?.includes(t) || p.aliasVoz?.toLowerCase().includes(t))
    )
  }, [productos, q, categoria])

  // Precio aplicado a una línea del carrito: si el producto tiene promo y no fue
  // desactivada manualmente (usarPromo=false), se usa el especial; si no, el normal.
  const precioFinal = (p: Producto) => (((usarPromo[p.id] ?? true) && tienePromo(p)) ? p.precioEspecial ?? 0 : (p.precioVenta ?? 0))

  const total = React.useMemo(() => {
    const invTotal = Object.entries(cart).reduce((s, [id, c]) => {
      const p = productos.find((x) => x.id === id)
      if (!p) return s
      const presId = presentacionesSel[id]
      const pres = presId ? p.presentaciones?.find((pr) => pr.id === presId) : null
      const factor = pres?.factor ?? 1
      return s + precioFinal(p) * factor * c
    }, 0)
    const manTotal = Object.values(manualItems).reduce((s, it) => s + it.precio * it.qty, 0)
    return invTotal + manTotal
  }, [cart, productos, usarPromo, manualItems, presentacionesSel])

  // Stock efectivo: para kits se calcula desde los componentes
  const kitStock = React.useCallback((p: Producto) => {
    if (!p.isKit || !p.kitItems?.length) return p.stock ?? 0
    let minKits = Infinity
    for (const ki of p.kitItems) {
      const comp = productos.find((x) => x.id === ki.productoId)
      if (!comp) return 0
      const compStock = comp.stock ?? 0
      const disponibles = Math.floor(compStock / ki.cantidad)
      if (disponibles < minKits) minKits = disponibles
    }
    return minKits === Infinity ? 0 : minKits
  }, [productos])

  // Stock ajustado por presentación seleccionada
  const stockEnPresentacion = React.useCallback((p: Producto) => {
    const base = kitStock(p)
    const presId = presentacionesSel[p.id]
    const pres = presId ? p.presentaciones?.find((pr) => pr.id === presId) : null
    const factor = pres?.factor ?? 1
    return Math.floor(base / factor)
  }, [kitStock, presentacionesSel])

  function add(id: string) {
    const p = productos.find((x) => x.id === id)
    if (!p) return
    const actual = cart[id] ?? 0
    const stock = stockEnPresentacion(p)
    if (actual >= stock) {
      setToast('⚠️ Sin stock disponible')
      return
    }
    setCart((c) => ({ ...c, [id]: actual + 1 }))
    // Si tiene presentaciones de venta, seleccionar la primera por defecto
    if (!presentacionesSel[id] && p.presentaciones?.length) {
      const ventaPres = p.presentaciones.filter((pr) => pr.esVenta)
      if (ventaPres.length > 0 && ventaPres[0].id) setPresentacionesSel((c) => ({ ...c, [id]: ventaPres[0].id! }))
    }
    if (tienePromo(p)) setUsarPromo((c) => ({ ...c, [id]: c[id] ?? true }))
  }
  // El cajero elige entre precio normal y especial en la línea del carrito.
  function togglePromo(id: string) {
    setUsarPromo((c) => ({ ...c, [id]: !c[id] }))
  }
  function dec(id: string) {
    setCart((c) => {
      const actual = c[id] ?? 0
      if (actual <= 1) {
        const { [id]: _, ...rest } = c
        return rest
      }
      return { ...c, [id]: actual - 1 }
    })
  }
  function del(id: string) {
    setCart((c) => {
      const { [id]: _, ...rest } = c
      return rest
    })
  }

  function agregarManual() {
    const nombre = manualNombre.trim()
    const precio = parseFloat(manualPrecio)
    const qty = parseInt(manualCantidad, 10) || 1
    if (!nombre) return setToast('⚠️ Ingresá el nombre del producto')
    if (!precio || precio <= 0) return setToast('⚠️ Ingresá un precio válido')
    if (qty <= 0) return setToast('⚠️ La cantidad debe ser mayor a 0')
    const id = `manual-${Date.now()}`
    setManualItems((c) => ({ ...c, [id]: { nombre, precio, qty } }))
    setManualOpen(false)
    setManualNombre('')
    setManualPrecio('')
    setManualCantidad('1')
  }

  function delManual(id: string) {
    setManualItems((c) => {
      const { [id]: _, ...rest } = c
      return rest
    })
  }

  function pausarVenta() {
    if (Object.keys(cart).length === 0 && Object.keys(manualItems).length === 0) {
      return setToast('⚠️ No hay nada en el carrito para pausar')
    }
    guardarVentaPausada({
      cart,
      manualItems,
      usarPromo,
      tipoComp,
      metodo,
      clienteDni,
      clienteNombre,
      clienteDireccion,
      cajero: nombreUsuario || user?.email || 'sistema',
      total,
    })
    setCart({})
    setManualItems({})
    setUsarPromo({})
    setTipoComp('boleta')
    setMetodo('efectivo')
    setClienteDni('')
    setClienteNombre('')
    setClienteDireccion('')
    setDniConsultado(false)
    setRecibido('')
    setReferencia('')
    setToast('⏸️ Venta pausada')
  }

  function abrirPausadas() {
    setPausadasLista(listarVentasPausadas())
    setPausadasAbierto(true)
  }

  function recuperarVenta(v: VentaPausada) {
    if (Object.keys(cart).length > 0 || Object.keys(manualItems).length > 0) {
      return setToast('⚠️ Vacíá el carrito antes de recuperar una venta pausada')
    }
    setCart(v.cart)
    setManualItems(v.manualItems)
    setUsarPromo(v.usarPromo)
    setTipoComp(v.tipoComp)
    setMetodo(v.metodo)
    setClienteDni(v.clienteDni)
    setClienteNombre(v.clienteNombre)
    setClienteDireccion(v.clienteDireccion)
    setDniConsultado(!!v.clienteDni)
    eliminarVentaPausada(v.id)
    setPausadasAbierto(false)
    setToast('✅ Venta recuperada')
  }

  function eliminarPausada(id: string) {
    eliminarVentaPausada(id)
    setPausadasLista(listarVentasPausadas())
  }

  const items = Object.keys(cart).map((id) => ({ id, p: productos.find((x) => x.id === id), qty: cart[id] })).filter((it): it is { id: string; p: Producto; qty: number } => it.p != null)
  const allItems = [
    ...items.map(({ id, p, qty }) => ({ id, nombre: p.nombre ?? '', precio: precioFinal(p), qty, manual: false })),
    ...Object.entries(manualItems).map(([id, it]) => ({ id, nombre: it.nombre, precio: it.precio, qty: it.qty, manual: true })),
  ]

  // Busca clientes existentes por nombre / DNI / RUC (solo para autocompletar).
  React.useEffect(() => {
    const q = busquedaCliente.trim()
    if (q.length < 2) {
      setResultadosCliente([])
      return
    }
    setBuscandoCliente(true)
    const t = setTimeout(async () => {
      try {
        setResultadosCliente(await buscarClientes(q))
      } catch (e) {
        console.error('❌ Error buscando clientes:', e)
        setResultadosCliente([])
      } finally {
        setBuscandoCliente(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [busquedaCliente])

  async function consultarCliente() {
    const docN = clienteDni.trim()
    if (!/^\d{8}$/.test(docN) && !/^\d{11}$/.test(docN)) {
      setToast('⚠️ Ingresa un DNI (8) o RUC (11)')
      return
    }
    setConsultando(true)
    try {
      // 1) Busca primero en la colección (si ya fue creado).
      const snap = await getDoc(doc(db, 'tblClientes', docN))
      if (snap.exists()) {
        const d = snap.data()
        setClienteNombre(d.razonSocial || d.nombre || '')
        setClienteDireccion(d.direccion || '')
        setDniConsultado(true)
        setManualCliente(false)
        return
      }
      // 2) Si no existe, consulta la API de SUNAT (DNI/RUC).
      const data = docN.length === 8 ? await consultarDni(docN) : await consultarRuc(docN)
      if (data) {
        const nombre =
          docN.length === 8
            ? `${data.nombres || ''} ${data.apellidoPaterno || ''} ${data.apellidoMaterno || ''}`.trim()
            : data.nombre || data.razonSocial || ''
        if (nombre) {
          setClienteNombre(nombre)
          setClienteDireccion(data.direccion || data.direccion_completa || '')
          setDniConsultado(true)
          setManualCliente(false)
          return
        }
      }
      // 3) No encontrado en colección ni API → modo manual.
      setManualCliente(true)
      setDniConsultado(false)
      setClienteNombre('')
      setToast('⚠️ No se encontró el documento. Podés ingresarlo manualmente.')
    } catch {
      // Sin conexión / API caída → modo manual.
      setDniConsultado(false)
      setManualCliente(true)
      setToast('⚠️ Sin conexión a SUNAT. Podés ingresar el cliente manualmente.')
    } finally {
      setConsultando(false)
    }
  }

  async function cobrar() {
    const tope = Number(cfg.topeBoletaDni) > 0 ? Number(cfg.topeBoletaDni) : 700
    const dni = clienteDni.trim()

    // Toda venta (incluida la not a de venta) necesita al menos un producto.
    if (Object.keys(cart).length === 0 && Object.keys(manualItems).length === 0) return setToast('⚠️ Agregá al menos un producto para vender')

    if (tipoComp === 'factura') {
      if (!/^\d{11}$/.test(dni)) return setToast('⚠️ Para FACTURA ingresa el RUC del cliente (11 dígitos)')
      if (!dniConsultado) return setToast('⚠️ Presiona Consultar para validar el RUC')
      if (!clienteNombre.trim()) return setToast('⚠️ Ingresa la razón social del cliente (FACTURA)')
    }
    if (tipoComp === 'boleta' && total > tope) {
      if (!/^\d{8}$/.test(dni)) return setToast(`⚠️ Boletas mayores a S/ ${tope.toFixed(2)} requieren DNI (8 dígitos)`)
      if (!dniConsultado) return setToast('⚠️ Presiona Consultar para validar el DNI')
    }
    if (dni && !dniConsultado) return setToast('⚠️ Presiona Consultar para validar el DNI/RUC')

    if (metodo === 'efectivo') {
      const m = parseFloat(recibido)
      if (!recibido || isNaN(m)) return setToast('⚠️ Ingresa un monto recibido')
      if (m < total) return setToast('⚠️ El monto recibido es menor al total')
    } else if (metodo === 'transferencia') {
      if (!referencia.trim()) return setToast('⚠️ Ingresa la referencia de la transferencia')
    } else if (metodo === 'credito') {
      if (!/^\d{8}$/.test(dni) && !/^\d{11}$/.test(dni)) return setToast('⚠️ El crédito requiere DNI o RUC válido')
      if (!dniConsultado) return setToast('⚠️ Presiona Consultar para validar el DNI/RUC')
      const snap = await getDoc(doc(db, 'tblClientes', dni))
      const d = snap.exists() ? snap.data() : null
      if (!d?.creditoActivo) return setToast('⚠️ El cliente no tiene crédito activo')
    } else if (metodo === 'mixto') {
      const tr = parseFloat(pagoMixtoTransf) || 0
      const ef = parseFloat(pagoMixtoEfectivo) || 0
      if (tr <= 0) return setToast('⚠️ Ingresa el monto por transferencia')
      if (ef < 0) return setToast('⚠️ El efectivo no puede ser negativo')
      if (ef + tr < total) return setToast(`⚠️ Transferencia + efectivo (S/ ${(ef + tr).toFixed(2)}) no alcanza el total (S/ ${total.toFixed(2)})`)
    }

    // El cierre del turno invalida la venta: solo se puede cobrar con turno abierto.
    const turno = await buscarTurnoAbierto(user?.uid, tienePermiso('verTodo'))
    if (!turno) return setToast('🚫 No hay un turno abierto. Abrí un turno antes de vender.')

    const methodLabel = metodo === 'efectivo' ? '💵 Efectivo' : metodo === 'transferencia' ? '📲 Transferencia' : metodo === 'credito' ? '💳 Crédito' : '🪙 Mixto'
    const itemsCount = Object.keys(cart).reduce((s, id) => s + cart[id], 0)
    const ok = await confirm({
      title: '¿Confirmar la venta?',
      message:
        `Total: ${fmt(total)}\n` +
        `Productos: ${itemsCount}\n` +
        `Método de pago: ${methodLabel}\n` +
        `Comprobante: ${tipoComp === 'nv' ? 'Nota de Venta' : tipoComp === 'boleta' ? 'Boleta' : 'Factura'}`,
      okText: 'Cobrar',
    })
    if (!ok) return

    setCobrando(true)
    try {
      const invItems = Object.entries(cart).map(([id, qty]) => {
        const p = productos.find((x) => x.id === id)
        if (!p) return null
        // Determinar presentación seleccionada
        const presId = presentacionesSel[id]
        const pres = presId ? p.presentaciones?.find((pr) => pr.id === presId) : null
        const factor = pres?.factor ?? 1
        const presNombre = pres?.nombre ?? 'Unidad'
        const base = { id, nombre: p.nombre || '', quantity: qty * factor, presentacionNombre: presNombre, presentacionId: pres?.id ?? 'unidad', factorConversion: factor, usarPrecioEspecial: (usarPromo[id] ?? true) && tienePromo(p) }
        if (p.isKit && p.kitItems?.length) return { ...base, kitItems: p.kitItems }
        return base
      }).filter(Boolean) as { id: string; nombre: string; quantity: number; presentacionNombre: string; presentacionId: string; factorConversion: number; usarPrecioEspecial: boolean; kitItems?: { productoId: string; cantidad: number }[] }[]
      const manItems = Object.entries(manualItems).map(([id, it]) => ({
        id,
        nombre: it.nombre,
        quantity: it.qty,
        precioVenta: it.precio,
        presentacionNombre: 'Unidad',
        presentacionId: 'unidad',
        factorConversion: 1,
        usarPrecioEspecial: false,
        manual: true,
      }))
      const items = [...invItems, ...manItems]
      const res = await registrarVenta({
        items,
        venta: {
          tipoDoc: tipoComp === 'nv' ? 'NV' : tipoComp === 'boleta' ? 'BOLETA' : 'FACTURA',
          tipoPago: metodo,
          pagos: metodo === 'mixto'
            ? (() => {
                const tr = parseFloat(pagoMixtoTransf) || 0
                // Si la transferencia supera el total, la venta se cubre por transferencia
                // y el excedente se devuelve en efectivo. Si no, se reparte entre efectivo y transferencia.
                const trAplicada = Math.min(tr, total)
                const efAplicado = Math.max(0, total - tr)
                return [
                  { tipo: 'efectivo' as const, monto: efAplicado },
                  { tipo: 'transferencia' as const, monto: trAplicada },
                ]
              })()
            : undefined,
          total,
          cliente_dni: dni || '',
          cliente_nombre: clienteNombre || '',
          cliente_direccion: clienteDireccion || '',
          referencia,
          montoRecibido: metodo === 'mixto' ? (parseFloat(pagoMixtoEfectivo) || 0) : (parseFloat(recibido) || 0),
          cambio: metodo === 'mixto'
            ? Math.max(0, (parseFloat(pagoMixtoEfectivo) || 0) + (parseFloat(pagoMixtoTransf) || 0) - total)
            : Math.max(0, (parseFloat(recibido) || 0) - total),
          vueltoTransferencia: metodo === 'mixto' ? Math.max(0, (parseFloat(pagoMixtoTransf) || 0) - total) : 0,
          cajero: nombreUsuario || user?.email || 'sistema',
          usuarioId: user?.uid || '',
          turnoId: turno?.id || null,
        },
        // Series por caja del usuario: si el usuario tiene series propias, sobreescriben la global.
        config: {
          ...cfg,
          serieBoleta: serieBoleta || cfg.serieBoleta,
          serieFactura: serieFactura || cfg.serieFactura,
          serie_prefijo: seriePrefijo || cfg.serie_prefijo,
        },
      })
      if (res.success) {
        setToast(`✅ Venta ${res.correlativo ?? ''} registrada`)
        setVentaOk({ correlativo: res.correlativo ?? '', total, vuelto, documento: res.documento })
        setCart({})
        setRecibido('')
        setReferencia('')
        setClienteDni('')
        setClienteNombre('')
        setDniConsultado(false)
        setManualItems({})
      } else {
        setToast('❌ ' + (res.error || 'Error al registrar la venta'))
      }
    } catch (e) {
      setToast('❌ ' + (e as Error).message)
    } finally {
      setCobrando(false)
    }
  }

  async function imprimirComprobante() {
    if (!ventaOk?.documento) return
    setImprimiendo(true)
    try {
      await abrirPDFComprobante(ventaOk.documento, cfg)
    } catch (e) {
      setToast('❌ ' + (e as Error).message)
    } finally {
      setImprimiendo(false)
    }
  }

  const recibidoNum = parseFloat(recibido) || 0
  const vuelto = metodo === 'mixto'
    ? Math.max(0, (parseFloat(pagoMixtoEfectivo) || 0) + (parseFloat(pagoMixtoTransf) || 0) - total)
    : Math.max(0, recibidoNum - total)

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_440px] items-start">
      {/* ===== Catálogo ===== */}
      <section className="min-w-0">
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar producto o código…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10 pr-9" />
            {q && (
              <button
                onClick={() => setQ('')}
                type="button"
                aria-label="Limpiar búsqueda"
                title="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button variant="outline" size="icon" aria-label="Escanear código" onClick={() => setScannerOpen(true)}>
            <ScanBarcode className="h-5 w-5" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setManualOpen(true)} className="shrink-0 gap-1.5">
            <Plus className="h-4 w-4" />
            Agregar producto
          </Button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
          {categorias.map((c) => (
            <button
              key={c}
              onClick={() => setCategoria(c)}
              className={cn(
                'shrink-0 rounded-full px-3.5 h-9 text-xs font-bold transition-colors cursor-pointer',
                categoria === c ? 'bg-primary text-white' : 'bg-background border hover:bg-accent'
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="col-span-full flex h-64 items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando productos…</span>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
            {error}
          </div>
        ) : lista.length === 0 ? (
          <div className="col-span-full py-16 text-center text-muted-foreground">
            <Search className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">Sin resultados</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-3 gap-3">
            {lista.map((p) => {
              const enCaja = cart[p.id] ?? 0
              const stock = stockEnPresentacion(p)
              const agotado = stock === 0
              const presId = presentacionesSel[p.id]
              const pres = presId ? p.presentaciones?.find((pr) => pr.id === presId) : null
              const presNombre = pres?.nombre
              const est = (() => {
                if (stock === 0) return { label: 'AGOTADO', variant: 'destructive' as const }
                const min = p.minStock ?? 0
                if (min > 0 && stock <= min) return { label: 'BAJO', variant: 'warning' as const }
                return { label: 'OK', variant: 'success' as const }
              })()
              const promo = p.precioEspecial != null && p.precioEspecial > 0
              return (
                <button
                  key={p.id}
                  onClick={() => add(p.id)}
                  disabled={agotado}
                  className={cn(
                    'card rounded-xl border bg-card p-2 text-left shadow-soft transition hover:border-primary/40 hover:shadow-card',
                    agotado && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <div className="relative mb-2">
                    {p.imagen ? (
                      <img src={p.imagen} alt={p.nombre} className="h-28 w-full rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-28 w-full items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <ShoppingCart className="h-8 w-8" />
                      </div>
                    )}
                    <Badge variant={est.variant} className="absolute right-1.5 top-1.5">
                      {est.label}
                    </Badge>
                    {p.fechaVencimiento && (() => {
                      const ev = estadoVencimiento(p.fechaVencimiento)
                      return ev.variant ? (
                        <Badge variant={ev.variant} className="absolute left-1.5 top-1.5">
                          {ev.label}
                        </Badge>
                      ) : null
                    })()}
                  </div>
                  <div className="px-1 pb-1">
                    <div className="line-clamp-2 text-sm font-semibold leading-tight">{p.nombre}</div>
                    <div className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{p.categoria}{p.isKit && ' · Kit'}</span>
                      <span className="num font-semibold">Stock: {stock}{presNombre ? ` ${presNombre}` : ''}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      {promo ? (
                        <div className="flex items-center gap-1.5">
                          <span className="num text-base font-extrabold text-destructive">{fmt(p.precioEspecial ?? p.precioVenta ?? 0)}</span>
                          <span className="num text-[11px] text-muted-foreground line-through">{fmt(p.precioVenta ?? 0)}</span>
                        </div>
                      ) : (
                        <span className="num text-base font-extrabold">{fmt(p.precioVenta ?? 0)}</span>
                      )}
                      {enCaja > 0 && <span className="num rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold">{enCaja}</span>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* ===== Caja ===== */}
      <aside className="lg:self-start">
        <div className="rounded-2xl border bg-card shadow-card lg:min-h-[560px] flex flex-col">
          <div className="flex items-center gap-2 border-b px-5 py-4">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <span className="text-[15px] font-bold">Nueva Venta</span>
            <Button variant="ghost" size="sm" onClick={abrirPausadas} className="ml-auto gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              <Pause className="h-3.5 w-3.5" />
              Pausadas
            </Button>
            <span className="num text-xs font-semibold text-muted-foreground">
              {allItems.length} item{allItems.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="border-b px-5 py-3 space-y-3">
            {/* Tipo de comprobante */}
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Tipo de comprobante">
              {(['nv', 'boleta', 'factura'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTipoComp(t)}
                  className={cn(
                    'flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-bold border cursor-pointer',
                    tipoComp === t ? 'bg-primary text-white border-primary' : 'bg-background hover:bg-accent'
                  )}
                >
                  {t === 'nv' ? <FileText className="h-3.5 w-3.5" /> : t === 'boleta' ? <ShoppingCart className="h-3.5 w-3.5" /> : <Landmark className="h-3.5 w-3.5" />}
                  {t === 'nv' ? 'Nota Venta' : t === 'boleta' ? 'Boleta' : 'Factura'}
                </button>
              ))}
            </div>

            {/* Cliente (colapsable para dar más espacio al carrito) */}
            <button
              onClick={() => setClienteAbierto((p) => !p)}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <UserRound className="h-3.5 w-3.5" />
                Cliente
                {clienteNombre && <span className="truncate text-primary"> · {clienteNombre}</span>}
              </span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', clienteAbierto && 'rotate-180')} />
            </button>
            {clienteAbierto && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Cliente (DNI / RUC)</label>
              <div className="flex gap-1.5">
                <Input
                  value={clienteDni}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, '')
                    setClienteDni(v)
                    setDniConsultado(false)
                    setClienteNombre('')
                    setClienteDireccion('')
                    setManualCliente(false)
                    // Auto-selecciona Boleta/Factura según el documento, pero NO
                    // toca el tipo si estás en Nota de Venta (NV).
                    if (tipoComp !== 'nv') {
                      if (v.length === 8) setTipoComp('boleta')
                      else if (v.length === 11) setTipoComp('factura')
                    }
                  }}
                  placeholder="DNI (8) o RUC (11)"
                  inputMode="numeric"
                  className="flex-1"
                />
                <Button variant="secondary" size="sm" onClick={consultarCliente} disabled={consultando}>
                  {consultando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Consultar
                </Button>
                {!manualCliente && (
                  <Button variant="outline" size="sm" title="Ingresar cliente manualmente (sin internet)" onClick={() => { setManualCliente(true); setDniConsultado(true) }}>
                    Manual
                  </Button>
                )}
              </div>

              {/* Buscar cliente existente por nombre / razón social */}
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  value={busquedaCliente}
                  onChange={(e) => setBusquedaCliente(e.target.value)}
                  placeholder="Buscar por nombre o razón social…"
                  className="pl-8"
                />
                {busquedaCliente.trim().length >= 2 && resultadosCliente.length > 0 && (
                  <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border bg-card shadow-lg">
                    {buscandoCliente && <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…</div>}
                    {resultadosCliente.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          const doc = c.numeroDoc || ''
                          setClienteDni(doc)
                          setClienteNombre(c.razonSocial || '')
                          setClienteDireccion(c.direccion || '')
                          setDniConsultado(true)
                          setManualCliente(false)
                          setBusquedaCliente('')
                          setResultadosCliente([])
                          if (tipoComp !== 'nv') {
                            if (doc.length === 8) setTipoComp('boleta')
                            else if (doc.length === 11) setTipoComp('factura')
                          }
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40 cursor-pointer"
                      >
                        <span className="min-w-0 truncate font-medium">{c.razonSocial || 'Sin nombre'}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{String(c.tipoDoc || '').toUpperCase()} {c.numeroDoc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {manualCliente ? (
                <>
                  <Input
                    value={clienteNombre}
                    onChange={(e) => {
                      setClienteNombre(e.target.value)
                      if (e.target.value.trim()) setDniConsultado(true)
                      else setDniConsultado(false)
                    }}
                    placeholder="Nombre / Razón Social (manual)"
                    className="mt-1.5"
                  />
                  <p className="mt-1 text-[11px] text-amber-600">Sin conexión / no encontrado — ingresá el nombre manualmente.</p>
                </>
              ) : (
                clienteNombre && (
                  <p className="mt-1.5 text-xs font-medium text-primary">
                    {dniConsultado ? '✅ ' : ''}
                    {clienteNombre}
                  </p>
                )
              )}
              {/* Dirección del cliente (se puede completar manualmente, p. ej. RUC 10) */}
              <Input
                value={clienteDireccion}
                onChange={(e) => setClienteDireccion(e.target.value)}
                placeholder="Dirección del cliente (opcional)"
                className="mt-1.5"
              />
            </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y px-5 py-2">
            {allItems.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                <ShoppingCart className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium">Carrito vacío</p>
                <p className="text-xs">Agregá productos desde el catálogo.</p>
              </div>
            ) : (
              <>
                {items.map(({ p, qty }) => {
                  const presVenta = p.presentaciones?.filter((pr) => pr.esVenta) ?? []
                  const presSel = presentacionesSel[p.id]
                  const presActual = presSel ? presVenta.find((pr) => pr.id === presSel) : null
                  const factorActual = presActual?.factor ?? 1
                  return (
                  <div key={p.id} className="flex items-center gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{p.nombre}</div>
                      <div className="num text-[11px] text-muted-foreground">
                        {fmt(precioFinal(p) * factorActual)} c/u
                        {tienePromo(p) && <span className="ml-1 line-through">{fmt((p.precioVenta ?? 0) * factorActual)}</span>}
                      </div>
                      {presVenta.length > 0 && (
                        <select
                          value={presSel ?? ''}
                          onChange={(e) => setPresentacionesSel((c) => ({ ...c, [p.id]: e.target.value }))}
                          className="mt-1 h-6 rounded border bg-background px-1 text-[10px] font-semibold"
                        >
                          {presVenta.map((pr) => (
                            <option key={pr.id} value={pr.id}>{pr.nombre} ({pr.factor}×)</option>
                          ))}
                        </select>
                      )}
                      {tienePromo(p) && (
                        <button
                          onClick={() => togglePromo(p.id)}
                          className={cn(
                            'mt-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors cursor-pointer',
                            usarPromo[p.id] ? 'bg-red-600 text-white' : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {usarPromo[p.id] ? '⚡ Precio especial' : 'Precio normal'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => dec(p.id)} aria-label="Quitar">
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="num w-9 text-center text-sm font-bold">{qty}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => add(p.id)}
                        disabled={qty >= stockEnPresentacion(p)}
                        aria-label="Agregar"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <span className="num w-16 text-right text-sm font-bold">{fmt(precioFinal(p) * factorActual * qty)}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => del(p.id)} aria-label="Eliminar">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  )
                })}
                {Object.entries(manualItems).map(([id, it]) => (
                  <div key={id} className="flex items-center gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{it.nombre}</div>
                      <div className="num text-[11px] text-muted-foreground">{fmt(it.precio)} c/u</div>
                      <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                        Producto del momento
                      </span>
                    </div>
                    <span className="num w-9 text-center text-sm font-bold">{it.qty}</span>
                    <span className="num w-16 text-right text-sm font-bold">{fmt(it.precio * it.qty)}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => delManual(id)} aria-label="Eliminar">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="space-y-3 border-t px-5 pt-3 pb-5">
            <div className="grid grid-cols-4 gap-1.5">
              {(['efectivo', 'transferencia', 'credito', 'mixto'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMetodo(m); if (m !== 'mixto') { setPagoMixtoTransf(''); setPagoMixtoEfectivo(''); } }}
                  className={cn(
                    'h-10 rounded-lg text-xs font-bold border transition-colors cursor-pointer',
                    metodo === m ? 'bg-primary text-white border-primary' : 'bg-background hover:bg-accent'
                  )}
                >
                  {m === 'efectivo' ? 'Efectivo' : m === 'transferencia' ? 'Tarjeta/Transf.' : m === 'credito' ? 'Crédito' : 'Mixto'}
                </button>
              ))}
            </div>

            {metodo === 'mixto' && (
              (() => {
                const tr = parseFloat(pagoMixtoTransf) || 0
                const ef = parseFloat(pagoMixtoEfectivo) || 0
                const trAplicada = Math.min(tr, total)
                const enEfectivo = Math.max(0, total - tr)
                const vueltoTotal = Math.max(0, ef + tr - total)
                const transfSupera = tr > total
                return (
                  <div className="space-y-2 rounded-xl border border-dashed p-3">
                    <div className="flex items-center gap-2">
                      <label className="w-28 text-xs font-semibold text-muted-foreground">Transfer. S/</label>
                      <Input type="number" inputMode="decimal" placeholder="0.00" value={pagoMixtoTransf} onChange={(e) => {
                        const v = e.target.value
                        setPagoMixtoTransf(v)
                        const num = parseFloat(v) || 0
                        if (num <= 0) {
                          // El efectivo cubre todo → método Efectivo y se limpia el mixto
                          setMetodo('efectivo')
                          setPagoMixtoTransf('')
                          setPagoMixtoEfectivo('')
                        } else {
                          setPagoMixtoEfectivo(String(num >= total ? 0 : Math.max(0, total - num)))
                        }
                      }} className="num" />
                    </div>
                    <p className="text-[11px] text-muted-foreground">Monto que paga el cliente por transferencia (puede ser mayor al total → se devuelve el excedente en efectivo).</p>
                    <div className="flex items-center gap-2">
                      <label className="w-28 text-xs font-semibold text-muted-foreground">Efectivo rec. S/</label>
                      <Input type="number" inputMode="decimal" placeholder="0.00" value={pagoMixtoEfectivo} disabled className={cn('num cursor-not-allowed opacity-50')} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">Se calcula automáticamente (total − transferencia). Si la transferencia es mayor al total, efectivo = 0.</p>

                    {(ef + tr) < total ? (
                      <div className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700 dark:bg-red-500/10">
                        ⚠️ Faltan S/ {fmt(total - ef - tr)} por cubrir. El efectivo + transferencia debe sumar al menos el total (S/ {fmt(total)}).
                      </div>
                    ) : tr > 0 ? (
                      <>
                        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
                          <span className="text-muted-foreground">Cubierto por transferencia</span>
                          <span className="font-bold text-foreground">{fmt(trAplicada)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
                          <span className="text-muted-foreground">Parte en efectivo del total</span>
                          <span className="font-bold text-foreground">{fmt(enEfectivo)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Vuelto en efectivo</span>
                          <span className={vueltoTotal > 0 ? 'font-bold text-emerald-600' : 'font-bold text-muted-foreground'}>{fmt(vueltoTotal)}</span>
                        </div>
                        {transfSupera && (
                          <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/10">
                            La transferencia supera el total: se devuelve S/ {fmt(tr - total)} en efectivo al cliente.
                          </div>
                        )}
                        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/10">✓ Cubre el total (S/ {fmt(total)})</div>
                      </>
                    ) : null}
                  </div>
                )
              })()
            )}

            {metodo === 'efectivo' && (
              <div>
                <div className="flex items-center gap-2">
                  <label className="w-24 text-xs font-semibold text-muted-foreground">Recibido</label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={recibido}
                    onChange={(e) => setRecibido(e.target.value)}
                    className="num"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Vuelto</span>
                  <span className="num font-bold text-primary">{fmt(vuelto)}</span>
                </div>
              </div>
            )}

            {metodo === 'transferencia' && (
              <div className="flex items-center gap-2">
                <label className="w-24 text-xs font-semibold text-muted-foreground">Referencia</label>
                <Input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Yape, Plin, N° operación" className="flex-1" />
              </div>
            )}

            <div className="flex items-end justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="num text-3xl font-extrabold">{fmt(total)}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <Button variant="outline" onClick={() => setCart({})}>
                Vaciar
              </Button>
              <Button variant="secondary" onClick={pausarVenta} disabled={allItems.length === 0}>
                <Pause className="h-4 w-4" />
                Pausar
              </Button>
              <Button onClick={cobrar} disabled={allItems.length === 0 || cobrando}>
                {cobrando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {cobrando ? 'Procesando…' : 'Cobrar'}
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Toast */}
      <div className={cn('pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transition-opacity', toast ? 'opacity-100' : 'opacity-0')}>
        <div className="rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-white shadow-lg">{toast}</div>
      </div>

      {/* Venta completada → imprimir comprobante */}
      {ventaOk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-card shadow-xl">
            <div className="bg-emerald-600 px-5 py-4 text-center text-white">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-white/20"><Check className="h-7 w-7" /></div>
              <p className="text-lg font-bold">Venta registrada</p>
              <p className="num text-sm font-semibold opacity-90">{ventaOk.correlativo}</p>
            </div>
            <div className="space-y-3 p-5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total pagado</span>
                <span className="num font-bold">{fmt(ventaOk.total)}</span>
              </div>
              {ventaOk.vuelto > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Vuelto</span>
                  <span className="num font-bold text-emerald-600">{fmt(ventaOk.vuelto)}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button variant="outline" onClick={() => setVentaOk(null)}>Nueva venta</Button>
                <Button onClick={imprimirComprobante} disabled={imprimiendo} className="bg-emerald-600 hover:bg-emerald-700">
                  {imprimiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                  {imprimiendo ? 'Imprimiendo…' : 'Imprimir'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: agregar producto del momento */}
      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-card shadow-xl">
            <div className="bg-primary px-5 py-4 text-center text-white">
              <p className="text-lg font-bold">Producto del momento</p>
              <p className="text-sm opacity-90">Producto sin registro en inventario</p>
            </div>
            <div className="space-y-3 p-5">
              <Input
                value={manualNombre}
                onChange={(e) => setManualNombre(e.target.value)}
                placeholder="Nombre del producto"
                autoFocus
              />
              <Input
                type="number"
                inputMode="decimal"
                placeholder="Precio (S/)"
                value={manualPrecio}
                onChange={(e) => setManualPrecio(e.target.value)}
                className="num"
              />
              <Input
                type="number"
                inputMode="numeric"
                placeholder="Cantidad"
                value={manualCantidad}
                onChange={(e) => setManualCantidad(e.target.value)}
                className="num"
              />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button variant="outline" onClick={() => { setManualOpen(false); setManualNombre(''); setManualPrecio(''); setManualCantidad('1') }}>
                  Cancelar
                </Button>
                <Button onClick={agregarManual} disabled={!manualNombre.trim() || !manualPrecio || parseFloat(manualPrecio) <= 0}>
                  <Plus className="h-4 w-4" />
                  Agregar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: ventas pausadas */}
      {pausadasAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">Ventas Pausadas</h2>
              <button onClick={() => setPausadasAbierto(false)} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cerrar">✕</button>
            </div>
            {pausadasLista.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Pause className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                <p>No hay ventas pausadas</p>
              </div>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {pausadasLista.map((v) => {
                  const itemCount = Object.values(v.cart).reduce((s, n) => s + n, 0) + Object.values(v.manualItems).reduce((s, it) => s + it.qty, 0)
                  const fecha = new Date(v.fecha)
                  return (
                    <div key={v.id} className="flex items-center gap-3 rounded-xl border p-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{fmt(v.total)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {itemCount} producto{itemCount !== 1 ? 's' : ''} · {v.tipoComp.toUpperCase()} · {v.metodo}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {fecha.toLocaleDateString('es-PE')} {fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                          {v.clienteNombre && <> · {v.clienteNombre}</>}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => recuperarVenta(v)}>
                        Recuperar
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => eliminarPausada(v.id)} title="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <EscanearCodigo
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetectado={handleBarcodeDetectado}
      />
    </div>
  )
}
