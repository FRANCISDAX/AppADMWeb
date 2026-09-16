/**
 * Regla de crédito de clientes — **módulo puro** (sin Firebase, sin React).
 *
 * Es la **única** definición de cuándo se puede vender a crédito: la usan el PDV
 * (para bloquear y para mostrar el disponible) y los tests. Si mañana cambia la
 * política (por ejemplo, permitir exceder con autorización), se cambia acá y
 * cambia en todos lados.
 */

import { redondear2 } from './dinero.ts'

/** Límite `0` significa **sin límite configurado** (no "no puede comprar"). */
export const SIN_LIMITE = 0

/** Tolerancia para no bloquear por céntimos de redondeo. */
const TOLERANCIA = 0.01

export type EstadoCredito = {
  /** El cliente existe en `tblClientes`. */
  existe: boolean
  /** `creditoActivo` en la ficha del cliente. */
  activo: boolean
  /** Tope de deuda. `0` = sin límite. */
  limite: number
  /** Lo que ya debe (suma de pendientes de sus ventas a crédito). */
  saldo: number
}

export type EvaluacionCredito = {
  permitido: boolean
  /** Mensaje listo para mostrar cuando NO se permite. */
  motivo?: string
  /** Saldo si se concreta la venta. */
  saldoDespues: number
  /** Cuánto se pasa del límite (0 si entra). */
  excedente: number
  /** Cuánto le queda disponible hoy (`Infinity` si no tiene límite). */
  disponible: number
}

// El redondeo de dinero vive en `dinero.ts` (lo comparten crédito y pagos).
export { redondear2 } from './dinero.ts'

/** Disponible del cliente: `Infinity` sin límite configurado, `0` si ya se pasó. */
export function disponibleDe(estado: EstadoCredito): number {
  if (estado.limite <= SIN_LIMITE) return Infinity
  return Math.max(0, redondear2(estado.limite - estado.saldo))
}

/**
 * ¿Se puede vender `total` a crédito a un cliente con este estado?
 * El motivo viene redactado para mostrarlo tal cual en un aviso.
 */
export function evaluarVentaCredito({ total, estado }: { total: number; estado: EstadoCredito }): EvaluacionCredito {
  const venta = redondear2(Math.max(0, Number(total) || 0))
  const saldoDespues = redondear2(estado.saldo + venta)
  const disponible = disponibleDe(estado)

  if (!estado.existe) {
    return { permitido: false, motivo: 'El cliente no está registrado. Cargalo en Clientes para venderle a crédito.', saldoDespues, excedente: 0, disponible }
  }
  if (!estado.activo) {
    return { permitido: false, motivo: 'El cliente no tiene crédito activo. Activalo en su ficha para venderle a crédito.', saldoDespues, excedente: 0, disponible }
  }
  if (estado.limite <= SIN_LIMITE) {
    // Sin límite configurado: se permite (es el valor por defecto de las fichas).
    return { permitido: true, saldoDespues, excedente: 0, disponible }
  }

  const excedente = redondear2(saldoDespues - estado.limite)
  if (excedente > TOLERANCIA) {
    return {
      permitido: false,
      motivo: `Supera el límite de crédito: debe S/ ${estado.saldo.toFixed(2)} y su límite es S/ ${estado.limite.toFixed(2)}. Esta venta lo dejaría en S/ ${saldoDespues.toFixed(2)} (se pasa por S/ ${excedente.toFixed(2)}).`,
      saldoDespues,
      excedente,
      disponible,
    }
  }
  return { permitido: true, saldoDespues, excedente: 0, disponible }
}
