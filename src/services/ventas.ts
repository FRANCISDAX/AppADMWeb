import { collection, doc, getDoc, getDocs, query, runTransaction, updateDoc, where } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { numeroALetras } from '@/lib/numero-a-letras'
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

export type VentaData = {
  tipoDoc: 'NV' | 'BOLETA' | 'FACTURA'
  tipoPago: 'efectivo' | 'transferencia' | 'credito' | 'mixto'
  pagos?: { tipo: 'efectivo' | 'transferencia' | 'credito'; monto: number }[]
  total: number
  cliente_dni?: string
  cliente_nombre?: string
  cliente_direccion?: string
  referencia?: string
  montoRecibido?: number
  cambio?: number
  vueltoTransferencia?: number
  cajero: string
  usuarioId?: string
  turnoId?: string | null
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
        tx.update(prodRef, { stock: nuevoStock, ultimaActualizacion: f.toISOString(), updatedAt: f.toISOString() })
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
          categoria: '',
          tipoAfectacion: '10',
        })),
      ]
      const ventaBase = {
        id: String(Date.now()),
        fecha: f.toISOString(),
        items: ventaItems,
        total: venta.total,
        importe_total: venta.total,
        cliente_nombre: venta.cliente_nombre || '-',
        cliente_dni: venta.cliente_dni || '-',
        cliente_direccion: venta.cliente_direccion || '',
      }
      let ventaDoc: Record<string, any>
      if (venta.tipoPago === 'efectivo') {
        const monto = venta.montoRecibido ?? venta.total
        ventaDoc = { ...ventaBase, tipoPago: 'efectivo', forma_pago: 'Efectivo', efectivo: monto, montoRecibido: monto, cambio: Math.max(0, monto - venta.total) }
      } else if (venta.tipoPago === 'credito') {
        ventaDoc = { ...ventaBase, tipoPago: 'credito', forma_pago: 'Crédito', cobrado: 0 }
      } else {
        ventaDoc = { ...ventaBase, tipoPago: 'transferencia', forma_pago: 'Transferencia', referencia: venta.referencia || '' }
      }
      ventaDoc = { ...ventaDoc, cajero: venta.cajero || 'sistema', serie_numero: serieNumero, sucursal: config.sucursal || '', mensaje: config.mensaje || '', son_letras: numeroALetras(venta.total), turnoId: venta.turnoId || '' }

      // Pago (posiblemente mixto). Si no viene `pagos`, se colapsa a un solo método.
      const pagos = venta.pagos && venta.pagos.length > 0
        ? venta.pagos
        : [{ tipo: (venta.tipoPago === 'mixto' ? 'efectivo' : venta.tipoPago) as 'efectivo' | 'transferencia' | 'credito', monto: venta.total }]
      const montoEfectivo = pagos.filter((p) => p.tipo === 'efectivo').reduce((s, p) => s + (p.monto || 0), 0)
      const montoTransferencia = pagos.filter((p) => p.tipo === 'transferencia').reduce((s, p) => s + (p.monto || 0), 0)
      ventaDoc = { ...ventaDoc, pagos, tipoPago: pagos.length > 1 ? 'mixto' : pagos[0].tipo, efectivo: montoEfectivo, totalTransferenciaPago: montoTransferencia }
      // En pago mixto, el efectivo recibido puede superar la parte en efectivo del total
      // (se devuelve vuelto solo por la pata en efectivo). Se conservan recibido y vuelto.
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
        ...(venta.tipoDoc !== 'NV' ? { sunat: { serie, numero: nuevo, estado: 'pendiente' } } : {}),
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
          vueltoTransferencia: (turnoData.vueltoTransferencia || 0) + (venta.vueltoTransferencia || 0),
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
        const nuevasVentas = (td.ventasDelTurno || []).map((v: any) => (v.id === venta.id ? { ...v, estado: 'anulada', anulacion: { fecha: new Date().toISOString(), usuario, motivo } } : v))
        const update: Record<string, any> = { ventasDelTurno: nuevasVentas }
        if (turnoAbierto) {
          update.totalVentas = Math.max(0, (td.totalVentas || 0) - monto)
          update.totalEfectivo = Math.max(0, (td.totalEfectivo || 0) - (venta.tipoPago === 'efectivo' ? monto : 0))
          update.totalTransferencia = Math.max(0, (td.totalTransferencia || 0) - (venta.tipoPago === 'transferencia' ? monto : 0))
        } else {
          update.totalAnulado = (td.totalAnulado || 0) + monto
          update.totalAnuladoEfectivo = (td.totalAnuladoEfectivo || 0) + (venta.tipoPago === 'efectivo' ? monto : 0)
          update.totalAnuladoTransferencia = (td.totalAnuladoTransferencia || 0) + (venta.tipoPago === 'transferencia' ? monto : 0)
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
