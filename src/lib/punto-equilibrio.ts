/**
 * **Punto de equilibrio** — módulo puro (sin Firebase ni React).
 *
 * 🔑 **Qué contesta**: *«¿cuánto tengo que vender para no perder?»*. Se calcula con **dos números**:
 *
 *   1. **Los costos fijos** del mes: lo que se paga **aunque se venda cero** (alquiler, sueldos,
 *      luz/agua/internet, impuestos, mantenimiento, transporte). Están cargados como **Egresos**.
 *   2. **El margen de contribución**: de cada sol vendido, **cuánto queda después de reponer la
 *      mercadería**. No es la utilidad (todavía no se descontaron los fijos): es lo que **aporta** cada
 *      venta a cubrirlos.
 *
 *   **Punto de equilibrio = costos fijos ÷ margen %**
 *
 * 📌 **Ejemplo**: fijos S/ 3.000 y margen 25% ⇒ hay que vender **S/ 12.000** al mes. En 26 días de
 * atención son **S/ 462 por día**. Esa es toda la cuenta.
 *
 * ⚠️ **«Compras» NO es un costo fijo.** Esa categoría de Egresos es **mercadería** (costo variable) y
 * su costo **ya está adentro del margen** (se resta al calcularlo): contarla también como fija
 * **pagaría dos veces la misma compra** y el punto de equilibrio pediría vender mucho más de lo
 * necesario. Es la trampa real de este negocio: las bolsas se cargaron en Gastos/Egresos con la
 * categoría **«Compras»**.
 *
 * 🔑 **El impuesto a las ventas (`impuestoVentasPct`) también es variable y sale del MARGEN, no de los
 * fijos.** Un impuesto que se paga como **porcentaje de lo vendido** (el pago a cuenta del 1,5 % es el
 * caso real) **crece con las ventas**: no es algo que se pague «aunque no se venda nada». Por eso se
 * resta del margen de contribución:
 *
 *     equilibrio = fijos ÷ (margen − impuesto %)
 *
 * 📌 **Por qué NO alcanza con cargarlo como un Egreso del mes** (que es lo que hace la categoría
 * «Impuestos»): así entraría al numerador como **fijo** ⇒ `(fijos + impuesto del mes) ÷ margen`, y ese
 * impuesto del mes es el **de la venta de este mes**, no el de la venta del punto de equilibrio. La
 * cuenta da bien **solo si ya vendés cerca del equilibrio**; cuando estás lejos —justo cuando el número
 * importa— **queda corto**. Medido el 29/09/2026 con fijos S/ 212: como fijo daba **S/ 966,11** y como
 * variable **S/ 1.015,81** (S/ 15,24 de impuesto en el equilibrio).
 *
 * ⚠️ **`impuestoVentasPct` = 0 es «no hay impuesto»** (una config vieja no paga nada): es la misma
 * convención que `descuentoMaximoPorcentaje = 0`.
 *
 * ⚠️ **Con margen 0 o negativo no hay punto de equilibrio**: ningún nivel de ventas cubre los fijos
 * (`equilibrio: null`, para que la pantalla lo diga en vez de mostrar un número imposible).
 * ⚠️ **Un margen medido sobre mercadería sin costo está inflado** ⇒ el equilibrio sale **demasiado
 * bajo**. Por eso el resultado informa `itemsSinCosto` y la pantalla lo tiene que avisar.
 */

import { redondear2 } from './dinero.ts'

/**
 * Las categorías de **Egresos que NO son costo fijo**: mercadería. Se comparan sin distinguir
 * mayúsculas ni espacios (`services/egresos.ts` guarda `Compras`).
 */
export const CATEGORIAS_VARIABLES: readonly string[] = ['compras']

/** Lo que este módulo necesita de un egreso. */
export type EgresoParaFijos = {
  categoria?: string | null
  monto?: number | null
}

/** **¿Este egreso es un costo fijo?** Todo lo que no sea mercadería, sí. */
export function esCostoFijo(e: EgresoParaFijos | null | undefined): boolean {
  const categoria = String(e?.categoria ?? '').trim().toLowerCase()
  return !CATEGORIAS_VARIABLES.includes(categoria)
}

/** **Los costos fijos de un período**: la suma de los egresos, sin la mercadería. */
export function costosFijosDe(egresos: readonly EgresoParaFijos[] | null | undefined): number {
  let total = 0
  for (const e of egresos ?? []) {
    if (!esCostoFijo(e)) continue
    total += Number(e?.monto) || 0
  }
  return redondear2(total)
}

