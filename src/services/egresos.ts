import { addDoc, collection, deleteDoc, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { ejecutarTransaccion } from '@/services/transacciones'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { logActividad } from '@/lib/audit'
import { exigirRateLimit } from '@/lib/rate-limit'
import { efectivoEsperadoDe } from '@/lib/arqueo'
import { limpiarUndefined, mensajeDeDatoInvalido } from '@/lib/limpio'
import { entraAlTurno, esProvision, tocaLaCaja, type MedioDeEgreso } from '@/lib/egresos-medios'

export type { MedioDeEgreso }

export type Egreso = {
  id?: string
  monto: number
  descripcion: string
  categoria: string
  fecha: string
  /**
   * 🔑 **De dónde salió la plata — o si todavía no salió** (`lib/egresos-medios.ts` es la regla única).
   * `provision` = devengado y sin pagar; `dueno` = lo pagó el dueño de su bolsillo. **Ninguno de los dos
   * toca el cajón** ni entra al turno.
   */
  tipoPago: MedioDeEgreso
  rucProveedor?: string
  proveedorNombre?: string
  proveedorId?: string
  comprobante?: string
  usuarioId?: string
  usuarioNombre?: string
  turnoId?: string
  /** Cuándo se marcó pagada una provisión (ISO). Solo lo escribe `pagarProvisionDeEgreso`. */
  fechaPago?: string
  createdAt?: string
}

const CATEGORIAS_EGRESO = ['Servicios', 'Alquiler', 'Sueldos', 'Compras', 'Impuestos', 'Mantenimiento', 'Transporte', 'Otros']

export { CATEGORIAS_EGRESO }

export async function registrarEgreso(egreso: Omit<Egreso, 'id' | 'createdAt'>): Promise<{ success: boolean; error?: string }> {
  exigirRateLimit('crear_egreso')
  try {
    if (!egreso.monto || egreso.monto <= 0) return { success: false, error: 'El monto debe ser mayor a 0.' }
    if (!egreso.descripcion?.trim()) return { success: false, error: 'La descripción es obligatoria.' }
    if (!egreso.categoria) return { success: false, error: 'Selecciona una categoría.' }

    // ⚠️ **`limpiarUndefined` es obligatorio acá**: los datos del proveedor y el comprobante son
    // opcionales y llegan como `undefined` cuando el que carga el gasto no los completa. Firestore
    // **rechaza** `undefined` (*"Unsupported field value: undefined"*) y sin esto **no se guardaba
    // nada**: es el bug real del 28/09/2026 (una compra de bolsas cargada a mano en Gastos/Egresos).
    await addDoc(
      collection(db, COL.EGRESOS),
      limpiarUndefined({
        ...egreso,
        fecha: egreso.fecha || new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }),
    )

    logActividad({ accion: 'crear_egreso', entidad: COL.EGRESOS, entidadId: 'nuevo', detalle: { monto: egreso.monto, categoria: egreso.categoria, descripcion: egreso.descripcion } })

    return { success: true }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    console.error('❌ Error registrando egreso:', err.message)
    return { success: false, error: mensajeDeDatoInvalido(err.message) || err.message || 'Error al registrar egreso.' }
  }
}

export async function registrarEgresoEnTurno(egreso: Omit<Egreso, 'id' | 'createdAt'>, turnoId: string): Promise<{ success: boolean; error?: string }> {
  exigirRateLimit('crear_egreso')
  try {
    if (!egreso.monto || egreso.monto <= 0) return { success: false, error: 'El monto debe ser mayor a 0.' }
    if (!egreso.descripcion?.trim()) return { success: false, error: 'La descripción es obligatoria.' }
    // 🔑 **Una provisión o un pago del dueño NO entran al turno** (`lib/egresos-medios.ts`): no salió plata
    // del cajón. Si alguien las manda por acá, se corta con un motivo claro en vez de ensuciar el arqueo.
    if (!entraAlTurno(egreso.tipoPago)) {
      return {
        success: false,
        error: esProvision(egreso.tipoPago)
          ? 'Una provisión todavía no está pagada: registrala sin turno.'
          : 'Ese medio no mueve la caja: registralo sin turno.',
      }
    }

    const res = await ejecutarTransaccion(db, async (tx) => {
      const turnoRef = doc(db, COL.TURNOS, turnoId)
      const turnoSnap = await tx.get(turnoRef)
      if (!turnoSnap.exists()) return { success: false, error: 'No se encontró el turno.' }
      const turnoData = turnoSnap.data()

      // Validar saldo si es pago desde caja
      if (tocaLaCaja(egreso.tipoPago)) {
        const efectivoDisponible = efectivoEsperadoDe({
          montoInicial: turnoData.montoInicial,
          totalEfectivo: turnoData.totalEfectivo,
          totalGastosEfectivo: turnoData.totalGastosEfectivo,
          vueltoTransferencia: turnoData.vueltoTransferencia,
        })
        if (egreso.monto > efectivoDisponible) {
          return { success: false, error: `Saldo insuficiente. Disponible: S/ ${efectivoDisponible.toFixed(2)}` }
        }
      }

      // Registrar egreso.
      // ⚠️ **`limpiarUndefined` antes de escribir** (bug real del 28/09/2026): con el proveedor sin
      // cargar, la pantalla manda `proveedorId: undefined` y el `tx.set` se caía con *"Function
      // transaction.set() called with invalid data. Unsupported field value: undefined"*.
      // 🔑 Y el **mismo objeto limpio** va al turno: `gastosDelTurno` es un array y un `undefined`
      // adentro hace fallar **la misma transacción** (o sea: se perdía también el gasto del turno).
      const egresoLimpio = limpiarUndefined({
        ...egreso,
        fecha: egreso.fecha || new Date().toISOString(),
        createdAt: new Date().toISOString(),
        turnoId,
      })
      const egresoRef = doc(collection(db, COL.EGRESOS))
      tx.set(egresoRef, egresoLimpio)

      // Actualizar turno
      const nuevosGastos = [...(turnoData.gastosDelTurno || []), egresoLimpio]
      const gastosEfectivo = (turnoData.totalGastosEfectivo || 0) + (tocaLaCaja(egreso.tipoPago) ? egreso.monto : 0)
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
    return { success: false, error: mensajeDeDatoInvalido(err.message) || err.message || 'Error al registrar egreso.' }
  }
}

/**
 * 🔑 **Marcar una provisión como pagada** (03/11/2026, decisión del usuario): *«cuando se pague con caja se
 * va a descontar de caja, solo cuando suceda»*.
 *
 * Es **el mismo documento** que cambia de estado (`provision` → el medio real), así que el gasto **no puede
 * contarse dos veces**: ni en el punto de equilibrio (sigue siendo un egreso) ni en el arqueo (se descuenta
 * una sola vez, acá).
 *
 * - **`caja`**: pide turno abierto, **valida el saldo** con `efectivoEsperadoDe` y recién ahí suma a
 *   `totalGastosEfectivo` del turno.
 * - **`transferencia`**: pide turno (es un pago del día) y suma a `totalGastosTransferencia`.
 * - **`dueno`** / **`otro`**: no tocan ningún turno ni el cajón.
 * - ⚠️ Un medio que no sea de pago (`provision`) se rechaza: no se puede "pagar con provisión".
 */
export async function pagarProvisionDeEgreso(
  egresoId: string,
  opciones: { medio: MedioDeEgreso; turnoId?: string | null }
): Promise<{ success: boolean; error?: string }> {
  const { medio, turnoId } = opciones
  if (esProvision(medio)) return { success: false, error: 'Elegí cómo se pagó: caja, transferencia o lo pagó el dueño.' }
  const necesitaTurno = tocaLaCaja(medio) || medio === 'transferencia'
  if (necesitaTurno && !turnoId) {
    return { success: false, error: 'No hay un turno abierto: un pago de caja o transferencia se registra en el turno del día.' }
  }

  try {
    const res = await ejecutarTransaccion(db, async (tx) => {
      const egresoRef = doc(db, COL.EGRESOS, egresoId)
      const egresoSnap = await tx.get(egresoRef)
      if (!egresoSnap.exists()) return { success: false, error: 'El egreso no existe.' }
      const egreso = egresoSnap.data() as Egreso
      if (!esProvision(egreso.tipoPago)) return { success: false, error: 'Ese egreso ya figura como pagado.' }
      const monto = Number(egreso.monto) || 0

      const cambios = limpiarUndefined({
        tipoPago: medio,
        fechaPago: new Date().toISOString(),
        ...(turnoId ? { turnoId } : {}),
      })

      if (necesitaTurno && turnoId) {
        const turnoRef = doc(db, COL.TURNOS, turnoId)
        const turnoSnap = await tx.get(turnoRef)
        if (!turnoSnap.exists()) return { success: false, error: 'No se encontró el turno.' }
        const td = turnoSnap.data() as Record<string, unknown>

        if (tocaLaCaja(medio)) {
          const disponible = efectivoEsperadoDe({
            montoInicial: td.montoInicial as number,
            totalEfectivo: td.totalEfectivo as number,
            totalGastosEfectivo: td.totalGastosEfectivo as number,
            vueltoTransferencia: td.vueltoTransferencia as number,
          })
          if (monto > disponible) {
            return { success: false, error: `Saldo insuficiente. Disponible: S/ ${disponible.toFixed(2)}` }
          }
        }

        tx.update(
          turnoRef,
          limpiarUndefined({
            gastosDelTurno: [...((td.gastosDelTurno as unknown[]) || []), limpiarUndefined({ ...egreso, ...cambios })],
            totalGastos: ((td.totalGastos as number) || 0) + monto,
            ...(tocaLaCaja(medio) ? { totalGastosEfectivo: ((td.totalGastosEfectivo as number) || 0) + monto } : {}),
            ...(medio === 'transferencia' ? { totalGastosTransferencia: ((td.totalGastosTransferencia as number) || 0) + monto } : {}),
          })
        )
      }

      tx.update(egresoRef, cambios)
      return { success: true }
    }, 'pagar una provisión')

    if (res.success) {
      logActividad({ accion: 'pagar_provision_egreso', entidad: COL.EGRESOS, entidadId: egresoId, detalle: { medio, turnoId: turnoId ?? '' } })
    }
    return res
  } catch (e) {
    const err = e as { code?: string; message?: string }
    console.error('❌ Error pagando la provisión:', err.message)
    return { success: false, error: mensajeDeDatoInvalido(err.message) || err.message || 'No se pudo registrar el pago.' }
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
    // ⚠️ El mismo cuidado que al crear: editar un gasto también puede mandar `undefined`
    // (el RUC, el nombre del proveedor o el comprobante vacíos) y `updateDoc` lo rechaza igual.
    await updateDoc(doc(db, COL.EGRESOS, egresoId), limpiarUndefined(rest))
    logActividad({ accion: 'editar_egreso', entidad: COL.EGRESOS, entidadId: egresoId, detalle: rest })
    return { success: true }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    console.error('❌ Error actualizando egreso:', err.message)
    return { success: false, error: mensajeDeDatoInvalido(err.message) || err.message || 'Error al actualizar egreso.' }
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
