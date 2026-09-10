import { collection, doc, getDoc, getDocs, orderBy, query, runTransaction, updateDoc, where, type QueryConstraint } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'

// Una "venta" contable para reportes es un comprobante real (NV/BOLETA/FACTURA), NO anulado,
// y NO un cobro de crédito ni una nota de crédito/débito (esos no son ventas nuevas).
const esVentaReal = (v: any) => v && v.estado !== 'anulada' && v.tipo !== 'cobro_credito' && v.tipo !== 'nota_credito' && v.tipo !== 'nota_debito'

// Corrige el tipo de pago de un documento (NV o BOLETA/FACTURA) antes de enviar
// a SUNAT. Solo permite si sunat.estado === 'pendiente' o NV sin consolidar.
// Port de services/reportes.js → corregirTipoPago (RN).
export async function corregirTipoPago(docId: string, nuevoTipoPago: 'efectivo' | 'transferencia', referencia = ''): Promise<{ success: boolean; error?: string }> {
  try {
    if (!['efectivo', 'transferencia'].includes(nuevoTipoPago)) return { success: false, error: 'Tipo de pago no válido.' }
    const docRef = doc(db, COL.DOCUMENTOS, docId)
    const docSnap = await getDoc(docRef)
    if (!docSnap.exists()) return { success: false, error: 'Documento no encontrado.' }
    const docData = docSnap.data()

    if (docData.tipoDoc === 'NV' && docData.sunat?.consolidado) return { success: false, error: 'Esta NV ya fue consolidada a SUNAT. No se puede modificar.' }
    if (docData.tipoDoc !== 'NV' && docData.sunat?.estado && docData.sunat.estado !== 'pendiente') {
      return { success: false, error: `El documento ya fue enviado a SUNAT (estado: ${docData.sunat.estado}). No se puede modificar.` }
    }

    const ventaActual = docData.venta || {}
    const ventaActualizada = {
      ...ventaActual,
      tipoPago: nuevoTipoPago,
      ...(nuevoTipoPago === 'efectivo'
        ? { efectivo: ventaActual.total || 0, montoRecibido: ventaActual.montoRecibido || ventaActual.total || 0, cambio: ventaActual.cambio || 0, referencia: null }
        : { efectivo: 0, montoRecibido: 0, cambio: 0, referencia: referencia || ventaActual.referencia || '' }
      ),
    }

    await updateDoc(docRef, { venta: ventaActualizada, corregidoEn: new Date().toISOString() })
    return { success: true }
  } catch (e) {
    console.error('❌ Error al corregir tipo de pago:', e)
    return { success: false, error: (e as Error).message }
  }
}

// ─── Tipos de reporte ───
export type TurnoReporte = {
  id?: string
  estado?: string
  fechaCierre?: string
  fechaApertura?: string
  usuarioNombre?: string
  usuarioId?: string
  tipoTurno?: string
  montoInicial?: number
  efectivoEsperado?: number
  montoFinalEfectivo?: number
  diferencia?: number
  observaciones?: string
  totalVentas?: number
  totalEfectivo?: number
  totalTransferencia?: number
  totalAnulado?: number
  totalAnuladoEfectivo?: number
  totalAnuladoTransferencia?: number
  totalGastos?: number
  totalGastosEfectivo?: number
  totalGastosTransferencia?: number
  ventasDelTurno?: any[]
}

export type ResumenMensual = {
  totalVentas: number
  totalEfectivo: number
  totalTransferencia: number
  totalGastos: number
  totalTransacciones: number
  totalNeto: number
}

export type ArqueoDelDia = {
  success: boolean
  fecha: string | Date
  numCierres: number
  numTurnos: number
  hayCierres: boolean
  totalVentas: number
  totalEfectivo: number
  totalTransferencia: number
  totalGastos: number
  totalGastosEfectivo: number
  totalGastosTransferencia: number
  montoInicialTotal: number
  efectivoEsperadoTotal: number
  efectivoContadoTotal: number
  diferenciaTotal: number
  totalNeto: number
  numTransacciones: number
  turnos: any[]
}

// ─── UTILIDADES DE FECHA ───

