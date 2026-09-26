import { collection, doc, getDocs, query, where } from 'firebase/firestore'
import { ejecutarTransaccion } from '@/services/transacciones'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'

export type EnvioEstado = 'pendiente' | 'en_camino' | 'entregado' | 'cancelado'

export type EnvioPendiente = {
  docId: string
  turnoId: string
  serieNumero: string
  clienteNombre: string
  clienteDni: string
  fecha: string
  total: number
  envio: {
    direccion: string
    referencia?: string
    zonaId?: string
    costo: number
    notas?: string
    estado: EnvioEstado
  }
}

/**
 * Obtiene envíos a domicilio pendientes de turnos anteriores al turno actual.
 * Consulta tblDocumentos de los últimos N días y filtra por envio.tipo === 'domicilio'.
 */
export async function obtenerEnviosPendientesAnteriores(turnoActualId?: string): Promise<EnvioPendiente[]> {
  // Últimos 7 días
  const desde = new Date()
  desde.setDate(desde.getDate() - 7)
  const desdeISO = desde.toISOString()

  const q = query(
    collection(db, COL.DOCUMENTOS),
    where('fecha', '>=', desdeISO),
  )

  const snap = await getDocs(q)
  const envios: EnvioPendiente[] = []

  snap.forEach((d) => {
    const data = d.data()
    const venta = data.venta
    if (!venta?.envio || venta.envio.tipo !== 'domicilio') return
    if (venta.envio.estado === 'entregado') return
    if (data.turnoId === turnoActualId) return // del turno actual ya se muestra aparte
    if (data.estado === 'anulada') return

    envios.push({
      docId: d.id,
      turnoId: data.turnoId || '',
      serieNumero: venta.serie_numero || data.serieNumero || '',
      clienteNombre: venta.cliente_nombre || '-',
      clienteDni: venta.cliente_dni || '-',
      fecha: venta.fecha || data.fecha || '',
      total: venta.total || 0,
      envio: {
        direccion: venta.envio.direccion || '',
        referencia: venta.envio.referencia || '',
        zonaId: venta.envio.zonaId || '',
        costo: venta.envio.costo || 0,
        notas: venta.envio.notas || '',
        estado: venta.envio.estado || 'pendiente',
      },
    })
  })

  return envios.sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/**
 * Actualiza el estado de un envío en tblDocumentos y en la venta del turno.
 */
export async function actualizarEstadoEnvio({
  docId,
  turnoId,
  serieNumero,
  nuevoEstado,
}: {
  docId: string
  turnoId?: string
  serieNumero: string
  nuevoEstado: EnvioEstado
}): Promise<{ success: boolean; error?: string }> {
  try {
    await ejecutarTransaccion(db, async (tx) => {
      // Actualizar en tblDocumentos
      const docRef = doc(db, COL.DOCUMENTOS, docId)
      const docSnap = await tx.get(docRef)
      if (!docSnap.exists()) throw new Error('Documento no encontrado')

      const data = docSnap.data()
      const ventaActualizada = { ...data.venta, envio: { ...data.venta.envio, estado: nuevoEstado } }
      tx.update(docRef, { venta: ventaActualizada })

      // Actualizar en tblTurnos.ventasDelTurno
      if (turnoId) {
        const turnoRef = doc(db, COL.TURNOS, turnoId)
        const turnoSnap = await tx.get(turnoRef)
        if (turnoSnap.exists()) {
          const turnoData = turnoSnap.data()
          const ventas = (turnoData.ventasDelTurno ?? []).map((v: Record<string, any>) => {
            if ((v.serie_numero || v.serieNumero) === serieNumero) {
              return { ...v, envio: { ...v.envio, estado: nuevoEstado } }
            }
            return v
          })
          tx.update(turnoRef, { ventasDelTurno: ventas })
        }
      }
    })

    return { success: true }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}
