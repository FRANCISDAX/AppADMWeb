/**
 * Importes que se declaran a SUNAT — **módulo puro** (sin Firebase, sin React).
 *
 * El comprobante que se envía tiene que declarar **lo que realmente se cobró**.
 * En la venta, el descuento (promoción de volumen, cupón, descuento del cliente
 * o global) se guarda aparte, en `venta.descuentoTotal`, y los items conservan su
 * precio de lista: si el XML se arma con esos precios, declara más de lo cobrado
 * (por ejemplo una media docena con promo: cobra S/ 3.00 y declara S/ 3.60).
 *
 * Acá el descuento se **reparte entre las líneas** (proporcional a su importe, y
 * el residuo del redondeo cae en la línea más grande para que la suma sea
 * exacta) y cada línea queda con su **precio unitario efectivo**. Así:
 *   - la suma de las líneas es exactamente el total cobrado,
 *   - el IGV se calcula sobre la base correcta (importante si el producto es
 *     gravado),
 *   - y el comprobante coincide con lo que el cliente pagó.
 *
 * Módulo puro: se testea con el runner nativo de Node (`npm test`).
 */

import { redondear2 } from './dinero.ts'

/** Un item de la venta, tal como se guarda en el documento. */
export type ItemVenta = {
  id?: string
  nombre?: string
  cantidad?: number
  quantity?: number
  precioVenta?: number
  subtotal?: number
  [k: string]: unknown
}

/** Cuántos decimales se le mandan al backend en el precio unitario. */
const DECIMALES_PRECIO = 6

/** Cantidad de unidades de la línea (el web la guarda en `cantidad`). */
export function cantidadDe(item: ItemVenta): number {
  const n = Number(item?.cantidad ?? item?.quantity ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Importe bruto de la línea, sin descuento. */
export function importeBrutoDe(item: ItemVenta): number {
  const subtotal = Number(item?.subtotal)
  if (Number.isFinite(subtotal) && subtotal > 0) return redondear2(subtotal)
  return redondear2(cantidadDe(item) * (Number(item?.precioVenta) || 0))
}

/**
 * Reparte `descuentoTotal` entre las líneas. Devuelve un importe por línea que
 * **suma exactamente** el descuento (sin céntimos perdidos por redondeo).
 */
export function repartirDescuento(items: readonly ItemVenta[], descuentoTotal: number): number[] {
  const brutos = items.map(importeBrutoDe)
  const totalBruto = redondear2(brutos.reduce((s, x) => s + x, 0))
  const descuento = redondear2(Math.min(Math.max(0, Number(descuentoTotal) || 0), totalBruto))
  if (descuento <= 0 || totalBruto <= 0) return items.map(() => 0)

  const partes = brutos.map((b) => redondear2((descuento * b) / totalBruto))
  // El residuo del redondeo se ajusta en la línea de mayor importe.
  let suma = redondear2(partes.reduce((s, x) => s + x, 0))
  let residuo = redondear2(descuento - suma)
  if (residuo !== 0) {
    let idxMayor = 0
    for (let i = 1; i < brutos.length; i++) if (brutos[i] > brutos[idxMayor]) idxMayor = i
    partes[idxMayor] = redondear2(partes[idxMayor] + residuo)
    suma = redondear2(partes.reduce((s, x) => s + x, 0))
    residuo = redondear2(descuento - suma)
  }
  return partes
}

/**
 * Items con el descuento ya aplicado: `subtotal` es el importe neto de la línea y
 * `precioVenta` el precio unitario efectivo (el que se declara).
 *
 * Si no hay descuento devuelve los items tal cual (mismo precio de lista), así el
 * camino normal no cambia nada.
 */
export function itemsConDescuento<T extends ItemVenta>(items: readonly T[], descuentoTotal: number): T[] {
  const partes = repartirDescuento(items, descuentoTotal)
  if (partes.every((p) => p === 0)) return items.map((it) => ({ ...it }))

  return items.map((it, i) => {
    const bruto = importeBrutoDe(it)
    const neto = redondear2(Math.max(0, bruto - partes[i]))
    const cantidad = cantidadDe(it)
    const precioUnitario = cantidad > 0 ? Number((neto / cantidad).toFixed(DECIMALES_PRECIO)) : redondear2(Number(it.precioVenta) || 0)
    return { ...it, precioVenta: precioUnitario, subtotal: neto, descuento: partes[i] }
  })
}

/** Total que debe declarar el comprobante: lo cobrado (los items ya sin descuento). */
export function totalDeclarado(items: readonly ItemVenta[], descuentoTotal: number): number {
  const conDescuento = itemsConDescuento(items, descuentoTotal)
  return redondear2(conDescuento.reduce((s, it) => s + importeBrutoDe(it), 0))
}

/**
 * Tasa del IGV. Es la que aplica SUNAT y la que usa el backend (`sunat_py`).
 */
export const IGV_RATE = 0.18

/**
 * ¿La afectación lleva IGV? Solo `'10'` (gravado - operación onerosa): en la
 * práctica es la única que se usa en ventas. Las de retiro ('11'-'19') y las
 * gratuitas tampoco suman IGV en el comprobante.
 */
export function esGravado(afectacion: string): boolean {
  return String(afectacion || '').trim() === '10'
}

/**
 * Valor de venta **sin IGV** para declarar en el comprobante.
 *
 * ⚠️ El precio del producto es un **precio final al público** (incluye el IGV, es
 * el que está en la etiqueta y el que se le cobra al cliente). El XML, en cambio,
 * lleva el **valor unitario sin IGV**: la base gravada. Por eso a las líneas
 * gravadas se les despeja el impuesto (`precio / 1.18`) y el comprobante muestra
 * el desglose (base + IGV = precio). En las exoneradas/inafectas el valor es el
 * precio tal cual, porque no llevan IGV.
 *
 * Si se mandara el precio con IGV como si fuera la base, una venta de S/ 100 se
 * declararía como S/ 118.
 */
export function valorUnitarioSunat(precioFinal: number, afectacion: string): number {
  const precio = Number(precioFinal) || 0
  if (!esGravado(afectacion)) return precio
  return Number((precio / (1 + IGV_RATE)).toFixed(6))
}