/**
 * Calcula el rango de inicio/fin de un mes dado (mes 0-indexado, como JS getMonth()).
 * Port de services/reportes.js → obtenerRangoMes.
 */
export function obtenerRangoMes(mes: number, anio: number): { inicio: string; fin: string } {
  const inicio = new Date(anio, mes, 1)
  const fin = new Date(anio, mes + 1, 0, 23, 59, 59, 999)
  return { inicio: inicio.toISOString(), fin: fin.toISOString() }
}

/**
 * Calcula el rango de un día completo (inicio 00:00 / fin 23:59:59).
 * Port de services/reportes.js → obtenerRangoDia.
 */
export function obtenerRangoDia(fecha: Date | string): { inicio: string; fin: string } {
  const d = new Date(fecha)
  const inicio = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const fin = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
  return { inicio: inicio.toISOString(), fin: fin.toISOString() }
}

// ─── CONSULTAS A FIRESTORE ───

/**
 * Carga turnos cerrados en un rango de fechas (tblTurnos estado=cerrado).
 * Port de services/reportes.js → cargarTurnosCerrados.
 */
export async function cargarTurnosCerrados(inicio: string, fin: string): Promise<TurnoReporte[]> {
  const q = query(collection(db, COL.TURNOS), where('estado', '==', 'cerrado'), where('fechaCierre', '>=', inicio), where('fechaCierre', '<=', fin))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
}

/**
 * Carga turnos en un rango opcional de fechaApertura, ordenados por apertura descendente.
 * Port de services/reportes.js → cargarTodosLosTurnos.
 */
export async function cargarTodosLosTurnos(fechaInicio?: string, fechaFin?: string): Promise<TurnoReporte[]> {
  const constraints: QueryConstraint[] = []
  if (fechaInicio) constraints.push(where('fechaApertura', '>=', fechaInicio))
  if (fechaFin) constraints.push(where('fechaApertura', '<=', fechaFin))
  constraints.push(orderBy('fechaApertura', 'desc'))
  const q = query(collection(db, COL.TURNOS), ...constraints)
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
}

/**
 * Obtiene el arqueo de caja por TURNO, arqueado por el DÍA DE APERTURA
 * (fechaApertura). Incluye turnos abiertos y cerrados, de modo que se pueda
 * revisar el cuadre aunque el turno no esté cerrado (o se haya cerrado al día
 * siguiente por error u olvido).
 */
