import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { obtenerProximoCorrelativoSunat } from '@/services/notas'
import {
  consolidarItems,
  descuentoConsolidado,
  documentoClienteConsolidado,
  nombreClienteConsolidado,
  totalConsolidado as totalDe,
} from '@/lib/consolidado'
import { db } from '@/lib/firebase'
import { porcentajeValido } from '@/lib/igv'

// Port de helper/ConsolidadoHelper.js → generarConsolidado (RN): crea una BOLETA
// que agrupa las Notas de Venta del día y marca cada NV como consolidada.
// La serie la decide quien llama vía `config.serieBoleta`: el cajero que consolida
// SUS NV pasa su serie de caja; un supervisor (que ve las de todos) pasa la global.
export async function generarConsolidado(nvs: any[], config: Record<string, any>, cajero: string | null = null, usuarioId: string | null = null) {
  if (!nvs || nvs.length === 0) return { success: false, error: 'No hay notas de venta pendientes de consolidación.' }

  const hoy = new Date()
  const anioMes = `${hoy.getFullYear()}-${hoy.getMonth() + 1}`
  const serie = config.serieBoleta || 'B001'
  const numSunat = await obtenerProximoCorrelativoSunat(serie)
  if (!numSunat) return { success: false, error: 'No se pudo obtener el correlativo SUNAT.' }

  const correlativoStr = `${serie}-${String(numSunat).padStart(6, '0')}`
  // 🔑 El total es la suma de los totales (ya netos) de cada NV y el **descuento se declara**: la
  // boleta consolidada se imprime y va a SUNAT como cualquier otra, así que tiene que cuadrar
  // líneas (precio de lista) − descuento = total. Antes sumaba los totales pero **tiraba el
  // descuento** y unía los items por `id` sin mirar el precio: una NV con promoción consolidada
  // salía con las líneas a precio de lista, el total menor y sin fila de descuento (y el XML
  // declaraba de más). Las reglas viven en `lib/consolidado.ts` (puras y testeadas).
  const total = totalDe(nvs)
  const descuento = descuentoConsolidado(nvs)
  const itemsConsolidado = consolidarItems(nvs)
  const nvIds = nvs.map((nv) => nv.id)
  const docId = `BOLETA-${correlativoStr}`
  const docRef = doc(db, COL.DOCUMENTOS, `${anioMes}_${docId}`)

  const ventaData = {
    id: 'consolidado_' + Date.now().toString(),
    fecha: hoy.toISOString(),
    items: itemsConsolidado,
    total,
    importe_total: total,
    // El descuento viaja igual que en una venta normal (camelCase, que es lo que leen el
    // comprobante y el XML) y con el nombre viejo para cualquier lector que ya lo usara.
    descuentoTotal: descuento,
    descuento_total: descuento,
    tipoPago: 'efectivo',
    efectivo: total,
    montoRecibido: total,
    cambio: 0,
    // 🔑 El nombre y el documento del receptor salen de la configuración (Configuración → SUNAT):
    // una consolidada no tiene cliente real, es un rótulo → `lib/consolidado.ts` es la regla única
    // y vacío vuelve al valor por defecto (nunca se declara un nombre en blanco).
    cliente_nombre: nombreClienteConsolidado(config),
    cliente_dni: documentoClienteConsolidado(config),
    serie_numero: correlativoStr,
    sucursal: config.sucursal || '',
    mensaje: config.mensaje || '',
    cajero: cajero || 'sistema',
    // 🔑 La tasa del IGV con la que nace la consolidada (18% general, 10% restaurantes/hoteles): queda
    // guardada con la venta para que el PDF, el XML y el SIRE declaren lo mismo (`lib/igv.ts`).
    igvPorcentaje: porcentajeValido(config.igvPorcentaje),
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

  return { success: true, correlativo: correlativoStr, total, nvsProcesadas: nvIds.length, docId }
}
