import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { obtenerProximoCorrelativoSunat } from '@/services/notas'
import { db } from '@/lib/firebase'

// Port de helper/ConsolidadoHelper.js → generarConsolidado (RN): crea una BOLETA
// que agrupa las Notas de Venta del día y marca cada NV como consolidada.
export async function generarConsolidado(nvs: any[], config: Record<string, any>, cajero: string | null = null, usuarioId: string | null = null) {
  if (!nvs || nvs.length === 0) return { success: false, error: 'No hay notas de venta pendientes de consolidación.' }

  const hoy = new Date()
  const anioMes = `${hoy.getFullYear()}-${hoy.getMonth() + 1}`
  const serie = config.serieBoleta || 'B001'
  const numSunat = await obtenerProximoCorrelativoSunat(serie)
  if (!numSunat) return { success: false, error: 'No se pudo obtener el correlativo SUNAT.' }

  const correlativoStr = `${serie}-${String(numSunat).padStart(6, '0')}`
  const totalConsolidado = nvs.reduce((s, nv) => s + (nv.venta?.total || 0), 0)
  const itemsConsolidado = nvs.reduce((acc: any[], nv) => {
    const its = nv.venta?.items || []
    its.forEach((it: any) => {
      const existente = acc.find((a) => a.id === it.id)
      if (existente) {
        existente.cantidad += it.cantidad || 1
        existente.subtotal += it.subtotal || 0
      } else {
        acc.push({ ...it })
      }
    })
    return acc
  }, [])
  const nvIds = nvs.map((nv) => nv.id)
  const docId = `BOLETA-${correlativoStr}`
  const docRef = doc(db, COL.DOCUMENTOS, `${anioMes}_${docId}`)

  const ventaData = {
    id: 'consolidado_' + Date.now().toString(),
    fecha: hoy.toISOString(),
    items: itemsConsolidado,
    total: totalConsolidado,
    importe_total: totalConsolidado,
    tipoPago: 'efectivo',
    efectivo: totalConsolidado,
    montoRecibido: totalConsolidado,
    cambio: 0,
    cliente_nombre: config.clienteDefaultNombre || 'CONSUMIDOR FINAL',
    cliente_dni: config.clienteDefaultDni || '00000000',
    serie_numero: correlativoStr,
    sucursal: config.sucursal || '',
    mensaje: config.mensaje || '',
    cajero: cajero || 'sistema',
  }

  await setDoc(docRef, {
    tipo: 'BOLETA',
    tipoDoc: 'BOLETA',
    serie,
    numero: numSunat,
    correlativo: numSunat,
    serieNumero: correlativoStr,
    venta: ventaData,
    fecha: hoy.toISOString(),
    anio: hoy.getFullYear(),
    mes: hoy.getMonth() + 1,
    anioMes,
    createdAt: hoy.toISOString(),
    consolidado: true,
    nvsConsolidadas: nvIds,
    usuarioId: usuarioId || '',
    sunat: { serie, numero: numSunat, estado: 'pendiente' },
  })

  await Promise.all(nvs.map((nv) => updateDoc(doc(db, COL.DOCUMENTOS, nv.id), { sunat: { consolidado: true, consolidadoAt: hoy.toISOString(), documentoConsolidadoId: docId } })))

  return { success: true, correlativo: correlativoStr, total: totalConsolidado, nvsProcesadas: nvIds.length, docId }
}
