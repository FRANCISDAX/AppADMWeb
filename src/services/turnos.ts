import { addDoc, collection, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { logActividad } from '@/lib/audit'
import { exigirRateLimit } from '@/lib/rate-limit'
import { analizarCierre } from '@/lib/auditoria-caja'

export type Turno = {
  id?: string
  usuarioId?: string
  usuarioNombre?: string
  tipoTurno?: string
  fechaApertura?: string
  estado?: 'abierto' | 'cerrado'
  montoInicial?: number
  ventasDelTurno?: any[]
  gastosDelTurno?: any[]
  totalVentas?: number
  totalEfectivo?: number
  totalTransferencia?: number
  totalGastos?: number
  totalGastosEfectivo?: number
  totalGastosTransferencia?: number
}

export async function buscarTurnoAbierto(usuarioId?: string | null, permiteOtros = false): Promise<Turno | null> {
  try {
    const snap = await getDocs(query(collection(db, COL.TURNOS), where('estado', '==', 'abierto')))
    if (snap.empty) return null
    const docs = snap.docs
    const propio = usuarioId ? docs.find((d) => d.data().usuarioId === usuarioId) : undefined
    // Solo el turno del propio usuario, salvo que sea supervisor (verTodo) → puede usar cualquier turno abierto.
    const elegido = propio || (permiteOtros ? docs[0] : undefined)
    if (!elegido) return null
    return { id: elegido.id, ...elegido.data() }
  } catch (e) {
    console.error('❌ Error buscando turno:', (e as Error).message)
    return null
  }
}

export async function abrirTurno({ tipoTurno, montoInicial, usuarioId, usuarioNombre }: { tipoTurno: string; montoInicial: number; usuarioId: string; usuarioNombre: string }) {
  exigirRateLimit('abrir_turno')
  try {
    const abiertos = await getDocs(query(collection(db, COL.TURNOS), where('estado', '==', 'abierto'), where('usuarioId', '==', usuarioId)))
    if (!abiertos.empty) {
      const existente = abiertos.docs[0].data()
      const apertura = existente.fechaApertura
        ? new Date(existente.fechaApertura).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : 'fecha desconocida'
      return { success: false, error: `Ya tenés un turno ${existente.tipoTurno || ''} abierto desde el ${apertura}.` }
    }
    const nuevoTurno = {
      usuarioId,
      usuarioNombre: usuarioNombre || usuarioId,
      tipoTurno,
      fechaApertura: new Date().toISOString(),
      estado: 'abierto' as const,
      montoInicial,
      ventasDelTurno: [],
      totalVentas: 0,
      totalEfectivo: 0,
      totalTransferencia: 0,
      createdAt: new Date().toISOString(),
    }
    const ref = await addDoc(collection(db, COL.TURNOS), nuevoTurno)
    logActividad({ accion: 'abrir_turno', entidad: COL.TURNOS, entidadId: ref.id, detalle: { tipoTurno, montoInicial, usuarioNombre } })
    return { success: true, turno: { id: ref.id, ...nuevoTurno } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function cerrarTurno({ turnoId, montoFinalEfectivo, observaciones, usuarioId, esSupervisor = false }: { turnoId: string; montoFinalEfectivo: number; observaciones: string; usuarioId: string; esSupervisor?: boolean }) {
  exigirRateLimit('cerrar_turno')
  try {
    const fechaCierre = new Date().toISOString()
    const turnoDocRef = doc(db, COL.TURNOS, turnoId)
    const cierreRef = doc(collection(db, COL.CIERRES))

    const cierre = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(turnoDocRef)
      if (!snap.exists()) throw new Error('El turno activo ya no existe.')
      const t = snap.data()
      // Solo el dueño del turno puede cerrarlo, salvo supervisor (verTodo / admin).
      if (t.usuarioId && t.usuarioId !== usuarioId && !esSupervisor) {
        throw new Error('Solo podés cerrar tu propio turno.')
      }
      const totalVentas = t.totalVentas || 0
      const totalGastos = t.totalGastos || 0
      const vueltoTransferencia = t.vueltoTransferencia || 0
      const efectivoEsperado = (t.montoInicial || 0) + (t.totalEfectivo || 0) - (t.totalGastosEfectivo || 0) - vueltoTransferencia
      const diferencia = montoFinalEfectivo - efectivoEsperado

      const analisis = analizarCierre({
        montoInicial: t.montoInicial || 0,
        totalEfectivo: t.totalEfectivo || 0,
        totalGastosEfectivo: t.totalGastosEfectivo || 0,
        ventasDelTurno: t.ventasDelTurno || [],
        efectivoReal: montoFinalEfectivo,
      })

      const cierreDoc = {
        turnoId,
        usuarioId,
        usuarioNombre: t.usuarioNombre,
        tipoTurno: t.tipoTurno,
        fechaApertura: t.fechaApertura,
        fechaCierre,
        montoInicial: t.montoInicial,
        totalVentas,
        totalEfectivo: t.totalEfectivo || 0,
        totalTransferencia: t.totalTransferencia || 0,
        totalGastos,
        totalGastosEfectivo: t.totalGastosEfectivo || 0,
        totalGastosTransferencia: t.totalGastosTransferencia || 0,
        efectivoEsperado,
        montoFinalEfectivo,
        diferencia,
        analisis: {
          causas: analisis.causas,
          recomendaciones: analisis.recomendaciones,
        },
        observaciones,
        ventas: t.ventasDelTurno || [],
        gastos: t.gastosDelTurno || [],
        createdAt: fechaCierre,
      }
      transaction.set(cierreRef, cierreDoc)
      transaction.update(turnoDocRef, { estado: 'cerrado', fechaCierre, montoFinalEfectivo, efectivoEsperado, diferencia })
      return cierreDoc
    })

    logActividad({ accion: 'cerrar_turno', entidad: COL.TURNOS, entidadId: turnoId, detalle: { montoFinalEfectivo, diferencia: cierre.diferencia } })

    return { success: true, cierre }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function obtenerTurnoActivo(usuarioId?: string | null, permiteOtros = false): Promise<Turno | null> {
  return buscarTurnoAbierto(usuarioId, permiteOtros)
}

// Helper para mantener sincronizada la lista de venta si se necesita re-leer el turno.
export async function refrescarTurno(turnoId: string) {
  try {
    const snap = await getDoc(doc(db, COL.TURNOS, turnoId))
    return snap.exists() ? { id: snap.id, ...snap.data() } : null
  } catch (e) {
    console.error('❌ Error refrescando turno:', e)
    return null
  }
}
