import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { valorizarMovimiento } from '@/lib/valorizacion'
import type { Producto } from '@/hooks/use-productos'

// Port de services/kardex.js de la app RN.
// El único movimiento de una venta (incluidos los pedidos que el vendedor manda a caja) es
// `venta`, que es SALIDA. `venta_pendiente`/`reposicion_venta_pendiente` quedaron como compat
// de lectura: el flujo de pedidos **ya no toca el stock** (se descuenta al cobrar), así que no
// se escriben más; si algún movimiento viejo aparece, se clasifica bien igual.
const esEntrada = (tipo: string) =>
  ['compra', 'ajuste_entrada', 'inventario_fisico_entrada', 'anulacion_venta', 'nota_credito', 'reposicion_venta_pendiente'].includes(tipo)

/** `true` si el movimiento **suma** stock. Se exporta para que ningún servicio lo reinterprete. */
export function movimientoEsEntrada(tipo: string): boolean {
  return esEntrada(tipo)
}

/**
 * **Valorización de un movimiento de stock, como regla única** (la matemática del promedio
 * ponderado vive en `lib/valorizacion.ts`; acá solo se arma lo que hay que escribir).
 *
 * Devuelve dos grupos de campos:
 *   - `camposProducto`: `costoPromedio` (el promedio después del movimiento) y `valorStock`
 *     (unidades × promedio): así el catálogo y la valorización no recalculan nada.
 *   - `camposMovimiento`: `costoUnitario`, `valorTotal`, `costoPromedioDespues` y
 *     `stockValorizadoDespues`, o sea el **kardex valorizado**: cada línea queda con el costo con el
 *     que se valorizó y con cómo quedaron el promedio y el valor del stock.
 *
 * ⚠️ En una entrada hay que pasar `costoEntrada` **por unidad base** (en una compra por
 * presentación, `costoUnitario ÷ factor`): el promedio se lleva por unidad, no por caja.
 */
export function valorizacionDeMovimiento({
  tipoMovimiento,
  cantidad,
  stockAntes,
  stockNuevo,
  producto,
  costoEntrada,
}: {
  tipoMovimiento: string
  cantidad: number
  stockAntes: number
  stockNuevo: number
  producto?: { costoPromedio?: number | null; precioCompra?: number | null; costo?: number | null } | null
  costoEntrada?: number | null
}): { camposProducto: Record<string, number>; camposMovimiento: Record<string, number> } {
  const v = valorizarMovimiento({
    esEntrada: esEntrada(tipoMovimiento),
    cantidad,
    stockAntes,
    stockNuevo,
    costoPromedioActual: producto?.costoPromedio ?? null,
    costoEntrada: costoEntrada ?? null,
    costoUltimo: producto?.precioCompra ?? producto?.costo ?? null,
  })
  return {
    camposProducto: { costoPromedio: v.costoPromedioDespues, valorStock: v.stockValorizadoDespues },
    camposMovimiento: {
      costoUnitario: v.costoUnitario,
      valorTotal: v.valorTotal,
      costoPromedioDespues: v.costoPromedioDespues,
      stockValorizadoDespues: v.stockValorizadoDespues,
    },
  }
}

export async function cargarProductos(): Promise<Producto[]> {
  const snap = await getDocs(query(collection(db, COL.PRODUCTOS), orderBy('nombre', 'asc')))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Producto, 'id'>) }))
}

export async function consultarKardex(producto: Producto, fechaDesde: Date, fechaHasta: Date) {
  const desdeISO = new Date(fechaDesde)
  desdeISO.setHours(0, 0, 0, 0)
  const hastaISO = new Date(fechaHasta)
  hastaISO.setHours(23, 59, 59, 999)

  const snap = await getDocs(
    query(collection(db, COL.MOVIMIENTOS), where('productoId', '==', producto.id), where('fecha', '>=', desdeISO.toISOString()), where('fecha', '<=', hastaISO.toISOString()))
  )

  const movimientos: any[] = []
  snap.forEach((doc) => {
    const d = doc.data()
    if (d.tipoMovimiento !== 'anulacion_compra') movimientos.push({ id: doc.id, ...d })
  })
  movimientos.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())

  const entrada = movimientos.filter((m) => esEntrada(m.tipoMovimiento)).reduce((s, m) => s + (m.cantidad || 0), 0)
  const salida = movimientos.filter((m) => !esEntrada(m.tipoMovimiento)).reduce((s, m) => s + (m.cantidad || 0), 0)

  const stockInicial = movimientos.length > 0 ? movimientos[0].stockAnterior ?? 0 : 0

  let running = stockInicial
  const filas = movimientos.map((m) => {
    const esEnt = esEntrada(m.tipoMovimiento)
    running = esEnt ? running + (m.cantidad || 0) : running - (m.cantidad || 0)
    return { ...m, cantidadReal: esEnt ? m.cantidad : -m.cantidad, stockCorriente: running }
  })

  return { producto, stockInicial, stockFinal: running, totalEntradas: entrada, totalSalidas: salida, filas }
}
