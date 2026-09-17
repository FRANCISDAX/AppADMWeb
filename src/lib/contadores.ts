/**
 * Claves de los contadores de correlativos — **módulo puro** (sin imports, testeable con el
 * runner nativo de Node: `node --test src/lib/contadores.test.ts`).
 *
 * Los correlativos viven en `tblContadores`, un documento por **espacio de numeración**:
 *
 *   - `notaVenta_{serie}` → notas de venta (no van a SUNAT)
 *   - `sunat_{serie}`     → boletas, facturas y notas de crédito/débito
 *
 * Por eso una **NV nunca comparte contador** con una boleta, aunque la serie se llame igual:
 * `NV01` en NV y `NV01` en boletas son dos secuencias distintas (ver `lib/series.ts`, que
 * usa esto para detectar choques de series entre cajas).
 *
 * ⚠️ **Regla que ya se rompió una vez** (ventas pendientes, 16/09/2026): ese flujo usaba
 * `sunat_{serie}` para todo y escribía el campo `contador`. Resultado real: nació un
 * contador `sunat_NV01` que arrancaba en **1** mientras las NV vivas seguían por
 * `notaVenta_NV01 = 173` → la siguiente NV pendiente habría salido `NV01-000001`,
 * **repitiendo un número ya emitido**. Usar **siempre** `claveContador`, nunca la clave a mano.
 */

/** Campo de `tblContadores` donde vive el correlativo. Es el que lee y escribe todo el sistema. */
export const CAMPO_CONTADOR = 'ultimoCorrelativo'

export type EspacioContador = 'sunat' | 'notaVenta'

/** Espacio de numeración de un tipo de documento (`NV` es el único fuera de SUNAT). */
export function espacioContador(tipoDoc: string): EspacioContador {
  return tipoDoc === 'NV' ? 'notaVenta' : 'sunat'
}

/**
 * Id del documento de `tblContadores` que numera un comprobante.
 * @param tipoDoc `NV` | `BOLETA` | `FACTURA` | `NC` | `ND`
 * @param serie Serie ya resuelta (propia de la caja o global de la empresa).
 */
export function claveContador(tipoDoc: string, serie: string): string {
  return `${espacioContador(tipoDoc)}_${serie}`
}
