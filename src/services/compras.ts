import { collection, doc, runTransaction, type DocumentSnapshot } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { efectivoEsperadoDe } from '@/lib/arqueo'
import { valorizacionDeMovimiento } from '@/services/kardex'
import { registrarCambioPrecio } from '@/services/historial-precios'

type ItemCompra = { productoId: string; productoNombre: string; codigo?: string; cantidad: number; costoUnitario: number; factor?: number; presentacionId?: string; presentacionNombre?: string }

/** Lo que devuelve la compra por cada producto, para poder registrar el cambio de costo. */
export type ResultadoCompra = {
  productoId: string
  productoNombre: string
  stockAnterior: number
  nuevoStock: number
  /** Costo por **unidad base** que tenía el producto antes de esta compra. */
  precioCompraAnterior: number
  /** Costo por unidad base después de la compra (el mismo, si el ítem vino sin costo). */
  precioCompraNuevo: number
}

export async function registrarCompra({
  items,
  proveedor,
  proveedorId,
  proveedorDireccion,
  nota,
  usuario = 'sistema',
  tipoPago = 'Transferencia',
  turnoId,
}: {
  items: ItemCompra[]
  proveedor: string
  proveedorId?: string
  proveedorDireccion?: string
  nota?: string
  usuario?: string
  tipoPago?: 'caja' | 'Transferencia'
  turnoId?: string | null
}): Promise<{ success: boolean; error?: string; compraId?: string; totalPagado?: number; resultados?: ResultadoCompra[] }> {
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
        const efectivoDisponible = efectivoEsperadoDe({
          montoInicial: td.montoInicial as number,
          totalEfectivo: td.totalEfectivo as number,
          totalGastosEfectivo: td.totalGastosEfectivo as number,
          vueltoTransferencia: td.vueltoTransferencia as number,
        })
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
      const res: ResultadoCompra[] = []
      for (const { item, prodRef, snap } of lecturas) {
        const data = snap.data() as Record<string, unknown>
        const factor = item.factor || 1
        const cantidadBase = (item.cantidad || 0) * factor
        const stockActual = (data.stock as number) || 0
        const nuevoStock = stockActual + cantidadBase
        // 🔑 **Comprar es lo que alimenta el costo promedio ponderado** (`lib/valorizacion.ts`).
        // ⚠️ El costo del ítem es **por presentación** (así se calcula `totalPagado`), y el promedio
        // se lleva **por unidad base**: por eso se divide por el factor de conversión.
        const costoBase = factor > 0 ? (Number(item.costoUnitario) || 0) / factor : Number(item.costoUnitario) || 0
        const valorizado = valorizacionDeMovimiento({
          tipoMovimiento: 'compra',
          cantidad: cantidadBase,
          stockAntes: stockActual,
          stockNuevo: nuevoStock,
          producto: data as { costoPromedio?: number | null; precioCompra?: number | null },
          costoEntrada: costoBase,
        })
        tx.update(prodRef, {
          stock: nuevoStock,
          ...valorizado.camposProducto,
          // 🔑 **La compra también deja actualizado el último costo del producto.** `costoBase` es el
          // costo por **unidad base** (el de la presentación dividido por su factor), que es la unidad
          // en la que se guarda `precioCompra`. Antes **ninguna compra lo escribía** —solo el
          // formulario manual— así que el campo quedaba viejo y lo mostraban desactualizado la columna
          // «Precio Compra» del Inventario, la precarga del modal de compra y el respaldo de
          // `costoDeProducto()`. ⚠️ Un ítem **sin costo** (una bonificación) **no** lo pisa: no hay
          // costo que registrar, y pisarlo con 0 haría que el producto valga 0.
          ...(costoBase > 0 ? { precioCompra: costoBase } : {}),
          ultimaActualizacion: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
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
          // Kardex **valorizado**: con qué costo se valorizó esta entrada y cómo quedaron el
          // promedio y el valor del stock.
          ...valorizado.camposMovimiento,
          usuario,
          metadata: {
            compraId,
            proveedor,
            proveedorId: proveedorId || '',
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
        res.push({
          productoId: item.productoId,
          productoNombre: (data.nombre as string) || item.productoNombre,
          stockAnterior: stockActual,
          nuevoStock,
          precioCompraAnterior: Number(data.precioCompra) || 0,
          precioCompraNuevo: costoBase > 0 ? costoBase : Number(data.precioCompra) || 0,
        })
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

    // El cambio de costo que trajo la compra queda en el **historial de precios**, igual que cuando se
    // edita el producto a mano (`Inventario.tsx` → `registrarCambioPrecio`). Antes la compra cambiaba
    // el costo sin dejar rastro de cuál era el anterior, así que no se podía auditar un aumento del
    // proveedor. Va **después** de la transacción y sin `await`: `registrarCambioPrecio` maneja sus
    // propios errores y un fallo al escribir el historial no puede tumbar una compra ya registrada.
    for (const r of resultados) {
      if (r.precioCompraAnterior !== r.precioCompraNuevo) {
        registrarCambioPrecio({
          productoId: r.productoId,
          productoNombre: r.productoNombre,
          campo: 'precioCompra',
          valorAnterior: r.precioCompraAnterior,
          valorNuevo: r.precioCompraNuevo,
          usuario,
        })
      }
    }

    return { success: true, resultados, compraId, totalPagado }
  } catch (e) {
    console.error('❌ Error registrando compra:', e)
    return { success: false, error: (e as Error).message }
  }
}
