import { addDoc, collection, deleteDoc, doc, getDocs, query, runTransaction, updateDoc, where } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { logActividad } from '@/lib/audit'
import { exigirRateLimit } from '@/lib/rate-limit'

export type Egreso = {
  id?: string
  monto: number
  descripcion: string
  categoria: string
  fecha: string
  tipoPago: 'caja' | 'transferencia' | 'otro'
  rucProveedor?: string
  proveedorNombre?: string
  comprobante?: string
  usuarioId?: string
  usuarioNombre?: string
  turnoId?: string
  createdAt?: string
}

const CATEGORIAS_EGRESO = ['Servicios', 'Alquiler', 'Sueldos', 'Compras', 'Impuestos', 'Mantenimiento', 'Transporte', 'Otros']

export { CATEGORIAS_EGRESO }

export async function registrarEgreso(egreso: Omit<Egreso, 'id' | 'createdAt'>): Promise<{ success: boolean; error?: string }> {
  exigirRateLimit('crear_egreso')
  try {
    if (!egreso.monto || egreso.monto <= 0) return { success: false, error: 'El monto debe ser mayor a 0.' }
    if (!egreso.descripcion?.trim()) return { success: false, error: 'La descripción es obligatoria.' }
    if (!egreso.categoria) return { success: false, error: 'Seleccioná una categoría.' }

    await addDoc(collection(db, COL.EGRESOS), {
      ...egreso,
      fecha: egreso.fecha || new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })

    logActividad({ accion: 'crear_egreso', entidad: COL.EGRESOS, entidadId: 'nuevo', detalle: { monto: egreso.monto, categoria: egreso.categoria, descripcion: egreso.descripcion } })

    return { success: true }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    console.error('❌ Error registrando egreso:', err.message)
    return { success: false, error: err.message || 'Error al registrar egreso.' }
  }
}

export async function registrarEgresoEnTurno(egreso: Omit<Egreso, 'id' | 'createdAt'>, turnoId: string): Promise<{ success: boolean; error?: string }> {
  exigirRateLimit('crear_egreso')
  try {
    if (!egreso.monto || egreso.monto <= 0) return { success: false, error: 'El monto debe ser mayor a 0.' }
    if (!egreso.descripcion?.trim()) return { success: false, error: 'La descripción es obligatoria.' }

    const res = await runTransaction(db, async (tx) => {
      const turnoRef = doc(db, COL.TURNOS, turnoId)
      const turnoSnap = await tx.get(turnoRef)
      if (!turnoSnap.exists()) return { success: false, error: 'No se encontró el turno.' }
      const turnoData = turnoSnap.data()

      // Validar saldo si es pago desde caja
      if (egreso.tipoPago === 'caja') {
        const efectivoDisponible = (turnoData.montoInicial || 0) + (turnoData.totalEfectivo || 0) - (turnoData.totalGastosEfectivo || 0) - (turnoData.vueltoTransferencia || 0)
        if (egreso.monto > efectivoDisponible) {
          return { success: false, error: `Saldo insuficiente. Disponible: S/ ${efectivoDisponible.toFixed(2)}` }
        }
      }

      // Registrar egreso
      const egresoDoc = {
        ...egreso,
        fecha: egreso.fecha || new Date().toISOString(),
        createdAt: new Date().toISOString(),
        turnoId,
      }
      const egresoRef = doc(collection(db, COL.EGRESOS))
      tx.set(egresoRef, egresoDoc)

      // Actualizar turno
      const nuevosGastos = [...(turnoData.gastosDelTurno || []), egresoDoc]
      const gastosEfectivo = (turnoData.totalGastosEfectivo || 0) + (egreso.tipoPago === 'caja' ? egreso.monto : 0)
      const gastosTransferencia = (turnoData.totalGastosTransferencia || 0) + (egreso.tipoPago === 'transferencia' ? egreso.monto : 0)
      tx.update(turnoRef, {
        gastosDelTurno: nuevosGastos,
        totalGastos: (turnoData.totalGastos || 0) + egreso.monto,
        totalGastosEfectivo: gastosEfectivo,
        totalGastosTransferencia: gastosTransferencia,
      })

      return { success: true }
    })

    if (res.success) {
      logActividad({ accion: 'crear_egreso_turno', entidad: COL.EGRESOS, entidadId: 'nuevo', detalle: { monto: egreso.monto, categoria: egreso.categoria, turnoId } })
    }
    return res
  } catch (e) {
    const err = e as { code?: string; message?: string }
    console.error('❌ Error registrando egreso en turno:', err.message)
    return { success: false, error: err.message || 'Error al registrar egreso.' }
  }
}

export async function eliminarEgreso(egresoId: string): Promise<{ success: boolean; error?: string }> {
  exigirRateLimit('eliminar_egreso')
  try {
    await deleteDoc(doc(db, COL.EGRESOS, egresoId))
    logActividad({ accion: 'eliminar_egreso', entidad: COL.EGRESOS, entidadId: egresoId, detalle: {} })
    return { success: true }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    console.error('❌ Error eliminando egreso:', err.message)
    return { success: false, error: err.message || 'Error al eliminar egreso.' }
  }
}

export async function actualizarEgreso(egresoId: string, datos: Partial<Egreso>): Promise<{ success: boolean; error?: string }> {
  try {
    if (!egresoId) return { success: false, error: 'ID de egreso no válido.' }
    const { id, ...rest } = datos
    await updateDoc(doc(db, COL.EGRESOS, egresoId), rest)
    logActividad({ accion: 'editar_egreso', entidad: COL.EGRESOS, entidadId: egresoId, detalle: rest })
    return { success: true }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    console.error('❌ Error actualizando egreso:', err.message)
    return { success: false, error: err.message || 'Error al actualizar egreso.' }
  }
}

export async function obtenerEgresosPorFecha(fechaDesde: string, fechaHasta: string): Promise<Egreso[]> {
  try {
    const snap = await getDocs(query(
      collection(db, COL.EGRESOS),
      where('fecha', '>=', fechaDesde),
      where('fecha', '<=', fechaHasta + 'T23:59:59')
    ))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Egreso))
  } catch (e) {
    console.error('❌ Error obteniendo egresos:', (e as Error).message)
    return []
  }
}
