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

/**
 * Lo que este módulo necesita de un egreso.
 *
 * Los tres últimos campos **no entran en ninguna cuenta**: existen para que el desglose pueda mostrar
 * **de qué gasto** sale cada total (`lineas`). Sin ellos el widget decía «Servicios S/ 185,90» y no había
 * forma de saber que eran internet + celular + agua (📌 la pregunta real del usuario, 17/11/2026:
 * *«¿de dónde sale los 185,90?»*).
 */
export type EgresoParaFijos = {
  categoria?: string | null
  monto?: number | null
  /** Para el detalle del desglose. */
  descripcion?: string | null
  /** La fecha del gasto (ISO `YYYY-MM-DD…`), solo para ordenar y mostrar el detalle. */
  fecha?: string | null
  /** El medio guardado (`caja`, `transferencia`, `provision`, `dueno`, `otro`); la pantalla lo rotula. */
  tipoPago?: string | null
}

/** Lo que se muestra cuando un egreso viejo no tiene descripción: **no se inventa un texto**. */
export const SIN_DESCRIPCION = '(sin descripción)'

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

/** Una línea del desglose: el gasto **tal como se cargó**, para poder auditarlo. */
export type LineaDeEgreso = {
  descripcion: string
  /** La fecha guardada, sin tocar (la pantalla la abrevia). Puede venir vacía en datos viejos. */
  fecha: string
  monto: number
  /** El medio guardado, en minúsculas (`caja`, `transferencia`, `provision`, …). Vacío si no tiene. */
  medio: string
}

/** Un renglón del desglose: cuánto hay en cada categoría, si cuenta como fijo y **qué gastos lo componen**. */
export type CategoriaDeEgreso = {
  categoria: string
  monto: number
  fijo: boolean
  /** 🔑 Las líneas **siempre suman `monto`** (es lo que hace auditable el total). */
  lineas: LineaDeEgreso[]
}

/**
 * **El desglose por categoría**, para que se vea *qué* hay cargado (y qué no).
 * 📌 Sin esto, un total de S/ 169,90 no dice nada: no se puede saber que falta el alquiler.
 * 📌 Y con el total solo, tampoco se sabe **de qué gastos** sale (internet + celular + agua, por ejemplo):
 * por eso cada categoría trae sus `lineas`, con descripción, fecha y medio.
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
    const linea: LineaDeEgreso = {
      descripcion: String(e?.descripcion ?? '').trim() || SIN_DESCRIPCION,
      fecha: String(e?.fecha ?? '').trim(),
      monto: redondear2(monto),
      medio: String(e?.tipoPago ?? '').trim().toLowerCase(),
    }
    const actual = mapa.get(clave)
    if (actual) {
      actual.monto = redondear2(actual.monto + monto)
      actual.lineas.push(linea)
    } else mapa.set(clave, { categoria, monto: redondear2(monto), fijo, lineas: [linea] })
    if (fijo) fijos += monto
    else mercaderia += monto
  }
  // Las líneas van de la **más reciente a la más vieja** (como un estado de cuenta); sin fecha, al final y
  // ordenadas por monto, para que el detalle no cambie de orden entre dos renders.
  for (const c of mapa.values()) {
    c.lineas.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.monto - a.monto)
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

/** Las categorías **fijas** que sí están cargadas (sin repetir, sin mayúsculas). Ignora montos en 0: una fila
 *  vacía no es una categoría cargada. */
export function categoriasFijasDe(egresos: readonly EgresoParaFijos[] | null | undefined): string[] {
  const vistas = new Set<string>()
  for (const e of egresos ?? []) {
    if (!esCostoFijo(e)) continue
    if ((Number(e?.monto) || 0) <= 0) continue
    const categoria = String(e?.categoria ?? '').trim()
    if (categoria) vistas.add(categoria.toLowerCase())
  }
  return [...vistas]
}

/**
 * 🔑 **¿El mes sirve como base?** Un mes con **un** egreso suelto de S/ 12 no describe un local: tomarlo como
 * base hace que el punto de equilibrio diga *«✅ Mes cubierto»* con S/ 54 vendidos.
 *
 * 📌 **El caso real** (03/11/2026): septiembre tenía **un** egreso de S/ 12 y el widget lo usó como «mes con
 * datos» ⇒ equilibrio S/ 52,84 y «cubierto» con S/ 54,60 vendidos. Falsa tranquilidad.
 *
 * La regla: hace falta **al menos `minimoCategorias` categorías fijas distintas** (por defecto **2**:
 * una estructura mínima de local son alquiler + sueldos). Con **provisión** cargada, un mes en curso puede
 * cumplirla desde el día 1 — y entonces **sí** es una base válida aunque el mes no haya cerrado.
 */
export function esMesCompleto(
  egresos: readonly EgresoParaFijos[] | null | undefined,
  minimoCategorias = 2
): boolean {
  if (costosFijosDe(egresos) <= 0) return false
  return categoriasFijasDe(egresos).length >= Math.max(1, minimoCategorias)
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
  /**
   * De dónde salió: `'promedio'` = meses cerrados con datos; `'provisionado'` = el mes en curso **con sus
   * provisiones cargadas** (vale como base); `'incompleto'` = el mes en curso a medias (es un **mínimo**).
   */
  motivo: 'promedio' | 'provisionado' | 'incompleto'
  /** Los meses (YYYY-MM) que entraron en el promedio, del más viejo al más nuevo. */
  mesesUsados: string[]
  /** `false` = el número es un **mínimo**: el mes está incompleto y nunca se cargaron gastos antes. */
  completo: boolean
}

export function baseDeCostosFijos({
  mesesCompletos = [],
  mesEnCurso,
  maximoMeses = 3,
  minimoCategorias = 2,
}: {
  /** Los meses **ya terminados** (el actual no va acá). */
  mesesCompletos?: readonly MesDeEgresos[]
  /** El mes en curso, como respaldo. */
  mesEnCurso?: MesDeEgresos | null
  maximoMeses?: number
  /** Categorías fijas distintas que tiene que tener un mes para servir como base. */
  minimoCategorias?: number
}): BaseDeFijos {
  // 🔑 Solo los meses que **parecen completos**: con fijos > 0 **y** al menos `minimoCategorias` categorías.
  // Un mes sin cargar no es un mes de gasto cero; un mes con un egreso suelto tampoco es un mes real.
  const conDatos = mesesCompletos
    .map((m) => ({ mes: String(m.mes ?? ''), monto: costosFijosDe(m.egresos), valido: esMesCompleto(m.egresos, minimoCategorias) }))
    .filter((m) => m.valido)
    .slice(-Math.max(1, maximoMeses))

  if (conDatos.length > 0) {
    const suma = conDatos.reduce((s, m) => s + m.monto, 0)
    return {
      monto: redondear2(suma / conDatos.length),
      motivo: 'promedio',
      mesesUsados: conDatos.map((m) => m.mes),
      completo: true,
    }
  }

  // Sin meses cerrados válidos: el mes en curso. Sirve como base **si está provisionado** (tiene las
  // categorías cargadas): con devengo, un mes a medias puede estar completo en costos.
  const montoMes = costosFijosDe(mesEnCurso?.egresos)
  const provisionado = esMesCompleto(mesEnCurso?.egresos, minimoCategorias)
  return {
    monto: montoMes,
    motivo: provisionado ? 'provisionado' : 'incompleto',
    mesesUsados: mesEnCurso?.mes ? [String(mesEnCurso.mes)] : [],
    completo: provisionado,
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
