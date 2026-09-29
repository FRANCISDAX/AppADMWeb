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

/** Lo que este módulo necesita de un documento de venta (el resto no se usa). */
export type DocDeVenta = {
  tipoDoc?: string | null
  estado?: string | null
  /** `true` en una boleta consolidada: agrupa NV que **ya se contaron** en caja. */
  consolidado?: boolean | null
  /** ISO. Es la fecha de **la venta**, no la del envío a SUNAT. */
  fecha?: string | null
  venta?: { total?: number | null } | null
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
}

export type SerieMensual = {
  anio: number
  /** **Siempre los 12 meses**, tenga ventas o no: un mes sin ventas es una barra en cero, no un hueco. */
  meses: MesDeVenta[]
  total: number
  comprobantes: number
  /** El mes con más ventas (`null` si el año no tiene ninguna venta). */
  mejorMes: MesDeVenta | null
  /** El total más alto de un mes: la escala de las barras (**nunca 0**, para no dividir por cero). */
  max: number
  /** Cuántos meses tuvieron alguna venta. */
  mesesConVentas: number
}

/**
 * **Las ventas de un año, mes por mes.**
 *
 * ⚠️ **Filtra por año adentro**: si le pasan el historial completo (o una consulta que se pasó de
 * rango), un comprobante de otro año **no entra**. La función no se fía de la consulta.
 */
export function serieMensual(docs: readonly DocDeVenta[] | null | undefined, anio: number): SerieMensual {
  const meses: MesDeVenta[] = MESES_CORTOS.map((label, i) => ({ mes: i + 1, label, total: 0, comprobantes: 0 }))
  const objetivo = Number(anio)

  for (const d of docs ?? []) {
    if (!esDocumentoDeVenta(d)) continue
    if (Number(anioDeFecha(d.fecha)) !== objetivo) continue
    const m = mesDeFecha(d.fecha)
    if (m < 1) continue
    const bucket = meses[m - 1]
    bucket.total = redondear2(bucket.total + importeNetoDeVenta(d))
    bucket.comprobantes += 1
  }

  const total = redondear2(meses.reduce((s, m) => s + m.total, 0))
  const comprobantes = meses.reduce((s, m) => s + m.comprobantes, 0)
  const conVentas = meses.filter((m) => m.comprobantes > 0)
  const mejorMes = meses.reduce<MesDeVenta | null>((mejor, m) => (m.total > (mejor?.total ?? 0) ? m : mejor), null)
  const max = Math.max(...meses.map((m) => m.total), 0)

  return {
    anio: objetivo,
    meses,
    total,
    comprobantes,
    mejorMes: max > 0 ? mejorMes : null,
    max: max > 0 ? max : 1,
    mesesConVentas: conVentas.filter((m) => m.total !== 0 || m.comprobantes > 0).length,
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
