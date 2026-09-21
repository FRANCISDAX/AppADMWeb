import {
  Check,
  ChevronDown,
  FileText,
  Landmark,
  Loader2,
  Minus,
  Monitor,
  Pause,
  Plus,
  Printer,
  QrCode,
  ScanBarcode,
  Search,
  ShoppingCart,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { useNotifications } from '@/components/notifications'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { useProductos, type Producto } from '@/hooks/use-productos'
import { useCategorias } from '@/hooks/use-categorias'
import { categoriasParaFiltros } from '@/services/categorias'
import { consultarDni, consultarRuc } from '@/lib/consultaSunat'
import { buscarClientes, obtenerCliente, obtenerEstadoCredito, type Cliente } from '@/services/clientes'
import { evaluarVentaCredito, type EstadoCredito } from '@/lib/credito'
import {
  MEDIOS_ELECTRONICOS,
  etiquetaPago,
  infoMedio,
  normalizarMonto,
  resumenPagos,
  tipoPagoDe,
  topeSugerido,
  type MedioPago,
} from '@/lib/pagos'
import { CreditoPanel } from '@/components/CreditoPanel'
import { buscarTurnoAbierto } from '@/services/turnos'
import { registrarVenta, crearVentaPendiente, cobrarVentaPendiente, obtenerDocumento, obtenerVentasPendientes, type VentaItem } from '@/services/ventas'
import { abrirPDFComprobante } from '@/lib/pdf'
import { cn } from '@/lib/utils'
import { fmt, useToast, estadoVencimiento } from '@/lib/ui-utils'
import { AFECTACION_EXONERADO } from '@/lib/sunat-importes'
import { redondear2 } from '@/lib/dinero'
import { CATEGORIA_MANUAL } from '@/lib/categorias'
import { AFECTACION_POR_DEFECTO, TIPO_AFECTACION } from '@/constants/tributario'
import { listarVentasPausadas, guardarVentaPausada, eliminarVentaPausada, type VentaPausada } from '@/lib/ventas-pausadas'
import { EscanearCodigo } from '@/components/EscanearCodigo'
import { broadcastCart, closeSession } from '@/lib/customer-display'
import { calcularDescuentos, revisarDescuentoManual } from '@/lib/descuentos'
import { clienteDelPedido, pedidoParaCarrito, pedidoPendienteCoincidente, type PedidoEnCarrito } from '@/lib/pedidos'
import { promocionesAplicables, type PromocionVolumen } from '@/services/promociones-volumen'
import QRCode from 'qrcode'
import { PanelVentasPendientes } from '@/components/PanelVentasPendientes'

// Un producto tiene precio especial (promo) si su valor es > 0.
const tienePromo = (p: Producto) => p?.precioEspecial != null && p.precioEspecial > 0

/**
 * Una línea de la lista "Formas de pago". El monto se guarda como texto porque
 * es un input (mismo criterio que el resto del PDV); se convierte con
 * `normalizarMonto` al calcular.
 */
type PagoUI = { id: string; medio: MedioPago; monto: string; operacion: string }

let pagoSecuencia = 0
const nuevoPago = (medio: MedioPago, monto: string): PagoUI => ({
  // Id estable para la key de React (nunca el índice: al borrar una fila el
  // input del medio siguiente se quedaría con el valor de la anterior).
  id: `pago-${++pagoSecuencia}`,
  medio,
  monto,
  operacion: '',
})

export function Pdv() {
  const { user } = useAuth()
  const { nombre: nombreUsuario, tienePermiso, serieBoleta, serieFactura, seriePrefijo, cajaId } = usePermisos()
  const { confirm } = useNotifications()
  const { productos, loading, error } = useProductos()
  const { activas: categoriasAdmin } = useCategorias()
  const { config: cfg } = useConfiguracion()
  const [q, setQ] = React.useState('')
  const [categoria, setCategoria] = React.useState('Todos')
  const [tipoComp, setTipoComp] = React.useState<'nv' | 'boleta' | 'factura'>('boleta')
  const [pagos, setPagos] = React.useState<PagoUI[]>([])
  // El crédito es exclusivo (no se combina): cuando está activo, la venta entera
  // va a la cuenta del cliente y la lista de formas de pago queda de lado.
  const [pagoCredito, setPagoCredito] = React.useState(false)
  // Muestra los medios electrónicos (Yape, Plin, transferencia, tarjeta).
  const [grupoTransf, setGrupoTransf] = React.useState(false)
  const [clienteDni, setClienteDni] = React.useState('')
  const [clienteNombre, setClienteNombre] = React.useState('')
  const [clienteDireccion, setClienteDireccion] = React.useState('')
  const [clienteAbierto, setClienteAbierto] = React.useState(false)
  const [dniConsultado, setDniConsultado] = React.useState(false)
  const [credito, setCredito] = React.useState<{ id: string; estado: EstadoCredito } | null>(null)
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
  const [manualItems, setManualItems] = React.useState<Record<string, { nombre: string; precio: number; qty: number; afectacion?: string }>>({})
  const [pausadasAbierto, setPausadasAbierto] = React.useState(false)
  const [pausadasLista, setPausadasLista] = React.useState<VentaPausada[]>([])
  const [scannerOpen, setScannerOpen] = React.useState(false)
  const [envio, setEnvio] = React.useState({ tipo: 'tienda' as 'tienda' | 'domicilio', direccion: '', referencia: '', zonaId: '', costo: 0, notas: '' })
  const [displaySession, setDisplaySession] = React.useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null)
  const [qrOpen, setQrOpen] = React.useState(false)
  const displayUrlRef = React.useRef<string | null>(null)
  const [descuentoGlobalTipo, setDescuentoGlobalTipo] = React.useState<'porcentaje' | 'monto'>('monto')
  const [descuentoGlobalValor, setDescuentoGlobalValor] = React.useState('')
  const [reglasVolumen, setReglasVolumen] = React.useState<PromocionVolumen[]>([])
  const [listaPrecioSel, setListaPrecioSel] = React.useState('')
  /**
   * **Modo pedido**: el pedido que el cajero trajo desde "Ventas Pendientes" para cobrarlo acá.
   * Mientras está activo, el carrito muestra SUS items (solo lectura) y el cobro de abajo cobra
   * ese pedido con el **total cotizado por el vendedor** (no se recalcula nada). Así el cajero
   * tiene un solo lugar para elegir comprobante y forma de pago, en vez de dos copias.
   */
  const [pedidoActivo, setPedidoActivo] = React.useState<PedidoEnCarrito | null>(null)

  const handleBarcodeDetectado = React.useCallback((codigo: string) => {
    const codigoLimpio = codigo.replace(/[\s-]/g, '').trim()
    console.log('[Pdv] Barcode detectado:', codigo, '| Limpio:', codigoLimpio)

    const producto = productos.find((p) => {
      const cod = (p.codigo || '').replace(/[\s-]/g, '').trim()
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

  // Crédito: se consulta el estado del cliente al elegir el método, para mostrarle
  // al cajero el disponible ANTES de confirmar. El estado se guarda con el id del
  // cliente al que corresponde, así nunca se muestra el de un cliente anterior.
  React.useEffect(() => {
    const id = clienteDni.trim()
    if (!pagoCredito) return
    if (!/^\d{8}$/.test(id) && !/^\d{11}$/.test(id)) return
    let vigente = true
    obtenerEstadoCredito(id)
      .then((estado) => {
        if (vigente) setCredito({ id, estado })
      })
      .catch((e) => console.error('❌ Estado de crédito:', e))
    return () => {
      vigente = false
    }
  }, [pagoCredito, clienteDni])

  const dniCreditoValido = /^\d{8}$/.test(clienteDni.trim()) || /^\d{11}$/.test(clienteDni.trim())
  const estadoCredito = credito?.id === clienteDni.trim() ? credito.estado : null
  const cargandoCredito = pagoCredito && dniCreditoValido && estadoCredito === null

  // Filtros: categorías administradas (activas, en su orden) ∪ las que ya usan
  // los productos, para que ningún producto quede inalcanzable.
  const categorias = React.useMemo(() => {
    const presentes = new Set<string>()
    productos.forEach((p) => p.categoria && presentes.add(p.categoria))
    return ['Todos', ...categoriasParaFiltros(categoriasAdmin, presentes)]
  }, [productos, categoriasAdmin])

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
  // Cargar promociones de volumen al montar
  React.useEffect(() => {
    import('@/services/promociones-volumen').then((mod) => {
      mod.listarPromocionesVolumen().then(setReglasVolumen).catch(() => {})
    }).catch(() => {})
  }, [])

  // Cliente seleccionado para descuento
  const clienteDescuento = React.useMemo(() => {
    if (!clienteDni) return 0
    const c = resultadosCliente.find((cl) => cl.numeroDoc === clienteDni || cl.id === clienteDni)
    return c?.descuentoPorcentaje ?? 0
  }, [clienteDni, resultadosCliente])

  // Lista de precio activa: override manual > lista del cliente > 'general'
  const listaPrecioActiva = React.useMemo(() => {
    if (listaPrecioSel) return listaPrecioSel
    if (!clienteDni) return 'general'
    const c = resultadosCliente.find((cl) => cl.numeroDoc === clienteDni || cl.id === clienteDni)
    return c?.listaPrecio || 'general'
  }, [listaPrecioSel, clienteDni, resultadosCliente])

  // Resetear lista override cuando cambia el cliente
  React.useEffect(() => {
    setListaPrecioSel('')
  }, [clienteDni])

  const precioFinal = (p: Producto) => {
    if ((usarPromo[p.id] ?? true) && tienePromo(p)) return p.precioEspecial ?? 0
    if (listaPrecioActiva !== 'general' && p.preciosPorLista?.[listaPrecioActiva] != null && p.preciosPorLista[listaPrecioActiva] > 0) {
      return p.preciosPorLista[listaPrecioActiva]
    }
    return p.precioVenta ?? 0
  }

  const totalBruto = React.useMemo(() => {
    const invTotal = Object.entries(cart).reduce((s, [id, c]) => {
      const p = productos.find((x) => x.id === id)
      if (!p) return s
      const presId = presentacionesSel[id]
      const pres = presId ? p.presentaciones?.find((pr) => pr.id === presId) : null
      const factor = pres?.factor ?? 1
      return s + precioFinal(p) * factor * c
    }, 0)
    const manTotal = Object.values(manualItems).reduce((s, it) => s + it.precio * it.qty, 0)
    const envioCosto = envio.tipo === 'domicilio' ? envio.costo : 0
    return invTotal + manTotal + envioCosto
  }, [cart, productos, usarPromo, manualItems, presentacionesSel, envio])

  // Calcular descuentos
  const descuentosCalc = React.useMemo(() => {
    const itemsCarrito = Object.entries(cart).map(([id, qty]) => {
      const p = productos.find((x) => x.id === id)
      if (!p) return null
      const presId = presentacionesSel[id]
      const pres = presId ? p.presentaciones?.find((pr) => pr.id === presId) : null
      const factor = pres?.factor ?? 1
      return {
        productoId: id,
        nombre: p.nombre ?? '',
        // ⚠️ El motor de descuentos trabaja en **unidades base**, no en unidades
        // de venta: el precio va por unidad base y la cantidad son las unidades
        // base de la línea. Si se mandara `precio × factor` con `cantidad: qty`,
        // una media docena (1 unidad de venta) nunca alcanzaría el mínimo de 2
        // unidades de las promociones de volumen y no se aplicaría el descuento
        // (media docena a 0.60 c/u en vez de 0.50). El subtotal es el mismo
        // (0.60 × 6 = 3.60), pero ahora la promo sí lo ve.
        precioUnitario: precioFinal(p),
        cantidad: qty * factor,
        tienePromo: (usarPromo[id] ?? true) && tienePromo(p),
        precioEspecial: p.precioEspecial ?? 0,
        descuentoPorcentaje: p.descuentoPorcentaje ?? 0,
      }
    }).filter(Boolean) as { productoId: string; nombre: string; precioUnitario: number; cantidad: number; tienePromo: boolean; precioEspecial: number; descuentoPorcentaje: number }[]
    const itemsManuales = Object.entries(manualItems).map(([id, it]) => ({
      productoId: id,
      nombre: it.nombre,
      precioUnitario: it.precio,
      cantidad: it.qty,
      tienePromo: false,
      precioEspecial: 0,
      descuentoPorcentaje: 0,
    }))
    const todosItems = [...itemsCarrito, ...itemsManuales]

    // Promociones de volumen aplicables
    const idsEnCarrito = todosItems.map((it) => it.productoId)
    const volumenes = promocionesAplicables(reglasVolumen, idsEnCarrito).map((pv) => ({
      promocionId: pv.id ?? '',
      nombre: pv.nombre,
      tipo: pv.tipo as '3x2' | '2da_50' | 'lleva_paga' | 'porcentaje' | 'monto_fijo',
      valor: pv.valor,
      descuento: pv.descuento ?? pv.valor ?? 0,
      productos: pv.productoIds,
    }))

    return calcularDescuentos(todosItems, {
      reglasVolumen: volumenes,
      descuentoClientePorcentaje: clienteDescuento,
      descuentoGlobalTipo,
      descuentoGlobalValor: parseFloat(descuentoGlobalValor) || 0,
    })
  }, [cart, productos, usarPromo, manualItems, presentacionesSel, reglasVolumen, clienteDescuento, descuentoGlobalTipo, descuentoGlobalValor])

  const totalCarrito = descuentosCalc.totalFinal
  // 🔑 En **modo pedido** el monto a cobrar es el que cotizó el vendedor: el carrito está vacío y
  // recalcular con las promos de hoy daría un precio distinto al que se le prometió al cliente.
  // Al redefinir `total`, todo lo que ya lo usa (resumen de pagos, validaciones, botones) queda
  // apuntando al monto correcto sin duplicar reglas.
  const total = pedidoActivo ? pedidoActivo.total : totalCarrito

  const puedeDescontar = tienePermiso('aplicarDescuento')

  /**
   * Tope del **descuento manual** (`config.descuentoMaximoPorcentaje`, 0 = sin tope).
   * La regla vive en `lib/descuentos.ts` (`revisarDescuentoManual`) y se aplica sobre la base del
   * descuento global (lo que queda después de producto, volumen y cliente): las promociones
   * automáticas son configuración del negocio, no una decisión de mostrador.
   */
  const revisionDescuento = React.useMemo(() => {
    const baseParaGlobal = Math.max(0, descuentosCalc.totalBruto - (descuentosCalc.totalDescuento - (descuentosCalc.global?.descuento ?? 0)))
    return revisarDescuentoManual({
      tipo: descuentoGlobalTipo,
      valor: parseFloat(descuentoGlobalValor) || 0,
      subtotal: baseParaGlobal,
      topePorcentaje: (cfg as Record<string, unknown>).descuentoMaximoPorcentaje as number | undefined,
    })
  }, [descuentoGlobalTipo, descuentoGlobalValor, descuentosCalc, cfg])

  // ─── Formas de pago ────────────────────────────────────────────────────────
  // Sin nada en la venta no se elige forma de pago: los botones quedan
  // deshabilitados y no se muestra la lista. Se calcula del carrito en vivo, así
  // que al vaciarlo (botón, o borrando el último producto) se desactivan solos.
  const hayProductos = Object.keys(cart).length > 0 || Object.keys(manualItems).length > 0 || Boolean(pedidoActivo)
  const esVendedor = tienePermiso('enviarACaja') && !tienePermiso('cobrarVenta')

  /** Al quedarse la venta sin nada, se descarta la forma de pago elegida. */
  function limpiarPagoSiVacio(carrito: Record<string, number>, manuales: Record<string, unknown>) {
    if (Object.keys(carrito).length === 0 && Object.keys(manuales).length === 0) {
      setPagos([])
      setPagoCredito(false)
      setGrupoTransf(false)
    }
  }

  // La regla (topes, vuelto, redondeo) vive en `lib/pagos.ts`; acá solo se
  // guarda lo que carga el cajero y se muestra el resultado. Así el panel y el
  // guardado no pueden contradecirse.
  const resumen = React.useMemo(
    () =>
      resumenPagos({
        pagos: pagos.map((p) => ({
          id: p.id,
          medio: p.medio,
          monto: normalizarMonto(p.monto),
          ...(p.operacion.trim() ? { operacion: p.operacion } : {}),
        })),
        total,
      }),
    [pagos, total]
  )

  // Con el total ya cubierto no se agregan más medios: el excedente solo tiene
  // sentido como efectivo recibido (y ese se edita en la fila que ya existe).
  const puedeAgregarPago = resumen.falta > 0

  const agregarPago = React.useCallback(
    (medio: MedioPago) => {
      // Sin nada en la venta no hay forma de pago que elegir (los botones ya
      // están deshabilitados; esto cubre cualquier otro camino de entrada).
      if (!hayProductos) return
      setPagoCredito(false)
      setGrupoTransf(false)
      // Se precarga con lo que falta: el caso normal (pago exacto) queda en un toque.
      const tope = topeSugerido(medio, resumen.falta)
      const monto = tope === null ? (resumen.falta > 0 ? String(resumen.falta) : '') : String(tope)
      setPagos((prev) => [...prev, nuevoPago(medio, monto)])
    },
    [resumen.falta, hayProductos]
  )

  function actualizarPago(id: string, cambios: Partial<Pick<PagoUI, 'monto' | 'operacion'>>) {
    setPagos((prev) => prev.map((p) => (p.id === id ? { ...p, ...cambios } : p)))
  }

  function quitarPago(id: string) {
    setPagos((prev) => prev.filter((p) => p.id !== id))
  }

  /** Cambiar a crédito: la venta entera va a la cuenta del cliente. */
  function elegirCredito() {
    if (!hayProductos) return
    setPagoCredito(true)
    setGrupoTransf(false)
    setPagos([])
  }

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
    const actual = cart[id] ?? 0
    const siguiente = { ...cart }
    if (actual <= 1) delete siguiente[id]
    else siguiente[id] = actual - 1
    setCart(siguiente)
    // Si con esto la venta quedó vacía, se descarta la forma de pago elegida.
    limpiarPagoSiVacio(siguiente, manualItems)
  }
  function del(id: string) {
    const { [id]: _, ...siguiente } = cart
    setCart(siguiente)
    limpiarPagoSiVacio(siguiente, manualItems)
  }

  function delManual(id: string) {
    const { [id]: _, ...siguiente } = manualItems
    setManualItems(siguiente)
    limpiarPagoSiVacio(cart, siguiente)
  }

  /** Vaciar la venta completa (catálogo + items manuales) y descartar el pago. */
  function vaciarCarrito() {
    setCart({})
    // Antes "Vaciar" dejaba los items manuales ("Embalaje y Otros"): la venta
    // seguía viva y el botón Cobrar habilitado, aunque el carrito se viera vacío.
    setManualItems({})
    limpiarPagoSiVacio({}, {})
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
      metodo: pagoCredito ? 'credito' : 'pago',
      pagos: pagos.map((p) => ({ medio: p.medio, monto: normalizarMonto(p.monto), operacion: p.operacion })),
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
    setPagoCredito(false)
    setPagos([])
    setGrupoTransf(false)
    setClienteDni('')
    setClienteNombre('')
    setClienteDireccion('')
    setDniConsultado(false)
    setListaPrecioSel('')
    setToast('⏸️ Venta pausada')
  }

  function abrirPausadas() {
    setPausadasLista(listarVentasPausadas())
    setPausadasAbierto(true)
  }

  // ─── Modo pedido (el vendedor → caja, cobrado desde el carrito) ─────────────

  /** Trae un pedido al carrito para cobrarlo acá. Con la venta ocupada, avisa y no hace nada. */
  async function activarPedido(doc: Parameters<typeof pedidoParaCarrito>[0]) {
    if (Object.keys(cart).length > 0 || Object.keys(manualItems).length > 0) {
      return setToast('⚠️ Terminá o vaciá la venta actual antes de cobrar un pedido')
    }
    const p = pedidoParaCarrito(doc)
    // Cambiar de pedido a mitad del cobro descarta lo que ya se cargó: se pregunta.
    if (pedidoActivo && pedidoActivo.id !== p.id) {
      const ok = await confirm({
        title: 'Cambiar de pedido',
        message: `Estás cobrando ${pedidoActivo.codigo}. ¿Pasamos a ${p.codigo}? Se descarta la forma de pago que ya cargaste.`,
        okText: 'Cambiar',
      })
      if (!ok) return
    }
    setPedidoActivo(p)
    // El pedido no tiene tipo fiscal: el cajero lo elige acá (arranca en Nota de Venta).
    setTipoComp('nv')
    setClienteDni(p.clienteDni)
    setClienteNombre(p.clienteNombre)
    setDniConsultado(Boolean(p.clienteDni))
    setPagos([])
    setPagoCredito(false)
    setGrupoTransf(false)
    // Envío del pedido: se carga en el cajero para que sepa que es delivery (y quede en el ticket).
    setEnvio(p.envio ? { tipo: 'domicilio', direccion: p.envio.direccion || '', referencia: p.envio.referencia || '', zonaId: p.envio.zonaId || '', costo: Number(p.envio.costo) || 0, notas: p.envio.notas || '' } : { tipo: 'tienda', direccion: '', referencia: '', zonaId: '', costo: 0, notas: '' })
    setToast(`🧾 Cobrando pedido ${p.codigo} (${fmt(p.total)})`)
  }

  /** Suelta el pedido sin cobrarlo: vuelve a la lista de pendientes, intacto. */
  function soltarPedido() {
    setPedidoActivo(null)
    setPagos([])
    setToast('Pedido devuelto a la lista')
  }

  /** Cobra el pedido activo: usa el mismo camino que ya existía (`cobrarVentaPendiente`). */
  async function cobrarPedido() {
    if (!pedidoActivo) return
    if (!tienePermiso('cobrarVenta')) return setToast('🚫 No tenés permiso para cobrar')
    const { buscarTurnoAbierto } = await import('@/services/turnos')
    const turnoActivo = await buscarTurnoAbierto(user?.uid, tienePermiso('verTodo'))
    if (!turnoActivo) return setToast('🚫 No hay un turno abierto. Abrí un turno antes de cobrar.')

    const tipoDocPedido: 'NV' | 'BOLETA' | 'FACTURA' = tipoComp === 'nv' ? 'NV' : tipoComp === 'boleta' ? 'BOLETA' : 'FACTURA'
    // Las mismas validaciones del PDV (Factura → RUC; Boleta sobre el tope → DNI).
    if (tipoDocPedido === 'FACTURA' && !/^\d{11}$/.test(clienteDni.trim())) {
      return setToast('⚠️ La Factura necesita el RUC (11 dígitos) del cliente')
    }
    const topeDoc = Number(cfg.topeBoletaDni) > 0 ? Number(cfg.topeBoletaDni) : 700
    if (tipoDocPedido === 'BOLETA' && pedidoActivo.total > topeDoc && !/^\d{8}$/.test(clienteDni.trim())) {
      return setToast(`⚠️ Boletas mayores a ${fmt(topeDoc)} requieren DNI (8 dígitos)`)
    }
    if (!resumen.puedeCobrar) return setToast(`⚠️ ${resumen.motivo ?? 'El pago no cubre el total'}`)

    const pagosGuardar = resumen.pagos
    const tipoPagoPedido = tipoPagoDe(pagosGuardar)
    if (pedidoActivo.cajaId && cajaId && pedidoActivo.cajaId !== cajaId) {
      const ok = await confirm({
        title: 'Pedido de otra caja',
        message: `Este pedido es de ${pedidoActivo.cajaId} y se va a emitir con la serie de tu ${cajaId}.`,
        okText: 'Cobrar igual',
      })
      if (!ok) return
    }

    setCobrando(true)
    try {
      const res = await cobrarVentaPendiente({
        documentoId: pedidoActivo.id,
        turnoId: turnoActivo.id || '',
        pagos: pagosGuardar,
        tipoPago: tipoPagoPedido,
        montoRecibido: resumen.efectivoRecibido,
        cambio: resumen.vuelto,
        cajeroId: user?.uid || '',
        cajeroNombre: nombreUsuario || user?.email || 'sistema',
        tipoDoc: tipoDocPedido,
        cajaId: cajaId || undefined,
        config: {
          ...cfg,
          serieBoleta: serieBoleta || cfg.serieBoleta,
          serieFactura: serieFactura || cfg.serieFactura,
          serie_prefijo: seriePrefijo || cfg.serie_prefijo,
        },
      })
      if (!res.success) return setToast(`❌ ${res.error || 'No se pudo cobrar el pedido'}`)

      const correlativo = res.correlativo || pedidoActivo.codigo
      // Se relee el documento cobrado para ofrecer la impresión, igual que una venta normal.
      const documento = await obtenerDocumento(pedidoActivo.id)
      setVentaOk({ correlativo, total: pedidoActivo.total, vuelto: resumen.vuelto, documento: (documento ?? {}) as Record<string, unknown> })
      setPedidoActivo(null)
      setPagos([])
      // El panel de pendientes no se refresca a mano: escucha la colección en vivo (`onSnapshot`),
      // así que el pedido cobrado sale de la lista por sí solo, en este equipo y en los demás.
      setToast(`✅ Pedido ${pedidoActivo.codigo} cobrado · ${correlativo}`)
    } catch (e) {
      setToast(`❌ ${(e as Error).message}`)
    } finally {
      setCobrando(false)
    }
  }

  function recuperarVenta(v: VentaPausada) {    if (Object.keys(cart).length > 0 || Object.keys(manualItems).length > 0) {
      return setToast('⚠️ Vacíá el carrito antes de recuperar una venta pausada')
    }
    setCart(v.cart)
    setManualItems(v.manualItems)
    setUsarPromo(v.usarPromo)
    setTipoComp(v.tipoComp)
    setPagoCredito(v.metodo === 'credito')
    // Las ventas pausadas viejas no tienen `pagos`: se reconstruye una fila con
    // el medio que tenían (o efectivo) por el total guardado.
    setPagos(
      v.pagos?.length
        ? v.pagos.map((p) => nuevoPago(infoMedio(p.medio).medio, String(normalizarMonto(p.monto) || v.total)))
        : v.metodo === 'credito'
          ? []
          : [nuevoPago(v.metodo === 'transferencia' || v.metodo === 'mixto' ? 'transferencia' : 'efectivo', String(v.total))]
    )
    setGrupoTransf(false)
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

  // Customer display: broadcast cart data to Firestore for cross-device sync.
  React.useEffect(() => {
    if (!displaySession) return
    const bizName = cfg?.nombre || 'JorFel'
    broadcastCart(displaySession, {
      businessName: bizName,
      items: allItems.map((it) => ({
        nombre: it.nombre,
        cantidad: it.qty,
        precioUnitario: it.precio,
        subtotal: it.precio * it.qty,
        esManual: it.manual,
      })),
      descuento: descuentosCalc.totalDescuento,
      envioCosto: envio.tipo === 'domicilio' ? envio.costo : 0,
      total,
    }).catch(() => {})
  }, [displaySession, allItems, total, envio, cfg])

  // Cleanup session on unmount
  React.useEffect(() => {
    return () => {
      if (displaySession) closeSession(displaySession).catch(() => {})
    }
  }, [displaySession])

  function toggleDisplay() {
    if (displaySession) {
      closeSession(displaySession).catch(() => {})
      setDisplaySession(null)
      setQrDataUrl(null)
      setQrOpen(false)
      displayUrlRef.current = null
      return
    }
    const sid = crypto.randomUUID()
    const baseUrl = window.location.origin + window.location.pathname
    const url = baseUrl + '?session=' + sid
    displayUrlRef.current = url
    setDisplaySession(sid)
    // Open display tab
    window.open(url, 'jorfel-display')
    // Generate QR and show modal
    QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: '#1a1a2e', light: '#ffffff' } })
      .then((dataUrl) => { setQrDataUrl(dataUrl); setQrOpen(true) })
      .catch(() => setQrOpen(true))
  }

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
      const guardado = await obtenerCliente(docN)
      if (guardado) {
        const d = guardado
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

    // 🔑 **Control espejo del pedido colgado**: si en caja hay un pedido pendiente con estos mismos
    // productos, se avisa ANTES de venderlo directo. Caso real (21/09/2026): el cajero vendió
    // directo lo mismo que `PED-000007` (emitió la NV01-000180) y el pedido quedó pendiente en su
    // lista para siempre. La comparación es una ayuda (no bloquea): si no es ese pedido, se sigue.
    try {
      const igual = pedidoPendienteCoincidente(await obtenerVentasPendientes(), { items: allItems, total })
      if (igual) {
        const usarPedido = await confirm({
          title: 'Hay un pedido con estos mismos productos',
          message: `El pedido ${igual.serieNumero} de ${igual.vendedorNombre || 'un vendedor'} está esperando en caja con estos mismos productos por ${fmt(Number(igual.venta?.total) || 0)}.\n\nSi es la misma venta, conviene cobrar ESE pedido: así no queda colgado en la lista de caja ni se emite dos veces.\n\n¿Traer el pedido al carrito?`,
          okText: `Cobrar el pedido ${igual.serieNumero}`,
        })
        if (usarPedido) {
          activarPedido(igual)
          return
        }
      }
    } catch (e) {
      // Es una ayuda, no un candado: si la consulta falla, la venta sigue su curso.
      console.warn('⚠️ No se pudo verificar si hay un pedido con los mismos productos:', e)
    }

    if (pagoCredito) {
      if (!/^\d{8}$/.test(dni) && !/^\d{11}$/.test(dni)) return setToast('⚠️ El crédito requiere DNI o RUC válido')
      if (!dniConsultado) return setToast('⚠️ Presiona Consultar para validar el DNI/RUC')
      // El estado lo lee el servicio y la REGLA la define lib/credito.ts:
      // acá solo se muestra el motivo, para que no haya dos verdades distintas.
      const estado = await obtenerEstadoCredito(dni)
      const evaluacion = evaluarVentaCredito({ total, estado })
      if (!evaluacion.permitido) return setToast(`🚫 ${evaluacion.motivo}`)
    } else {
      // El tope, el vuelto y el "falta" los define lib/pagos.ts: acá solo se
      // muestra el motivo de que no se pueda cobrar todavía.
      if (resumen.pagos.length === 0) return setToast('⚠️ Elegí al menos una forma de pago')
      if (!resumen.puedeCobrar) return setToast(`⚠️ ${resumen.motivo ?? 'El pago no cubre el total'}`)
    }

    // El cierre del turno invalida la venta: solo se puede cobrar con turno abierto.
    const turno = await buscarTurnoAbierto(user?.uid, tienePermiso('verTodo'))
    if (!turno) return setToast('🚫 No hay un turno abierto. Abrí un turno antes de vender.')

    // --- Protección de margen mínimo ---
    const hoy = new Date()
    const productosBloqueados: string[] = []
    const productosDebajoCosto: string[] = []

    for (const [id, qty] of Object.entries(cart)) {
      const p = productos.find((x) => x.id === id)
      if (!p) continue
      const presId = presentacionesSel[id]
      const pres = presId ? p.presentaciones?.find((pr) => pr.id === presId) : null
      const factor = pres?.factor ?? 1
      const precioItem = precioFinal(p) * factor
      if (qty <= 0 || precioItem <= 0) continue

      // ¿Producto por vencer o vencido? (≤7 días)
      const expiraEn = p.fechaVencimiento ? Math.ceil((new Date(p.fechaVencimiento).getTime() - hoy.getTime()) / 86400000) : Infinity
      const porVencer = expiraEn <= 7

      // ¿Debajo del costo?
      const costo = p.precioCompra ?? 0
      if (costo > 0 && precioItem < costo) {
        productosDebajoCosto.push(p.nombre ?? id)
      }

      // ¿Debajo del precio mínimo (y no es por vencer)?
      const minimo = p.precioMinimo ?? 0
      if (minimo > 0 && precioItem < minimo && !porVencer) {
        productosBloqueados.push(`${p.nombre ?? id} (mínimo: ${fmt(minimo)}, actual: ${fmt(precioItem)})`)
      }
    }

    if (productosBloqueados.length > 0) {
      return setToast(`🚫 Precio bajo piso: ${productosBloqueados.join(', ')}`)
    }

    if (productosDebajoCosto.length > 0) {
      const ok2 = await confirm({
        title: '⚠️ Venta por debajo del costo',
        message: `Estás vendiendo por debajo del costo en: ${productosDebajoCosto.join(', ')}. ¿Confirmar venta?`,
        okText: 'Vender',
      })
      if (!ok2) return
    }

    // Desglose del cobro para que el cajero confirme viendo exactamente qué se
    // registra (con pago múltiple, un solo rótulo ya no alcanza).
    const detallePago = pagoCredito
      ? 'Crédito (todo a la cuenta del cliente)'
      : resumen.pagos.map((p) => `${etiquetaPago(p)} ${fmt(p.monto)}`).join(' + ')
    const itemsCount = Object.keys(cart).reduce((s, id) => s + cart[id], 0)
    const ok = await confirm({
      title: '¿Confirmar la venta?',
      message:
        `Total: ${fmt(total)}\n` +
        `Productos: ${itemsCount}\n` +
        `Forma de pago: ${detallePago}${resumen.vuelto > 0 ? `\nVuelto: ${fmt(resumen.vuelto)}` : ''}\n` +
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
        // El embalaje se declara con SU afectación (por defecto, la del negocio).
        tipoAfectacion: it.afectacion || cfg.tipoAfectacionManual || AFECTACION_POR_DEFECTO,
        usarPrecioEspecial: false,
        manual: true,
      }))
      const items = [...invItems, ...manItems]
      // El crédito es la única forma de pago que no pasa por la lista: va por el
      // total. En el resto, `resumen.pagos` ya viene con los montos aplicados y
      // los bolsillos resueltos por `lib/pagos.ts`.
      const pagosGuardar = pagoCredito ? undefined : resumen.pagos
      const tipoPago = pagoCredito ? 'credito' : tipoPagoDe(resumen.pagos)
      const res = await registrarVenta({
        items,
        venta: {
          tipoDoc: tipoComp === 'nv' ? 'NV' : tipoComp === 'boleta' ? 'BOLETA' : 'FACTURA',
          tipoPago,
          pagos: pagosGuardar,
          total,
          descuentoTotal: descuentosCalc.totalDescuento,
          descuentoGlobalTipo: descuentoGlobalValor ? descuentoGlobalTipo : undefined,
          descuentoGlobalValor: parseFloat(descuentoGlobalValor) || undefined,
          cliente_dni: dni || '',
          cliente_nombre: clienteNombre || '',
          cliente_direccion: clienteDireccion || '',
          // La referencia del documento es el N° de operación del primer pago
          // electrónico (antes era un campo aparte; ahora vive en cada pago).
          referencia: resumen.pagos.find((p) => p.operacion)?.operacion || '',
          montoRecibido: resumen.efectivoRecibido,
          cambio: resumen.vuelto,
          cajero: nombreUsuario || user?.email || 'sistema',
          usuarioId: user?.uid || '',
          turnoId: turno?.id || null,
          envio: envio.tipo === 'domicilio' ? {
            tipo: 'domicilio',
            direccion: envio.direccion,
            referencia: envio.referencia,
            zonaId: envio.zonaId,
            costo: envio.costo,
            notas: envio.notas,
            estado: 'pendiente',
          } : undefined,
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
        setVentaOk({ correlativo: res.correlativo ?? '', total, vuelto: resumen.vuelto, documento: res.documento })
        setCart({})
        setPagos([])
        setPagoCredito(false)
        setGrupoTransf(false)
        setClienteDni('')
        setClienteNombre('')
        setDniConsultado(false)
        setManualItems({})
        setEnvio({ tipo: 'tienda', direccion: '', referencia: '', zonaId: '', costo: 0, notas: '' })
        setDescuentoGlobalValor('')
        setListaPrecioSel('')
      } else {
        setToast('❌ ' + (res.error || 'Error al registrar la venta'))
      }
    } catch (e) {
      setToast('❌ ' + (e as Error).message)
    } finally {
      setCobrando(false)
    }
  }

  async function enviarACaja() {
    if (Object.keys(cart).length === 0 && Object.keys(manualItems).length === 0) return setToast('⚠️ Agregá al menos un producto')

    // ⚠️ El pedido **no** lleva comprobante: se manda como pedido (`PED-…`) y el cajero, al
    // cobrarlo, elige NV / boleta / factura y recién ahí se asigna la serie y el correlativo.
    // Antes se usaba `tipoComp` (arranca en 'boleta' y está oculto para el vendedor) → creaba
    // boletas sin que nadie las eligiera y consumía un correlativo de B001 por cada intento.
    const ok = await confirm({
      title: '¿Enviar a caja?',
      message: `Total: ${fmt(total)}\nEl cajero cobrará esta venta.\nComprobante y forma de pago los elige el cajero al cobrar.`,
      okText: 'Enviar',
    })
    if (!ok) return

    setCobrando(true)
    try {
      // ⚠️ Los items se guardan con el **formato de documento** (el mismo que arma `registrarVenta`),
      // no con el del carrito: `cantidad` en unidades base, `precioVenta` por unidad base,
      // `subtotal`, `categoria` y —sobre todo— **`tipoAfectacion`**. Sin esto, el pedido se declaraba
      // GRAVADO ('10') aunque el producto fuera exonerado ('20') y el comprobante sumaba 18% de IGV
      // que nadie cobró (y los reportes por categoría lo mandaban a "Sin categoría").
      const afectacionPorDefecto = cfg.regionExonerada ? AFECTACION_EXONERADO : AFECTACION_POR_DEFECTO
      const invItems = Object.entries(cart).map(([id, qty]) => {
        const p = productos.find((x) => x.id === id)
        if (!p) return null
        const presId = presentacionesSel[id]
        const pres = presId ? p.presentaciones?.find((pr) => pr.id === presId) : null
        const factor = pres?.factor ?? 1
        const presNombre = pres?.nombre ?? 'Unidad'
        const precioBase = precioFinal(p)
        const unidadesBase = qty * factor
        const base = {
          id,
          nombre: p.nombre || '',
          // El carrito usa `quantity`; el documento, `cantidad`. Se mandan los dos iguales.
          quantity: unidadesBase,
          cantidad: unidadesBase,
          cantidadEnUnidadBase: unidadesBase,
          precioVenta: precioBase,
          subtotal: redondear2(precioBase * unidadesBase),
          unidad: presNombre,
          presentacionNombre: presNombre,
          presentacionId: pres?.id ?? 'unidad',
          factorConversion: factor,
          categoria: p.categoria || '',
          tipoAfectacion: p.tipoAfectacion || afectacionPorDefecto,
          usarPrecioEspecial: (usarPromo[id] ?? true) && tienePromo(p),
        }
        if (p.isKit && p.kitItems?.length) return { ...base, kitItems: p.kitItems }
        return base
      }).filter(Boolean) as VentaItem[]
      const manItems = Object.entries(manualItems).map(([id, it]) => ({
        id,
        nombre: it.nombre,
        quantity: it.qty,
        cantidad: it.qty,
        cantidadEnUnidadBase: it.qty,
        precioVenta: it.precio,
        subtotal: redondear2(it.precio * it.qty),
        unidad: 'Unidad',
        presentacionNombre: 'Unidad',
        presentacionId: 'unidad',
        factorConversion: 1,
        // El embalaje se declara con SU afectación; si no la eligieron, la del negocio.
        categoria: CATEGORIA_MANUAL,
        tipoAfectacion: String(it.afectacion || cfg.tipoAfectacionManual || afectacionPorDefecto),
        usarPrecioEspecial: false,
        manual: true,
      }))
      const items = [...invItems, ...manItems]
      const payloadPedido = {
        items,
        venta: {
          total,
          descuentoTotal: descuentosCalc.totalDescuento,
          // ⚠️ Nada de `undefined`: Firestore lo rechaza al escribir y TypeScript no avisa (era el
          // motivo por el que "Enviar a caja" fallaba siempre). Los opcionales van con spread.
          ...(descuentoGlobalValor ? { descuentoGlobalTipo, descuentoGlobalValor: parseFloat(descuentoGlobalValor) || 0 } : {}),
          cliente_dni: clienteDni || '',
          cliente_nombre: clienteNombre || '',
          cliente_direccion: clienteDireccion || '',
          cajero: nombreUsuario || user?.email || 'sistema',
          usuarioId: user?.uid || '',
          // Envío a domicilio: mismo formato que la venta directa, para no perder la dirección
          // ni el costo en un pedido que se cobra después.
          ...(envio.tipo === 'domicilio' ? {
            envio: {
              tipo: 'domicilio' as const,
              direccion: envio.direccion,
              referencia: envio.referencia,
              zonaId: envio.zonaId,
              costo: envio.costo,
              notas: envio.notas,
            },
          } : {}),
        },
        config: {
          ...cfg,
          serieBoleta: serieBoleta || cfg.serieBoleta,
          serieFactura: serieFactura || cfg.serieFactura,
          serie_prefijo: seriePrefijo || cfg.serie_prefijo,
        },
        vendedorId: user?.uid || '',
        vendedorNombre: nombreUsuario || user?.email || 'sistema',
        cajaId: cajaId || '',
      }
      let res = await crearVentaPendiente(payloadPedido)

      // 🔑 **Pedido duplicado**: si el mismo vendedor ya mandó esta misma venta y el pedido sigue
      // esperando en caja, se avisa con el código del que ya existe y decide él. Caso real
      // (18/09/2026): un reenvío dejaba dos pedidos idénticos y el cajero veía "un pedido ya
      // procesado" que en realidad era el sobrante, colgado para siempre.
      if (!res.success && res.duplicado) {
        const otro = await confirm({
          title: '¿Enviar otro pedido igual?',
          message: `Ya enviaste este mismo pedido (${res.codigoPedido}) hace menos de 15 minutos y todavía está esperando en caja.\n\nSi es la MISMA venta, cancelá: el cajero va a cobrar el pedido que ya está en su lista.\nSi es OTRA venta con los mismos productos, confirmá y se envía un pedido nuevo.`,
          okText: 'Enviar otro igual',
        })
        if (!otro) return setToast(`ℹ️ No se envió nada: el pedido ${res.codigoPedido} ya está en caja`)
        res = await crearVentaPendiente({ ...payloadPedido, permitirDuplicado: true })
      }

      if (res.success) {
        setToast(`✅ Pedido ${res.correlativo ?? ''} enviado a caja`)
        setCart({})
        setPagos([])
        setPagoCredito(false)
        setGrupoTransf(false)
        setClienteDni('')
        setClienteNombre('')
        setDniConsultado(false)
        setManualItems({})
        setEnvio({ tipo: 'tienda', direccion: '', referencia: '', zonaId: '', costo: 0, notas: '' })
        setDescuentoGlobalValor('')
        setListaPrecioSel('')
      } else {
        setToast('❌ ' + (res.error || 'Error al enviar a caja'))
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
            Embalajes
          </Button>
        </div>

        {/* Venta rápida — favoritos del admin o más vendidos */}
        {React.useMemo(() => {
          const activos = productos.filter((p) => p.activo !== false && (p.stock ?? 0) > 0)
          const favs = activos.filter((p) => p.esFavorito)
          // Si el admin marcó favoritos, usar esos. Si no, usar los más vendidos (al menos 1 venta).
          const rapidos = favs.length > 0
            ? favs
            : [...activos].filter((p) => (p.vecesVendido ?? 0) > 0).sort((a, b) => (b.vecesVendido ?? 0) - (a.vecesVendido ?? 0)).slice(0, 12)
          if (rapidos.length === 0) return null
          const esAuto = favs.length === 0
          return (
            <div className="mb-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-bold text-primary">⚡ VENTA RÁPIDA</span>
                {esAuto && <span className="text-[10px] text-muted-foreground">(más vendidos)</span>}
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {rapidos.map((p) => {
                  const enCaja = cart[p.id] ?? 0
                  const stock = stockEnPresentacion(p)
                  return (
                    <button
                      key={p.id}
                      onClick={() => add(p.id)}
                      disabled={enCaja >= stock}
                      className={cn(
                        'relative flex w-[88px] shrink-0 flex-col items-center gap-1 rounded-xl border-2 p-2.5 text-center transition-all cursor-pointer',
                        enCaja > 0
                          ? 'border-primary bg-primary/10 shadow-sm'
                          : 'border-border hover:border-primary/50 hover:bg-accent',
                        enCaja >= stock && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-lg">
                        {p.imagen ? (
                          <img src={p.imagen} alt="" className="h-10 w-10 rounded-lg object-cover" />
                        ) : (
                          '📦'
                        )}
                      </div>
                      <span className="w-full truncate text-[11px] font-semibold leading-tight">{p.nombre}</span>
                      <span className="text-[11px] font-bold text-primary">{fmt(precioFinal(p))}</span>
                      {enCaja > 0 && (
                        <span className="absolute -right-1 -top-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white">{enCaja}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        }, [productos, cart, add, stockEnPresentacion, precioFinal])}

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
            <Button variant="ghost" size="sm" onClick={abrirPausadas} className="gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              <Pause className="h-3.5 w-3.5" />
              Pausadas
            </Button>
            <Button
              variant={displaySession ? 'default' : 'ghost'}
              size="sm"
              onClick={() => {
                if (displaySession) {
                  // Already active — show QR modal again
                  if (!qrDataUrl && displayUrlRef.current) {
                    QRCode.toDataURL(displayUrlRef.current.toUpperCase(), { width: 240, margin: 1, color: { dark: '#1a1a2e', light: '#ffffff' } })
                      .then((d) => { setQrDataUrl(d); setQrOpen(true) })
                      .catch(() => setQrOpen(true))
                  } else {
                    setQrOpen(true)
                  }
                } else {
                  toggleDisplay()
                }
              }}
              className={cn('gap-1.5 text-xs font-semibold', displaySession ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'text-muted-foreground hover:text-foreground')}
            >
              {displaySession ? <Monitor className="h-3.5 w-3.5" /> : <QrCode className="h-3.5 w-3.5" />}
              {displaySession ? 'En vivo' : 'Pantalla'}
            </Button>
            <span className="num text-xs font-semibold text-muted-foreground">
              {allItems.length} item{allItems.length !== 1 ? 's' : ''}
            </span>
          </div>

          {tienePermiso('verVentasPendientes') && (
            <div className="border-b px-5 py-3">
              <PanelVentasPendientes onCobrarPedido={activarPedido} />
            </div>
          )}

          <div className="border-b px-5 py-3 space-y-3">
            {/* Tipo de comprobante — solo cajero; el vendedor no elige */}
            {!esVendedor && (
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
            )}

            {/* Cliente (colapsable para dar más espacio al carrito).
                En modo pedido el cliente viene del pedido y no se edita acá. */}
            {!pedidoActivo && <>
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
              {(cfg.listasPrecios ?? []).length > 1 && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">Lista:</span>
                  <div className="flex gap-1">
                    {(cfg.listasPrecios ?? []).map((l) => (
                      <button
                        key={l.id}
                        onClick={() => setListaPrecioSel(listaPrecioActiva === l.id ? '' : l.id)}
                        className={cn(
                          'rounded-md px-2 py-0.5 text-[10px] font-bold cursor-pointer',
                          listaPrecioActiva === l.id ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-accent'
                        )}
                      >
                        {l.nombre}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}
            </>}
          </div>

          {/* ── Modo pedido: aviso fijo con el pedido que se está cobrando ────────── */}
          {pedidoActivo && (
            <div className="border-b bg-amber-50 px-5 py-2.5 dark:bg-amber-950/30">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-amber-800 dark:text-amber-200">🧾 Cobrando pedido {pedidoActivo.codigo}</p>
                  <p className="text-[10px] text-amber-700 dark:text-amber-300">
                    Vendedor: {pedidoActivo.vendedor || '—'}
                    {clienteDelPedido(pedidoActivo) ? ` · ${clienteDelPedido(pedidoActivo)}` : ''}
                  </p>
                  {pedidoActivo.descuento > 0 && (
                    <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                      🏷️ Descuento aplicado por el vendedor: -{fmt(pedidoActivo.descuento)} · los precios de las líneas son de lista, el comprobante lo declara como descuento
                    </p>
                  )}
                  {pedidoActivo.envio && (pedidoActivo.envio.direccion || pedidoActivo.envio.notas) && (
                    <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                      🚚 Envío a domicilio: {pedidoActivo.envio.direccion || 'sin dirección'}{pedidoActivo.envio.referencia ? ` · Ref: ${pedidoActivo.envio.referencia}` : ''}{pedidoActivo.envio.notas ? ` · ${pedidoActivo.envio.notas}` : ''}{Number(pedidoActivo.envio.costo) > 0 ? ` · S/ ${Number(pedidoActivo.envio.costo).toFixed(2)}` : ''}
                    </p>
                  )}
                  <p className="text-[10px] text-amber-700 dark:text-amber-300">
                    El monto es el cotizado por el vendedor: no se recalcula. Elegí comprobante y forma de pago abajo.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={soltarPedido}>Cancelar</Button>
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto divide-y px-5 py-2">
            {pedidoActivo ? (
              <>
                {pedidoActivo.items.map((it, i) => (
                  <div key={`${it.nombre}-${i}`} className="flex items-center gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{it.nombre}</div>
                      <div className="num text-[11px] text-muted-foreground">{fmt(it.precio)} c/u × {it.cantidad}</div>
                    </div>
                    <span className="num w-20 text-right text-sm font-bold">{fmt(it.precio * it.cantidad)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-xs text-muted-foreground">Total cotizado por el vendedor</span>
                  <span className="num text-sm font-extrabold">{fmt(pedidoActivo.total)}</span>
                </div>
              </>
            ) : allItems.length === 0 ? (
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
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold">{p.nombre}</span>
                        {(p.precioCompra ?? 0) > 0 && precioFinal(p) * factorActual < (p.precioCompra ?? 0) && (
                          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">BAJO COSTO</span>
                        )}
                        {p.fechaVencimiento && (() => {
                          const dias = Math.ceil((new Date(p.fechaVencimiento).getTime() - Date.now()) / 86400000)
                          if (dias <= 0) return <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold text-red-600">VENCIDO</span>
                          if (dias <= 7) return <span className="shrink-0 rounded bg-orange-500/15 px-1.5 py-0.5 text-[9px] font-bold text-orange-600">{dias}d</span>
                          return null
                        })()}
                      </div>
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
                        Embalaje y Otros
                      </span>
                      {/* Afectación del embalaje: es un item sin producto en el catálogo, así que se
                          elige acá. Arranca con la del negocio (Configuración → SUNAT). */}
                      <select
                        value={it.afectacion ?? (cfg.tipoAfectacionManual || AFECTACION_POR_DEFECTO)}
                        onChange={(e) => setManualItems((prev) => ({ ...prev, [id]: { ...prev[id], afectacion: e.target.value } }))}
                        title="Afectación con la que se declara este item"
                        className="mt-1 block h-6 w-full max-w-[190px] rounded border bg-background px-1 text-[10px] font-semibold"
                      >
                        {TIPO_AFECTACION.map((a) => (
                          <option key={a.codigo} value={a.codigo}>{a.codigo} · {a.label}</option>
                        ))}
                      </select>
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
            {/* Envío (no se toca en modo pedido: el pedido ya trae lo suyo) */}
            {!pedidoActivo && cfg?.envioHabilitado && (
              <div className="space-y-2 rounded-xl border border-dashed p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-primary">🚚 ENVÍO</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEnvio({ ...envio, tipo: 'tienda' })}
                    className={cn(
                      'flex-1 rounded-lg border-2 py-2 text-xs font-semibold transition-colors cursor-pointer',
                      envio.tipo === 'tienda' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'
                    )}
                  >
                    🏪 Recoge en tienda
                  </button>
                  <button
                    onClick={() => setEnvio({ ...envio, tipo: 'domicilio' })}
                    className={cn(
                      'flex-1 rounded-lg border-2 py-2 text-xs font-semibold transition-colors cursor-pointer',
                      envio.tipo === 'domicilio' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'
                    )}
                  >
                    🚚 Envío a domicilio
                  </button>
                </div>
                {envio.tipo === 'domicilio' && (
                  <div className="space-y-2">
                    <input
                      value={envio.direccion}
                      onChange={(e) => setEnvio({ ...envio, direccion: e.target.value })}
                      placeholder="Dirección (Jr., Av., Calle + N°)"
                      className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                    />
                    <input
                      value={envio.referencia}
                      onChange={(e) => setEnvio({ ...envio, referencia: e.target.value })}
                      placeholder="Referencia (opcional)"
                      className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <select
                        value={envio.zonaId}
                        onChange={(e) => {
                          const zona = (cfg.zonasEnvio ?? []).find((z: any) => z.id === e.target.value)
                          setEnvio({ ...envio, zonaId: e.target.value, costo: zona?.costo ?? 0 })
                        }}
                        className="h-9 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
                      >
                        <option value="">Seleccionar zona</option>
                        {(cfg.zonasEnvio ?? []).map((z: any) => (
                          <option key={z.id} value={z.id}>{z.nombre} — {fmt(z.costo)}</option>
                        ))}
                      </select>
                      <div className="relative w-24">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">S/</span>
                        <input
                          type="number"
                          value={envio.costo}
                          onChange={(e) => setEnvio({ ...envio, costo: Number(e.target.value) || 0 })}
                          className="h-9 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-sm"
                          inputMode="decimal"
                        />
                      </div>
                    </div>
                    <input
                      value={envio.notas}
                      onChange={(e) => setEnvio({ ...envio, notas: e.target.value })}
                      placeholder="Notas (opcional): sin cebolla, llamar al llegar..."
                      className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── Formas de pago (pago múltiple) ────────────────────────────────
                El cajero agrega medios a una lista y el sistema valida el total.
                Solo el efectivo puede pagar de más (da vuelto); el crédito es
                exclusivo y va por el total de la venta.
                El vendedor (enviarACaja && !cobrarVenta) no ve esta sección. */}
            {!esVendedor && <div className="space-y-2">
              <div className={cn('grid gap-1.5', pedidoActivo ? 'grid-cols-2' : 'grid-cols-3')}>
                <button
                  type="button"
                  onClick={() => agregarPago('efectivo')}
                  disabled={!hayProductos || (!pagoCredito && !puedeAgregarPago)}
                  className={cn(
                    'h-10 rounded-lg border text-xs font-bold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                    hayProductos && !pagoCredito && pagos.length > 0 ? 'bg-primary/10 border-primary text-primary' : 'bg-background hover:bg-accent'
                  )}
                >
                  💵 Efectivo
                </button>
                <button
                  type="button"
                  onClick={() => setGrupoTransf((v) => !v)}
                  disabled={!hayProductos || (!pagoCredito && !puedeAgregarPago)}
                  className={cn(
                    'flex h-10 items-center justify-center gap-1 rounded-lg border text-xs font-bold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                    grupoTransf && hayProductos ? 'border-primary bg-primary/10 text-primary' : 'bg-background hover:bg-accent'
                  )}
                >
                  📲 Transferencia <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', grupoTransf && hayProductos && 'rotate-180')} />
                </button>
                {/* El crédito no se combina y va por el total de la venta: en modo pedido no se
                    ofrece (un pedido se cobra en el mostrador). */}
                {!pedidoActivo && (
                <button
                  type="button"
                  onClick={elegirCredito}
                  disabled={!hayProductos}
                  className={cn(
                    'h-10 rounded-lg border text-xs font-bold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                    pagoCredito && hayProductos ? 'border-primary bg-primary text-white' : 'bg-background hover:bg-accent'
                  )}
                >
                  💳 Crédito
                </button>
                )}
              </div>

              {!hayProductos && (
                <p className="text-[11px] text-muted-foreground">Agregá productos al carrito para elegir la forma de pago.</p>
              )}

              {hayProductos && !pagoCredito && pagos.length === 0 && !grupoTransf && (
                <p className="text-[11px] text-muted-foreground">
                  Elegí con qué paga el cliente. Se pueden combinar varias formas (y el sistema valida que no se pase del total).
                </p>
              )}

              {hayProductos && grupoTransf && (pagoCredito || puedeAgregarPago) && (
                <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-dashed p-2">
                  {MEDIOS_ELECTRONICOS.map((m) => (
                    <button
                      key={m.medio}
                      type="button"
                      onClick={() => agregarPago(m.medio)}
                      className="h-9 cursor-pointer rounded-lg border bg-background text-xs font-semibold transition-colors hover:bg-accent"
                    >
                      {m.icono} {m.label}
                    </button>
                  ))}
                </div>
              )}

              {hayProductos && !pagoCredito && pagos.length > 0 && (
                <div className="space-y-2 rounded-xl border p-2">
                  {pagos.map((p) => {
                    const info = infoMedio(p.medio)
                    return (
                      <div key={p.id} className="space-y-1.5 rounded-lg bg-muted/40 p-2">
                        <div className="flex items-center gap-2">
                          <span className="min-w-[6.5rem] shrink-0 text-xs font-bold">
                            {info.icono} {info.label}
                          </span>
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={p.monto}
                            onChange={(e) => actualizarPago(p.id, { monto: e.target.value })}
                            className="num h-8"
                          />
                          <button
                            type="button"
                            onClick={() => quitarPago(p.id)}
                            aria-label={`Quitar ${info.label}`}
                            title="Quitar esta forma de pago"
                            className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        {info.pideOperacion && (
                          <Input
                            value={p.operacion}
                            onChange={(e) => actualizarPago(p.id, { operacion: e.target.value })}
                            placeholder="N° de operación (opcional)"
                            className="h-8 text-xs"
                          />
                        )}
                      </div>
                    )
                  })}

                  {puedeAgregarPago && (
                    <button
                      type="button"
                      onClick={() => setGrupoTransf(true)}
                      className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" /> Forma de pago
                    </button>
                  )}
                </div>
              )}

              {hayProductos && !pagoCredito && pagos.length > 0 && (
                <div className="space-y-1 rounded-lg bg-muted/60 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Pagado</span>
                    <span className="num font-bold">{fmt(resumen.electronico + resumen.efectivoRecibido)}</span>
                  </div>
                  {resumen.falta > 0 ? (
                    <div className="flex items-center justify-between font-bold text-destructive">
                      <span>Falta</span>
                      <span className="num">{fmt(resumen.falta)}</span>
                    </div>
                  ) : resumen.vuelto > 0 ? (
                    <div className="flex items-center justify-between font-bold text-emerald-600">
                      <span>Vuelto</span>
                      <span className="num">{fmt(resumen.vuelto)}</span>
                    </div>
                  ) : (
                    <div className="font-bold text-emerald-600">✓ Cubre el total</div>
                  )}
                  {resumen.motivo && <p className="text-[11px] font-semibold text-destructive">{resumen.motivo}</p>}
                </div>
              )}
            </div>}

            {!esVendedor && pagoCredito && hayProductos && (
              <CreditoPanel dni={clienteDni.trim()} estado={estadoCredito} total={total} cargando={cargandoCredito} />
            )}
            {/* Descuentos: no aplican en modo pedido (el total ya viene cotizado) y requieren
                el permiso `aplicarDescuento` (el dueño lo da o lo quita por usuario). */}
            {!pedidoActivo && (puedeDescontar ? <div className="space-y-2 rounded-xl border p-3">
              <p className="text-xs font-bold text-muted-foreground">Descuentos</p>

              {/* Global */}
              <div className="flex gap-2">
                <select value={descuentoGlobalTipo} onChange={(e) => setDescuentoGlobalTipo(e.target.value as typeof descuentoGlobalTipo)} className="h-8 rounded-lg border px-2 text-xs">
                  <option value="monto">S/ </option>
                  <option value="porcentaje">%</option>
                </select>
                <Input type="number" inputMode="decimal" placeholder="0" value={descuentoGlobalValor} onChange={(e) => setDescuentoGlobalValor(e.target.value)} className={cn('h-8 flex-1 text-xs', revisionDescuento.excede && 'border-destructive')} />
              </div>

              {/* Tope del negocio: se avisa y se bloquea el cobro hasta que lo bajen */}
              {revisionDescuento.excede && (
                <p className="rounded-lg bg-destructive/10 p-2 text-[11px] font-semibold text-destructive">
                  {revisionDescuento.mensaje} Bajalo a {descuentoGlobalTipo === 'porcentaje' ? `${revisionDescuento.valorAjustado}%` : fmt(revisionDescuento.valorAjustado)} para poder cobrar, o pedile al administrador que suba el tope en <em>Configuración → Empresa</em>.
                </p>
              )}

              {/* Resumen descuentos */}
              {descuentosCalc.totalDescuento > 0 && (
                <div className="space-y-1 rounded-lg bg-emerald-50 p-2 text-[11px] dark:bg-emerald-500/10">
                  {descuentosCalc.porProducto.filter((d) => d.porcentaje > 0).map((d, i) => (
                    <div key={i} className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Dto. producto ({d.porcentaje}%)</span><span className="font-semibold text-emerald-700 dark:text-emerald-400">-{fmt(d.subtotalSinDescuento - d.subtotalConDescuento)}</span></div>
                  ))}
                  {descuentosCalc.volumen.map((v, i) => (
                    <div key={i} className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Volumen: {v.nombre}</span><span className="font-semibold text-emerald-700 dark:text-emerald-400">-{fmt(v.descuento)}</span></div>
                  ))}
                  {descuentosCalc.cliente && (
                    <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Cliente ({descuentosCalc.cliente.porcentaje}%)</span><span className="font-semibold text-emerald-700 dark:text-emerald-400">-{fmt(descuentosCalc.cliente.descuento)}</span></div>
                  )}
                  {descuentosCalc.global && (
                    <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Descuento global</span><span className="font-semibold text-emerald-700 dark:text-emerald-400">-{fmt(descuentosCalc.global.descuento)}</span></div>
                  )}
                </div>
              )}
            </div> : (
              <p className="rounded-lg border border-dashed p-2 text-[11px] text-muted-foreground">
                Tu usuario no tiene el permiso <strong>«Aplicar descuento manual»</strong>. Las promociones y descuentos configurados (volumen, producto, cliente) se siguen aplicando solos.
              </p>
            ))}

            <div className="flex items-end justify-between">
              <span className="text-sm text-muted-foreground">{pedidoActivo ? 'Total del pedido' : 'Total'}</span>
              <div className="text-right">
                {descuentosCalc.totalDescuento > 0 && (
                  <span className="num text-sm text-muted-foreground line-through">{fmt(totalBruto)}</span>
                )}
                <span className="num text-3xl font-extrabold">{fmt(total)}</span>
                {descuentosCalc.totalDescuento > 0 && (
                  <p className="text-[11px] font-semibold text-emerald-600">Ahorro: {fmt(descuentosCalc.totalDescuento)}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <Button variant="outline" onClick={vaciarCarrito}>
                Vaciar
              </Button>
              <Button variant="secondary" onClick={pausarVenta} disabled={allItems.length === 0}>
                <Pause className="h-4 w-4" />
                Pausar
              </Button>
            {pedidoActivo ? (
              // Modo pedido: las acciones del carrito no aplican (el pedido se cotizó en otro lado).
              <>
                <Button variant="outline" onClick={soltarPedido} disabled={cobrando}>
                  Cancelar
                </Button>
                <Button className="col-span-2" onClick={cobrarPedido} disabled={cobrando || !resumen.puedeCobrar}>
                  {cobrando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {cobrando ? 'Cobrando…' : `Cobrar pedido ${fmt(total)}`}
                </Button>
              </>
            ) : tienePermiso('enviarACaja') && !tienePermiso('cobrarVenta') ? (
              <Button onClick={enviarACaja} disabled={allItems.length === 0 || cobrando || revisionDescuento.excede}>
                {cobrando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {cobrando ? 'Enviando…' : 'Enviar a caja'}
              </Button>
            ) : (
              <Button onClick={cobrar} disabled={allItems.length === 0 || cobrando || revisionDescuento.excede || (!pagoCredito && !resumen.puedeCobrar)}>
                {cobrando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {cobrando ? 'Procesando…' : 'Cobrar'}
              </Button>
            )}
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

      {/* Modal: plantillas de productos sin stock */}
      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setManualOpen(false)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="bg-primary px-5 py-4 text-center text-white">
              <p className="text-lg font-bold">Embalaje y Otros</p>
              <p className="text-sm opacity-90">Seleccioná un producto</p>
              <p className="mt-1 text-[11px] opacity-80">Se registran en la categoría VARIOS y no descuentan stock</p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5">
              {(cfg?.plantillasManuales ?? []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No hay plantillas configuradas.<br />
                  Pedile al admin que las cree en Configuración → Plantillas.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {(cfg!.plantillasManuales as { id: string; nombre: string; precio: number }[]).map((tmpl) => (
                    <button
                      key={tmpl.id}
                      onClick={() => {
                        const id = `tmpl-${tmpl.id}`
                        setManualItems((prev) => ({
                          ...prev,
                          [id]: { nombre: tmpl.nombre, precio: tmpl.precio, qty: (prev[id]?.qty ?? 0) + 1, afectacion: prev[id]?.afectacion ?? cfg?.tipoAfectacionManual ?? AFECTACION_POR_DEFECTO },
                        }))
                        setManualOpen(false)
                        setToast(`✅ ${tmpl.nombre} agregado`)
                      }}
                      className="flex flex-col items-center gap-1 rounded-xl border-2 border-border p-3 text-center transition-all hover:border-primary/50 hover:bg-accent cursor-pointer"
                    >
                      <span className="text-lg">📦</span>
                      <span className="w-full truncate text-xs font-semibold">{tmpl.nombre}</span>
                      <span className="text-xs font-bold text-primary">S/ {tmpl.precio.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              )}
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

      {/* QR modal: pantalla del cliente */}
      {qrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setQrOpen(false)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="brand-grad px-5 py-4 text-center text-white">
              <Monitor className="mx-auto mb-1 h-6 w-6" />
              <p className="text-lg font-bold">Pantalla del Cliente</p>
              <p className="text-xs opacity-80">Escaneá el QR con tu celular</p>
            </div>
            <div className="flex flex-col items-center gap-4 p-5">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="QR Pantalla Cliente" className="h-56 w-56 rounded-xl" />
              ) : (
                <div className="h-56 w-56 animate-pulse rounded-xl bg-muted" />
              )}
              <p className="text-center text-xs text-muted-foreground">
                Abrí la cámara del celular y escaneá el código para ver tu compra en tiempo real.
              </p>
              {displayUrlRef.current && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(displayUrlRef.current || '')
                    setToast('📋 URL copiada')
                  }}
                  className="text-xs font-semibold text-primary underline cursor-pointer"
                >
                  Copiar enlace
                </button>
              )}
              <Button onClick={() => setQrOpen(false)} className="w-full">Cerrar</Button>
            </div>
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
