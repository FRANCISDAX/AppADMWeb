/**
 * **La tasa del IGV: una sola regla.**
 *
 * 🔑 **Por qué existe**: el 18% estaba escrito a mano en **cinco** lugares de la app (la constante
 * `IGV_RATE`, `obtenerInfoAfectacion`, el Registro de Compras, los totales que se mandan a SUNAT y las
 * etiquetas de los PDF). En Perú la tasa **no siempre es 18%**: los **restaurantes y hoteles** (Ley
 * 31556) tributan al **10%**, así que tiene que ser **configurable** — y, sobre todo, tiene que ser la
 * **misma** en el comprobante, en el PDF, en el margen y en el registro que se manda a SUNAT.
 *
 * ⚠️ **La tasa del documento manda sobre la configuración** (`porcentajeDelDocumento`): cada venta guarda
 * la tasa con la que nació. Sin eso, el día que el negocio cambie de régimen (o que alguien corrija el
 * campo), **todos los comprobantes ya emitidos se reimprimirían con la tasa nueva** — una factura
 * declarada al 18% saldría diciendo 10%. Es la misma regla que ya se usa con la afectación
 * (`afectacionGuardada`): **el documento pasado no se reescribe**. La configuración es el **default de lo
 * nuevo**.
 *
 * ⚠️ **Esto es la tasa de VENTA.** La del **papel del proveedor** es otra cosa: una factura de compra
 * trae el IGV que le corresponde al proveedor (18% si es del régimen general), y ese IGV sí es crédito
 * fiscal. Por eso `costoDeCompra()` y el Registro de Compras **no** usan este valor.
 */

/** La tasa general del Perú. Es el valor de fábrica y el respaldo de todo lo que no traiga dato. */
export const IGV_PORCENTAJE_DEFECTO = 18

/**
 * Tope de cordura para el campo de configuración. **No es una regla fiscal**: es para que un dedazo
 * (180 en vez de 18, o un `0` que dejaría las líneas gravadas sin impuesto) no se guarde como si fuera
 * una tasa válida. Fuera de este rango se usa el valor de fábrica.
 */
export const IGV_PORCENTAJE_MAX = 30

/** La tasa de fábrica como factor (`0.18`), que es lo que esperan las fórmulas. */
export const IGV_TASA_DEFECTO = IGV_PORCENTAJE_DEFECTO / 100

/**
 * **Normaliza el porcentaje que carga el usuario**: un número finito, mayor que 0 y dentro del tope, con
 * dos decimales. Cualquier otra cosa (vacío, `0`, texto, `NaN`, un dedazo) cae al **valor de fábrica**
 * —nunca a una tasa inválida— porque un porcentaje mal cargado declara mal todos los comprobantes.
 */
export function porcentajeValido(valor: unknown): number {
  const n = Number(valor)
  if (!Number.isFinite(n) || n <= 0 || n > IGV_PORCENTAJE_MAX) return IGV_PORCENTAJE_DEFECTO
  return Math.round(n * 100) / 100
}

/** Porcentaje → factor: `10` ⇒ `0.1`. */
export function tasaDePorcentaje(porcentaje: unknown): number {
  return porcentajeValido(porcentaje) / 100
}

/** Factor → porcentaje: `0.1` ⇒ `10`. */
export function porcentajeDeTasa(tasa: unknown): number {
  return porcentajeValido((Number(tasa) || 0) * 100)
}

/**
 * **La tasa con la que se declara un documento**: la que se guardó **con la venta** y, si esa venta es
 * anterior a esta función (o viene de la app móvil), la de la configuración de la empresa.
 */
export function porcentajeDelDocumento(venta: unknown, config?: unknown): number {
  const guardado = (venta as { igvPorcentaje?: unknown } | null | undefined)?.igvPorcentaje
  if (Number(guardado) > 0) return porcentajeValido(guardado)
  return porcentajeValido((config as { igvPorcentaje?: unknown } | null | undefined)?.igvPorcentaje)
}

/** La misma regla, como factor para las fórmulas. */
export function tasaDelDocumento(venta: unknown, config?: unknown): number {
  return tasaDePorcentaje(porcentajeDelDocumento(venta, config))
}

/** El porcentaje como se escribe en un papel: `18` · `10` · `18.5` (sin decimales de más). */
export function porcentajeTexto(porcentaje: unknown): string {
  return String(Number(porcentajeValido(porcentaje).toFixed(2)))
}

/**
 * **El título que sale en el comprobante**: `I.G.V. (18%)` o `I.G.V. (10%)`. Una sola implementación
 * para el ticket de 72 mm, el A4 y el reporte, así no pueden decir cosas distintas del mismo documento.
 */
export function etiquetaIgv(porcentaje: unknown): string {
  return `I.G.V. (${porcentajeTexto(porcentaje)}%)`
}
