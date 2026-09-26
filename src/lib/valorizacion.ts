/**
 * **Valorización de inventario con costo promedio ponderado móvil (PPP)** — módulo puro.
 *
 * Hasta ahora la app valorizaba el stock con el **último costo** (`stock × costo` del producto, en
 * `services/analisis.ts`), que se distorsiona cada vez que el proveedor cambia el precio. Acá vive
 * la regla del **promedio ponderado**, que es la que usan las PYMEs y la que pide un contador:
 *
 *   - **Entrada** (compra, devolución, ajuste positivo):
 *       promedio = (stockAntes × promedioActual + cantidad × costoEntrada) ÷ (stockAntes + cantidad)
 *   - **Salida** (venta, ajuste negativo): **no cambia el promedio**; se valoriza **al promedio
 *     vigente**, que es justamente la gracia del método: la mercadería que sale no arrastra el
 *     precio de la última compra.
 *   - Si el stock previo es **cero o negativo** (se vendió antes de cargar la compra), el promedio
 *     nuevo es **el costo de la entrada**: no hay nada con qué promediar y dividir por un stock
 *     negativo daría un número sin sentido.
 *
 * 🔑 **El promedio se guarda con 4 decimales** (no 2): al promediar compras de distinto precio, el
 * promedio suele caer en fracciones de céntimo y redondearlo en cada paso **acumula error**. Los
 * **valores** (costo de la salida, valor del inventario) sí se redondean a 2 decimales, que es
 * plata.
 *
 * Módulo puro (sin Firebase ni React): se prueba con el runner nativo de Node (`npm test`).
 */

import { redondear2 } from './dinero.ts'

/** Decimales con los que se guarda el costo promedio (ver el porqué en el encabezado). */
export const DECIMALES_COSTO = 4

/** Redondea el costo promedio a la precisión con la que se guarda. */
export function redondearCosto(n: number): number {
  const factor = 10 ** DECIMALES_COSTO
  return Math.round((Number(n) || 0) * factor) / factor
}

/**
 * **Costo por unidad base de una compra cargada por presentación.**
 *
 * El proveedor cobra por el bulto: una **caja de 12 botellas a S/ 38** cuesta S/ 3.1667 por botella y un
 * **paquete de 6 galletas a S/ 12** cuesta S/ 2.00 por galleta. Esa división es la que hace que el stock
 * (que se lleva en unidad base) y el costo hablen del mismo objeto: sin ella, el promedio ponderado
 * tomaría el precio del bulto como si fuera el de una unidad y el inventario quedaría valorizado de más.
 *
 * 🔑 **Es la regla ÚNICA**: la usan `services/compras.ts` (lo que se **guarda**) y el modal de compra
 * (`components/ModalCompra.tsx`, lo que se **muestra**), para que el número que ve el usuario y el que
 * queda en la base no puedan diferir.
 *
 * ⚠️ **Sin redondear, a propósito**: devuelve el cociente exacto. Redondea quien corresponde — la
 * valorización lleva el promedio a 4 decimales (`redondearCosto`) y la plata se muestra a 2. Si acá se
 * devolviera 3.17, comprar 12 unidades daría 38.04 y la valorización se iría desviando céntimo a céntimo.
 * ⚠️ Un **factor 0 o inválido** devuelve el costo tal cual (nunca divide por cero ni lo vuelve infinito).
 */
export function costoPorUnidadBase(costoPresentacion: number, factor: number): number {
  const costo = Number(costoPresentacion) || 0
  const f = Number(factor) || 0
  return f > 0 ? costo / f : costo
}

/**
 * **Costo promedio ponderado móvil después de una entrada.**
 *
 * `cantidad` debe ser positiva (lo que entra). Si no hay stock previo, el promedio pasa a ser el
 * costo de esa entrada.
 */
