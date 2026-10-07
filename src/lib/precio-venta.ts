/**
 * **Calculadora de precio de venta** (`costo → margen → precio`).
 *
 * 🔑 **Qué resuelve**: el precio de venta no se adivina. El camino es
 * *costo de la mercadería → margen que se quiere ganar → precio final*, y es una cuenta que todas las
 * apps del rubro ofrecen (Loyverse reporta ganancia/margen a partir del costo; los ERP recalculan el
 * precio desde la factura de compra; los POS serios tienen una **tabla de redondeo** aparte). Este
 * módulo es esa cuenta, **pura y testeada**, para que la pantalla no invente su propia aritmética.
 *
 * ⚠️ **El precio del producto es FINAL al público** (invariante del sistema: incluye el IGV y es el que
 * está en la etiqueta). Acá se respeta: cuando el producto es **gravado** (`'10'`), el margen se mide
 * sobre el **precio sin IGV** —porque el IGV no es plata del negocio— y el precio que se propone
 * **ya lo incluye**. Con un producto **exonerado** (`'20'`, el caso de esta región) el precio no lleva
 * IGV y la cuenta es directa.
 *
 * 🔑 **Dos formas de decir «quiero ganar 30%», y no dan lo mismo** (con un costo de S/ 3.1667):
 *
 * | Base | Fórmula | Precio sin IGV | Margen que deja |
 * |---|---|---|---|
 * | **Sobre el costo** (*markup*) | costo × 1.30 | 4.1167 | **23,1%** del precio |
 * | **Sobre el precio de venta** (*margen*) | costo ÷ 0.70 | 4.5238 | **30,0%** del precio |
 *
 * Por eso `base` es explícito y la pantalla muestra **las dos** lecturas del precio que se escriba.
 *
 * ⚠️ **El redondeo va SIEMPRE hacia arriba**: el margen objetivo es un **piso**, nunca un techo. Bajar
 * el precio para que «quede lindo» es vender por debajo de lo que el negocio pidió ganar.
 */
import { redondear2 } from './dinero.ts'
import { IGV_RATE, esGravado } from './sunat-importes.ts'
import { redondearCosto } from './valorizacion.ts'

/** Sobre qué se mide el porcentaje: el costo (markup) o el precio de venta (margen). */
export type BaseMargen = 'precio' | 'costo'

/** Cómo se «redondea» el precio propuesto (siempre hacia arriba). */
export type RedondeoPrecio = 'exacto' | 'decima' | 'medio' | 'comercio'

/** Las opciones de redondeo, con su rótulo, para que la pantalla no las escriba de nuevo. */
export const REDONDEOS: { id: RedondeoPrecio; label: string }[] = [
  { id: 'exacto', label: 'Sin redondear (al céntimo)' },
  { id: 'medio', label: 'A .00 o .50' },
  { id: 'comercio', label: 'A .00, .50 o .90' },
  { id: 'decima', label: 'A la décima (0.10)' },
]

/** Cuánto se gana con un precio, medido sobre el precio de venta **sin IGV**. */
export type MargenDePrecio = {
  /** El precio final (lo que paga el cliente), tal como se cargó. */
  precioFinal: number
  /** Lo que queda para el negocio, sin IGV. Con exonerado es igual al precio final. */
  neto: number
  /** ¿El producto lleva IGV? (afectación `'10'`). */
  gravado: boolean
  /** Plata que queda por unidad: `neto − costo`. Puede ser negativa (se vende a pérdida). */
  margen: number
  /** Margen como porcentaje **del precio de venta sin IGV**. */
  margenPct: number
  /** Lo mismo expresado **sobre el costo** (markup). Sirve para ver la diferencia entre las dos formas. */
  markupPct: number
}

/**
 * El precio **sin IGV** (lo que realmente queda para el negocio) de un precio final al público.
 * Con afectación exonerada o inafecta devuelve el precio tal cual, porque no lleva IGV.
 *
 * 🔑 **La tasa es un parámetro**: no siempre es 18% (restaurantes/hoteles van al 10%, `lib/igv.ts` →
 * `tasaDelDocumento`). Sin el parámetro se usa la general, así los llamadores viejos no cambian.
 */
export function precioSinIgv(precioFinal: number, afectacion?: string, tasa: number = IGV_RATE): number {
  const precio = Number(precioFinal) || 0
  const t = Number(tasa) > 0 ? Number(tasa) : IGV_RATE
  return esGravado(String(afectacion ?? '')) ? precio / (1 + t) : precio
}

/**
 * **El precio final que hace falta para ganar `precioSinIgv`** (la operación inversa).
 * Es lo que se le muestra al negocio cuando el producto es gravado: el IGV va **sumado** al precio, y
 * por eso el precio final siempre incluye el impuesto (nunca se recarga recién al cobrar).
 */
export function precioFinalConIgv(precioSinIgv: number, afectacion?: string, tasa: number = IGV_RATE): number {
  const neto = Number(precioSinIgv) || 0
  const t = Number(tasa) > 0 ? Number(tasa) : IGV_RATE
  return esGravado(String(afectacion ?? '')) ? neto * (1 + t) : neto
}

/**
 * **Qué margen deja un precio.** Es la lectura que hoy no se ve en ningún lado del formulario: se
 * escribe el precio y no se sabe si deja 12% o 40%. Devuelve también el markup para poder mostrar la
 * diferencia (*«30% sobre el precio = 42,9% sobre el costo»*).
 */
