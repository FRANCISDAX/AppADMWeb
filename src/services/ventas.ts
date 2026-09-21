import { collection, doc, increment, getDoc, getDocs, onSnapshot, query, runTransaction, updateDoc, where, limit, writeBatch } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { numeroALetras } from '@/lib/numero-a-letras'
import { CATEGORIA_MANUAL } from '@/lib/categorias'
import { AFECTACION_POR_DEFECTO } from '@/constants/tributario'
import { bolsillosDeVenta, formaPagoLabel, type PagoGuardado } from '@/lib/pagos'
import { CAMPO_CONTADOR, CLAVE_PEDIDO, claveContador, codigoPedido } from '@/lib/contadores'
import { limpiarUndefined } from '@/lib/limpio'
import { revisarDescuentoManual } from '@/lib/descuentos'
import { valorizacionDeMovimiento } from '@/services/kardex'
import { VENTANA_DUPLICADO_MINUTOS, esPedido, huellaPedido, pedidoDuplicado } from '@/lib/pedidos'
import { puntoEmisionDe } from '@/lib/sunat'
import { db } from '@/lib/firebase'
import { logActividad } from '@/lib/audit'
import { exigirRateLimit } from '@/lib/rate-limit'

// Precio efectivo de venta: usa el precio especial (promoción) si el item lo pidió
// (usarPrecioEspecial) y el producto tiene uno > 0; si no, el precio real.
const precioDe = (prod: any, item?: any) =>
  (item?.usarPrecioEspecial !== false && prod?.precioEspecial != null && prod.precioEspecial > 0)
    ? prod.precioEspecial
    : (prod?.precioVenta ?? 0)

export type VentaItem = {
  id: string
  nombre: string
  quantity: number
  precioVenta?: number
  categoria?: string
  tipoAfectacion?: string
  presentacionNombre?: string
  presentacionId?: string
  factorConversion?: number
  usarPrecioEspecial?: boolean
  manual?: boolean
  kitItems?: { productoId: string; cantidad: number }[]
}

export type EnvioData = {
  tipo: 'domicilio'
  direccion: string
  referencia?: string
  zonaId?: string
  costo: number
  notas?: string
  estado?: 'pendiente' | 'en_camino' | 'entregado' | 'cancelado'
}

export type VentaData = {
  tipoDoc: 'NV' | 'BOLETA' | 'FACTURA'
  tipoPago: 'efectivo' | 'transferencia' | 'credito' | 'mixto'
  /**
   * Formas de pago. `tipo` es el **bolsillo** (efectivo o transferencia: lo que
   * entienden el arqueo, los reportes y las anulaciones) y `medio` el detalle
   * (Yape, Plin, tarjeta…). Los montos son los **aplicados** y suman el total.
   * Los arma `lib/pagos.ts`.
   */
  pagos?: PagoGuardado[]
  total: number
  descuentoTotal?: number
  descuentoGlobalTipo?: 'porcentaje' | 'monto'
  descuentoGlobalValor?: number
  cliente_dni?: string
  cliente_nombre?: string
  cliente_direccion?: string
  referencia?: string
  montoRecibido?: number
  cambio?: number
  cajero: string
  usuarioId?: string
  turnoId?: string | null
  envio?: EnvioData
}

type Config = Record<string, any>

