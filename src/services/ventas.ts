import { collection, doc, increment, getDoc, getDocs, query, runTransaction, updateDoc, where, orderBy, limit } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { numeroALetras } from '@/lib/numero-a-letras'
import { CATEGORIA_MANUAL } from '@/lib/categorias'
import { AFECTACION_POR_DEFECTO } from '@/constants/tributario'
import { bolsillosDeVenta, formaPagoLabel, type PagoGuardado } from '@/lib/pagos'
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
        tx.update(prodRef, { stock: nuevoStock, vecesVendido: increment(1), ultimaActualizacion: f.toISOString(), updatedAt: f.toISOString() })
        const movRef = doc(collection(db, COL.MOVIMIENTOS))
        tx.set(movRef, {
          productoId: kitComponente ? prod.id : item.id,
          productoCodigo: prod.codigo || (kitComponente ? prod.id : item.id),
          productoNombre: prod.nombre || item.nombre,
          tipoMovimiento: 'venta',
          cantidad,
          stockAnterior: stockActual,
          stockNuevo: nuevoStock,
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
          tipoAfectacion: String(config.tipoAfectacionManual || AFECTACION_POR_DEFECTO),
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
      tx.set(docRef, docData)

      // Turno (escritura; el dato ya se leyó ANTES de escribir nada)
      if (turnoRef && turnoData) {
        const nuevasVentas = [...(turnoData.ventasDelTurno || []), ventaDoc]
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
        tx.update(prodRef, { stock: nuevoStock, ultimaActualizacion: new Date().toISOString(), updatedAt: new Date().toISOString() })
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
 * Crea una venta con estado 'pendiente' SIN descontar stock ni actualizar turno.
 * El stock se descuenta recién cuando el cajero cobra (cobrarVentaPendiente).
 */
export async function crearVentaPendiente({
  items,
  venta,
  config,
  vendedorId,
  vendedorNombre,
  cajaId,
}: {
  items: VentaItem[]
  venta: VentaData
  config: Config
  vendedorId: string
  vendedorNombre: string
  cajaId?: string
}): Promise<{ success: boolean; correlativo?: string; documento?: DocumentoVenta; error?: string }> {
  try {
    if (!items.length) return { success: false, error: 'No hay items para vender' }
    if (!venta.usuarioId) return { success: false, error: 'Falta usuarioId' }

    const f = new Date()
    const anioMes = `${f.getFullYear()}-${f.getMonth() + 1}`
    const tipoDoc = venta.tipoDoc
    const serie = tipoDoc === 'NV'
      ? (venta as Record<string, unknown>).seriePrefijo as string || config.serie_prefijo || 'NV'
      : tipoDoc === 'BOLETA' ? config.serieBoleta || 'B001' : config.serieFactura || 'F001'

    const counterRef = doc(db, COL.CONTADORES, `sunat_${serie}`)
    const counterSnap = await getDoc(counterRef)
    const nuevo = (counterSnap.exists() ? (counterSnap.data().contador || 0) : 0) + 1
    await updateDoc(counterRef, { contador: nuevo, lastUpdated: f.toISOString() }).catch(async () => {
      const { setDoc } = await import('firebase/firestore')
      await setDoc(counterRef, { contador: nuevo, lastUpdated: f.toISOString() })
    })

    const numeroStr = String(nuevo).padStart(7, '0')
    const serieNumero = `${serie}-${numeroStr}`

    const importeTotal = venta.total - (venta.descuentoTotal || 0)

    const ventaDoc = {
      id: '',
      fecha: f.toISOString(),
      items: items.map((it) => ({
        ...it,
        precioVenta: it.precioVenta ?? 0,
      })),
      total: venta.total,
      importe_total: importeTotal,
      descuento_total: venta.descuentoTotal || 0,
      descuento_global_tipo: venta.descuentoGlobalTipo,
      descuento_global_valor: venta.descuentoGlobalValor,
      tipoPago: venta.tipoPago,
      forma_pago: venta.tipoPago,
      pagos: venta.pagos || [],
      efectivo: (venta.pagos || []).filter((p) => p.tipo === 'efectivo').reduce((s, p) => s + p.monto, 0),
      totalTransferenciaPago: (venta.pagos || []).filter((p) => p.tipo === 'transferencia').reduce((s, p) => s + p.monto, 0),
      cliente_nombre: venta.cliente_nombre || '',
      cliente_dni: venta.cliente_dni || '',
      cliente_direccion: venta.cliente_direccion || '',
      montoRecibido: venta.montoRecibido || 0,
      cambio: venta.cambio || 0,
      cajero: vendedorNombre,
      serie_numero: serieNumero,
      sucursal: (config as Record<string, unknown>).sucursal || 'Casa Matriz',
      mensaje: (config as Record<string, unknown>).mensajeLegal || '',
      son_letras: numeroALetras(importeTotal),
      turnoId: '',
      envio: venta.envio,
    }

    const docData = {
      tipo: tipoDoc,
      tipoDoc,
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
      turnoId: '',
      usuarioId: venta.usuarioId || '',
      cajero: vendedorNombre,
      estado: 'pendiente' as const,
      vendedorId,
      vendedorNombre,
      cajaId: cajaId || '',
      ...(tipoDoc !== 'NV' ? {
        sunat: {
          serie,
          numero: nuevo,
          puntoEmision: puntoEmisionDe(null, config),
          estado: 'pendiente',
        },
      } : {}),
    }

    const docId = `${anioMes}_${tipoDoc}-${serieNumero}`
    const { setDoc } = await import('firebase/firestore')
    await setDoc(doc(db, COL.DOCUMENTOS, docId), docData)

    logActividad({
      accion: 'crear_venta_pendiente',
      entidad: COL.DOCUMENTOS,
      entidadId: docId,
      detalle: { vendedor: vendedorNombre, items: items.length, total: venta.total },
    })

    return { success: true, correlativo: serieNumero, documento: { id: docId, ...docData } as DocumentoVenta }
  } catch (e) {
    console.error('❌ Error creando venta pendiente:', e)
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Obtiene las ventas pendientes de una caja específica.
 */
export async function obtenerVentasPendientes(cajaId: string): Promise<DocumentoVenta[]> {
  try {
    if (!cajaId) return []
    const snap = await getDocs(
      query(
        collection(db, COL.DOCUMENTOS),
        where('cajaId', '==', cajaId),
        where('estado', '==', 'pendiente'),
        orderBy('fecha', 'desc'),
        limit(50),
      ),
    )
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DocumentoVenta))
  } catch (e) {
    console.error('❌ Error obteniendo ventas pendientes:', e)
    return []
  }
}

/**
 * Cobra una venta pendiente: descuenta stock, actualiza turno y marca como 'pagado'.
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
}): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await runTransaction(db, async (tx) => {
      const docRef = doc(db, COL.DOCUMENTOS, documentoId)
      const docSnap = await tx.get(docRef)
      if (!docSnap.exists()) return { success: false, error: 'Documento no encontrado' }
      const docData = docSnap.data() as DocumentoVenta
      if (docData.estado !== 'pendiente') return { success: false, error: 'La venta ya no está pendiente' }

      const items = (docData.venta as Record<string, unknown>)?.items as VentaItem[] | undefined
      if (!items?.length) return { success: false, error: 'Documento sin items' }

      // Descontar stock
      for (const it of items) {
        if (it.manual) continue
        if (it.kitItems?.length) {
          for (const kit of it.kitItems) {
            const prodRef = doc(db, COL.PRODUCTOS, kit.productoId)
            const prodSnap = await tx.get(prodRef)
            if (prodSnap.exists()) {
              const stockActual = prodSnap.data().stock ?? 0
              tx.update(prodRef, { stock: Math.max(0, stockActual - kit.cantidad) })
            }
          }
        } else {
          const prodRef = doc(db, COL.PRODUCTOS, it.id)
          const prodSnap = await tx.get(prodRef)
          if (prodSnap.exists()) {
            const prod = prodSnap.data()
            const factor = it.factorConversion || 1
            const stockActual = prod.stock ?? 0
            tx.update(prodRef, { stock: Math.max(0, stockActual - it.quantity) })
            tx.set(doc(collection(db, COL.MOVIMIENTOS)), {
              productoId: it.id,
              productoNombre: it.nombre,
              tipo: 'venta',
              cantidad: it.quantity,
              cantidadAnterior: stockActual,
              cantidadNueva: Math.max(0, stockActual - it.quantity),
              factorConversion: factor,
              presentacionNombre: it.presentacionNombre || 'Unidad',
              fecha: new Date().toISOString(),
              documentoRef: documentoId,
              usuario: cajeroNombre,
            })
          }
        }
      }

      // Actualizar turno
      if (turnoId) {
        const turnoRef = doc(db, COL.TURNOS, turnoId)
        const turnoSnap = await tx.get(turnoRef)
        if (turnoSnap.exists()) {
          const td = turnoSnap.data()
          const total = (docData.venta as Record<string, unknown>)?.total as number || 0
          const efectivo = (docData.venta as Record<string, unknown>)?.efectivo as number || 0
          const transferencia = (docData.venta as Record<string, unknown>)?.totalTransferenciaPago as number || 0
          tx.update(turnoRef, {
            totalVentas: (td.totalVentas || 0) + total,
            totalEfectivo: (td.totalEfectivo || 0) + efectivo,
            totalTransferencia: (td.totalTransferencia || 0) + transferencia,
            ventasDelTurno: [...(td.ventasDelTurno || []), {
              docId: documentoId,
              tipo: docData.tipo,
              serieNumero: docData.serieNumero,
              total,
              fecha: new Date().toISOString(),
              vendedorId: docData.vendedorId || '',
              vendedorNombre: docData.vendedorNombre || '',
            }],
          })
        }
      }

      // Marcar como pagado
      const f = new Date()

      // Si el cajero cambió el tipoDoc, reasignar serie/numero
      let serieNumeroFinal = docData.serieNumero
      let tipoDocFinal = docData.tipo
      let serieFinal = docData.serie
      let numeroFinal = docData.numero ?? docData.correlativo
      if (tipoDoc && tipoDoc !== docData.tipo && config) {
        const nuevaSerie = tipoDoc === 'NV'
          ? config.serie_prefijo || 'NV'
          : tipoDoc === 'BOLETA' ? config.serieBoleta || 'B001' : config.serieFactura || 'F001'
        const counterRef = doc(db, COL.CONTADORES, `sunat_${nuevaSerie}`)
        const counterSnap = await tx.get(counterRef)
        const nuevo = (counterSnap.exists() ? (counterSnap.data().contador || 0) : 0) + 1
        tx.set(counterRef, { contador: nuevo, lastUpdated: f.toISOString() }, { merge: true })
        const numeroStr = String(nuevo).padStart(7, '0')
        serieNumeroFinal = `${nuevaSerie}-${numeroStr}`
        tipoDocFinal = tipoDoc
        serieFinal = nuevaSerie
        numeroFinal = nuevo
      }

      tx.update(docRef, {
        estado: 'pagado',
        cajeroId,
        cajero: cajeroNombre,
        fechaCobro: f.toISOString(),
        turnoId: turnoId || '',
        tipo: tipoDocFinal,
        tipoDoc: tipoDocFinal,
        serie: serieFinal,
        numero: numeroFinal,
        correlativo: numeroFinal,
        serieNumero: serieNumeroFinal,
        ...(pagos ? {
          venta: {
            ...((docData.venta || {}) as Record<string, unknown>),
            pagos,
            tipoPago,
            forma_pago: tipoPago,
            montoRecibido: montoRecibido || 0,
            cambio: cambio || 0,
          },
        } : {}),
      })

      return { success: true }
    })

    if (res.success) {
      logActividad({
        accion: 'cobrar_venta_pendiente',
        entidad: COL.DOCUMENTOS,
        entidadId: documentoId,
        detalle: { cajero: cajeroNombre },
      })
    }
    return res
  } catch (e) {
    console.error('❌ Error cobrando venta pendiente:', e)
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Cancela una venta pendiente con motivo obligatorio.
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

    const docRef = doc(db, COL.DOCUMENTOS, documentoId)
    const docSnap = await getDoc(docRef)
    if (!docSnap.exists()) return { success: false, error: 'Documento no encontrado' }
    const docData = docSnap.data() as DocumentoVenta
    if (docData.estado !== 'pendiente') return { success: false, error: 'La venta ya no está pendiente' }

    await updateDoc(docRef, {
      estado: 'cancelado',
      motivoCancelacion: motivo.trim(),
      anulacion: {
        fecha: new Date().toISOString(),
        usuario: usuario || 'sistema',
        motivo: motivo.trim(),
      },
      updatedAt: new Date().toISOString(),
    })

    logActividad({
      accion: 'cancelar_venta_pendiente',
      entidad: COL.DOCUMENTOS,
      entidadId: documentoId,
      detalle: { motivo, usuario },
    })

    return { success: true }
  } catch (e) {
    console.error('❌ Error cancelando venta pendiente:', e)
    return { success: false, error: (e as Error).message }
  }
}