export function promedioConEntrada({
  stockActual,
  promedioActual,
  cantidad,
  costoEntrada,
}: {
  stockActual: number
  promedioActual: number
  cantidad: number
  costoEntrada: number
}): number {
  const cantidadEntra = Number(cantidad) || 0
  const costo = Number(costoEntrada) || 0
  if (cantidadEntra <= 0) return redondearCosto(promedioActual)

  const stockPrevio = Number(stockActual) || 0
  const promedioPrevio = Number(promedioActual) || 0
  // Sin stock (o con stock negativo) no hay promedio que ponderar: manda el costo de la entrada.
  if (stockPrevio <= 0) return redondearCosto(costo)

  const stockFinal = stockPrevio + cantidadEntra
  const valorPrevio = stockPrevio * promedioPrevio
  const valorEntra = cantidadEntra * costo
  return redondearCosto((valorPrevio + valorEntra) / stockFinal)
}

/**
 * **Costo con el que se valoriza un producto ahora**: el promedio si ya se calculó alguna vez, y si
 * no, el último costo conocido (así un producto que nunca se compró después de este cambio no
 * aparece con costo cero).
 */
export function costoVigente({
  costoPromedio,
  costoUltimo,
}: {
  costoPromedio?: number | null
  costoUltimo?: number | null
}): number {
  const promedio = Number(costoPromedio) || 0
  if (promedio > 0) return redondearCosto(promedio)
  return redondearCosto(Number(costoUltimo) || 0)
}

/**
 * **Último costo conocido de un producto**: `precioCompra` y, si ese está vacío o en **0**, el campo
 * viejo `costo` (productos que nunca se editaron desde la app web).
 *
 * ⚠️ El 0 **no** es un costo: significa «no hay dato». Tratarlo como valor final haría que un producto
 * con un costo legado cargado valga **S/ 0** en el inventario y en el margen. Ojo: un producto **sin
 * ningún** costo tampoco inventa uno — devuelve 0 y sigue valiendo 0, que es el caso real de
 * WAFER NIK CHOCOLATE y WAFER NIK FRESA en producción.
 */
export function ultimoCostoDeProducto(
  p?: { precioCompra?: number | null; costo?: number | null } | null,
): number {
  const compra = Number(p?.precioCompra)
  if (compra > 0) return redondearCosto(compra)
  return redondearCosto(Number(p?.costo) || 0)
}

/**
 * 🔑 **El costo de un producto del catálogo, en un solo lugar**: el promedio ponderado si ya se
 * calculó alguna vez (`costoPromedio`) y, si no, el **último costo** conocido (`ultimoCostoDeProducto`).
 *
 * Es la **única forma de leer el costo de un producto para plata**: valorización del inventario y del
 * kardex, **margen bruto y utilidad**, los reportes de inventario (stock general, mayor inversión, por
 * categoría) y el aviso **BAJO COSTO** del PDV. Leer `precioCompra` a mano fue un bug real
 * (19/09/2026): el inventario ya valorizaba con el promedio mientras Análisis y los reportes de
 * utilidad seguían usando el último costo tipeado, así que **dos pantallas mostraban dos costos
 * distintos del mismo producto** — y el equivocado era el que se usaba para decidir precios.
 */
export function costoDeProducto(
  p?: { costoPromedio?: number | null; precioCompra?: number | null; costo?: number | null } | null,
): number {
  return costoVigente({ costoPromedio: p?.costoPromedio, costoUltimo: ultimoCostoDeProducto(p) })
}

/** Valor de una salida de stock: la cantidad valorizada al **promedio vigente**. */
export function valorDeSalida({ cantidad, costoPromedio }: { cantidad: number; costoPromedio: number }): number {
  return redondear2((Number(cantidad) || 0) * (Number(costoPromedio) || 0))
}

/** Valor del inventario de un producto (o del total, si se suman): unidades × costo vigente. */
export function valorDeStock({ stock, costo }: { stock: number; costo: number }): number {
  return redondear2((Number(stock) || 0) * (Number(costo) || 0))
}

