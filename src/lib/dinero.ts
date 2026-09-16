/**
 * Aritmética de dinero — módulo puro y mínimo.
 *
 * Vive aparte porque lo comparten dos reglas de negocio distintas (crédito y
 * formas de pago): así el redondeo se define **una sola vez** y no hay dos
 * implementaciones que se desincronicen.
 */

/** Redondeo a 2 decimales evitando los típicos 0.30000000000000004. */
export function redondear2(n: number): number {
  const valor = Number(n) || 0
  return Math.round((valor + Number.EPSILON) * 100) / 100
}
