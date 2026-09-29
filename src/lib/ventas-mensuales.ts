/**
 * **Las ventas de un año, mes por mes** — módulo puro (sin Firebase ni React).
 *
 * 🔑 **Para qué**: el **Dashboard Gerencial** muestra el día (ventas de hoy, por hora, top productos).
 * Esto es la otra mitad: **cómo viene el año**, un mes al lado del otro, para elegir el año con un
 * selector. La cuenta la hace este módulo y la pantalla **solo dibuja** (regla de la casa).
 *
 * 🔑 **Una regla, una implementación**: acá vive QUÉ es una venta para los reportes —
 * `esDocumentoDeVenta()` (no anulada, no consolidada, y de tipo NV/BOLETA/FACTURA/NC/ND) y
 * `signoDoc()` (**la nota de crédito resta**, el resto suma)—. Estaba escrita a mano en cuatro
 * lugares (`obtenerVentasPorRango` y el filtro del dashboard, más una copia en `VentasPorEmpleado`
 * y otra en `ReporteSire`); ahora la usan todos desde acá, así **el gráfico no puede contradecir a
 * Reportes**.
 *
 * ⚠️ **Lo que NO cuenta como venta**: un pedido pendiente (`PENDIENTE`), un documento anulado o
 * `cancelado`, y una boleta consolidada (sus NV ya se contaron en caja). Un **cobro de crédito**
 * tampoco es una venta nueva — no entra acá porque no es un documento de venta con ese `tipoDoc`.
 */

import { redondear2 } from './dinero.ts'
import { margenDePrecio } from './precio-venta.ts'
import { afectacionGuardada, cantidadDe } from './sunat-importes.ts'
import { costoDeProducto } from './valorizacion.ts'

/** Un ítem de un documento de venta: lo mínimo para valorizar la línea (cantidad en unidad base). */
export type ItemDeDocumento = {
  id?: string
  cantidad?: number
  quantity?: number
  precioVenta?: number
  subtotal?: number
  tipoAfectacion?: string
}

/** Lo que este módulo necesita de un documento de venta (el resto no se usa). */
export type DocDeVenta = {
  tipoDoc?: string | null
  estado?: string | null
  /** `true` en una boleta consolidada: agrupa NV que **ya se contaron** en caja. */
  consolidado?: boolean | null
  /** ISO. Es la fecha de **la venta**, no la del envío a SUNAT. */
  fecha?: string | null
  venta?: { total?: number | null; items?: readonly ItemDeDocumento[] | null } | null
}

/** Los tipos de comprobante que son una venta del negocio (los que suma el reporte de ventas). */
export const TIPOS_DE_VENTA = ['NV', 'BOLETA', 'FACTURA', 'NC', 'ND'] as const

/**
 * **¿Este documento cuenta como venta?** No anulado, no consolidado, y de un tipo de venta.
 * Es la misma condición que usa `obtenerVentasPorRango` para traer el rango.
 */
export function esDocumentoDeVenta(d: DocDeVenta | null | undefined): boolean {
  if (!d) return false
  if (d.estado === 'anulada') return false
  if (d.consolidado) return false
  return (TIPOS_DE_VENTA as readonly string[]).includes(String(d.tipoDoc ?? ''))
}

/**
 * **El signo del documento en los totales**: `-1` para la **nota de crédito** (le devolvieron plata al
 * cliente: resta de lo vendido) y `+1` para todo lo demás (la nota de débito suma).
 */
export function signoDoc(d: DocDeVenta | null | undefined): number {
  return d?.tipoDoc === 'NC' ? -1 : 1
}

/**
 * **Lo que un comprobante aporta al total del período** (la NC resta). Devuelve `0` si el documento
 * no es una venta, así el llamador puede recorrer una lista cruda sin filtrarla antes.
 */
export function importeNetoDeVenta(d: DocDeVenta | null | undefined): number {
  if (!esDocumentoDeVenta(d)) return 0
  return redondear2(signoDoc(d) * (Number(d?.venta?.total) || 0))
}

/** El mes (1-12) de una fecha ISO. `0` cuando la fecha no se puede leer. */
export function mesDeFecha(fecha?: string | null): number {
  const d = new Date(String(fecha ?? ''))
  return Number.isNaN(d.getTime()) ? 0 : d.getMonth() + 1
}