/** Lo que se guarda en cada movimiento del kardex para que el kardex quede **valorizado**. */
export type ValorizacionMovimiento = {
  /** Costo unitario con el que se valoriza ESTE movimiento (entrada: su costo; salida: el promedio). */
  costoUnitario: number
  /** `cantidad × costoUnitario`, redondeado a 2 decimales. */
  valorTotal: number
  /** Costo promedio del producto **después** del movimiento (no cambia en las salidas). */
  costoPromedioDespues: number
  /** Valor del stock **después** del movimiento (`stockNuevo × costoPromedioDespues`). */
  stockValorizadoDespues: number
}

/**
 * Valoriza **un movimiento del kardex** aplicando la regla del promedio ponderado.
 *
 * `stockAntes` es el stock previo al movimiento (el mismo que el kardex ya guarda como
 * `stockAnterior`) y `stockNuevo` el que queda. Para una **entrada** hay que pasar el
 * `costoEntrada` (lo que costó esa mercadería); para una **salida** se ignora y se usa el promedio.
 */
export function valorizarMovimiento({
  esEntrada,
  cantidad,
  stockAntes,
  stockNuevo,
  costoPromedioActual,
  costoEntrada,
  costoUltimo,
}: {
  esEntrada: boolean
  cantidad: number
  stockAntes: number
  stockNuevo: number
  costoPromedioActual?: number | null
  costoEntrada?: number | null
  costoUltimo?: number | null
}): ValorizacionMovimiento {
  const cant = Math.abs(Number(cantidad) || 0)
  const promedioPrevio = costoVigente({ costoPromedio: costoPromedioActual, costoUltimo })

  // ⚠️ **Una entrada sin costo NO baja el promedio**: una devolución, una anulación o un ajuste
  // positivo sin dato de costo devuelven mercadería que ya estaba valorizada al promedio, así que se
  // valorizan **al promedio vigente** (y por lo tanto el promedio no se mueve). Tratar el costo
  // faltante como 0 hundiría el promedio del producto y valorizaría el inventario de menos.
  const costoEntradaUsado = Number(costoEntrada) > 0 ? Number(costoEntrada) : promedioPrevio

  const costoPromedioDespues = esEntrada
    ? promedioConEntrada({ stockActual: stockAntes, promedioActual: promedioPrevio, cantidad: cant, costoEntrada: costoEntradaUsado })
    : promedioPrevio

  const costoUnitario = esEntrada ? redondearCosto(costoEntradaUsado) : costoPromedioDespues

  return {
    costoUnitario,
    valorTotal: redondear2(cant * costoUnitario),
    costoPromedioDespues,
    stockValorizadoDespues: valorDeStock({ stock: stockNuevo, costo: costoPromedioDespues }),
  }
}

/** Fila del reporte de valorización: el inventario de un producto con su costo y su valor. */
export type FilaValorizacion = {
  productoId: string
  nombre: string
  categoria: string
  stock: number
  costoPromedio: number
  /** `true` si el costo es el promedio calculado; `false` si se usó el último costo como respaldo. */
  usaPromedio: boolean
  valor: number
}

/**
 * Arma las filas del reporte de valorización y su total, ordenadas por valor descendente (lo que
 * más plata tiene primero, que es lo que interesa mirar).
 */
export function resumenValorizacion(
  productos: readonly {
    id?: string
    nombre?: string
    categoria?: string
    stock?: number
    costoPromedio?: number | null
    precioCompra?: number | null
    costo?: number | null
  }[],
): { filas: FilaValorizacion[]; total: number; unidades: number } {
  const filas: FilaValorizacion[] = []
  let total = 0
  let unidades = 0

  for (const p of productos ?? []) {
    const stock = Number(p?.stock) || 0
    const costoPromedio = costoDeProducto(p)
    const valor = valorDeStock({ stock, costo: costoPromedio })
    total = redondear2(total + valor)
    unidades = redondear2(unidades + stock)
    filas.push({
      productoId: String(p?.id || ''),
      nombre: String(p?.nombre || ''),
      categoria: String(p?.categoria || ''),
      stock,
      costoPromedio,
      usaPromedio: (Number(p?.costoPromedio) || 0) > 0,
      valor,
    })
  }

  filas.sort((a, b) => b.valor - a.valor)
  return { filas, total, unidades }
}