export async function obtenerArqueoDelDia(fecha: Date | string, usuarioFiltro?: string): Promise<ArqueoDelDia> {
  const { inicio, fin } = obtenerRangoDia(fecha)

  let totalVentas = 0
  let totalEfectivo = 0
  let totalTransferencia = 0
  let totalGastos = 0
  let totalGastosEfectivo = 0
  let totalGastosTransferencia = 0
  let montoInicialTotal = 0
  let efectivoEsperadoTotal = 0
  let efectivoContadoTotal = 0
  let numCierres = 0
  let numTransacciones = 0
  const turnos: any[] = []

  try {
    const q = query(collection(db, COL.TURNOS), where('fechaApertura', '>=', inicio), where('fechaApertura', '<=', fin), ...(usuarioFiltro ? [where('usuarioId', '==', usuarioFiltro)] : []))
    const snap = await getDocs(q)

    snap.docs.forEach((d) => {
      const t = d.data() as any
      const montoInicial = t.montoInicial || 0
      const ventas = t.totalVentas || 0
      const efectivo = t.totalEfectivo || 0
      const transferencia = t.totalTransferencia || 0
      const gastos = t.totalGastos || 0
      const gastosEfectivo = t.totalGastosEfectivo || 0
      const gastosTransferencia = t.totalGastosTransferencia || 0
      const vueltoTransferencia = t.vueltoTransferencia || 0
      // Mismo cálculo que cerrarTurno → live también para turnos abiertos.
      // El vuelto por transferencia (pago con Yape mayor al total) SALE del cajón y se descuenta.
      const efectivoEsperado = montoInicial + efectivo - gastosEfectivo - vueltoTransferencia
      const cerrado = t.estado === 'cerrado'
      const efectivoContado = cerrado ? (t.montoFinalEfectivo || 0) : 0
      const diferencia = cerrado ? efectivoContado - efectivoEsperado : 0
      const activas = (t.ventasDelTurno || []).filter((v: any) => v.estado !== 'anulada')

      totalVentas += ventas
      totalEfectivo += efectivo
      totalTransferencia += transferencia
      totalGastos += gastos
      totalGastosEfectivo += gastosEfectivo
      totalGastosTransferencia += gastosTransferencia
      montoInicialTotal += montoInicial
      efectivoEsperadoTotal += efectivoEsperado
      efectivoContadoTotal += efectivoContado
      if (cerrado) numCierres++
      numTransacciones += activas.length

      turnos.push({
        id: d.id,
        tipoTurno: t.tipoTurno || 'mañana',
        usuarioNombre: t.usuarioNombre || t.usuarioId || 'Usuario',
        estado: t.estado || 'abierto',
        fechaApertura: t.fechaApertura,
        fechaCierre: t.fechaCierre,
        montoInicial,
        totalVentas: ventas,
        totalEfectivo: efectivo,
        totalTransferencia: transferencia,
        totalGastos: gastos,
        totalGastosEfectivo: gastosEfectivo,
        totalGastosTransferencia: gastosTransferencia,
        efectivoEsperado,
        efectivoContado,
        diferencia,
        observaciones: t.observaciones || '',
        numVentas: activas.length,
        gastosDelTurno: t.gastosDelTurno || [],
        comprobantes: activas.map((v: any) => ({
          id: v.id,
          serieNumero: v.serie_numero || v.serieNumero || '',
          tipoPago: v.tipoPago || 'efectivo',
          esCobro: v.tipo === 'cobro_credito',
          total: v.total || 0,
          fecha: v.fecha,
          clienteNombre: v.cliente_nombre || v.clienteNombre || '-',
        })),
      })
    })

    // Abiertos primero (arqueo en curso) y luego por hora de apertura.
    turnos.sort((a, b) => {
      const aAbierto = a.estado === 'abierto' ? 0 : 1
      const bAbierto = b.estado === 'abierto' ? 0 : 1
      if (aAbierto !== bAbierto) return aAbierto - bAbierto
      return new Date(a.fechaApertura).getTime() - new Date(b.fechaApertura).getTime()
    })
  } catch (e) {
    console.error('❌ Error cargando turnos del día:', e)
  }

  const hayCierres = numCierres > 0
  const diferenciaTotal = efectivoContadoTotal - efectivoEsperadoTotal
  const totalNeto = totalVentas - totalGastos
  const numTurnos = turnos.length

  return {
    success: true,
    fecha,
    numCierres,
    numTurnos,
    hayCierres,
    totalVentas,
    totalEfectivo,
    totalTransferencia,
    totalGastos,
    totalGastosEfectivo,
    totalGastosTransferencia,
    montoInicialTotal,
    efectivoEsperadoTotal,
    efectivoContadoTotal,
    diferenciaTotal,
    totalNeto,
    numTransacciones,
    turnos,
  }
}

// ─── PROCESAMIENTO DE DATOS ───

/**
 * Calcula el resumen mensual de turnos filtrados.
 * Port de services/reportes.js → calcularResumenMensual.
 */
export function calcularResumenMensual(turnosFiltrados: TurnoReporte[]): ResumenMensual {
  const totalVentas = turnosFiltrados.reduce((sum, t) => sum + ((t.totalVentas || 0) - (t.totalAnulado || 0)), 0)
  const totalEfectivo = turnosFiltrados.reduce((sum, t) => sum + ((t.totalEfectivo || 0) - (t.totalAnuladoEfectivo || 0)), 0)
  const totalTransferencia = turnosFiltrados.reduce((sum, t) => sum + ((t.totalTransferencia || 0) - (t.totalAnuladoTransferencia || 0)), 0)
  const totalGastos = turnosFiltrados.reduce((sum, t) => sum + (t.totalGastos || 0), 0)
  const totalTransacciones = turnosFiltrados.reduce((sum, t) => sum + ((t.ventasDelTurno?.filter(esVentaReal).length) || 0), 0)

  return {
    totalVentas,
    totalEfectivo,
    totalTransferencia,
    totalGastos,
    totalTransacciones,
    totalNeto: totalVentas - totalGastos,
  }
}

