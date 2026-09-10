import { collection, doc, runTransaction, type DocumentSnapshot } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'

type ItemCompra = { productoId: string; productoNombre: string; codigo?: string; cantidad: number; costoUnitario: number; factor?: number; presentacionId?: string; presentacionNombre?: string }

export async function registrarCompra({
  items,
  proveedor,
  proveedorDireccion,
  nota,
  usuario = 'sistema',
  tipoPago = 'Transferencia',
  turnoId,
}: {
  items: ItemCompra[]
  proveedor: string
  proveedorDireccion?: string
  nota?: string
  usuario?: string
  tipoPago?: 'caja' | 'Transferencia'
  turnoId?: string | null
}): Promise<{ success: boolean; error?: string; compraId?: string; totalPagado?: number; resultados?: unknown[] }> {
  const lista = (items || []).filter((i) => i && i.cantidad > 0)
  if (lista.length === 0) return { success: false, error: 'Selecciona al menos un producto.' }
  if (!proveedor.trim()) return { success: false, error: 'Completa el proveedor.' }

  const compraId = 'compra_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
  const totalPagado = lista.reduce((s, i) => s + (i.cantidad || 0) * (i.costoUnitario || 0), 0)
  if (totalPagado <= 0) return { success: false, error: 'El total de la compra debe ser mayor a 0.' }

  try {
    const resultados = await runTransaction(db, async (tx) => {
      // FASE 1: Todas las lecturas ANTES de cualquier escritura.
      const lecturas: { item: ItemCompra; prodRef: ReturnType<typeof doc>; snap: DocumentSnapshot }[] = []

      // Si es pago desde caja, leer turno
      let turnoSnap: DocumentSnapshot | null = null
      let turnoRef: ReturnType<typeof doc> | null = null
      if (tipoPago === 'caja' && turnoId) {
        turnoRef = doc(db, COL.TURNOS, turnoId)
        turnoSnap = await tx.get(turnoRef)
        if (!turnoSnap.exists()) throw new Error('No se encontró el turno abierto.')
        const td = turnoSnap.data() as Record<string, unknown>
        const efectivoDisponible = ((td.montoInicial as number) || 0) + ((td.totalEfectivo as number) || 0) - ((td.totalGastosEfectivo as number) || 0) - ((td.vueltoTransferencia as number) || 0)
        if (totalPagado > efectivoDisponible) {
          throw new Error(`Saldo insuficiente en caja. Disponible: S/ ${efectivoDisponible.toFixed(2)}`)
        }
      }

      for (const item of lista) {
        const prodRef = doc(db, COL.PRODUCTOS, item.productoId)
        const snap = await tx.get(prodRef)
        if (!snap.exists()) throw new Error(`Producto "${item.productoNombre}" no existe.`)
        lecturas.push({ item, prodRef, snap })
      }

      // FASE 2: Todas las escrituras.
      const res: unknown[] = []
      for (const { item, prodRef, snap } of lecturas) {
        const data = snap.data() as Record<string, unknown>
        const factor = item.factor || 1
        const cantidadBase = (item.cantidad || 0) * factor
        const stockActual = (data.stock as number) || 0
        const nuevoStock = stockActual + cantidadBase
        tx.update(prodRef, { stock: nuevoStock, ultimaActualizacion: new Date().toISOString(), updatedAt: new Date().toISOString() })
        const movRef = doc(collection(db, COL.MOVIMIENTOS))
        tx.set(movRef, {
          productoId: item.productoId,
          productoCodigo: (data.codigo as string) || item.codigo || '',
          productoNombre: (data.nombre as string) || item.productoNombre,
          categoria: (data.categoria as string) || '',
          tipoMovimiento: 'compra',
          cantidad: cantidadBase,
          motivo: nota ? `Compra a ${proveedor}: ${nota}` : `Compra a ${proveedor}`,
          stockAnterior: stockActual,
          stockNuevo: nuevoStock,
          usuario,
          metadata: {
            compraId,
            proveedor,
            proveedorDireccion: proveedorDireccion || '',
            totalPagado,
            precioUnitario: item.costoUnitario,
            cantidadPresentacion: item.cantidad,
            factorConversion: factor,
            presentacionId: item.presentacionId || 'unidad',
            presentacionNombre: item.presentacionNombre || 'Unidad',
            nota: nota || '',
          },
          fecha: new Date().toISOString(),
          timestamp: Date.now(),
        })
        res.push({ productoId: item.productoId, stockAnterior: stockActual, nuevoStock })
      }

      // Actualizar turno si es pago desde caja
      if (tipoPago === 'caja' && turnoRef && turnoSnap) {
        const td = turnoSnap.data() as Record<string, unknown>
        const gastoDoc = {
          descripcion: `Compra mercadería a ${proveedor}${nota ? ` (${nota})` : ''}`,
          categoria: 'compra',
          monto: totalPagado,
          tipoPago: 'caja',
          fecha: new Date().toISOString(),
          compraId,
        }
        const nuevosGastos = [...((td.gastosDelTurno as unknown[]) || []), gastoDoc]
        tx.update(turnoRef, {
          gastosDelTurno: nuevosGastos,
          totalGastos: ((td.totalGastos as number) || 0) + totalPagado,
          totalGastosEfectivo: ((td.totalGastosEfectivo as number) || 0) + totalPagado,
        })
      }

      return res
    })
    return { success: true, resultados, compraId, totalPagado }
  } catch (e) {
    console.error('❌ Error registrando compra:', e)
    return { success: false, error: (e as Error).message }
  }
}