/** El año de una fecha ISO. `0` cuando la fecha no se puede leer. */
export function anioDeFecha(fecha?: string | null): number {
  const d = new Date(String(fecha ?? ''))
  return Number.isNaN(d.getTime()) ? 0 : d.getFullYear()
}

/** Los meses como se muestran en el gráfico (3 letras, en orden). */
export const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'] as const

export type MesDeVenta = {
  /** 1-12. */
  mes: number
  label: string
  /** Lo vendido ese mes (con la nota de crédito ya restada). Puede ser negativo si las
   *  devoluciones del mes superan lo vendido. */
  total: number
  /** Cuántos comprobantes de venta hubo (incluye notas de crédito y de débito). */
  comprobantes: number
  /** Lo vendido **para el negocio**, sin IGV en los gravados (la base del margen). */
  ingreso: number
  /** Lo que costó la mercadería vendida (a costo promedio: `lib/valorizacion.ts`). */
  costo: number
  /** `ingreso − costo`: **el margen bruto del mes**. Es la utilidad antes de los gastos fijos. */
  margen: number
  /** Líneas vendidas sin costo cargado: **infla el margen** (se venden como si fueran gratis). */
  itemsSinCosto: number
}

/** El costo y la afectación de un producto, ya resueltos, para valorizar lo vendido. */
export type CostoDeProducto = { costo: number; afectacion?: string }

/** Lo mínimo del catálogo para armar el mapa de costos. */
type ProductoDeCatalogo = {
  id: string
  costoPromedio?: number | null
  precioCompra?: number | null
  costo?: number | null
  tipoAfectacion?: string
}

/**
 * **El costo de cada producto del catálogo, listo para valorizar las ventas** (`id → costo + afectación`).
 *
 * 🔑 El costo sale de **`costoDeProducto()`** (promedio ponderado móvil, con el último costo como
 * respaldo): es la regla única de la casa para leer el costo de un producto **para plata**. Si acá se
 * leyera `precioCompra` a mano, el margen del gráfico diría algo distinto que Análisis.
 */
export function mapaDeCostos(productos: readonly ProductoDeCatalogo[] | null | undefined): Map<string, CostoDeProducto> {
  const mapa = new Map<string, CostoDeProducto>()
  for (const p of productos ?? []) {
    if (!p?.id) continue
    mapa.set(String(p.id), {
      costo: costoDeProducto(p),
      ...(p.tipoAfectacion ? { afectacion: String(p.tipoAfectacion) } : {}),
    })
  }
  return mapa
}

/** Lo que aporta un comprobante: venta neta, costo de la mercadería y margen. */
export type MargenDeDocumento = { ingreso: number; costo: number; margen: number; itemsSinCosto: number }

/**
 * **El margen bruto de un comprobante**, línea por línea.
 *
 * 🔑 **La cuenta es la misma que la de Análisis** (`margenDePrecio` sobre la **base neta**: en un ítem
 * gravado el IGV cobrado no es plata del negocio ⇒ `lib/precio-venta.ts`) y con el **mismo costo**
 * (`costoDeProducto`). Por eso el margen del gráfico no puede contradecir a Análisis.
 *
 * ⚠️ **La afectación sale del ítem** y, si no la tiene (documento viejo), del producto; el respaldo es
 * **exonerado** (`afectacionGuardada`): suponer gravado un documento histórico le restaría un 18% que
 * nadie declaró.
 * ⚠️ **Un ítem sin producto en el catálogo** (los «Embalaje y Otros») no tiene costo: cuenta como
 * ingreso con costo 0 y por eso se informa en `itemsSinCosto` — el margen de ese mes está **inflado**
 * y la pantalla tiene que poder avisarlo.
 */
