import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { ejecutarTransaccion } from '@/services/transacciones'
import { COL } from '@/constants/colecciones'
import { numeroALetras } from '@/lib/numero-a-letras'
import { puntoEmisionDe } from '@/lib/sunat'
import { normalizarSerie } from '@/lib/series'
import { bolsillosDeVenta, medioDeVenta } from '@/lib/pagos'
import { valorizacionDeMovimiento } from '@/services/kardex'
import { redondear2 } from '@/lib/dinero'
import { db } from '@/lib/firebase'

/**
 * Máximo correlativo ya emitido para una serie (cualquier tipo de documento).
 * Sirve para sembrar el contador cuando el doc de `tblContadores` no existe:
 * restauración de la base, contador borrado o notas emitidas por otra app/versión.
 */
async function maxCorrelativoEmitido(serie: string): Promise<number> {
  let max = 0
  const snap = await getDocs(query(collection(db, COL.DOCUMENTOS), where('serie', '==', serie)))
  snap.forEach((d) => {
    const n = Number(d.data().numero ?? d.data().correlativo ?? 0)
    if (Number.isFinite(n) && n > max) max = n
  })
  return max
}

// Incrementa el contador `sunat_{serie}` y devuelve el próximo correlativo.
export async function obtenerProximoCorrelativoSunat(serie: string): Promise<number | null> {
  const serieNorm = normalizarSerie(serie)
  const contRef = doc(db, COL.CONTADORES, `sunat_${serieNorm}`)

  // SOLO LECTURA: si el contador aún no existe se arranca desde el máximo
  // correlativo ya emitido. Sin esto la primera nota volvería a 000001 y SUNAT
  // la rechazaría por correlativo duplicado ("el comprobante ya existe").
  let maxExistente = 0
  try {
    const snap = await getDoc(contRef)
    if (!snap.exists()) maxExistente = await maxCorrelativoEmitido(serieNorm)
  } catch (e) {
    console.warn('⚠️ Lectura de correlativos emitidos de la serie:', e)
  }

  try {
    return await ejecutarTransaccion(db, async (tx) => {
      const snap = await tx.get(contRef)
      const ultimo = snap.exists() ? snap.data().ultimoCorrelativo ?? 0 : maxExistente
      const nuevo = ultimo + 1
      tx.set(contRef, { ultimoCorrelativo: nuevo, serie: serieNorm, updatedAt: new Date().toISOString() }, { merge: true })
      return nuevo
    })
  } catch (e) {
    console.error('❌ Error al obtener correlativo SUNAT:', e)
    return null
  }
}

