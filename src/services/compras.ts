import { collection, doc, getDocs, query, type DocumentSnapshot, where } from 'firebase/firestore'
import { ejecutarTransaccion } from '@/services/transacciones'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { efectivoEsperadoDe } from '@/lib/arqueo'
import { costoPorUnidadBase } from '@/lib/valorizacion'
import { costoDeCompra } from '@/lib/precio-venta'
import { valorizacionDeMovimiento } from '@/services/kardex'
import { registrarCambioPrecio } from '@/services/historial-precios'
import type { CompraRegistro, ItemCompraRegistro } from '@/lib/registro-compras'

type ItemCompra = { productoId: string; productoNombre: string; codigo?: string; cantidad: number; costoUnitario: number; factor?: number; presentacionId?: string; presentacionNombre?: string; /** ¿El comprobante del proveedor trae IGV? (dato del papel, para el Registro de Compras). */ traeIgv?: boolean }

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
  igvRecuperable = false,
  comprobante = {},
}: {
  items: ItemCompra[]
  proveedor: string
  proveedorId?: string
  proveedorDireccion?: string
  nota?: string
  usuario?: string
  tipoPago?: 'caja' | 'Transferencia'
  turnoId?: string | null
  /** `config.igvRecuperable`: ¿el IGV de esta compra es crédito fiscal? Ver `costoDeCompra`. */
  igvRecuperable?: boolean
  /** El comprobante del proveedor (tipo, serie, número y fecha de emisión): es lo que pide el Registro de Compras. */
  comprobante?: { tipoComprobante?: string; serie?: string; numero?: string; fechaEmision?: string }
}): Promise<{ success: boolean; error?: string; compraId?: string; totalPagado?: number; resultados?: ResultadoCompra[] }> {
  const lista = (items || []).filter((i) => i && i.cantidad > 0)
  if (lista.length === 0) return { success: false, error: 'Selecciona al menos un producto.' }
  if (!proveedor.trim()) return { success: false, error: 'Completa el proveedor.' }

  const compraId = 'compra_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
  const totalPagado = lista.reduce((s, i) => s + (i.cantidad || 0) * (i.costoUnitario || 0), 0)
  if (totalPagado <= 0) return { success: false, error: 'El total de la compra debe ser mayor a 0.' }

  try {
    const resultados = await ejecutarTransaccion(db, async (tx) => {
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
        // se lleva **por unidad base**: por eso se divide por el factor de conversión. La división vive
        // en **`costoPorUnidadBase`** (puro) para que sea exactamente la misma que muestra el modal.
        const costoBase = costoPorUnidadBase(item.costoUnitario, factor)
        // 🔑 **Y acá se separa el IGV, si esa plata es un crédito fiscal** (`costoDeCompra`, la regla
        // única que el modal usa para mostrar el mismo número). ⚠️ Se decide con la afectación con la
        // que se **vende** el producto (un exonerado no lleva IGV en la factura) y con lo que dijo
        // quien cargó la compra (`yaSinIgv`). El **total pagado no cambia**: lo que se pagó es lo que
        // salió de la caja; lo que cambia es el **costo** con el que se valoriza y se mide el margen.
        const { costo, igvSeparado, separaIgv } = costoDeCompra(costoBase, {
          igvRecuperable,
          afectacion: String(data.tipoAfectacion || ''),
          // 🔑 **El IGV se separa del costo solo si el papel lo trae y el negocio lo recupera**. `traeIgv`
          // describe el comprobante del proveedor (`item.traeIgv`), no el producto: acá se compra en Lima con
          // factura y se puede vender exonerado.
          yaSinIgv: !item.traeIgv,
        })
        const valorizado = valorizacionDeMovimiento({
          tipoMovimiento: 'compra',
          cantidad: cantidadBase,
          stockAntes: stockActual,
          stockNuevo: nuevoStock,
          producto: data as { costoPromedio?: number | null; precioCompra?: number | null },
          costoEntrada: costo,
        })
        tx.update(prodRef, {
          stock: nuevoStock,
          ...valorizado.camposProducto,
          // 🔑 **La compra también deja actualizado el último costo del producto.** Es el costo por
          // **unidad base** (el de la presentación dividido por su factor, y sin IGV si es crédito
          // fiscal), que es la unidad en la que se guarda `precioCompra`. Antes **ninguna compra lo
          // escribía** —solo el formulario manual— así que el campo quedaba viejo y lo mostraban
          // desactualizado la columna «Precio Compra» del Inventario, la precarga del modal de compra y
          // el respaldo de `costoDeProducto()`. ⚠️ Un ítem **sin costo** (una bonificación) **no** lo
          // pisa: no hay costo que registrar, y pisarlo con 0 haría que el producto valga 0.
          ...(costo > 0 ? { precioCompra: costo } : {}),
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
            // ⚠️ `precioUnitario` es lo que dice la **factura** (con IGV si vino con IGV): es la
            // referencia para cuadrar contra el papel. El costo con el que se valorizó está en
            // `costoUnitario` (arriba, `camposMovimiento`), que es el neto cuando se separó el IGV.
            ...(separaIgv ? { igvSeparado, costoConIgv: item.costoUnitario } : {}),
            // 🔑 **Lo que el Registro de Compras (SUNAT · RCE) necesita saber del comprobante del proveedor**:
            // sin el tipo y el serie/número, la fila no se puede anotar (de ahí sale el CAR de 27 dígitos,
            // `lib/registro-compras.ts`). Se guarda en **cada movimiento** de la compra (es un dato del
            // comprobante, no del producto) para poder armar el registro sin leer otra colección.
            tipoComprobante: comprobante.tipoComprobante || '',
            serieComprobante: comprobante.serie || '',
            numeroComprobante: comprobante.numero || '',
            fechaEmisionComprobante: comprobante.fechaEmision || '',
            // ⚠️ **`traeIgv` es lo que dice el PAPEL, no la afectación del producto**: una compra en Lima
            // puede traer IGV para un producto que acá se vende exonerado. `igvConCredito` (el interruptor
            // del negocio) decide si ese IGV va a las columnas **DG** o **DGNG** del registro; se guarda
            // **con la compra** para que el registro no cambie si mañana se cambia la config.
            traeIgv: Boolean(item.traeIgv),
            ...(item.traeIgv ? { igvConCredito: Boolean(igvRecuperable) } : {}),
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
          precioCompraNuevo: costo > 0 ? costo : Number(data.precioCompra) || 0,
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

/**
 * **Las compras de un mes, agrupadas por comprobante** — para el **Registro de Compras (SUNAT · RCE)**.
 *
 * 🔑 **Se leen los movimientos del kardex, no una colección de compras**: una compra **es** un grupo de
 * movimientos con el mismo `metadata.compraId`, y ahí está todo lo que el registro necesita (proveedor y su
 * RUC, tipo/serie/número del comprobante, el importe de cada línea y si esa línea traía IGV).
 *
 * ⚠️ **La consulta es un solo rango de fechas** (`fecha` entre el 1 y el último día del mes) y el filtro de
 * `tipoMovimiento === 'compra'` va **en JavaScript**: con las dos condiciones en Firestore haría falta un
 * **índice compuesto** (igualdad + rango) y no vale la pena sólo para ahorrar lecturas de un mes.
 *
 * ⚠️ **Ojo con la fecha**: los movimientos guardan `fecha` en **ISO/UTC** (a diferencia de turnos y documentos,
 * que van en local). Se usa el mes local para armar el rango, igual que el resto de los reportes.
 */
export async function obtenerComprasDelMes(anio: number, mes: number): Promise<CompraRegistro[]> {
  const ini = new Date(anio, mes - 1, 1)
  const fin = new Date(anio, mes, 0, 23, 59, 59, 999)

  const snap = await getDocs(
    query(
      collection(db, COL.MOVIMIENTOS),
      where('fecha', '>=', ini.toISOString()),
      where('fecha', '<=', fin.toISOString()),
    ),
  )

  const porCompra = new Map<string, CompraRegistro>()

  snap.forEach((d) => {
    const m = d.data() as Record<string, any>
    if (m.tipoMovimiento !== 'compra') return
    const md = (m.metadata || {}) as Record<string, any>
    const compraId = String(md.compraId || '')
    // Una compra cargada desde el formulario manual (sin `compraId`) no es un comprobante: se ignora, igual
    // que hace el listado de Compras del app.
    if (!compraId) return

    const item: ItemCompraRegistro = {
      // El importe de la línea **como lo dice el comprobante**: precio de la presentación × cantidad de
      // presentaciones. ⚠️ `totalPagado` es el total de la compra; esto es su pedazo por producto.
      importe: (Number(md.precioUnitario) || 0) * (Number(md.cantidadPresentacion) || 0),
      traeIgv: Boolean(md.traeIgv),
      // Respaldo para las compras viejas (antes de que se guardara el dato): cuenta el IGV que se separó.
      ...(md.igvConCredito !== undefined
        ? { igvConCredito: Boolean(md.igvConCredito) }
        : md.igvSeparado !== undefined
          ? { igvConCredito: true }
          : {}),
    }

    const existente = porCompra.get(compraId)
    if (existente) {
      existente.items.push(item)
      return
    }
    porCompra.set(compraId, {
      compraId,
      fecha: String(m.fecha || ''),
      proveedor: String(md.proveedor || ''),
      // 🔑 **El documento del proveedor se busca en los DOS nombres que existen**: el web escribe
      // `proveedorId` y la **app móvil escribe `proveedorDoc`** (mismo dato, otro campo — verificado en
      // producción: 13 compras hechas desde el celular tenían su RUC en `proveedorDoc` y el registro las
      // mostraba sin documento). Sin este respaldo, esas compras no se pueden anotar aunque el RUC esté ahí.
      proveedorId: String(md.proveedorId || md.proveedorDoc || ''),
      tipoComprobante: String(md.tipoComprobante || ''),
      serie: String(md.serieComprobante || ''),
      numero: String(md.numeroComprobante || ''),
      fechaEmision: String(md.fechaEmisionComprobante || ''),
      nota: String(md.nota || ''),
      items: [item],
      ...(md.igvConCredito !== undefined || md.igvSeparado !== undefined
        ? { igvRecuperable: Boolean(md.igvConCredito ?? md.igvSeparado !== undefined) }
        : {}),
    })
  })

  return [...porCompra.values()]
}
