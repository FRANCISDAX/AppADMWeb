import { collection, doc, getDocs, runTransaction, query, where, type DocumentSnapshot } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'

export type PagoProveedor = {
  monto: number
  tipoPago: 'efectivo' | 'transferencia' | 'yape' | 'plin'
  fecha: string
  nota?: string
}

// Registra un pago a un proveedor y actualiza su saldo.
export async function registrarPagoProveedor(
  proveedorId: string,
  pago: Omit<PagoProveedor, 'fecha'>,
  turnoId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  if (pago.monto <= 0) return { success: false, error: 'El monto debe ser mayor a 0.' }
  if (!proveedorId.trim()) return { success: false, error: 'Proveedor inválido.' }

  try {
    await runTransaction(db, async (tx) => {
      const provRef = doc(db, COL.PROVEEDOR, proveedorId)
      const provSnap: DocumentSnapshot = await tx.get(provRef)
      if (!provSnap.exists()) throw new Error('Proveedor no encontrado.')
      const provData = provSnap.data() as Record<string, unknown>
      const saldoActual = (provData.saldoPendiente as number) || 0
      const nuevoSaldo = Math.max(0, saldoActual - pago.monto)

      // Actualizar saldo del proveedor
      tx.update(provRef, { saldoPendiente: nuevoSaldo, updatedAt: new Date().toISOString() })

      // Registrar el pago como movimiento de egreso
      const pagoRef = doc(collection(db, COL.EGRESOS))
      tx.set(pagoRef, {
        descripcion: `Pago a proveedor: ${provData.nombre || proveedorId}`,
        categoria: 'pago_proveedor',
        monto: pago.monto,
        tipoPago: pago.tipoPago,
        proveedorId,
        proveedorNombre: provData.nombre || '',
        nota: pago.nota || '',
        fecha: new Date().toISOString(),
        usuario: 'sistema',
      })

      // Si es pago desde caja, descontar del turno
      if (turnoId) {
        const turnoRef = doc(db, COL.TURNOS, turnoId)
        const turnoSnap: DocumentSnapshot = await tx.get(turnoRef)
        if (turnoSnap.exists()) {
          const td = turnoSnap.data() as Record<string, unknown>
          const gastoDoc = {
            descripcion: `Pago a proveedor: ${provData.nombre || proveedorId}`,
            categoria: 'pago_proveedor',
            monto: pago.monto,
            tipoPago: 'caja',
            fecha: new Date().toISOString(),
            proveedorId,
          }
          const nuevosGastos = [...((td.gastosDelTurno as unknown[]) || []), gastoDoc]
          tx.update(turnoRef, {
            gastosDelTurno: nuevosGastos,
            totalGastos: ((td.totalGastos as number) || 0) + pago.monto,
            totalGastosEfectivo: ((td.totalGastosEfectivo as number) || 0) + pago.monto,
          })
        }
      }
    })
    return { success: true }
  } catch (e) {
    console.error('❌ Error registrando pago a proveedor:', e)
    return { success: false, error: (e as Error).message }
  }
}

// Obtiene el historial de pagos a un proveedor (desde tblEgresos).
export async function obtenerPagosProveedor(proveedorId: string): Promise<PagoProveedor[]> {
  try {
    const q = query(collection(db, COL.EGRESOS), where('proveedorId', '==', proveedorId), where('categoria', '==', 'pago_proveedor'))
    const snap = await getDocs(q)
    return snap.docs.map((d) => {
      const data = d.data()
      return { monto: data.monto || 0, tipoPago: data.tipoPago || 'efectivo', fecha: data.fecha || '', nota: data.nota || '' }
    }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
  } catch {
    return []
  }
}