/**
 * Filtra turnos por mes (0-indexado) y por tipo de turno (mañana/tarde/todos).
 * Port de services/reportes.js → filtrarTurnosPorMes.
 */
export function filtrarTurnosPorMes(turnos: TurnoReporte[], mes: number, anio: number, tipoTurno = 'todos'): TurnoReporte[] {
  let filtrados = turnos.filter((t) => {
    if (!t.fechaApertura) return false
    const fecha = new Date(t.fechaApertura)
    return fecha.getMonth() === mes && fecha.getFullYear() === anio
  })

  if (tipoTurno !== 'todos') {
    filtrados = filtrados.filter((t) => t.tipoTurno === tipoTurno)
  }

  return filtrados
}

/**
 * Obtiene compras en un rango de fechas (tblMovimientos tipoMovimiento=compra).
 * Port de services/reportes.js → obtenerComprasPorRango.
 */
export async function obtenerComprasPorRango(inicio: Date, fin: Date): Promise<{ success: boolean; data: any[] }> {
  const q = query(collection(db, COL.MOVIMIENTOS), where('tipoMovimiento', '==', 'compra'), where('fecha', '>=', inicio.toISOString()), where('fecha', '<=', fin.toISOString()))
  const snap = await getDocs(q)
  return { success: true, data: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) }
}

// Ventas (NV + boleta + factura + NC/ND) por rango de fechas, POR FECHA DE VENTA.
// Excluye anuladas y boletas consolidadas (las NVs ya se contaron en caja).
// Las NC/ND se incluyen para que la NC reste del total (vuelve a Neto).
export async function obtenerVentasPorRango(inicio: Date, fin: Date, usuarioFiltro?: string): Promise<any[]> {
  const ini = new Date(inicio)
  ini.setHours(0, 0, 0, 0)
  const fin2 = new Date(fin)
  fin2.setHours(23, 59, 59, 999)
  const q = query(collection(db, COL.DOCUMENTOS), where('fecha', '>=', ini.toISOString()), where('fecha', '<=', fin2.toISOString()), ...(usuarioFiltro ? [where('usuarioId', '==', usuarioFiltro)] : []), orderBy('fecha', 'desc'))
  const snap = await getDocs(q)
  return snap.docs
    .map((s) => ({ id: s.id, ...(s.data() as any) }))
    .filter((d) => d.estado !== 'anulada' && !d.consolidado && (d.tipoDoc === 'NV' || d.tipoDoc === 'BOLETA' || d.tipoDoc === 'FACTURA' || d.tipoDoc === 'NC' || d.tipoDoc === 'ND'))
}

// Signo de un doc para los totales: las notas de crédito restan, el resto suma.
export const signoDoc = (d: any) => (d?.tipoDoc === 'NC' ? -1 : 1)

// ─── ANULAR COMPRA ───

const MAX_REINTENTOS = 5
const ESPERA_BASE = 800
const esConflicto = (error: any) =>
  error?.code === 'ABORTED' ||
  String(error?.message || '').includes('ABORTED') ||
  String(error?.message || '').includes('aborted') ||
  String(error?.message || '').includes('concurrent') ||
  String(error?.message || '').includes('conflict') ||
  String(error?.message || '').includes('retry')
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Anula un movimiento de compra revirtiendo el stock y eliminando el registro.
 * Valida stockActual === stockAnterior + cantidad (si el producto fue vendido/modificado, falla).
 * Port de helper/FirebaseHelper.js → anularMovimientoCompra.
 * Nota: recibe un objeto con { movimientoId, productoId, cantidad, stockAnterior } (igual que en RN),
 * no solo un id, porque necesita esos datos para validar y revertir el stock.
 */