export function margenDeDocumento(
  d: DocDeVenta | null | undefined,
  costos?: Map<string, CostoDeProducto> | null,
): MargenDeDocumento {
  let ingreso = 0
  let costo = 0
  let itemsSinCosto = 0

  const items = d?.venta?.items ?? []

  // ⚠️ **Sin el mapa de costos el margen NO se puede calcular.** Devolver `ingreso` como margen sería
  // decir que se gana todo lo que se vende (100% de utilidad), y eso es peor que mostrar cero: un
  // gráfico que miente es peor que un gráfico vacío. El ingreso sí se calcula (siempre se puede).
  if (!costos) {
    for (const it of items) {
      const cant = cantidadDe(it as { cantidad?: number; quantity?: number })
      if (cant <= 0) continue
      ingreso += margenDePrecio(Number(it?.precioVenta) || 0, 0, afectacionGuardada(it as { tipoAfectacion?: unknown })).neto * cant
      itemsSinCosto += 1
    }
    const sinCostos = signoDoc(d)
    return { ingreso: redondear2(sinCostos * ingreso), costo: 0, margen: 0, itemsSinCosto }
  }

  for (const it of items) {
    const cant = cantidadDe(it as { cantidad?: number; quantity?: number })
    if (cant <= 0) continue
    const pid = String(it?.id ?? '')
    const delCatalogo = costos.get(pid)
    const costoUnitario = delCatalogo?.costo ?? 0
    const afectacion = afectacionGuardada(
      it as { tipoAfectacion?: unknown },
      delCatalogo?.afectacion ? { tipoAfectacion: delCatalogo.afectacion } : null,
    )
    const m = margenDePrecio(Number(it?.precioVenta) || 0, costoUnitario, afectacion)
    ingreso += m.neto * cant
    costo += costoUnitario * cant
    // ⚠️ **Sin costo es sin costo**: lo mismo da un ítem que no está en el catálogo (los «Embalaje»)
    // que un producto al que nunca se le cargó el costo (vale S/ 0 ⇒ margen del 100%). Los dos inflan
    // el margen y bajan el punto de equilibrio, así que los dos se avisan.
    if (!delCatalogo || costoUnitario <= 0) itemsSinCosto += 1
  }

  // Una NC devuelve mercadería: resta el ingreso **y** el costo (la mercadería vuelve al stock).
  const signo = signoDoc(d)
  return {
    ingreso: redondear2(signo * ingreso),
    costo: redondear2(signo * costo),
    margen: redondear2(signo * (ingreso - costo)),
    itemsSinCosto,
  }
}

export type SerieMensual = {
  anio: number
  /** **Siempre los 12 meses**, tenga ventas o no: un mes sin ventas es una barra en cero, no un hueco. */
  meses: MesDeVenta[]
  total: number
  comprobantes: number
  /** Lo vendido en el año **sin IGV** (la base del margen). */
  ingreso: number
  /** Lo que costó la mercadería vendida en el año. */
  costo: number
  /** **El margen bruto del año** (`ingreso − costo`). */
  margen: number
  /** El margen como porcentaje de lo vendido (`0` si no hubo ventas). */
  margenPct: number
  /** Líneas sin costo en todo el año (avisa que el margen está inflado). */
  itemsSinCosto: number
  /** El mes con más ventas (`null` si el año no tiene ninguna venta). */
  mejorMes: MesDeVenta | null
  /** El total más alto de un mes: la escala de las barras (**nunca 0**, para no dividir por cero). */
  max: number
  /** Lo mismo para el margen: la escala de las barras de utilidad. */
  maxMargen: number
  /** Cuántos meses tuvieron alguna venta. */
  mesesConVentas: number
}

/**
 * **Las ventas de un año, mes por mes.**
 *
 * ⚠️ **Filtra por año adentro**: si le pasan el historial completo (o una consulta que se pasó de
 * rango), un comprobante de otro año **no entra**. La función no se fía de la consulta.
 */