export async function crearNotaCreditoDebito({
  documentoOriginal,
  tipoNota,
  motivo,
  codigoMotivo,
  config,
  afectaStock = false,
  turnoId,
  cajero,
}: {
  documentoOriginal: any
  tipoNota: 'NC' | 'ND'
  motivo: string
  codigoMotivo: string
  config: Record<string, any>
  afectaStock?: boolean
  turnoId?: string
  cajero?: string
}) {
  const estadoOriginal = documentoOriginal.sunat?.estado || 'pendiente'
  if (estadoOriginal !== 'aceptado') {
    return { success: false, error: 'El comprobante original debe tener CDR aceptado por SUNAT para emitir una nota.' }
  }

  const f = new Date()
  const anioMes = `${f.getFullYear()}-${f.getMonth() + 1}`
  const esCredito = tipoNota === 'NC'
  const modificaBoleta = (documentoOriginal.tipoDoc || documentoOriginal.tipo) === 'BOLETA'
  const serieKey = modificaBoleta ? (esCredito ? 'serieBoletaNC' : 'serieBoletaND') : esCredito ? 'serieFacturaNC' : 'serieFacturaND'
  const serieDefault = modificaBoleta ? (esCredito ? 'BC01' : 'BD01') : esCredito ? 'FC01' : 'FD01'
  const prefijoSerie = normalizarSerie(config[serieKey] || serieDefault)

  const nuevoNum = await obtenerProximoCorrelativoSunat(prefijoSerie)
  if (!nuevoNum) return { success: false, error: 'No se pudo obtener el correlativo SUNAT para la nota.' }

  const numStr = String(nuevoNum).padStart(6, '0')
  const correlativo = `${prefijoSerie}-${numStr}`

  const ventaOriginal = documentoOriginal.venta || {}
  const itemsBase = ventaOriginal.items || []
  const montoModificacion = Math.abs(itemsBase.reduce((s: number, it: any) => s + Number(it.subtotal || it.total || 0), 0))

  // Validación: una NC no puede superar el monto del comprobante original (evita sobre-devoluciones).
  if (esCredito) {
    const totalOriginal = Number(ventaOriginal.total || ventaOriginal.importe_total || 0)
    if (montoModificacion > totalOriginal + 0.01) {
      return {
        success: false,
        error: `La nota de crédito (S/ ${montoModificacion.toFixed(2)}) no puede superar el monto del comprobante original (S/ ${totalOriginal.toFixed(2)}).`,
      }
    }
  }

  const items = itemsBase.map((it: any) => ({
    ...it,
    precioVenta: Math.abs(it.precioVenta || 0),
    precio_unitario: Math.abs(it.precio_unitario || it.precioVenta || 0),
    subtotal: Math.abs(it.subtotal || 0),
  }))

  const nota = {
    id: Date.now().toString(),
    fecha: f.toISOString(),
    serie_numero: correlativo,
    items,
    total: montoModificacion,
    importe_total: montoModificacion,
    tipoPago: ventaOriginal.tipoPago || 'efectivo',
    cliente_nombre: ventaOriginal.cliente_nombre || '-',
    cliente_dni: ventaOriginal.cliente_dni || '-',
    motivo,
    tipoNota,
    motivoNota: motivo,
    codigoMotivo,
    tipoDocOriginal: documentoOriginal.tipoDoc || documentoOriginal.tipo,
    documentoReferencia: `${documentoOriginal.serie}-${documentoOriginal.numero}`,
    docReferencia: `${documentoOriginal.serie}-${documentoOriginal.numero}`,
    son_letras: numeroALetras(montoModificacion),
    afectaStock: Boolean(afectaStock) && esCredito,
    cajero: cajero || 'sistema',
  }

  const docId = `${tipoNota}-${correlativo}`
  const docRef = doc(db, COL.DOCUMENTOS, `${anioMes}_${docId}`)
  const docData = {
    tipo: tipoNota,
    tipoDoc: tipoNota,
    serie: prefijoSerie,
    numero: nuevoNum,
    correlativo: numStr,
    serieNumero: correlativo,
    venta: nota,
    fecha: f.toISOString(),
    anio: f.getFullYear(),
    mes: f.getMonth() + 1,
    anioMes,
    createdAt: f.toISOString(),
    usuarioId: documentoOriginal.usuarioId || '',
    sunat: { serie: prefijoSerie, numero: nuevoNum, puntoEmision: puntoEmisionDe(null, config), estado: 'pendiente' },
  }

  const ajustarStock = Boolean(afectaStock) && esCredito && items.length > 0

  try {
    await ejecutarTransaccion(db, async (tx) => {
      // FASE 1: Todas las lecturas ANTES de cualquier escritura.
      const prodSnaps: { item: any; snap: any; prodRef: any }[] = []
      if (ajustarStock) {
        for (const item of items) {
          const prodRef = doc(db, COL.PRODUCTOS, item.id)
          const prodSnap = await tx.get(prodRef)
          if (!prodSnap.exists()) throw new Error(`Producto "${item.nombre || item.id}" no existe. No se pudo ajustar stock.`)
          prodSnaps.push({ item, snap: prodSnap, prodRef })
        }
      }

      let turnoSnap: any = null
      if (turnoId) {
        const turnoRef = doc(db, COL.TURNOS, turnoId)
        turnoSnap = await tx.get(turnoRef)
      }

      // FASE 2: Todas las escrituras.
      if (ajustarStock) {
        for (const { item, snap: prodSnap, prodRef } of prodSnaps) {
          const prod = prodSnap.data()
          const stockActual = prod.stock || 0
          const factor = item.factorConversion || 1
          const cantidadBase = (item.cantidad || 1) * factor
          const nuevoStock = stockActual + cantidadBase
          // La nota de crédito **devuelve** mercadería: es una ENTRADA, y se valoriza **al costo
          // promedio vigente** (sin costo explícito, así el promedio no se mueve — la mercadería
          // vuelve con el costo con el que salió).
          const valorizado = valorizacionDeMovimiento({
            tipoMovimiento: 'nota_credito',
            cantidad: cantidadBase,
            stockAntes: stockActual,
            stockNuevo: nuevoStock,
            producto: prod,
          })
          tx.update(prodRef, { stock: nuevoStock, ...valorizado.camposProducto, ultimaActualizacion: f.toISOString(), updatedAt: f.toISOString() })
          const movRef = doc(collection(db, COL.MOVIMIENTOS))
          tx.set(movRef, {
            productoId: item.id,
            productoCodigo: prod.codigo || item.id,
            productoNombre: prod.nombre || item.nombre,
            tipoMovimiento: 'nota_credito',
            cantidad: cantidadBase,
            motivo: `Nota de Crédito ${correlativo}: ${motivo || 'devolución de mercadería'}`,
            stockAnterior: stockActual,
            stockNuevo: nuevoStock,
            ...valorizado.camposMovimiento,
            usuario: 'sistema',
            metadata: { notaId: docId, documentoRef: `${documentoOriginal.serie}-${documentoOriginal.numero}` },
            fecha: f.toISOString(),
            timestamp: Date.now(),
          })
        }
      }
      tx.set(docRef, docData)

      // Registrar la nota en el turno (afecta caja: la NC devuelve dinero).
      if (turnoId && turnoSnap && turnoSnap.exists() && turnoSnap.data().estado === 'abierto') {
        const turnoRef = doc(db, COL.TURNOS, turnoId)
        const t = turnoSnap.data()
        // ⚠️ El reparto sale de los **pagos** del comprobante original, no de su `tipoPago`:
        // una venta por Yape tiene `tipoPago: 'transferencia'` (el bolsillo) y su medio vive
        // en `pagos`. Se devuelve **en la misma proporción** en que se cobró (si el original
        // fue mixto, la devolución sale de los dos bolsillos), y se guarda el **medio** para
        // que la conciliación por billetera siga exacta ante una devolución.
        const repartoOriginal = bolsillosDeVenta({
          tipoPago: ventaOriginal.tipoPago,
          pagos: ventaOriginal.pagos,
          total: ventaOriginal.total,
        })
        const totalOriginalVenta = Number(ventaOriginal.total || ventaOriginal.importe_total || 0)
        const factor = totalOriginalVenta > 0 ? Math.min(1, montoModificacion / totalOriginalVenta) : 1
        const devueltoEfectivo = redondear2(repartoOriginal.efectivo * factor)
        const devueltoTransferencia = redondear2(repartoOriginal.transferencia * factor)
        const medioOriginal = medioDeVenta(ventaOriginal)
        const entry = {
          tipo: esCredito ? 'nota_credito' : 'nota_debito',
          tipoDoc: tipoNota,
          id: docId,
          monto: montoModificacion,
          total: esCredito ? -montoModificacion : montoModificacion,
          tipoPago: ventaOriginal.tipoPago || 'efectivo',
          ...(medioOriginal ? { medio: medioOriginal } : {}),
          // Movimiento por bolsillo, con signo: la NC saca plata (negativo) y la ND no mueve
          // la caja (queda por cobrar). Es lo que lee el desglose por origen del arqueo.
          montoEfectivo: esCredito ? -devueltoEfectivo : 0,
          montoTransferencia: esCredito ? -devueltoTransferencia : 0,
          fecha: f.toISOString(),
          serie_numero: correlativo,
          motivo,
        }
        let totalEfectivo = t.totalEfectivo || 0
        let totalTransferencia = t.totalTransferencia || 0
        if (esCredito) {
          totalEfectivo -= devueltoEfectivo
          totalTransferencia -= devueltoTransferencia
        }
        tx.update(turnoRef, {
          ventasDelTurno: [...(t.ventasDelTurno || []), entry],
          totalEfectivo,
          totalTransferencia,
        })
      }
    })
    return { success: true, correlativo, docId, nota }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}