export function margenDePrecio(precioFinal: number, costo: number, afectacion?: string, tasa: number = IGV_RATE): MargenDePrecio {
  const final = Number(precioFinal) || 0
  const c = Number(costo) || 0
  const neto = precioSinIgv(final, afectacion, tasa)
  const margen = neto - c
  return {
    precioFinal: final,
    neto: redondear2(neto),
    gravado: esGravado(String(afectacion ?? '')),
    margen: redondear2(margen),
    margenPct: neto > 0 ? (margen / neto) * 100 : 0,
    markupPct: c > 0 ? (margen / c) * 100 : 0,
  }
}

/**
 * **El costo que se guarda de una compra**: al monto que se cargó se le **separa el IGV** cuando esa
 * plata es un **crédito fiscal** (el negocio lo recupera) y el ítem es **gravado**.
 *
 * 🔑 **Por qué existe.** El precio de venta es **final al público** (lleva el IGV adentro) y el margen
 * se mide sobre el **neto**, así que el costo tiene que estar en la misma base:
 *
 * | Costo cargado | Costo guardado | Margen que sale |
 * |---|---|---|
 * | S/ 118 (total de la factura) con IGV recuperable | S/ 100 | correcto (21,3% con un precio de 150) |
 * | S/ 118 sin separar | S/ 118 | correcto **si el IGV no es recuperable** (ahí el IGV es costo) |
 *
 * 📌 **Medido el 25/09/2026** (emulador, negocio de Lima): con el costo neto cargado a mano y los
 * reportes midiendo sobre el precio con IGV, la app mostraba **33%** donde el negocio ganaba **21,3%**;
 * y cargando el total de la factura, el inventario quedaba **18% arriba**. Las dos cosas se arreglan
 * guardando el costo en la base correcta y midiendo el margen en esa misma base.
 *
 * ⚠️ **El ítem tiene que ser gravado**: un producto exonerado (`'20'`) no lleva IGV en la factura, así
 * que separarlo lo hundiría 18% — es el caso de esta región, y por eso acá **no cambia nada**.
 * ⚠️ **Y el proveedor tiene que haber facturado con IGV**: si la factura viene sin IGV (un proveedor
 * exonerado, un RUS, una boleta interna), quien carga la compra lo dice con `yaSinIgv` y el monto se
 * guarda tal cual.
 */
export function costoDeCompra(
  montoCargado: number,
  opts: { igvRecuperable?: boolean; afectacion?: string; yaSinIgv?: boolean } = {},
): { costo: number; igvSeparado: number; separaIgv: boolean } {
  const monto = Number(montoCargado) || 0
  const separaIgv = Boolean(opts.igvRecuperable) && esGravado(String(opts.afectacion ?? '')) && !opts.yaSinIgv
  if (!separaIgv) return { costo: monto, igvSeparado: 0, separaIgv: false }
  // 🔑 **Acá va la tasa GENERAL, no la de venta del negocio**: el IGV que se separa es el que el
  // **proveedor** facturó (18% si es del régimen general), y ese IGV es crédito fiscal aunque el negocio
  // venda al 10% (restaurantes/hoteles). La tasa de venta vive en `lib/igv.ts` y **no** entra acá.
  const costo = monto / (1 + IGV_RATE)
  // El costo se guarda con la precisión del inventario (4 decimales): 118 ÷ 1.18 da 100.00000000000001.
  return { costo: redondearCosto(costo), igvSeparado: redondear2(monto - costo), separaIgv: true }
}

/**
 * **Aplica la regla de redondeo.** Siempre hacia **arriba** (ver el encabezado), y con una tolerancia
 * mínima para que un céntimo de coma flotante no empuje el precio un escalón de más (`4.50` no puede
 * saltar a `4.90` por `4.5000000001`).
 */
export function redondearPrecio(precio: number, redondeo: RedondeoPrecio = 'exacto'): number {
  const x = redondear2(precio)
  const eps = 1e-9
  if (x <= 0) return 0
  if (redondeo === 'decima') return redondear2(Math.ceil(x * 10 - eps) / 10)
  if (redondeo === 'medio') return redondear2(Math.ceil(x * 2 - eps) / 2)
  if (redondeo === 'comercio') {
    // Los finales «de tienda»: .00, .50 y .90 del peso en que cae el precio.
    const entero = Math.floor(x)
    const candidatos = [entero, entero + 0.5, entero + 0.9, entero + 1, entero + 1.5, entero + 1.9]
    return redondear2(candidatos.find((c) => c >= x - eps) ?? entero + 1.9)
  }
  return x
}

/**
 * **El precio de venta que hace falta para ganar un margen objetivo.**
 *
 * - `base: 'precio'` → margen **sobre el precio de venta** (`costo ÷ (1 − m)`): es la lectura que
 *   responde «si quiero que el 30% de lo que cobro sea ganancia».
 * - `base: 'costo'` → **markup** sobre el costo (`costo × (1 + m)`): la lectura que responde
 *   «recargo 30% a lo que me costó».
 *
 * Devuelve el **precio final al público** (con IGV incluido si el producto es gravado), ya redondeado.
 * Devuelve `null` cuando la cuenta no existe: **sin costo** no hay margen que calcular, y un margen
 * **≥ 100%** sobre el precio de venta divide por cero o da negativo.
 */
export function precioDesdeMargen(
  costo: number,
  opciones: { margenPct: number; base?: BaseMargen; afectacion?: string; redondeo?: RedondeoPrecio },
): number | null {
  const c = Number(costo) || 0
  const m = Number(opciones.margenPct)
  if (!(c > 0) || !Number.isFinite(m)) return null
  const fraccion = m / 100
  let neto: number
  if ((opciones.base ?? 'precio') === 'precio') {
    if (fraccion >= 1) return null
    neto = c / (1 - fraccion)
  } else {
    neto = c * (1 + fraccion)
  }
  return redondearPrecio(precioFinalConIgv(neto, opciones.afectacion), opciones.redondeo ?? 'exacto')
}