export function serieMensual(
  docs: readonly DocDeVenta[] | null | undefined,
  anio: number,
  opts: { costos?: Map<string, CostoDeProducto> | null } = {},
): SerieMensual {
  const meses: MesDeVenta[] = MESES_CORTOS.map((label, i) => ({
    mes: i + 1,
    label,
    total: 0,
    comprobantes: 0,
    ingreso: 0,
    costo: 0,
    margen: 0,
    itemsSinCosto: 0,
  }))
  const objetivo = Number(anio)

  for (const d of docs ?? []) {
    if (!esDocumentoDeVenta(d)) continue
    if (Number(anioDeFecha(d.fecha)) !== objetivo) continue
    const m = mesDeFecha(d.fecha)
    if (m < 1) continue
    const bucket = meses[m - 1]
    bucket.total = redondear2(bucket.total + importeNetoDeVenta(d))
    bucket.comprobantes += 1
    const mg = margenDeDocumento(d, opts.costos)
    bucket.ingreso = redondear2(bucket.ingreso + mg.ingreso)
    bucket.costo = redondear2(bucket.costo + mg.costo)
    bucket.margen = redondear2(bucket.margen + mg.margen)
    bucket.itemsSinCosto += mg.itemsSinCosto
  }

  const total = redondear2(meses.reduce((s, m) => s + m.total, 0))
  const comprobantes = meses.reduce((s, m) => s + m.comprobantes, 0)
  const ingreso = redondear2(meses.reduce((s, m) => s + m.ingreso, 0))
  const costo = redondear2(meses.reduce((s, m) => s + m.costo, 0))
  // ⚠️ **El margen del año se SUMA de los meses**, no se calcula como `ingreso − costo`: si un mes no
  // se pudo valorizar (sin costos), restar ahí inventaría un margen del 100%.
  const margen = redondear2(meses.reduce((s, m) => s + m.margen, 0))
  const itemsSinCosto = meses.reduce((s, m) => s + m.itemsSinCosto, 0)
  const conVentas = meses.filter((m) => m.comprobantes > 0)
  const mejorMes = meses.reduce<MesDeVenta | null>((mejor, m) => (m.total > (mejor?.total ?? 0) ? m : mejor), null)
  const max = Math.max(...meses.map((m) => m.total), 0)
  // Las barras de margen escalan aparte: pueden ser negativas (un mes de puras devoluciones) y
  // mezclar esa escala con la de ventas haría que ninguna de las dos se vea.
  const maxMargen = Math.max(...meses.map((m) => m.margen), 0)

  return {
    anio: objetivo,
    meses,
    total,
    comprobantes,
    ingreso,
    costo,
    margen,
    margenPct: ingreso > 0 ? redondear2((margen / ingreso) * 100) : 0,
    itemsSinCosto,
    mejorMes: max > 0 ? mejorMes : null,
    max: max > 0 ? max : 1,
    maxMargen: maxMargen > 0 ? maxMargen : 1,
    mesesConVentas: conVentas.filter((m) => m.total !== 0 || m.comprobantes > 0).length,
  }
}

/**
 * **El margen de un período cualquiera** (no de un año calendario): se usa para el **punto de
 * equilibrio**, que mide los últimos meses para no depender del ruido de uno solo.
 *
 * El margen se devuelve como **fracción** (`0.25` = 25 centavos por sol vendido), que es lo que come
 * `puntoDeEquilibrio()`. Es un promedio **ponderado por ventas** (no el promedio de los porcentajes
 * de cada mes): un mes flojito pesa menos, que es lo correcto.
 */
export function margenDelPeriodo(
  docs: readonly DocDeVenta[] | null | undefined,
  costos?: Map<string, CostoDeProducto> | null,
): { ingreso: number; costo: number; margen: number; margenPct: number; itemsSinCosto: number; comprobantes: number } {
  let ingreso = 0
  let costo = 0
  let margen = 0
  let itemsSinCosto = 0
  let comprobantes = 0

  for (const d of docs ?? []) {
    if (!esDocumentoDeVenta(d)) continue
    const m = margenDeDocumento(d, costos)
    ingreso += m.ingreso
    costo += m.costo
    margen += m.margen
    itemsSinCosto += m.itemsSinCosto
    comprobantes += 1
  }

  const ingresoR = redondear2(ingreso)
  const margenR = redondear2(margen)
  return {
    ingreso: ingresoR,
    costo: redondear2(costo),
    margen: margenR,
    margenPct: ingresoR > 0 ? redondear2((margenR / ingresoR) * 100) : 0,
    itemsSinCosto,
    comprobantes,
  }
}

/**
 * **Los años que ofrece el selector**, del más nuevo al más viejo: desde el año del primer
 * comprobante hasta el año actual. Si el primero es inválido (0, `NaN`, o posterior al actual) cae a
 * `anioActual - 4`, así el selector **nunca queda vacío**.
 */
export function aniosParaSelector(primerAnio: number, anioActual: number): number[] {
  const actual = Number.isFinite(Number(anioActual)) && Number(anioActual) > 2000 ? Math.floor(Number(anioActual)) : new Date().getFullYear()
  const primero = Number.isFinite(Number(primerAnio)) ? Math.floor(Number(primerAnio)) : 0
  const desde = primero > 2000 && primero <= actual ? primero : actual - 4
  const anios: number[] = []
  for (let a = actual; a >= desde; a--) anios.push(a)
  return anios
}

/** La etiqueta del mes para el título de la barra: `Ene 2026`. */
export const etiquetaMes = (anio: number, mes: number) => `${MESES_CORTOS[Math.min(11, Math.max(0, mes - 1))]} ${anio}`
