/**
 * Importes que se declaran a SUNAT — **módulo puro** (sin Firebase, sin React).
 *
 * El comprobante que se envía tiene que declarar **lo que realmente se cobró**.
 * En la venta, el descuento (promoción de volumen, descuento del cliente
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

export const AFECTACION_GRAVADO = '10'
export const AFECTACION_EXONERADO = '20'

/**
 * Afectación con la que se declara un item.
 *
 * 🔑 **Manda la afectación del propio item** (la del producto, o `config.tipoAfectacionManual` en
 * los items manuales). La config **Región exonerada de IGV** (`config.regionExonerada`) es el
 * **default para lo que no trae afectación**, no un override: en una región exonerada un item sin
 * dato tiene que declararse exonerado (`'20'`), no gravado.
 *
 * ⚠️ **Este default es donde se rompió el flujo de pedidos** (17/09/2026): los items del pedido se
 * guardaban **sin `tipoAfectacion`**, así que un producto exonerado (`'20'`) se declaraba
 * **gravado** (`'10'`) y el comprobante agregaba 18% de IGV que nadie cobró. El arreglo de fondo es
 * que el pedido guarde la afectación (ver `enviarACaja`); esto es la red de seguridad.
 */
export function afectacionDe(
  item: { tipoAfectacion?: unknown; tipoAfectacionEfectivo?: unknown } | null | undefined,
  opts?: { regionExonerada?: boolean },
): string {
  const propia = String(item?.tipoAfectacionEfectivo || item?.tipoAfectacion || '').trim()
  if (propia) return propia
  return opts?.regionExonerada ? AFECTACION_EXONERADO : AFECTACION_GRAVADO
}

/**
 * **La afectación con la que se declaró una venta ya guardada** (para leer documentos, no para crearlos).
 *
 * 🔑 Cadena de respaldo: la del **ítem** → la del **producto** del catálogo → **exonerado** (`'20'`).
 * ⚠️ Acá **no** se usa `config.regionExonerada` (ese es el default de lo que se está **creando**):
 * aplicarlo a un documento histórico le inventaría un IGV que nunca se declaró. Un ítem sin
 * `tipoAfectacion` es un **pedido de antes del 18/09/2026** (el bug de `enviarACaja`), así que lo que
 * vale es la afectación del producto; y si el producto ya no está, **no se supone gravado**: suponerlo
 * restaría un 18% que nadie declaró.
 */
export function afectacionGuardada(
  item?: { tipoAfectacion?: unknown; tipoAfectacionEfectivo?: unknown; [k: string]: unknown } | null,
  producto?: { tipoAfectacion?: unknown; [k: string]: unknown } | null,
): string {
  const propia = String(item?.tipoAfectacionEfectivo || item?.tipoAfectacion || '').trim()
  if (propia) return propia
  const delProducto = String(producto?.tipoAfectacion || '').trim()
  return delProducto || AFECTACION_EXONERADO
}

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

/**
 * Descuento total de una venta, venga como venga el documento.
 *
 * 🔑 Lee `descuentoTotal` (camelCase: lo que escriben `registrarVenta` y los pedidos nuevos) y
 * **cae a `descuento_total`** (snake_case: como lo guardaba un pedido antes del 18/09/2026).
 * Sin ese respaldo, un pedido con promoción llegaba al comprobante con las líneas a **precio de
 * lista** y el descuento en 0: el PDF mostraba *Op. Exonerada 2.20* contra un **TOTAL de 2.00**
 * sin ninguna fila de descuento que lo explicara, y el XML declaraba el importe de lista
 * (bug real: 2 huevos con promo a S/ 0.50 + 2 galletas, huevos 1.20 + galletas 1.00 = 2.20 con
 * un total de 2.00).
 */
export function descuentoDeVenta(venta: Record<string, unknown> | null | undefined): number {
  const v = venta ?? {}
  const n = Number(v.descuentoTotal ?? v.descuento_total ?? 0)
  return Number.isFinite(n) && n > 0 ? redondear2(n) : 0
}

/** Cantidad con la que se declara una línea: la API de SUNAT acepta **2 decimales**. */
export function cantidadSunat(n: number): number {
  const c = Number.isFinite(n) && n > 0 ? Number(n) : 1
  return Math.max(0.01, redondear2(c))
}