/** Lo que costó la mercadería cargada como egreso (informativo: no entra en los fijos). */
export function comprasDeEgresos(egresos: readonly EgresoParaFijos[] | null | undefined): number {
  let total = 0
  for (const e of egresos ?? []) {
    if (esCostoFijo(e)) continue
    total += Number(e?.monto) || 0
  }
  return redondear2(total)
}

export type PuntoDeEquilibrio = {
  /** Los costos fijos del período (S/). */
  costosFijos: number
  /** El margen bruto medido, como fracción: `0.25` = 25 centavos por sol vendido. */
  margen: number
  /**
   * **El margen con el que se calcula** (fracción): el bruto **menos** el impuesto a las ventas.
   * Es el margen de **contribución**: lo que de cada sol vendido queda para pagar los fijos.
   */
  margenContribucion: number
  /** El impuesto a las ventas usado, en **porcentaje** (`1.5` = 1,5 %). */
  impuestoVentasPct: number
  /** Cuánto se lleva el impuesto de **lo vendido** en el período (S/). */
  impuestoDelMes: number
  /** Lo vendido en el período medido (S/). */
  vendido: number
  /** **Cuánto hay que vender** para cubrir los fijos (`null` si el margen es ≤ 0). */
  equilibrio: number | null
  /** Cuánto falta para llegar (`null` si no hay equilibrio posible; `0` si ya se alcanzó). */
  falta: number | null
  /** Qué parte del equilibrio está cubierta, para la barra (0-100). */
  avancePct: number
  alcanzado: boolean
  /** El equilibrio repartido en días de atención (`null` si no hay equilibrio posible). */
  porDia: number | null
  /** Días usados para el equivalente diario. */
  dias: number
}

/**
 * **La cuenta del punto de equilibrio.**
 *
 * `margen` es la **fracción** (no el porcentaje): sale de `margen bruto ÷ ventas` del período que se
 * elija medir (lo sano es usar varios meses: el margen de un mes suelto es ruidoso). `impuestoVentasPct`
 * es el impuesto que se paga **como porcentaje de lo vendido** (ver la cabecera): **se resta del margen**
 * porque también es variable.
 */
export function puntoDeEquilibrio({
  costosFijos,
  vendido,
  margen,
  dias = 26,
  impuestoVentasPct = 0,
}: {
  costosFijos: number
  vendido: number
  margen: number
  /** Días de atención del mes, para el «por día». `26` por defecto (un mes de 30 menos domingos). */
  dias?: number
  /** Impuesto que se paga como **porcentaje de las ventas** (`1.5` = 1,5 %). `0` = no hay. */
  impuestoVentasPct?: number
}): PuntoDeEquilibrio {
  const fijos = Math.max(0, Number(costosFijos) || 0)
  const ventas = Math.max(0, Number(vendido) || 0)
  const bruto = Number(margen) || 0
  const impuesto = Math.max(0, Number(impuestoVentasPct) || 0)
  // Se redondea a 6 decimales para que 0,2237 − 0,015 no arrastre ruido de coma flotante.
  const contribucion = Math.round((bruto - impuesto / 100) * 1e6) / 1e6
  const impuestoDelMes = redondear2((ventas * impuesto) / 100)
  const diasOk = Number(dias) > 0 ? Math.floor(Number(dias)) : 26

  // Sin margen de contribución no hay equilibrio: por cada sol vendido no queda nada para pagar los
  // fijos (y con margen negativo, vender más **agranda** la pérdida). Se devuelve `null`, no un número
  // inventado. ⚠️ Acá cae también el impuesto que se come todo el margen: la pantalla lo tiene que decir.
  if (!(contribucion > 0)) {
    return {
      costosFijos: fijos,
      margen: bruto,
      margenContribucion: contribucion,
      impuestoVentasPct: impuesto,
      impuestoDelMes,
      vendido: ventas,
      equilibrio: null,
      falta: null,
      avancePct: 0,
      alcanzado: false,
      porDia: null,
      dias: diasOk,
    }
  }

  const equilibrio = redondear2(fijos / contribucion)
  const falta = Math.max(0, redondear2(equilibrio - ventas))

  return {
    costosFijos: fijos,
    margen: bruto,
    margenContribucion: contribucion,
    impuestoVentasPct: impuesto,
    impuestoDelMes,
    vendido: ventas,
    equilibrio,
    falta,
    avancePct: equilibrio > 0 ? Math.min(100, redondear2((ventas / equilibrio) * 100)) : 100,
    alcanzado: ventas >= equilibrio,
    porDia: redondear2(equilibrio / diasOk),
    dias: diasOk,
  }
}