export async function anularMovimientoCompra({ movimientoId, productoId, cantidad, stockAnterior }: { movimientoId: string; productoId: string; cantidad: number; stockAnterior: number }): Promise<{ success: boolean; error?: string; nuevoStock?: number }> {
  const productoRef = doc(db, COL.PRODUCTOS, productoId)
  const movimientoRef = doc(db, COL.MOVIMIENTOS, movimientoId)

  for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
    try {
      const resultado = await runTransaction(db, async (transaction) => {
        const productoDoc = await transaction.get(productoRef)
        if (!productoDoc.exists()) throw new Error('El producto no existe')
        const data: any = productoDoc.data()
        const stockActual = data.stock || 0
        const stockEsperado = stockAnterior + cantidad
        if (stockActual !== stockEsperado) throw new Error(`El producto "${data.nombre}" ya fue vendido o modificado. No se puede anular.`)
        transaction.update(productoRef, { stock: stockAnterior, ultimaActualizacion: new Date().toISOString(), updatedAt: new Date().toISOString() })
        transaction.delete(movimientoRef)
        return { nuevoStock: stockAnterior, stockAnterior: stockActual }
      })
      console.log('✅ Compra anulada y eliminada:', { movimientoId, productoId })
      return { success: true, nuevoStock: resultado.nuevoStock }
    } catch (error) {
      const e = error as any
      if (intento < MAX_REINTENTOS && esConflicto(e)) {
        const espera = ESPERA_BASE * Math.pow(2, intento - 1) + Math.random() * 500
        await esperar(espera)
        continue
      }
      console.warn('⚠️ Anulación rechazada:', { productoId, motivo: e?.message })
      return { success: false, error: e?.message }
    }
  }
  return { success: false, error: 'No se pudo anular la compra.' }
}

/**
 * Anula una compra completa (agrupa por metadata.compraId) en una sola transacción atómica,
 * revirtiendo el stock de todos sus movimientos y eliminándolos.
 * Port de helper/FirebaseHelper.js → anularCompraCompleta.
 */
export async function anularCompraCompleta(compraId: string): Promise<{ success: boolean; error?: string; total?: number }> {
  const snap = await getDocs(query(collection(db, COL.MOVIMIENTOS), where('metadata.compraId', '==', compraId)))
  const movimientos: any[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))

  if (movimientos.length === 0) {
    return { success: false, error: 'No se encontraron movimientos para esta compra' }
  }

  for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
    try {
      await runTransaction(db, async (transaction) => {
        const validaciones: { mov: any; productoRef: any }[] = []
        for (const mov of movimientos) {
          const movimientoRef = doc(db, COL.MOVIMIENTOS, mov.id)
          const movActual = await transaction.get(movimientoRef)
          if (!movActual.exists()) throw new Error(`Movimiento ${mov.id} ya fue eliminado.`)
          const movData: any = movActual.data()
          if (movData.stockAnterior !== mov.stockAnterior || movData.cantidad !== mov.cantidad) throw new Error(`Movimiento ${mov.id} fue modificado después de la consulta inicial.`)

          const productoRef = doc(db, COL.PRODUCTOS, mov.productoId)
          const productoDoc = await transaction.get(productoRef)
          if (!productoDoc.exists()) throw new Error(`Producto "${mov.productoNombre}" no existe en la base de datos`)
          const data: any = productoDoc.data()
          const stockActual = data.stock || 0
          const stockEsperado = (mov.stockAnterior || 0) + (mov.cantidad || 0)
          if (stockActual !== stockEsperado) throw new Error(`"${data.nombre}" ya fue vendido o modificado. No se puede anular.`)
          validaciones.push({ mov, productoRef })
        }
        for (const { mov, productoRef } of validaciones) {
          const movimientoRef = doc(db, COL.MOVIMIENTOS, mov.id)
          transaction.update(productoRef, { stock: mov.stockAnterior || 0, ultimaActualizacion: new Date().toISOString(), updatedAt: new Date().toISOString() })
          transaction.delete(movimientoRef)
        }
      })
      console.log('✅ Compra completa anulada:', { compraId, total: movimientos.length })
      return { success: true, total: movimientos.length }
    } catch (error) {
      const e = error as any
      if (intento < MAX_REINTENTOS && esConflicto(e)) {
        const espera = ESPERA_BASE * Math.pow(2, intento - 1) + Math.random() * 500
        await esperar(espera)
        continue
      }
      console.warn('⚠️ Anulación completa rechazada:', { compraId, motivo: e?.message })
      return { success: false, error: e?.message }
    }
  }
  return { success: false, error: 'No se pudo anular la compra.' }
}
