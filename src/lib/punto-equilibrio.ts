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
 * mayúsculas ni espacios.
 *
 * 🔑 **Ampliada el 03/11/2026** (revisión del punto de equilibrio): antes solo tenía `'compras'`, la que se
 * elige a mano en Gastos. Pero los **pagos a proveedores** (`services/pagos-proveedores.ts`) escriben en
 * `tblEgresos` con `categoria: 'pago_proveedor'`, y las compras dejan `'compra'` en el gasto del turno:
 * esas dos **son mercadería**, y su costo **ya está descontado en el margen**. Contarlas como fijas
 * **duplicaba la mercadería** y el equilibrio pedía vender de más.
 */
export const CATEGORIAS_VARIABLES: readonly string[] = ['compras', 'compra', 'pago_proveedor']

/**
 * 🔑 **Las categorías de gasto fijo que un negocio suele tener.** Sirven para **decir qué falta** cuando el
 * mes está incompleto: sin alquiler ni sueldos cargados el punto de equilibrio sale irrealmente bajo —no
 * porque la cuenta esté mal, sino porque el dato no está—. Se comparan sin mayúsculas.
 * (Son las mismas que ofrece `services/egresos.ts` en el listado, menos «Compras» y «Otros».)
 */
export const CATEGORIAS_FIJAS_TIPICAS: readonly string[] = [
  'alquiler',
  'sueldos',
  'servicios',
  'impuestos',
  'mantenimiento',
  'transporte',
]

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

/** Un renglón del desglose: cuánto hay en cada categoría y si cuenta como fijo. */
export type CategoriaDeEgreso = { categoria: string; monto: number; fijo: boolean }

/**
 * **El desglose por categoría**, para que se vea *qué* hay cargado (y qué no).
 * 📌 Sin esto, un total de S/ 169,90 no dice nada: no se puede saber que falta el alquiler.
 */
export function resumenDeEgresos(egresos: readonly EgresoParaFijos[] | null | undefined): {
  fijos: number
  mercaderia: number
  porCategoria: CategoriaDeEgreso[]
} {
  const mapa = new Map<string, CategoriaDeEgreso>()
  let fijos = 0
  let mercaderia = 0
  for (const e of egresos ?? []) {
    const monto = Number(e?.monto) || 0
    if (monto === 0) continue
    const fijo = esCostoFijo(e)
    const categoria = String(e?.categoria ?? '').trim() || 'Sin categoría'
    const clave = categoria.toLowerCase()
    const actual = mapa.get(clave)
    if (actual) actual.monto = redondear2(actual.monto + monto)
    else mapa.set(clave, { categoria, monto: redondear2(monto), fijo })
    if (fijo) fijos += monto
    else mercaderia += monto
  }
  return {
    fijos: redondear2(fijos),
    mercaderia: redondear2(mercaderia),
    porCategoria: [...mapa.values()].sort((a, b) => b.monto - a.monto),
  }
}

/** Las categorías fijas típicas que **no** aparecen en los egresos dados (lo que falta cargar). */
export function categoriasAusentes(
  categorias: readonly string[] | null | undefined,
  esperadas: readonly string[] = CATEGORIAS_FIJAS_TIPICAS
): string[] {
  const presentes = new Set((categorias ?? []).map((c) => String(c ?? '').trim().toLowerCase()))
  return esperadas.filter((c) => !presentes.has(c.toLowerCase()))
}

/** Lo que se cargó en Egresos como impuesto (para avisar del doble conteo con el impuesto a las ventas). */
export function impuestosEnEgresos(egresos: readonly EgresoParaFijos[] | null | undefined): number {
  let total = 0
  for (const e of egresos ?? []) {
    if (String(e?.categoria ?? '').trim().toLowerCase() !== 'impuestos') continue
    total += Number(e?.monto) || 0
  }
  return redondear2(total)
}

/**
 * 🔑 **¿Con qué costos fijos se calcula el equilibrio?** (revisión del 03/11/2026)
 *
 * 📌 **El problema**: el widget usaba los Egresos del **mes en curso**. El 3 de noviembre eso son **3 días**
 * de gastos comparados contra un objetivo de **mes completo** ⇒ el equilibrio salía **irrealmente bajo**
 * (S/ 751 cuando la verdad podía ser S/ 10.000) y daba una tranquilidad falsa justo cuando el número importa.
 *
 * 🔑 **La regla, y lo que NO hace**: usa el **promedio de los meses YA TERMINADOS que tienen gastos
 * cargados**; si no hay ninguno, cae al mes en curso **marcándolo como incompleto** (`completo: false`).
 * ⚠️ **Jamás promedia meses vacíos**: con dos meses sin cargar, `(169,90 + 0 + 0) ÷ 3 = 57` **inventaría**
 * un negocio que no paga nada y hundiría el equilibrio a una cuarta parte. Sin dato, se dice que falta;
 * no se rellena con ceros.
 */
export type MesDeEgresos = { mes: string; egresos: readonly EgresoParaFijos[] | null | undefined }

export type BaseDeFijos = {
  /** Con cuánto se calcula. */
  monto: number
  /** `'promedio'` = meses completos con datos; `'mes-en-curso'` = el mes a medias (mínimo conocido). */
  fuente: 'promedio' | 'mes-en-curso'
  /** Los meses (YYYY-MM) que entraron en el promedio, del más viejo al más nuevo. */
  mesesUsados: string[]
  /** `false` = el número es un **mínimo**: el mes todavía no terminó (o nunca se cargaron gastos antes). */
  completo: boolean
}

export function baseDeCostosFijos({
  mesesCompletos = [],
  mesEnCurso,
  maximoMeses = 3,
}: {
  /** Los meses **ya terminados** (el actual no va acá). */
  mesesCompletos?: readonly MesDeEgresos[]
  /** El mes en curso, como respaldo. */
  mesEnCurso?: MesDeEgresos | null
  maximoMeses?: number
}): BaseDeFijos {
  // Solo los meses con fijos > 0: un mes sin cargar no es un mes de gastos cero.
  const conDatos = mesesCompletos
    .map((m) => ({ mes: String(m.mes ?? ''), monto: costosFijosDe(m.egresos) }))
    .filter((m) => m.monto > 0)
    .slice(-Math.max(1, maximoMeses))

  if (conDatos.length > 0) {
    const suma = conDatos.reduce((s, m) => s + m.monto, 0)
    return {
      monto: redondear2(suma / conDatos.length),
      fuente: 'promedio',
      mesesUsados: conDatos.map((m) => m.mes),
      completo: true,
    }
  }

  return {
    monto: costosFijosDe(mesEnCurso?.egresos),
    fuente: 'mes-en-curso',
    mesesUsados: mesEnCurso?.mes ? [String(mesEnCurso.mes)] : [],
    completo: false,
  }
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