/**
 * Items listos para **enviar a SUNAT**: el descuento ya repartido (`itemsConDescuento`) y el
 * **precio unitario con 2 decimales**.
 *
 * 📌 **Bug del 18/09/2026**: *"decimal input should have no more that 2 decimal places"*. Ese
 * mensaje es del **backend** (`appadm-sunat`, Pydantic: `precio_unitario = Field(decimal_places=2)`
 * y `cantidad = Field(gt=0, decimal_places=2)` en `app/schemas/invoice.py`), no de SUNAT. El web
 * mandaba el precio unitario efectivo con hasta **6 decimales** (`DECIMALES_PRECIO`): una línea con
 * descuento daba `1.09 / 2 = 0.545`, y una línea **gravada** da `precio / 1.18` (0.508475…), así que
 * el envío se caía con un error de validación.
 *
 * 🔑 **El precio unitario se ajusta a 2 decimales y el residuo del redondeo se repone línea por
 * línea** (de la más flexible —cantidad 1— a la menos flexible) moviéndolo en pasos de
 * `cantidad` céntimos, para que **la suma de las líneas siga siendo el total cobrado**. Si el
 * residuo no es divisible por la cantidad de ninguna línea queda ≤1 céntimo (aceptable: el XML
 * se arma con esos importes y sigue siendo consistente).
 */
export function itemsParaSunat<T extends ItemVenta>(items: readonly T[], descuentoTotal: number): T[] {
  const conDescuento = itemsConDescuento(items, descuentoTotal)
  const totalCobrado = redondear2(conDescuento.reduce((s, it) => s + importeBrutoDe(it), 0))
  const lineas = conDescuento.map((it) => {
    const cantidad = cantidadSunat(cantidadDe(it))
    const neto = importeBrutoDe(it)
    const unitario = redondear2(neto / cantidad)
    return { it, cantidad, unitario, neto: redondear2(unitario * cantidad) }
  })

  const suma = () => redondear2(lineas.reduce((s, l) => s + l.neto, 0))
  let residuo = Math.round((totalCobrado - suma()) * 100)
  if (residuo !== 0) {
    const porFlexibilidad = [...lineas].sort((a, b) => a.cantidad - b.cantidad)
    for (const linea of porFlexibilidad) {
      if (residuo === 0) break
      if (linea.cantidad <= 0) continue
      const centavosPorUnidad = Math.trunc(residuo / linea.cantidad)
      if (centavosPorUnidad === 0) continue
      const nuevo = redondear2(linea.unitario + centavosPorUnidad / 100)
      if (nuevo < 0) continue
      linea.unitario = nuevo
      linea.neto = redondear2(linea.unitario * linea.cantidad)
      residuo = Math.round((totalCobrado - suma()) * 100)
    }
  }

  return lineas.map(({ it, cantidad, unitario, neto }) => ({ ...it, cantidad, precioVenta: unitario, subtotal: neto }))
}

/** Total que debe declarar el comprobante: lo cobrado (los items ya sin descuento). */
export function totalDeclarado(items: readonly ItemVenta[], descuentoTotal: number): number {
  const conDescuento = itemsConDescuento(items, descuentoTotal)
  return redondear2(conDescuento.reduce((s, it) => s + importeBrutoDe(it), 0))
}

/**
 * Tasa del IGV **de fábrica** (la general del Perú). Es el respaldo de todo lo que no traiga su propia
 * tasa: la tasa real de un documento sale de `lib/igv.ts` (`tasaDelDocumento`), porque un negocio de
 * restaurantes/hoteles tributa al 10%.
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
 * ¿La afectación es una **operación gratuita** (catálogo 07)?
 *
 * 🔑 **Los códigos gratuitos son `11`-`16` (gravado), `21` (exonerado) y `31`-`37` (inafecto)**, y el
 * catálogo les asigna el tributo **`9996` (GRATUITO)**: no llevan IGV en el comprobante y su importe es el
 * **valor referencial** de la mercadería, no plata cobrada (`PayableAmount` = 0).
 *
 * ⚠️ **El `20` (exonerado - operación onerosa) NO es gratuito**: es una venta normal sin IGV. La
 * diferencia importa: por eso un retiro declarado `'21'` o `'32'` se lee como gratuito y uno `'20'`, no.
 */
export function esGratuita(afectacion: string): boolean {
  const af = String(afectacion || '').trim()
  if (!af) return false
  const n = Number(af)
  return (n >= 11 && n <= 16) || af === '21' || (n >= 31 && n <= 37)
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
 *
 * 🔑 **La tasa es un parámetro** (`tasa`): no siempre es 18% — un restaurante/hotel tributa al 10%
 * (`lib/igv.ts` → `tasaDelDocumento`). Sin el parámetro se usa la general, así los llamadores viejos
 * (y la app móvil) no cambian de comportamiento.
 */
export function valorUnitarioSunat(precioFinal: number, afectacion: string, tasa: number = IGV_RATE): number {
  const precio = Number(precioFinal) || 0
  if (!esGravado(afectacion)) return precio
  const t = Number(tasa) > 0 ? Number(tasa) : IGV_RATE
  return Number((precio / (1 + t)).toFixed(6))
}