export async function registrarVenta({ items, venta, config }: { items: VentaItem[]; venta: VentaData; config: Config }): Promise<{ success: boolean; correlativo?: string; ventaId?: string; documento?: any; error?: string }> {
  const accionRL = venta.tipoDoc === 'NV' ? 'crear_venta' : venta.tipoDoc === 'BOLETA' ? 'emitir_boleta' : 'emitir_factura'
  exigirRateLimit(accionRL)

  const f = new Date()
  const anioMes = `${f.getFullYear()}-${f.getMonth() + 1}`
  const serie =
    venta.tipoDoc === 'NV' ? config.serie_prefijo || 'BB02' : venta.tipoDoc === 'BOLETA' ? config.serieBoleta || 'B001' : config.serieFactura || 'F001'
  const contId = venta.tipoDoc === 'NV' ? `notaVenta_${serie}` : `sunat_${serie}`
  const contRef = doc(db, COL.CONTADORES, contId)

  // SOLO LECTURA: detecta el máximo correlativo ya emitido por si el contador
  // aún no existe. La creación del contador se hace DENTRO de la transacción
  // (junto con la venta) para garantizar "o pasa todo, o no pasa nada" y evitar
  // escrituras huérfanas (contador creado sin venta) si la venta llegara a fallar.
  let maxExistente = 0
  try {
    const snap = await getDoc(contRef)
    // Si el contador ya existe no hace falta el cálculo; la transacción lo usará.
    if (!snap.exists()) {
      const docsSnap = await getDocs(query(collection(db, COL.DOCUMENTOS), where('tipoDoc', '==', venta.tipoDoc), where('serie', '==', serie)))
      docsSnap.forEach((d) => {
        const n = Number(d.data().numero ?? d.data().correlativo ?? 0)
        if (n > maxExistente) maxExistente = n
      })
    }
  } catch (e) {
    console.warn('⚠️ Lectura de correlativos existentes:', e)
  }

  try {
    const res = await runTransaction(db, async (tx) => {
      const contSnap = await tx.get(contRef)
      let nuevo: number
      if (contSnap.exists()) {
        nuevo = (contSnap.data().ultimoCorrelativo ?? 0) + 1
      } else {
        // Contador inexistente: se siembra ATOMÓMICAMENTE con la venta usando el
        // máximo correlativo ya emitido, para no dejar escrituras huérfanas.
        nuevo = maxExistente + 1
      }
      const corrStr = String(nuevo).padStart(6, '0')
      const serieNumero = `${serie}-${corrStr}`
      const ventaId = `V-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

      // Validar + leer productos (solo los que NO son manuales)
      // Los kits se descomponen en sus componentes para validar stock
      const prods: { item: VentaItem; prodRef: any; prod: any; stockActual: number; cantidad: number; kitComponente?: boolean }[] = []
      const manuales: VentaItem[] = []
      for (const item of items) {
        if (item.manual) {
          manuales.push(item)
          continue
        }
        // Si el item es un kit, descomponer en componentes
        if (item.kitItems && item.kitItems.length > 0) {
          for (const ki of item.kitItems) {
            const compRef = doc(db, COL.PRODUCTOS, ki.productoId)
            const compSnap = await tx.get(compRef)
            if (!compSnap.exists()) throw new Error(`Componente del kit no encontrado: ${ki.productoId}`)
            const comp = compSnap.data()
            const stockActual = comp.stock || 0
            const cantidad = ki.cantidad * item.quantity
            if (cantidad > stockActual) throw new Error(`Stock insuficiente en kit para ${comp.nombre || ki.productoId}: disponible ${stockActual}, solicitado ${cantidad}`)
            prods.push({ item, prodRef: compRef, prod: comp, stockActual, cantidad, kitComponente: true })
          }
          continue
        }
        const prodRef = doc(db, COL.PRODUCTOS, item.id)
        const prodSnap = await tx.get(prodRef)
        if (!prodSnap.exists()) throw new Error(`Producto no encontrado: ${item.nombre}`)
        const prod = prodSnap.data()
        const stockActual = prod.stock || 0
        const cantidad = item.quantity
        if (cantidad > stockActual) throw new Error(`Stock insuficiente para ${item.nombre}: disponible ${stockActual}, solicitado ${item.quantity}`)
        prods.push({ item, prodRef, prod, stockActual, cantidad })
      }

      // Leer el turno ANTES de cualquier escritura (regla de Firestore:
      // todos los reads deben completarse antes de ejecutar los writes)
      let turnoRef: any = null
      let turnoData: any = null
      if (venta.turnoId) {
        turnoRef = doc(db, COL.TURNOS, venta.turnoId)
        const turnoSnap = await tx.get(turnoRef)
        if (turnoSnap.exists()) {
          turnoData = turnoSnap.data()
        }
      }

      // Contador
      tx.set(contRef, { ultimoCorrelativo: nuevo, updatedAt: f.toISOString() }, { merge: true })

      // Stock + movimientos
      for (const { item, prodRef, prod, stockActual, cantidad, kitComponente } of prods) {
        const nuevoStock = stockActual - cantidad
        // Una venta es SALIDA: se valoriza **al costo promedio vigente** (no cambia el promedio) y
        // el movimiento del kardex queda valorizado (`lib/valorizacion.ts`).
        const valorizado = valorizacionDeMovimiento({
          tipoMovimiento: 'venta',
          cantidad,
          stockAntes: stockActual,
          stockNuevo: nuevoStock,
          producto: prod as { costoPromedio?: number | null; precioCompra?: number | null },
        })
        tx.update(prodRef, { stock: nuevoStock, vecesVendido: increment(1), ...valorizado.camposProducto, ultimaActualizacion: f.toISOString(), updatedAt: f.toISOString() })
        const movRef = doc(collection(db, COL.MOVIMIENTOS))
        tx.set(movRef, {
          productoId: kitComponente ? prod.id : item.id,
          productoCodigo: prod.codigo || (kitComponente ? prod.id : item.id),
          productoNombre: prod.nombre || item.nombre,
          tipoMovimiento: 'venta',
          cantidad,
          stockAnterior: stockActual,
          stockNuevo: nuevoStock,
          ...valorizado.camposMovimiento,
          usuario: venta.cajero || 'sistema',
          fecha: f.toISOString(),
          timestamp: Date.now(),
          presentacionUsada: item.presentacionNombre || 'Unidad',
          presentacionId: item.presentacionId || 'unidad',
          cantidadPresentacion: kitComponente ? cantidad : item.quantity,
          factorConversion: item.factorConversion || 1,
          metadata: { ventaId, documentoId: `${anioMes}_${venta.tipoDoc}-${serieNumero}`, ...(kitComponente ? { kitId: item.id, kitNombre: item.nombre } : {}) },
        })
      }

      // ===== Objeto venta (misma estructura que RN) =====
      const ventaItems = [
        ...prods.map(({ item, prod }) => ({
          id: item.id,
          nombre: item.nombre,
          precioVenta: precioDe(prod, item),
          cantidad: item.quantity,
          unidad: item.presentacionNombre || 'Un',
          presentacionId: item.presentacionId || 'unidad',
          factorConversion: item.factorConversion || 1,
          cantidadEnUnidadBase: item.quantity,
          subtotal: precioDe(prod, item) * item.quantity,
          categoria: prod.categoria || '',
          tipoAfectacion: prod.tipoAfectacion || '10',
        })),
        ...manuales.map((item) => ({
          id: item.id,
          nombre: item.nombre,
          precioVenta: item.precioVenta || 0,
          cantidad: item.quantity,
          unidad: item.presentacionNombre || 'Un',
          presentacionId: item.presentacionId || 'unidad',
          factorConversion: 1,
          cantidadEnUnidadBase: item.quantity,
          subtotal: (item.precioVenta || 0) * item.quantity,
          // Los items manuales no tienen producto del catálogo: se agrupan en
          // VARIOS para que no caigan en "Sin categoría" en los reportes.
          categoria: CATEGORIA_MANUAL,
          // ⚠️ Antes iba fijo en '10' (gravado) mientras todo el catálogo puede
          // estar exonerado ('20'): ese item sumaba 18% de IGV al comprobante y la
          // boleta declaraba MÁS de lo cobrado (pasó en la boleta B001-000057:
          // cobrado S/ 9.20, declarado S/ 9.56). Ahora la afectación de los items
          // manuales se configura en Configuración → SUNAT.
          // El item manual puede traer su propia afectación (embalaje); si no, la del negocio.
          tipoAfectacion: String(item.tipoAfectacion || config.tipoAfectacionManual || AFECTACION_POR_DEFECTO),
        })),
      ]
      const ventaBase = {
        id: String(Date.now()),
        fecha: f.toISOString(),
        items: ventaItems,
        total: venta.total,
        importe_total: venta.total,
        descuentoTotal: venta.descuentoTotal ?? 0,
        descuentoGlobalTipo: venta.descuentoGlobalTipo ?? null,
        descuentoGlobalValor: venta.descuentoGlobalValor ?? null,
        cliente_nombre: venta.cliente_nombre || '-',
        cliente_dni: venta.cliente_dni || '-',
        cliente_direccion: venta.cliente_direccion || '',
      }
      let ventaDoc: Record<string, any>
      if (venta.tipoPago === 'efectivo') {
        const monto = venta.montoRecibido ?? venta.total
        ventaDoc = { ...ventaBase, tipoPago: 'efectivo', forma_pago: 'Efectivo', efectivo: monto, montoRecibido: monto, cambio: Math.max(0, monto - venta.total) }
      } else if (venta.tipoPago === 'credito') {
        // El crédito es por el total de la venta y no se combina: `cobrado` arranca
        // en 0 porque TODAVÍA no pagó nada (es lo que lee el saldo del cliente).
        ventaDoc = { ...ventaBase, tipoPago: 'credito', forma_pago: 'Crédito', cobrado: 0 }
      } else if (venta.tipoPago === 'mixto') {
        // El desglose manda: acá no se inventa nada, lo arma `lib/pagos.ts`.
        ventaDoc = { ...ventaBase, tipoPago: 'mixto' }
      } else {
        ventaDoc = { ...ventaBase, tipoPago: 'transferencia', forma_pago: 'Transferencia', referencia: venta.referencia || '' }
      }
      ventaDoc = { ...ventaDoc, cajero: venta.cajero || 'sistema', serie_numero: serieNumero, sucursal: config.sucursal || '', mensaje: config.mensaje || '', son_letras: numeroALetras(venta.total), turnoId: venta.turnoId || '' }

      // Pago (puede ser múltiple). Si no viene `pagos`, se colapsa a un solo método.
      // `p.tipo` es el bolsillo: así el turno, el arqueo y los reportes siguen
      // sumando por efectivo/transferencia sin saber qué medio se usó.
      const pagos: PagoGuardado[] = venta.pagos && venta.pagos.length > 0
        ? venta.pagos
        : [{ tipo: (venta.tipoPago === 'mixto' ? 'efectivo' : venta.tipoPago) as PagoGuardado['tipo'], monto: venta.total }]
      // Reparto por bolsillo: regla única en `lib/pagos.ts`. Una venta a crédito
      // devuelve 0 y 0 (no deja plata en el cajón: queda por cobrar).
      const { efectivo: montoEfectivo, transferencia: montoTransferencia } = bolsillosDeVenta({ tipoPago: venta.tipoPago, pagos, total: venta.total })
      const tipoPagoFinal = pagos.length > 1 ? 'mixto' : pagos[0].tipo
      ventaDoc = {
        ...ventaDoc,
        pagos,
        tipoPago: tipoPagoFinal,
        // Con pago múltiple el rótulo viejo ("Transferencia") mentiría: se arma
        // desde los medios reales (Yape, Plin, tarjeta…).
        forma_pago: formaPagoLabel(pagos, tipoPagoFinal),
        efectivo: montoEfectivo,
        totalTransferenciaPago: montoTransferencia,
      }
      // Envío a domicilio
      if (venta.envio) {
        ventaDoc = { ...ventaDoc, envio: venta.envio }
      }
      // `montoRecibido` es lo que el cliente entregó en efectivo y `cambio` el
      // vuelto. Con pago múltiple lo calcula `lib/pagos.ts` (solo el efectivo
      // puede pagar de más); `efectivo` guarda el monto **aplicado**, que es lo
      // que tiene que entrar a la caja.
      ventaDoc = {
        ...ventaDoc,
        montoRecibido: venta.montoRecibido != null ? venta.montoRecibido : (ventaDoc.montoRecibido ?? montoEfectivo),
        cambio: venta.cambio != null ? venta.cambio : (ventaDoc.cambio ?? Math.max(0, (venta.montoRecibido ?? montoEfectivo) - montoEfectivo)),
      }

      // Documento
      const docId = `${anioMes}_${venta.tipoDoc}-${serieNumero}`
      const docRef = doc(db, COL.DOCUMENTOS, docId)
      const docData = {
        tipo: venta.tipoDoc,
        tipoDoc: venta.tipoDoc,
        serie,
        numero: nuevo,
        correlativo: nuevo,
        serieNumero,
        venta: ventaDoc,
        fecha: f.toISOString(),
        anio: f.getFullYear(),
        mes: f.getMonth() + 1,
        anioMes,
        createdAt: f.toISOString(),
        turnoId: venta.turnoId || '',
        usuarioId: venta.usuarioId || '',
        cajero: venta.cajero || '',
        vendedorId: venta.usuarioId || '',
        vendedorNombre: venta.cajero || '',
        ...(venta.tipoDoc !== 'NV' ? { sunat: { serie, numero: nuevo, puntoEmision: puntoEmisionDe(null, config), estado: 'pendiente' } } : {}),
      }
      tx.set(docRef, limpiarUndefined(docData))

      // Turno (escritura; el dato ya se leyó ANTES de escribir nada)
      if (turnoRef && turnoData) {
        // La venta que se guarda en el turno también va limpia: el item viaja dentro de un array
        // y Firestore rechaza igual cualquier `undefined` que se cuele.
        const nuevasVentas = [...(turnoData.ventasDelTurno || []), limpiarUndefined(ventaDoc)]
        tx.update(turnoRef, {
          ventasDelTurno: nuevasVentas,
          totalVentas: (turnoData.totalVentas || 0) + venta.total,
          totalEfectivo: (turnoData.totalEfectivo || 0) + montoEfectivo,
          totalTransferencia: (turnoData.totalTransferencia || 0) + montoTransferencia,
          // Ya no se acumula `vueltoTransferencia`: existía porque la transferencia
          // podía superar el total y el excedente se devolvía en efectivo. Con el
          // pago múltiple eso es imposible (los electrónicos no pueden pasarse),
          // así que el vuelto sale solo del efectivo (`montoRecibido − aplicado`).
          // Los turnos viejos conservan su valor y el arqueo lo sigue restando.
        })
      }

      return { success: true, correlativo: serieNumero, ventaId, documento: docData }
    })

    if (res.success) {
      logActividad({
        accion: venta.tipoDoc === 'NV' ? 'crear_nv' : venta.tipoDoc === 'BOLETA' ? 'emitir_boleta' : 'emitir_factura',
        entidad: COL.DOCUMENTOS,
        entidadId: res.ventaId || '',
        detalle: { tipoDoc: venta.tipoDoc, total: venta.total, cliente: venta.cliente_nombre },
      })

      // Actualizar ultimaCompra y totalCompras del cliente (si tiene DNI/RUC asociado)
      if (venta.cliente_dni && res.success) {
        try {
          const clienteRef = doc(db, COL.CLIENTES, venta.cliente_dni)
          const clienteSnap = await getDoc(clienteRef)
          if (clienteSnap.exists()) {
            const cd = clienteSnap.data() as Record<string, unknown>
            await updateDoc(clienteRef, {
              ultimaCompra: new Date().toISOString(),
              totalCompras: ((cd.totalCompras as number) || 0) + 1,
              montoTotal: ((cd.montoTotal as number) || 0) + (venta.total || 0),
            })
          }
        } catch (e) {
          console.warn('⚠️ No se pudo actualizar ultimaCompra del cliente:', e)
        }
      }
    }
    return res
  } catch (e) {
    const err = e as { code?: string; message?: string; name?: string }
    console.error('❌ Error en registrarVenta:', { code: err.code, name: err.name, message: err.message })
    const msg = err.message || 'Error en la transacción de venta'
    return { success: false, error: (err.code ? err.code + ': ' : '') + msg }
  }
}

// Anula un comprobante del día (NV, BOLETA o FACTURA no enviada a SUNAT).
// Revierte stock, marca el documento como anulada y ajusta la caja del turno.
export async function anularNotaVenta({ documentoId, motivo, usuario = 'sistema' }: { documentoId: string; motivo: string; usuario?: string }): Promise<{ success: boolean; error?: string }> {
  exigirRateLimit('anular_documento')
  const docRef = doc(db, COL.DOCUMENTOS, documentoId)
  try {
    const docSnap = await getDoc(docRef)
    if (!docSnap.exists()) return { success: false, error: 'Documento no encontrado' }
    const docData = docSnap.data()
    const tipo = docData.tipo || docData.tipoDoc
    const esNV = tipo === 'NV'
    const esElectronico = tipo === 'BOLETA' || tipo === 'FACTURA'
    if (!esNV && !esElectronico) return { success: false, error: 'Tipo de documento no anulable.' }
    if (docData.estado === 'anulada') return { success: false, error: 'Este documento ya fue anulado.' }
    if (docData.sunat?.consolidado) return { success: false, error: 'Este documento fue consolidado a SUNAT. No se puede anular.' }
    // Boletas/Facturas: solo se pueden anular directamente si NO fueron aceptadas por SUNAT
    if (esElectronico && docData.sunat?.estado === 'aceptado') return { success: false, error: 'Este comprobante ya fue aceptado por SUNAT. Emití una Nota de Crédito para anularlo.' }

    const f = new Date(docData.fecha || docData.createdAt || new Date())
    const hoy = new Date()
    const esDeHoy = f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth() && f.getDate() === hoy.getDate()
    if (!esDeHoy) return { success: false, error: 'Solo se pueden anular notas de venta del día actual.' }

    const venta = docData.venta || {}
    const items = (venta.items || []).filter((it: any) => it && it.id && !it.id.startsWith('manual-'))
    if (items.length === 0) return { success: false, error: 'La nota no tiene items para revertir stock.' }

    const res = await runTransaction(db, async (tx) => {
      // FASE 1: Todas las lecturas ANTES de cualquier escritura.
      const docActual = await tx.get(docRef)
      if (!docActual.exists()) throw new Error('Documento no encontrado')
      if (docActual.data().estado === 'anulada') throw new Error('Esta nota ya fue anulada')

      const turnoId = docData.turnoId || venta.turnoId || null
      const turnoRef = turnoId ? doc(db, COL.TURNOS, turnoId) : null
      const turnoSnap = turnoRef ? await tx.get(turnoRef) : null
      const turnoAbierto = !!(turnoSnap && turnoSnap.exists() && turnoSnap.data().estado === 'abierto')

      const prodLecturas: { item: any; prodRef: any; prodSnap: any }[] = []
      for (const item of items) {
        const prodRef = doc(db, COL.PRODUCTOS, item.id)
        const prodSnap = await tx.get(prodRef)
        if (!prodSnap.exists()) throw new Error(`Producto "${item.nombre}" no existe. No se puede anular.`)
        prodLecturas.push({ item, prodRef, prodSnap })
      }

      // FASE 2: Todas las escrituras.
      for (const { item, prodRef, prodSnap } of prodLecturas) {
        const prod = prodSnap.data()
        const stockActual = prod.stock || 0
        const factor = item.factorConversion || 1
        const cantidadBase = item.cantidadEnUnidadBase || item.cantidad * factor
        const nuevoStock = stockActual + cantidadBase
        // La anulación **devuelve** la mercadería: es una ENTRADA valorizada **al costo promedio
        // vigente** (sin costo explícito), así el promedio del producto no se mueve.
        const valorizado = valorizacionDeMovimiento({
          tipoMovimiento: 'anulacion_venta',
          cantidad: cantidadBase,
          stockAntes: stockActual,
          stockNuevo: nuevoStock,
          producto: prod,
        })
        tx.update(prodRef, { stock: nuevoStock, ...valorizado.camposProducto, ultimaActualizacion: new Date().toISOString(), updatedAt: new Date().toISOString() })
        const movRef = doc(collection(db, COL.MOVIMIENTOS))
        tx.set(movRef, {
          productoId: item.id,
          productoCodigo: prod.codigo || item.id,
          productoNombre: prod.nombre || item.nombre,
          tipoMovimiento: 'anulacion_venta',
          cantidad: cantidadBase,
          motivo: `Anulación de ${docData.serieNumero || documentoId}: ${motivo || 'sin motivo'}`,
          stockAnterior: stockActual,
          stockNuevo: nuevoStock,
          ...valorizado.camposMovimiento,
          usuario,
          metadata: { ventaId: venta.id, documentoId },
          fecha: new Date().toISOString(),
          timestamp: Date.now(),
        })
      }

      // Marcar el documento como anulada (no se borra)
      tx.set(docRef, {
        ...docData,
        estado: 'anulada',
        anulacion: { fecha: new Date().toISOString(), usuario, motivo, documentoAnuladoRef: documentoId },
        updatedAt: new Date().toISOString(),
      })

      // Ajustar caja del turno
      if (turnoRef && turnoSnap && turnoSnap.exists()) {
        const td = turnoSnap.data()
        const monto = venta.total || 0
        // Desglose real del cobro, con la MISMA regla que el alta (`lib/pagos.ts`).
        // Antes se usaba `venta.tipoPago === 'efectivo'` a secas (en una venta MIXTA
        // daba 0 y 0) y después `bolsilloDe`, que ante un medio desconocido devolvía
        // efectivo: una venta a CRÉDITO se restaba del efectivo que nunca había
        // sumado. `bolsillosDeVenta` deja el crédito fuera de los dos bolsillos.
        const pagosAnulados: PagoGuardado[] = Array.isArray(venta.pagos) && venta.pagos.length > 0
          ? venta.pagos
          : [{ tipo: venta.tipoPago === 'efectivo' ? 'efectivo' : venta.tipoPago === 'transferencia' ? 'transferencia' : 'credito', monto } as PagoGuardado]
        const { efectivo: anuladoEfectivo, transferencia: anuladoTransferencia } = bolsillosDeVenta({ tipoPago: venta.tipoPago, pagos: pagosAnulados, total: monto })
        const nuevasVentas = (td.ventasDelTurno || []).map((v: any) => (v.id === venta.id ? { ...v, estado: 'anulada', anulacion: { fecha: new Date().toISOString(), usuario, motivo } } : v))
        const update: Record<string, any> = { ventasDelTurno: nuevasVentas }
        if (turnoAbierto) {
          update.totalVentas = Math.max(0, (td.totalVentas || 0) - monto)
          update.totalEfectivo = Math.max(0, (td.totalEfectivo || 0) - anuladoEfectivo)
          update.totalTransferencia = Math.max(0, (td.totalTransferencia || 0) - anuladoTransferencia)
        } else {
          update.totalAnulado = (td.totalAnulado || 0) + monto
          update.totalAnuladoEfectivo = (td.totalAnuladoEfectivo || 0) + anuladoEfectivo
          update.totalAnuladoTransferencia = (td.totalAnuladoTransferencia || 0) + anuladoTransferencia
        }
        tx.update(turnoRef, update)
      }

      return { success: true }
    })

    if (res.success) {
      logActividad({
        accion: 'anular_documento',
        entidad: COL.DOCUMENTOS,
        entidadId: documentoId,
        detalle: { motivo },
      })
    }
    return res
  } catch (e) {
    console.error('❌ Error anulando nota de venta:', e)
    return { success: false, error: (e as Error).message }
  }
}

// ─── Venta pendiente (flujo vendedor → cajero) ─────────────────────────────

export type DocumentoVenta = {
  id: string
  tipo: 'NV' | 'BOLETA' | 'FACTURA'
  serie: string
  numero: number
  serieNumero: string
  fecha: string
  anio: number
  mes: number
  anioMes: string
  estado?: 'anulada' | 'pendiente' | 'pagado' | 'cancelado'
  vendedorId?: string
  vendedorNombre?: string
  cajaId?: string
  cajeroId?: string
  fechaCobro?: string
  motivoCancelacion?: string
  turnoId?: string
  usuarioId?: string
  cajero?: string
  venta?: Record<string, unknown>
  sunat?: { estado: string }
  anulacion?: Record<string, unknown>
  [k: string]: unknown
}

/**
 * Crea **un pedido**: la venta que el vendedor manda a caja, todavía **sin comprobante**.
 *
 * El pedido no es una NV, ni una boleta, ni una factura: no tiene serie ni correlativo (lleva un
 * código propio, `PED-000123`), tampoco forma de pago — todo eso lo define el cajero al cobrarlo
 * (`cobrarVentaPendiente`), que es cuando **se genera el comprobante**. Por eso acá no se pide
 * `tipoDoc` ni `tipoPago`.
 *
 * ⚠️ **No toca el stock**: el inventario se descuenta recién al cobrar, en un solo lugar
 * (`cobrarVentaPendiente`). Un pedido es un ticket en espera, no una reserva: si nadie lo cobra
 * —o el cajero lo elimina— el inventario queda intacto y no hay nada que devolver.
 */
export async function crearVentaPendiente({
  items,
  venta,
  config,
  vendedorId,
  vendedorNombre,
  cajaId,
  permitirDuplicado = false,
}: {
  items: VentaItem[]
  venta: Omit<VentaData, 'tipoDoc' | 'tipoPago'>
  config: Config
  vendedorId: string
  vendedorNombre: string
  cajaId?: string
  /**
   * `true` cuando el vendedor **confirmó** que quiere enviar otra vez la misma venta (venta
   * distinta con los mismos productos). Sin esto, un pedido idéntico y pendiente del mismo
   * vendedor dentro de `VENTANA_DUPLICADO_MINUTOS` se rechaza con el código del pedido existente.
   */
  permitirDuplicado?: boolean
}): Promise<{ success: boolean; correlativo?: string; documento?: DocumentoVenta; error?: string; duplicado?: boolean; codigoPedido?: string }> {
  try {
    if (!items.length) return { success: false, error: 'No hay items para vender' }
    if (!venta.usuarioId) return { success: false, error: 'Falta usuarioId' }

    // 🔑 **Segunda capa contra el pedido duplicado** (la primera es el aviso del PDV): si el mismo
    // vendedor ya mandó esta misma venta y ese pedido sigue pendiente, no se crea otro. Caso real
    // (18/09/2026): un reenvío dejaba dos pedidos idénticos (`PED-000123` y `PED-000124`), el cajero
    // cobraba uno y el otro quedaba colgado para siempre en su lista.
    const huella = huellaPedido({ vendedorId, items, total: venta.total })
    if (!permitirDuplicado) {
      try {
        const repetido = pedidoDuplicado(await obtenerVentasPendientes(), { vendedorId, huella })
        if (repetido) {
          return {
            success: false,
            duplicado: true,
            codigoPedido: repetido.serieNumero || repetido.id || '',
            error: `Este pedido ya fue enviado a caja (${repetido.serieNumero || repetido.id}) hace menos de ${VENTANA_DUPLICADO_MINUTOS} minutos.`,
          }
        }
      } catch (e) {
        // La comprobación es una ayuda, no un candado: si la consulta falla, el pedido se crea igual.
        console.warn('⚠️ No se pudo verificar si el pedido estaba duplicado:', e)
      }
    }

    // Tope del **descuento manual** (`config.descuentoMaximoPorcentaje`, 0 = sin tope): segunda
    // capa de la regla de `lib/descuentos.ts` (la primera es la UI del PDV). No mira las
    // promociones automáticas, que son configuración del negocio.
    const tope = Number((config as Record<string, unknown>).descuentoMaximoPorcentaje) || 0
    const valorDesc = Number(venta.descuentoGlobalValor) || 0
    if (tope > 0 && valorDesc > 0) {
      // Base del descuento global: el total (ya neto) más lo que restó el propio descuento.
      const aplicado = venta.descuentoGlobalTipo === 'porcentaje'
        ? (venta.total * valorDesc) / Math.max(1, 100 - valorDesc)
        : valorDesc
      const revision = revisarDescuentoManual({
        tipo: venta.descuentoGlobalTipo === 'porcentaje' ? 'porcentaje' : 'monto',
        valor: valorDesc,
        subtotal: venta.total + aplicado,
        topePorcentaje: tope,
      })
      if (revision.excede) return { success: false, error: revision.mensaje }
    }

    const f = new Date()
    const anioMes = `${f.getFullYear()}-${f.getMonth() + 1}`

    // ⚠️ **Un pedido NO es un comprobante**: acá no se asigna serie ni correlativo fiscal
    // (eso pasa recién al cobrar, cuando el cajero elige NV/Boleta/Factura). Así el número
    // de comprobante se genera una sola vez y no quedan huecos en las series fiscales si la
    // venta se elimina. El pedido lleva un código propio (`PED-000123`) de un contador
    // aparte, que nunca choca con las series de SUNAT.
    const pedidoRef = doc(db, COL.CONTADORES, CLAVE_PEDIDO)


    // Contador del pedido + documento, en una transacción (nada queda a medias). El stock **no**
    // se toca: se descuenta al cobrar.
    const guardada = await runTransaction(db, async (tx) => {
      const pedidoSnap = await tx.get(pedidoRef)
      const numeroPedido = Number(pedidoSnap.data()?.[CAMPO_CONTADOR] ?? 0) + 1
      const codigo = codigoPedido(numeroPedido)
      const docId = `${anioMes}_${codigo}`

      const ventaDoc = {
        id: '',
        fecha: f.toISOString(),
        items: items.map((it) => ({
          ...it,
          precioVenta: it.precioVenta ?? 0,
        })),
        total: venta.total,
        // ⚠️ **`venta.total` YA viene neto de descuentos** (es `descuentosCalc.totalFinal` del PDV):
        // volver a restar `descuentoTotal` acá dejaba el `importe_total` del pedido por debajo del
        // total real, y el ticket imprimía un TOTAL y un "Son: …" distintos de lo que se cobraba
        // (el cobro usa `venta.total`). Igual que `registrarVenta`, el importe es el total.
        importe_total: venta.total,
        descuento_total: venta.descuentoTotal || 0,
        // 🔑 **El descuento viaja también en camelCase** (`descuentoTotal`), que es como lo leen
        // el comprobante (`lib/pdf.ts`) y el XML de SUNAT (`lib/sunat.ts`): con solo
        // `descuento_total` el pedido llegaba a caja **sin descuento declarado**, así que el
        // comprobante sumaba las líneas a precio de lista (2.20) contra un TOTAL ya descontado
        // (2.00) y no imprimía ninguna fila de descuento que lo explicara. Un pedido y una venta
        // directa tienen que declarar el descuento igual.
        descuentoTotal: venta.descuentoTotal || 0,
        // ⚠️ `undefined` NO es un valor válido para Firestore (tira *"Unsupported field value:
        // undefined"*): los opcionales van en `null` y lo que puede faltar (el envío) se agrega
        // con spread condicional. Esto es lo que hacía fallar **siempre** el envío a caja.
        descuento_global_tipo: venta.descuentoGlobalTipo ?? null,
        descuento_global_valor: venta.descuentoGlobalValor ?? null,
        // El pago lo define el cajero al cobrar: el pedido nace sin forma de pago.
        tipoPago: '',
        forma_pago: '',
        pagos: [],
        efectivo: 0,
        totalTransferenciaPago: 0,
        cliente_nombre: venta.cliente_nombre || '',
        cliente_dni: venta.cliente_dni || '',
        cliente_direccion: venta.cliente_direccion || '',
        montoRecibido: 0,
        cambio: 0,
        // Todavía nadie cobró (eso lo hace el cajero) y el vendedor va en su propio campo: si se
        // escribiera al vendedor en `cajero`, el comprobante diría que él cobró la venta.
        vendedor: vendedorNombre,
        cajero: '',
        serie_numero: codigo,
        sucursal: (config as Record<string, unknown>).sucursal || 'Casa Matriz',
        mensaje: (config as Record<string, unknown>).mensajeLegal || '',
        son_letras: numeroALetras(venta.total),
        turnoId: '',
        ...(venta.envio ? { envio: venta.envio } : {}),
      }

      const docData = {
        // `PENDIENTE` a propósito: todavía no es NV, boleta ni factura (lo elige el cajero),
        // así tampoco aparece en los reportes fiscales por tipo de documento.
        tipo: 'PENDIENTE',
        tipoDoc: 'PENDIENTE',
        serie: '',
        numero: 0,
        correlativo: 0,
        serieNumero: codigo,
        venta: ventaDoc,
        fecha: f.toISOString(),
        anio: f.getFullYear(),
        mes: f.getMonth() + 1,
        anioMes,
        createdAt: f.toISOString(),
        turnoId: '',
        usuarioId: venta.usuarioId || '',
        // El pedido no tiene cajero todavía: `cajero` se llena recién al cobrar.
        cajero: '',
        estado: 'pendiente' as const,
        vendedorId,
        vendedorNombre,
        cajaId: cajaId || '',
        // Huella de la venta: permite reconocer un reenvío del mismo pedido (`lib/pedidos.ts`).
        // Los pedidos creados antes de esta regla no la tienen y se comparan recalculándola.
        huella,
        // Queda constancia de que el vendedor confirmó un envío idéntico al anterior.
        ...(permitirDuplicado ? { duplicadoConfirmado: true } : {}),
      }

      tx.set(pedidoRef, { [CAMPO_CONTADOR]: numeroPedido, updatedAt: f.toISOString() }, { merge: true })
      // `limpiarUndefined` es la red de seguridad: Firestore rechaza `undefined` y TypeScript no
      // lo detecta (los campos opcionales compilan igual). Sin esto, un campo que se cuele deja
      // la venta sin poder enviarse.
      tx.set(doc(db, COL.DOCUMENTOS, docId), limpiarUndefined(docData))
      return { docId, docData: docData as unknown as DocumentoVenta }
    })
    const { docId, docData } = guardada

    logActividad({
      accion: 'crear_venta_pendiente',
      entidad: COL.DOCUMENTOS,
      entidadId: docId,
      detalle: { vendedor: vendedorNombre, items: items.length, total: venta.total },
    })

    return { success: true, correlativo: docData.serieNumero, documento: { ...docData, id: docId } as DocumentoVenta }
  } catch (e) {
    console.error('❌ Error creando venta pendiente:', e)
    return { success: false, error: (e as Error).message }
  }
}

/** Lee un documento de venta por id (para imprimir el comprobante recién emitido). */
export async function obtenerDocumento(id: string): Promise<Record<string, unknown> | null> {
  if (!id) return null
  try {
    const snap = await getDoc(doc(db, COL.DOCUMENTOS, id))
    return snap.exists() ? ({ ...snap.data(), id: snap.id } as Record<string, unknown>) : null
  } catch (e) {
    console.error('❌ Error leyendo el documento:', e)
    return null
  }
}

/**
 * Pedidos esperando cobro (**todos**, sin filtrar por caja).
 *
 * El reparto por caja lo decide **`repartirPedidos()`** (`lib/pedidos.ts`, puro y testeado), no la
 * consulta: filtrar en Firestore dejó la lista ciega dos veces (un cajero **sin caja** veía todo
 * vacío, y un pedido de un vendedor **sin** caja no lo veía nadie aunque el cajero tuviera la
 * suya). Acá se traen los ≤50 pendientes y quien consulta decide qué atiende y qué rescata.
 */
export async function obtenerVentasPendientes(): Promise<DocumentoVenta[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COL.DOCUMENTOS), where('estado', '==', 'pendiente'), limit(50)),
    )
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as unknown as DocumentoVenta)
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
  } catch (e) {
    console.error('❌ Error obteniendo ventas pendientes:', e)
    return []
  }
}

/**
 * Pedidos de un mes **en cualquier estado** (pendientes, cobrados y eliminados), para el listado de
 * `Reportes → Pedidos`.
 *
 * 🔑 **Sin índice compuesto**: se consulta por una sola igualdad (`anioMes`) y el filtro de "esto
 * es un pedido" se hace en JavaScript con `esPedido()` (`lib/pedidos.ts`), que reconoce tanto el
 * `tipoDoc: 'PENDIENTE'` como el campo `pedido` que sobrevive al cobro. Ordenar por fecha en la
 * consulta exigiría un índice compuesto (igualdad + orderBy) y no hace falta: se ordena acá.
 *
 * ⚠️ El límite es alto a propósito (un mes de operación real son unos cientos de documentos); si el
 * negocio crece mucho, conviene paginar por `fecha` en vez de subir el límite.
 */
export async function obtenerPedidosDelMes(anioMes: string): Promise<DocumentoVenta[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COL.DOCUMENTOS), where('anioMes', '==', anioMes), limit(500)),
    )
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as unknown as DocumentoVenta)
      .filter((d) => esPedido(d as unknown as Parameters<typeof esPedido>[0]))
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
  } catch (e) {
    console.error('❌ Error obteniendo los pedidos del mes:', e)
    return []
  }
}

/**
 * Escucha los pedidos pendientes **en tiempo real** (`onSnapshot`) y avisa en cada cambio.
 * Devuelve la función para dejar de escuchar.
 *
 * 🔑 **Por qué en vivo y no cada 30 segundos**: un pedido cobrado o eliminado —acá o desde otra
 * caja— **sale de la lista al instante**. Con el refresco periódico quedaba a la vista hasta medio
 * minuto *pareciendo pendiente*, que es justo lo que confundía al cajero ("ya lo cobré y sigue
 * apareciendo"). Además sale más barato: un sondeo cada 30 s relee los 50 documentos en cada
 * terminal, mientras que el canal en vivo sólo transmite los cambios.
 *
 * La consulta es la misma que la del listado (igualdad sola + límite ⇒ **sin índice compuesto**),
 * así que el panel nunca queda ciego por configuración de caja.
 */
export function suscribirVentasPendientes(
  onCambio: (ventas: DocumentoVenta[]) => void,
  onError?: (e: unknown) => void,
): () => void {
  const q = query(collection(db, COL.DOCUMENTOS), where('estado', '==', 'pendiente'), limit(50))
  return onSnapshot(
    q,
    (snap) => {
      const lista = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as unknown as DocumentoVenta)
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
      onCambio(lista)
    },
    (e) => {
      console.error('❌ Error escuchando los pedidos pendientes:', e)
      onError?.(e)
    },
  )
}

/**
 * **Transfiere los pedidos abiertos** de una caja a otra (caso: la caja 2 se cae y sus vendedores y
 * su cajero pasan a la caja 1). Se usa desde `Configuración → Cajas`.
 *
 * ⚠️ **Es seguro**: el `cajaId` de un pedido es solo la etiqueta de **ruteo** — las series fiscales
 * las pone la caja que cobra (`cobrarVentaPendiente`), así que mover el pedido no toca series,
 * correlativos ni plata. Devuelve **cuántos movió de verdad** (nunca 0 por un fallo parcial).
 */
export async function moverPedidosDeCaja({
  origen,
  destino,
  usuario,
}: {
  origen: string
  destino: string
  usuario?: string
}): Promise<{ success: boolean; movidos: number; error?: string }> {
  try {
    if (!origen || !destino) return { success: false, movidos: 0, error: 'Elegí las dos cajas' }
    if (origen === destino) return { success: false, movidos: 0, error: 'Las cajas son la misma' }

    const snap = await getDocs(
      query(collection(db, COL.DOCUMENTOS), where('estado', '==', 'pendiente'), limit(500)),
    )
    const mover = snap.docs.filter((d) => (d.data().cajaId || '') === origen)
    if (mover.length === 0) return { success: true, movidos: 0 }

    for (let i = 0; i < mover.length; i += 500) {
      const lote = writeBatch(db)
      for (const d of mover.slice(i, i + 500)) {
        lote.update(d.ref, { cajaId: destino, updatedAt: new Date().toISOString() })
      }
      await lote.commit()
    }

    logActividad({
      accion: 'mover_pedidos_caja',
      entidad: COL.DOCUMENTOS,
      entidadId: origen,
      detalle: { origen, destino, movidos: mover.length, usuario },
    })
    return { success: true, movidos: mover.length }
  } catch (e) {
    console.error('❌ Error moviendo pedidos de caja:', e)
    return { success: false, movidos: 0, error: (e as Error).message }
  }
}

/**
 * Cobra un pedido: **acá se genera el comprobante** (asigna serie y correlativo del tipo que
 * eligió el cajero), se registra el cobro en el turno y el pedido queda `pagado`.
 *
 * La salida de stock ya ocurrió al enviar el pedido a caja (reserva `venta_pendiente`): esos
 * movimientos se convierten en `venta` — **no** se descuenta dos veces.
 */
export async function cobrarVentaPendiente({
  documentoId,
  turnoId,
  pagos,
  tipoPago,
  montoRecibido,
  cambio,
  cajeroId,
  cajeroNombre,
  tipoDoc,
  config,
  cajaId,
}: {
  documentoId: string
  turnoId: string
  pagos?: PagoGuardado[]
  tipoPago: 'efectivo' | 'transferencia' | 'credito' | 'mixto'
  montoRecibido?: number
  cambio?: number
  cajeroId: string
  cajeroNombre: string
  tipoDoc?: 'NV' | 'BOLETA' | 'FACTURA'
  config?: Config
  /** Caja **que emite** (la del cajero). Queda registrada en el documento cobrado. */
  cajaId?: string
}): Promise<{ success: boolean; error?: string; correlativo?: string }> {
  try {
    // 🔑 **El comprobante se numera ACÁ, recién al cobrar**: el pedido nace sin serie ni
    // correlativo (solo con un código `PED-…`), porque el vendedor no sabe si será NV, boleta
    // o factura. Así el número se emite una única vez y eliminar un pedido **no deja huecos
    // en las series fiscales** (antes la pendiente consumía un correlativo al crearse).
    // La serie destino sale del tipo que eligió el cajero y el número del contador de **ese**
    // espacio vía `claveContador` (una NV nunca comparte contador con una boleta).
    const previo = await getDoc(doc(db, COL.DOCUMENTOS, documentoId))
    if (!previo.exists()) return { success: false, error: 'Documento no encontrado' }
    const tipoPrevio = previo.data()?.tipo as string | undefined
    const tipoFinal: 'NV' | 'BOLETA' | 'FACTURA' =
      tipoDoc ?? (tipoPrevio === 'BOLETA' || tipoPrevio === 'FACTURA' ? tipoPrevio : 'NV')
    const serieDestino =
      tipoFinal === 'NV'
        ? config?.serie_prefijo || 'BB02'
        : tipoFinal === 'BOLETA' ? config?.serieBoleta || 'B001' : config?.serieFactura || 'F001'
    const contadorDestino = doc(db, COL.CONTADORES, claveContador(tipoFinal, serieDestino))

    // SOLO LECTURA: máximo ya emitido por si el contador todavía no existe (se siembra desde
    // ahí dentro de la transacción, junto con el cobro, para no dejar contadores huérfanos).
    let maxDestino = 0
    try {
      const snap = await getDoc(contadorDestino)
      if (!snap.exists()) {
        const previos = await getDocs(
          query(collection(db, COL.DOCUMENTOS), where('tipoDoc', '==', tipoFinal), where('serie', '==', serieDestino))
        )
        previos.forEach((d) => {
          const n = Number(d.data().numero ?? d.data().correlativo ?? 0)
          if (n > maxDestino) maxDestino = n
        })
      }
    } catch (e) {
      console.warn('⚠️ Lectura del contador destino:', e)
    }

    const res = await runTransaction(db, async (tx) => {
      const docRef = doc(db, COL.DOCUMENTOS, documentoId)
      const docSnap = await tx.get(docRef)
      if (!docSnap.exists()) return { success: false, error: 'Documento no encontrado' }
      const docData = docSnap.data() as DocumentoVenta
      if (docData.estado !== 'pendiente') return { success: false, error: 'La venta ya no está pendiente' }

      const items = (docData.venta as Record<string, unknown>)?.items as VentaItem[] | undefined
      if (!items?.length) return { success: false, error: 'Documento sin items' }

      // ⚠️ **Firestore exige TODAS las lecturas antes de cualquier escritura.** Antes esta
      // transacción leía el turno (y el contador) DESPUÉS de descontar stock, así que
      // cobrar una venta pendiente fallaba siempre con "transactions require all reads to
      // be executed before all writes". Acá se lee todo primero y recién después se escribe.
      const turnoRef = turnoId ? doc(db, COL.TURNOS, turnoId) : null
      const turnoSnap = turnoRef ? await tx.get(turnoRef) : null
      const contSnapDestino = await tx.get(contadorDestino)

      // 🔑 **Acá y solo acá se descuenta el stock de un pedido.** El pedido no reservó nada, así
      // que el cobro lee el stock actual de cada producto y lo descuenta con el formato del
      // kardex (`tipoMovimiento` + `cantidad` positiva; el signo lo decide `esEntrada`).
      // Un solo camino de escritura ⇒ no puede haber doble descuento ni descuento faltante.
      const stockPrevio = new Map<string, number | null>()
      // El costo de cada producto se lee **acá**, antes de cualquier escritura (Firestore lo exige):
      // el cobro tiene que valorizar la salida al costo promedio vigente.
      const costoPrevio = new Map<string, { costoPromedio?: number | null; precioCompra?: number | null }>()
      for (const it of items) {
        if (it.manual) continue
        const ids = it.kitItems?.length ? it.kitItems.map((k) => k.productoId) : [it.id]
        for (const id of ids) {
          if (stockPrevio.has(id)) continue
          const s = await tx.get(doc(db, COL.PRODUCTOS, id))
          const d = s.exists() ? s.data() : null
          stockPrevio.set(id, d ? (d.stock ?? 0) : null)
          if (d) costoPrevio.set(id, { costoPromedio: d.costoPromedio ?? null, precioCompra: d.precioCompra ?? null })
        }
      }

      // ─── ESCRITURAS ───
      // Marcar como pagado
      const f = new Date()

      // 🔑 Serie y correlativo se asignan **una sola vez, acá**: el pedido no tiene número.
      const nuevo = contSnapDestino.exists()
        ? Number(contSnapDestino.data()?.[CAMPO_CONTADOR] ?? 0) + 1
        : maxDestino + 1
      const tipoDocFinal: string = tipoFinal
      const serieFinal = serieDestino
      const numeroFinal = nuevo
      const serieNumeroFinal = `${serieDestino}-${String(nuevo).padStart(6, '0')}`
      tx.set(contadorDestino, { serie: serieDestino, [CAMPO_CONTADOR]: nuevo, updatedAt: f.toISOString() }, { merge: true })

      for (const it of items) {
        if (it.manual) continue
        const partes = it.kitItems?.length
          ? it.kitItems.map((k) => ({ id: k.productoId, cantidad: k.cantidad * it.quantity }))
          : [{ id: it.id, cantidad: it.quantity }]
        for (const parte of partes) {
          const stockActual = stockPrevio.get(parte.id)
          if (stockActual == null) continue
          // El pedido estuvo esperando en caja: si otro vendió esas unidades, el cajero tiene que
          // enterarse (antes de cobrar) en vez de que el inventario quede mintiendo.
          if (stockActual < parte.cantidad) {
            throw new Error(
              `El stock de ${it.nombre} se agotó mientras el pedido esperaba en caja: disponible ${stockActual}, pedido ${parte.cantidad}.`,
            )
          }
          const stockNuevo = stockActual - parte.cantidad
          // El cobro de un pedido es una SALIDA más: se valoriza al costo promedio vigente, con la
          // misma regla que una venta directa (un solo camino de valorización).
          const valorizado = valorizacionDeMovimiento({
            tipoMovimiento: 'venta',
            cantidad: parte.cantidad,
            stockAntes: stockActual,
            stockNuevo,
            producto: costoPrevio.get(parte.id),
          })
          tx.update(doc(db, COL.PRODUCTOS, parte.id), {
            stock: stockNuevo,
            // Igual que una venta normal: si no, un cobro de pedido no cuenta en "más vendidos".
            vecesVendido: increment(1),
            ...valorizado.camposProducto,
            ultimaActualizacion: f.toISOString(),
            updatedAt: f.toISOString(),
          })
          tx.set(doc(collection(db, COL.MOVIMIENTOS)), {
            productoId: parte.id,
            productoNombre: it.nombre,
            tipoMovimiento: 'venta',
            cantidad: parte.cantidad,
            stockAnterior: stockActual,
            stockNuevo,
            ...valorizado.camposMovimiento,
            factorConversion: it.factorConversion || 1,
            presentacionUsada: it.presentacionNombre || 'Unidad',
            cantidadPresentacion: parte.cantidad,
            fecha: f.toISOString(),
            timestamp: f.getTime(),
            documentoRef: documentoId,
            serieNumero: serieNumeroFinal,
            usuario: cajeroNombre,
          })
        }
      }

      // Actualizar turno: los bolsillos salen del **pago real** del cajero (regla única), no
      // de los campos guardados al crear la venta pendiente (sin cobro venían en 0 y la caja
      // quedaba corta al cerrar).
      const totalVenta = Number((docData.venta as Record<string, unknown>)?.total || 0)
      const bolsillos = bolsillosDeVenta({ tipoPago, pagos, total: totalVenta })
      if (turnoRef && turnoSnap?.exists()) {
        const td = turnoSnap.data()
        tx.update(turnoRef, {
          totalVentas: (td.totalVentas || 0) + totalVenta,
          totalEfectivo: (td.totalEfectivo || 0) + bolsillos.efectivo,
          totalTransferencia: (td.totalTransferencia || 0) + bolsillos.transferencia,
          ventasDelTurno: [...(td.ventasDelTurno || []), {
            // Mismo formato que una venta normal (`ventaDoc`) para que el arqueo, el desglose
            // por origen y los reportes la lean igual.
            ...((docData.venta || {}) as Record<string, unknown>),
            pagos: pagos || [],
            tipoPago,
            forma_pago: formaPagoLabel(pagos || [], tipoPago),
            efectivo: bolsillos.efectivo,
            totalTransferenciaPago: bolsillos.transferencia,
            serie_numero: serieNumeroFinal,
            cajero: cajeroNombre,
            turnoId: turnoId || '',
            vendedorId: docData.vendedorId || '',
            vendedorNombre: docData.vendedorNombre || '',
            cobradaPorCajero: true,
          }],
        })
      }

      tx.update(docRef, limpiarUndefined({
        estado: 'pagado',
        cajeroId,
        cajero: cajeroNombre,
        // 🔑 **La venta queda a nombre de quien la COBRÓ**, igual que en una venta directa: los
        // reportes filtran por `usuarioId` (cada usuario ve lo suyo si no tiene `verTodo`), así que
        // si el pedido conservaba el `usuarioId` del vendedor, el cajero **no veía en Reportes** la
        // NV/boleta que acababa de emitir. El vendedor no pierde nada: sigue en `vendedorId` /
        // `vendedorNombre`, y `VentasPorEmpleado` usa `vendedorId || usuarioId`.
        usuarioId: cajeroId,
        // La caja que **emitió** el comprobante es la del cajero, no la del pedido: si el pedido
        // se rescató desde otra caja (la suya estaba caída), el dato tiene que decir la verdad.
        ...(cajaId ? { cajaId } : {}),
        fechaCobro: f.toISOString(),
        turnoId: turnoId || '',
        tipo: tipoDocFinal,
        tipoDoc: tipoDocFinal,
        serie: serieFinal,
        numero: numeroFinal,
        correlativo: numeroFinal,
        serieNumero: serieNumeroFinal,
        // El código `PED-…` con el que el vendedor mandó la venta a caja queda guardado: sirve
        // para rastrear el pedido original ahora que `serieNumero` es el comprobante real.
        pedido: typeof docData.serieNumero === 'string' ? docData.serieNumero : '',
        // ⚠️ El bloque `sunat` tiene que seguir al comprobante real: si el cajero cambió el
        // tipo, el envío a SUNAT usaría la serie/numero viejos (el XML declararía un número
        // distinto al emitido). Y si pasó a NV, **no debe existir** (una NV no va a SUNAT).
        ...(tipoDocFinal !== 'NV'
          ? {
              sunat: {
                ...((docData.sunat || {}) as Record<string, unknown>),
                serie: serieFinal,
                numero: numeroFinal,
                puntoEmision: puntoEmisionDe(null, config || ({} as Config)),
                estado: 'pendiente',
              },
            }
          : { sunat: null }),
        // La venta queda con las DOS personas identificadas: quién la armó (`vendedor`, del
        // pedido) y quién la cobró (`cajero`, este cobro). Antes `venta.cajero` guardaba al
        // vendedor y el comprobante lo imprimía como si hubiera cobrado él.
        venta: {
          ...((docData.venta || {}) as Record<string, unknown>),
          vendedor: docData.vendedorNombre || (docData.venta as Record<string, unknown>)?.vendedor || '',
          cajero: cajeroNombre,
          tipoPago,
          forma_pago: formaPagoLabel(pagos || [], tipoPago),
          pagos: pagos || [],
          montoRecibido: montoRecibido || 0,
          cambio: cambio || 0,
          efectivo: bolsillos.efectivo,
          totalTransferenciaPago: bolsillos.transferencia,
          serie_numero: serieNumeroFinal,
        },
      }))

      return { success: true, correlativo: serieNumeroFinal }
    })

    if (res.success) {
      logActividad({
        accion: 'cobrar_venta_pendiente',
        entidad: COL.DOCUMENTOS,
        entidadId: documentoId,
        detalle: { cajero: cajeroNombre, comprobante: res.correlativo, tipoDoc: tipoFinal },
      })
    }
    return res
  } catch (e) {
    console.error('❌ Error cobrando venta pendiente:', e)
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Elimina una venta pendiente (el cajero la descarta antes de cobrarla) con motivo obligatorio.
 *
 * ⚠️ **Acá no se anula ningún comprobante y tampoco se repone stock, porque no hay nada que
 * deshacer**: el pedido se creó sin serie ni correlativo (solo un código `PED-…`) y **sin tocar
 * el inventario** (el descuento ocurre recién al cobrar). Se marca `cancelado` con el motivo y
 * queda el registro en el historial de auditoría; los productos nunca salieron de su estado
 * original.
 */
export async function cancelarVentaPendiente({
  documentoId,
  motivo,
  usuario,
}: {
  documentoId: string
  motivo: string
  usuario?: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (!motivo.trim()) return { success: false, error: 'El motivo es obligatorio' }

    const res = await runTransaction(db, async (tx) => {
      const docRef = doc(db, COL.DOCUMENTOS, documentoId)
      const docSnap = await tx.get(docRef)
      if (!docSnap.exists()) return { success: false, error: 'Documento no encontrado' }
      const docData = docSnap.data() as DocumentoVenta
      if (docData.estado !== 'pendiente') return { success: false, error: 'La venta ya no está pendiente' }

      const f = new Date()
      tx.update(docRef, limpiarUndefined({
        estado: 'cancelado',
        motivoCancelacion: motivo.trim(),
        anulacion: {
          fecha: f.toISOString(),
          usuario: usuario || 'sistema',
          motivo: motivo.trim(),
          // Sin comprobante emitido no hay nada que anular, y sin descuento de stock no hay nada
          // que reponer: el pedido se descarta tal como estaba.
          comprobante: null,
          tocoStock: false,
        },
        updatedAt: f.toISOString(),
      }))

      return { success: true }
    })

    if (res.success) {
      logActividad({
        accion: 'eliminar_venta_pendiente',
        entidad: COL.DOCUMENTOS,
        entidadId: documentoId,
        detalle: { motivo, usuario },
      })
    }

    return res
  } catch (e) {
    console.error('❌ Error eliminando venta pendiente:', e)
    return { success: false, error: (e as Error).message }
  }
}
